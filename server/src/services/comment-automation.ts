import { AppError, notFound } from "../core/i18n.js";
import { createLogger } from "../core/logger.js";
import { channelsRepo } from "../core/repos/channels.js";
import { commentRulesRepo, privateRepliesRepo, type CommentRuleInput } from "../core/repos/comment-automation.js";
import { inboxRepo } from "../core/repos/inbox.js";
import { activityRepo } from "../core/repos/misc.js";
import type { Channel, CommentRule, Conversation, Ctx, DmButton, PrivateReply } from "../core/types.js";
import { getProvider, ProviderError, type InboundEvent } from "../providers/index.js";
import { requireRole } from "./access.js";
import { matchesKeywords, parseKeywordList } from "./keyword-match.js";
import { assertFeature, hasFeature } from "./limits.js";
import { ensureFreshToken } from "./publisher.js";

/**
 * Yorumdan DM'e (ManyChat "comment to DM" benzeri).
 * Webhook'tan gelen gönderi yorumu bir kurala uyarsa kuyruğa eklenir; zamanlayıcı kuyruğu işler ve
 * yorum sahibine özel yanıt (private reply) gönderir, istenirse yorumun altına açık bir cevap yazar.
 *
 * Meta kuralları:
 * - Yorum başına tek özel yanıt, yorumdan sonraki 7 gün içinde.
 * - Instagram hesabı başına saatte en fazla 750 çağrı (burada 700: yeniden denemeler için pay).
 */

const log = createLogger("comment-dm");

export const PRIVATE_REPLY_HOURLY_LIMIT = 700;
export const PRIVATE_REPLY_WINDOW_DAYS = 7;
export const PRIVATE_REPLY_MAX_ATTEMPTS = 3;
/** Geçici hatadan sonra bekleme (dakika): 1. denemeden sonra 1, 2.'den sonra 5 */
const RETRY_DELAY_MINUTES = [1, 5];
/** Tek seferde kanal başına işlenecek en fazla kayıt (bir tik uzun sürmesin) */
const BATCH_PER_CHANNEL = 25;

export const BOT_NOTICE = "(Bu mesaj otomatik gönderildi.)";

const WINDOW_MS = PRIVATE_REPLY_WINDOW_DAYS * 86400_000;

interface CommentMeta {
  commentId?: string;
  mediaId?: string;
  parentId?: string | null;
}

/** Kural bu yorumda çalışır mı (kanal, gönderi, cevap yorumu ve metin) */
export function commentRuleApplies(
  rule: Pick<CommentRule, "enabled" | "channelId" | "mediaIds" | "matchType" | "pattern" | "includeReplies">,
  channelId: string,
  mediaId: string,
  text: string,
  isReply: boolean,
): boolean {
  if (!rule.enabled) return false;
  if (rule.channelId && rule.channelId !== channelId) return false;
  if (rule.mediaIds.length && !rule.mediaIds.includes(mediaId)) return false;
  if (isReply && !rule.includeReplies) return false;
  if (rule.matchType === "any") return true;
  return matchesKeywords(rule.pattern, text);
}

/** DM metni: {{name}} yerine kullanıcı adı, istenirse sonuna otomatik mesaj notu */
export function buildDmText(rule: Pick<CommentRule, "dmText" | "botNotice">, participantName: string | null): string {
  const name = (participantName ?? "").replace(/^@/, "");
  const body = rule.dmText.replace(/\{\{\s*(name|isim)\s*\}\}/g, name).trim();
  return rule.botNotice ? `${body}\n\n${BOT_NOTICE}` : body;
}

/** Düğmeye basılınca gelen payload: "cr:<kuralId>:<düğme sırası>" */
const POSTBACK_PREFIX = "cr:";

export function commentButtonPayload(ruleId: string, index: number): string {
  return `${POSTBACK_PREFIX}${ruleId}:${index}`;
}

/** Kuralın düğmelerini giden mesaj düğmelerine çevirir (bağlantı ya da basınca cevap) */
export function buildDmButtons(rule: Pick<CommentRule, "id" | "buttons">): DmButton[] {
  return rule.buttons.slice(0, 3).map((b, i) =>
    b.url ? { type: "web_url" as const, title: b.title, url: b.url } : { type: "postback" as const, title: b.title, payload: commentButtonPayload(rule.id, i) },
  );
}

/** Gelen kutusunda giden mesajın düğmeleriyle birlikte görünen metni */
function textWithButtons(text: string, buttons: DmButton[]): string {
  return buttons.length ? `${text}\n\n${buttons.map((b) => `[${b.title}]`).join(" ")}` : text;
}

/** Açık cevap varyasyonlarından birini seçer (aynı metin tekrar tekrar görünmesin) */
export function pickPublicReply(options: string[], random: () => number = Math.random): string | null {
  const list = options.map((o) => o.trim()).filter(Boolean);
  if (!list.length) return null;
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/**
 * Webhook'tan gelen yorumu uygun ilk kurala göre kuyruğa ekler.
 * Dönen değer: eklenen kuralın kimliği; kural yoksa, tekrar eden olaysa ya da kişi bu gönderide
 * zaten bir özel yanıt aldıysa null.
 */
export function enqueueCommentDm(channel: Channel, ev: InboundEvent, now = new Date(), random: () => number = Math.random): string | null {
  if (ev.kind !== "comment") return null;
  if (channel.provider !== "instagram" && channel.provider !== "facebook") return null;
  if (!getProvider(channel.provider).sendPrivateReply) return null;
  const meta = (ev.metadata ?? {}) as CommentMeta;
  if (!meta.commentId || !meta.mediaId) return null;
  const commentedAt = ev.receivedAt ? new Date(ev.receivedAt) : now;
  if (now.getTime() - commentedAt.getTime() > WINDOW_MS) return null;
  if (!hasFeature(channel.orgId, "inbox")) return null;

  const isReply = Boolean(meta.parentId);
  const rule = commentRulesRepo.list(channel.orgId).find((r) => commentRuleApplies(r, channel.id, meta.mediaId!, ev.text, isReply));
  if (!rule) return null;

  const added = privateRepliesRepo.enqueue(
    {
      channelId: channel.id,
      commentId: meta.commentId,
      orgId: channel.orgId,
      ruleId: rule.id,
      mediaId: meta.mediaId,
      commenterId: ev.participantId,
      commenterName: ev.participantName ?? null,
      commentText: ev.text,
      commentedAt: commentedAt.toISOString(),
      dmText: buildDmText(rule, ev.participantName ?? null),
      dmButtons: buildDmButtons(rule),
      publicReplyText: pickPublicReply(rule.publicReplies, random),
    },
    now,
  );
  return added ? rule.id : null;
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

/** Tek kaydı işler; DM gittiyse true */
async function sendOne(channel: Channel, item: PrivateReply, now: Date): Promise<boolean> {
  const { channelId, commentId } = item;
  if (now.getTime() - new Date(item.commentedAt).getTime() > WINDOW_MS) {
    privateRepliesRepo.markDone(channelId, commentId, "expired", `${PRIVATE_REPLY_WINDOW_DAYS} günlük süre doldu`);
    return false;
  }
  const rule = item.ruleId ? commentRulesRepo.get(item.orgId, item.ruleId) : null;
  if (!rule?.enabled) {
    privateRepliesRepo.markDone(channelId, commentId, "skipped", "kural kapatıldı ya da silindi");
    return false;
  }
  // Konuşma insana devredildiyse (ör. "durdur" yazan kişi) otomatik mesaj gönderilmez
  const dmConversation = inboxRepo.findConversation(channel.id, item.commenterId);
  if (dmConversation?.mode === "manual") {
    privateRepliesRepo.markDone(channelId, commentId, "skipped", "konuşma insana devredilmiş");
    return false;
  }
  const provider = getProvider(channel.provider);
  if (!provider.sendPrivateReply) {
    privateRepliesRepo.markDone(channelId, commentId, "failed", "kanal özel yanıtı desteklemiyor");
    return false;
  }

  let fresh: Channel;
  let dmMessageId: string | null;
  try {
    fresh = await ensureFreshToken(channel);
    dmMessageId = (await provider.sendPrivateReply(fresh, commentId, { text: item.dmText, buttons: item.dmButtons })).externalId ?? null;
  } catch (e) {
    const msg = errorText(e);
    const retryable = !(e instanceof ProviderError) || e.retryable;
    if (retryable && item.attempts < PRIVATE_REPLY_MAX_ATTEMPTS) {
      const wait = RETRY_DELAY_MINUTES[Math.min(item.attempts, RETRY_DELAY_MINUTES.length) - 1] ?? 5;
      privateRepliesRepo.retryLater(channelId, commentId, new Date(now.getTime() + wait * 60_000), msg);
    } else {
      privateRepliesRepo.markDone(channelId, commentId, "failed", msg);
      activityRepo.add(channel.orgId, "error", "dm", `${channel.name}: yorumdan DM gönderilemedi: ${msg}`, { commentId, ruleId: item.ruleId });
    }
    return false;
  }

  privateRepliesRepo.markSent(channelId, commentId, dmMessageId, now);
  const conv = inboxRepo.ensureConversation({
    orgId: channel.orgId,
    channelId: channel.id,
    externalId: item.commenterId,
    participantId: item.commenterId,
    participantName: item.commenterName,
  });
  inboxRepo.recordOutbound(conv.id, textWithButtons(item.dmText, item.dmButtons), "rule", { externalId: dmMessageId, ruleId: item.ruleId });

  if (item.publicReplyText && provider.publishComment) {
    try {
      const r = await provider.publishComment(fresh, item.mediaId, item.publicReplyText, commentId);
      privateRepliesRepo.markPublicReply(channelId, commentId, { id: r.externalId });
    } catch (e) {
      privateRepliesRepo.markPublicReply(channelId, commentId, { error: errorText(e) });
    }
  }
  return true;
}

/** Kuyruğu işler: kanal başına saatlik sınırı aşmadan sırası gelen kayıtları gönderir */
export async function processPrivateReplyQueue(now = new Date()): Promise<{ sent: number; processed: number }> {
  const recovered = privateRepliesRepo.recoverStale(now);
  if (recovered) log.warn("takılı kalan özel yanıtlar kuyruğa geri alındı", { count: recovered });
  let processed = 0;
  let sent = 0;
  for (const channelId of privateRepliesRepo.channelsDue(now)) {
    const channel = channelsRepo.getById(channelId);
    const used = privateRepliesRepo.attemptsSince(channelId, new Date(now.getTime() - 3600_000));
    const items = privateRepliesRepo.claimDue(channelId, Math.min(BATCH_PER_CHANNEL, PRIVATE_REPLY_HOURLY_LIMIT - used), now);
    for (const item of items) {
      processed++;
      if (!channel || channel.status === "disabled") {
        privateRepliesRepo.markDone(channelId, item.commentId, "skipped", "kanal kapalı");
        continue;
      }
      const ok = await sendOne(channel, item, now).catch((e) => {
        privateRepliesRepo.markDone(channelId, item.commentId, "failed", errorText(e));
        log.error("özel yanıt işlenemedi", { channel: channelId, e: errorText(e) });
        return false;
      });
      if (ok) sent++;
    }
  }
  return { sent, processed };
}

/* ---------------- Kural yönetimi (panel ve MCP) ---------------- */

function checkRule(ctx: Ctx, r: Pick<CommentRuleInput, "channelId" | "matchType" | "pattern" | "buttons" | "dmText" | "botNotice">): void {
  if (r.channelId) {
    const ch = channelsRepo.get(ctx.orgId, r.channelId);
    if (!ch) throw notFound("channel");
    if (ch.provider !== "instagram" && ch.provider !== "facebook") throw new AppError(400, "comment_rule.provider");
  }
  if (r.matchType === "keyword" && !parseKeywordList(r.pattern).length) throw new AppError(400, "comment_rule.pattern");
  const buttons = r.buttons ?? [];
  if (buttons.length > 3) throw new AppError(400, "comment_rule.buttons");
  for (const b of buttons) {
    if (Boolean(b.url) === Boolean(b.replyText?.trim())) throw new AppError(400, "comment_rule.button_kind");
    if (b.url && !/^https:\/\//.test(b.url)) throw new AppError(400, "comment_rule.button_url");
  }
  // Düğmeli mesaj (button template) en fazla 640 karakter; otomatik mesaj notu da sayılır
  if (buttons.length && buildDmText({ dmText: r.dmText, botNotice: r.botNotice }, "kullanici_adi_30_karakterlik_x").length > 640)
    throw new AppError(400, "comment_rule.button_text");
}

/** Yorum kuralı oluşturur. MCP'den gelen kurallar her zaman kapalı oluşur (insan açar). */
export function createCommentRule(ctx: Ctx, input: CommentRuleInput): CommentRule {
  requireRole(ctx, "admin");
  assertFeature(ctx.orgId, "inbox");
  checkRule(ctx, input);
  return commentRulesRepo.create(ctx.orgId, ctx.via === "session" ? input : { ...input, enabled: 0 });
}

export function updateCommentRule(ctx: Ctx, id: string, patch: Partial<CommentRuleInput>): CommentRule {
  requireRole(ctx, "admin");
  const cur = commentRulesRepo.get(ctx.orgId, id);
  if (!cur) throw notFound("rule");
  checkRule(ctx, { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
  if (patch.enabled) assertFeature(ctx.orgId, "inbox");
  return commentRulesRepo.update(ctx.orgId, id, patch)!;
}

export function deleteCommentRule(ctx: Ctx, id: string): void {
  requireRole(ctx, "admin");
  commentRulesRepo.remove(ctx.orgId, id);
}

/** Kurallar ve son 30 günün gönderim sayıları (akış başına basit analiz) */
export function listCommentRules(ctx: Ctx): Array<CommentRule & { stats: ReturnType<typeof privateRepliesRepo.stats> }> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  return commentRulesRepo.list(ctx.orgId).map((r) => ({ ...r, stats: privateRepliesRepo.stats(ctx.orgId, { ruleId: r.id, since }) }));
}

/* ---------------- Düğmeye basılınca ---------------- */

/**
 * Yorumdan DM'e düğmesine (postback) basıldıysa tanımlı cevabı gönderir.
 * Dönen değer: olay bu özelliğe aitse true (DM kuralları ayrıca çalışmaz).
 * Kişi düğmeye bastığı için 24 saatlik mesajlaşma penceresi açıktır.
 */
export async function handleCommentButton(
  channel: Channel,
  conversation: Conversation,
  payload: string,
  send: (text: string, ruleId: string) => Promise<unknown>,
): Promise<boolean> {
  if (!payload.startsWith(POSTBACK_PREFIX)) return false;
  const [ruleId, idx] = payload.slice(POSTBACK_PREFIX.length).split(":");
  const rule = ruleId ? commentRulesRepo.get(channel.orgId, ruleId) : null;
  const button = rule?.buttons[Number(idx)];
  const replyText = button?.replyText?.trim();
  if (!rule?.enabled || !replyText || conversation.mode === "manual") {
    inboxRepo.flagAttention(conversation.id, true);
    return true;
  }
  await send(replyText, rule.id);
  return true;
}
