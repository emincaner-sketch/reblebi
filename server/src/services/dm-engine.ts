import { config } from "../core/config.js";
import { AppError, notFound } from "../core/i18n.js";
import { createLogger } from "../core/logger.js";
import { channelsRepo } from "../core/repos/channels.js";
import { inboxRepo } from "../core/repos/inbox.js";
import { activityRepo, rulesRepo } from "../core/repos/misc.js";
import { orgSettingsRepo, orgsRepo } from "../core/repos/orgs.js";
import type { AutoReplyRule, Channel, Conversation, Ctx, Message, OrgSettings, ProviderId } from "../core/types.js";
import { aiAvailable, draftReply } from "../ai/index.js";
import { getProvider, lookupParticipant, type InboundEvent } from "../providers/index.js";
import { requireRole } from "./access.js";
import { hasFeature } from "./limits.js";
import { emitWebhook, notify, orgT } from "./notify.js";
import { ensureFreshToken } from "./publisher.js";

const log = createLogger("dm");

/* ---------------- Yardımcılar ---------------- */

export function isWithinBusinessHours(s: OrgSettings, timeZone: string, now = new Date()): boolean {
  if (!s.businessHoursEnabled) return true;
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[parts.weekday] ?? now.getDay();
  if (!s.businessDays.includes(day)) return false;
  const cur = `${parts.hour}:${parts.minute}`;
  return cur >= s.businessHoursStart && cur <= s.businessHoursEnd;
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

function normalize(s: string): string {
  return s.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

export function ruleMatches(rule: Pick<AutoReplyRule, "matchType" | "pattern">, text: string, isFirstContact: boolean): boolean {
  const t = normalize(text);
  switch (rule.matchType) {
    case "any":
      return true;
    case "first_contact":
      return isFirstContact;
    case "keyword":
      return (rule.pattern ?? "")
        .split(",")
        .map(normalize)
        .filter(Boolean)
        .some((w) => t.includes(w));
    case "regex":
      if (!rule.pattern || rule.pattern.length > 300) return false;
      try {
        return new RegExp(rule.pattern, "iu").test(text.slice(0, 2000));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function containsHandoffKeyword(text: string, s: OrgSettings): boolean {
  const t = normalize(text);
  return s.handoffKeywords
    .split(",")
    .map(normalize)
    .filter(Boolean)
    .some((w) => t.includes(w));
}

/* ---------------- Gönderim ---------------- */

export async function sendReply(channel: Channel, conversation: Conversation, text: string, sentBy: Message["sentBy"], ruleId: string | null = null): Promise<Message> {
  const provider = getProvider(channel.provider);
  if (!provider.sendMessage) throw new AppError(400, "channel.no_dm", { provider: provider.label });
  try {
    const fresh = await ensureFreshToken(channel);
    const r = await provider.sendMessage({ channel: fresh, conversationExternalId: conversation.externalId, participantId: conversation.participantId, text });
    return inboxRepo.recordOutbound(conversation.id, text, sentBy, { externalId: r.externalId ?? null, ruleId, status: "sent" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    activityRepo.add(channel.orgId, "error", "dm", `${channel.name}: ${msg}`, { conversationId: conversation.id });
    return inboxRepo.recordOutbound(conversation.id, text, sentBy, { ruleId, status: "failed", error: msg.slice(0, 500) });
  }
}

/** Panel/MCP'den manuel yanıt */
export async function replyToConversation(ctx: Ctx, conversationId: string, text: string): Promise<Message> {
  requireRole(ctx, "editor");
  const conv = inboxRepo.getConversation(ctx.orgId, conversationId);
  if (!conv) throw notFound("conversation");
  const ch = channelsRepo.get(ctx.orgId, conv.channelId);
  if (!ch) throw notFound("channel");
  const msg = await sendReply(ch, conv, text, ctx.via === "session" ? "user" : "ai");
  inboxRepo.markRead(conv.id);
  inboxRepo.flagAttention(conv.id, false);
  return msg;
}

/* ---------------- Gelen mesaj işleme ---------------- */

function channelsForEvent(provider: ProviderId, accountId: string): Channel[] {
  const direct = channelsRepo.findAllByExternal(provider, accountId);
  if (direct.length) return direct;
  // Instagram webhook'larında entry.id bağlı sayfa id'si olabilir
  return channelsRepo.listAll().filter((c) => c.provider === provider && (c.metadata.pageId === accountId || c.metadata.igUserId === accountId));
}

export async function handleInbound(provider: ProviderId, ev: InboundEvent, onlyChannelId?: string): Promise<void> {
  const channels = onlyChannelId
    ? [channelsRepo.getById(onlyChannelId)].filter((c): c is Channel => Boolean(c))
    : channelsForEvent(provider, ev.accountExternalId);
  if (!channels.length) {
    log.warn("gelen mesaj için kanal bulunamadı", { provider, account: ev.accountExternalId });
    return;
  }
  for (const channel of channels) {
    if (channel.status === "disabled") continue;
    await handleForChannel(channel, provider, ev).catch((e) => log.error("gelen mesaj işlenemedi", { channel: channel.id, e: e instanceof Error ? e.message : e }));
  }
}

async function handleForChannel(channel: Channel, provider: ProviderId, ev: InboundEvent): Promise<void> {
  let name = ev.participantName ?? null;
  let avatar = ev.participantAvatar ?? null;
  const existing = inboxRepo.findConversation(channel.id, ev.conversationExternalId);
  if (!existing && !name && (provider === "instagram" || provider === "facebook")) {
    const info = await lookupParticipant(provider, ev.participantId, channel.accessToken);
    name = info.name;
    avatar = info.avatar;
  }
  const rec = inboxRepo.recordInbound({
    orgId: channel.orgId,
    channelId: channel.id,
    conversationExternalId: ev.conversationExternalId,
    participantId: ev.participantId,
    participantName: name,
    participantAvatar: avatar,
    externalMessageId: ev.externalMessageId ?? null,
    text: ev.text,
    attachments: ev.attachments ?? [],
    receivedAt: ev.receivedAt,
  });
  if (!rec) return; // tekrar eden webhook
  const { conversation, message } = rec;
  emitWebhook(channel.orgId, "message.received", {
    conversationId: conversation.id,
    channelId: channel.id,
    provider,
    from: conversation.participantName ?? conversation.participantId,
    text: message.text,
  });

  // Plan gelen kutusu otomasyonunu içermiyorsa sadece kaydet
  if (!hasFeature(channel.orgId, "inbox")) {
    inboxRepo.flagAttention(conversation.id, true);
    return;
  }

  const settings = orgSettingsRepo.get(channel.orgId);
  if (containsHandoffKeyword(message.text, settings)) {
    inboxRepo.setMode(conversation.id, "manual");
    inboxRepo.flagAttention(conversation.id, true);
    notify(channel.orgId, { kind: "warning", title: orgT(channel.orgId, "notif.handoff", { name: conversation.participantName ?? "?" }), link: `/app/inbox/${conversation.id}` });
    return;
  }
  if (conversation.mode === "manual") {
    inboxRepo.flagAttention(conversation.id, true);
    return;
  }

  const delay = Math.max(0, Math.min(settings.replyDelaySeconds, 60)) * 1000;
  setTimeout(() => {
    autoRespond(channel, conversation.id, message).catch((e) => log.error("oto-yanıt hatası", { e: e instanceof Error ? e.message : e }));
  }, delay);
}

async function aiReply(channel: Channel, conversation: Conversation, instructions?: string | null) {
  return draftReply(channel.orgId, {
    platform: channel.provider,
    participantName: conversation.participantName,
    history: inboxRepo.messages(conversation.id, 40),
    ruleInstructions: instructions ?? null,
  });
}

async function autoRespond(channel: Channel, conversationId: string, inbound: Message): Promise<void> {
  const conversation = inboxRepo.getConversationById(conversationId);
  if (!conversation || conversation.mode === "manual") return;
  const org = orgsRepo.get(channel.orgId);
  const settings = orgSettingsRepo.get(channel.orgId);
  const withinHours = isWithinBusinessHours(settings, org?.timezone ?? config.timezone);
  const isFirstContact = !inboxRepo.hasInboundBefore(conversation.id, inbound.id);
  const vars = { name: conversation.participantName ?? "", platform: channel.provider, kanal: channel.name, channel: channel.name };
  const canAi = hasFeature(channel.orgId, "aiReplies") && aiAvailable(channel.orgId);

  const rules = rulesRepo
    .list(channel.orgId)
    .filter((r) => r.enabled)
    .filter((r) => !r.channelId || r.channelId === channel.id)
    .filter((r) => !r.provider || r.provider === channel.provider);

  for (const rule of rules) {
    if (rule.onlyBusinessHours && !withinHours) continue;
    if (!ruleMatches(rule, inbound.text, isFirstContact)) continue;
    if (inboxRepo.ruleHitRecently(rule.id, conversation.id, rule.cooldownMinutes)) continue;

    let replyText = "";
    let sentBy: Message["sentBy"] = "rule";
    if (rule.replyMode === "ai" && canAi) {
      try {
        const drafted = await aiReply(channel, conversation, rule.aiInstructions);
        replyText = drafted.reply.trim();
        sentBy = "ai";
        if (drafted.handoff) inboxRepo.flagAttention(conversation.id, true);
      } catch (e) {
        log.warn("AI kural yanıtı üretilemedi", { e: e instanceof Error ? e.message : e });
        replyText = renderTemplate(rule.replyText ?? "", vars).trim();
      }
    } else {
      replyText = renderTemplate(rule.replyText ?? "", vars).trim();
    }
    inboxRepo.recordRuleHit(rule.id, conversation.id);
    if (replyText) await sendReply(channel, conversation, replyText, sentBy, rule.id);
    if (rule.handoffToHuman) {
      inboxRepo.setMode(conversation.id, "manual");
      inboxRepo.flagAttention(conversation.id, true);
    }
    return; // ilk eşleşen kural kazanır
  }

  if (!withinHours && settings.outsideHoursMessage) {
    if (!inboxRepo.ruleHitRecently("__outside_hours", conversation.id, 240)) {
      inboxRepo.recordRuleHit("__outside_hours", conversation.id);
      await sendReply(channel, conversation, renderTemplate(settings.outsideHoursMessage, vars), "rule");
    }
    return;
  }
  if (isFirstContact && settings.welcomeMessage && !settings.aiAutoReplyFallback) {
    await sendReply(channel, conversation, renderTemplate(settings.welcomeMessage, vars), "rule");
    return;
  }
  if (settings.aiAutoReplyFallback && canAi) {
    try {
      const drafted = await aiReply(channel, conversation);
      if (drafted.reply.trim()) await sendReply(channel, conversation, drafted.reply.trim(), "ai");
      if (drafted.handoff) {
        inboxRepo.flagAttention(conversation.id, true);
        if (drafted.intent === "complaint") inboxRepo.setMode(conversation.id, "manual");
      }
      return;
    } catch (e) {
      log.warn("AI yedek yanıt üretilemedi", { e: e instanceof Error ? e.message : e });
    }
  }
  inboxRepo.flagAttention(conversation.id, true);
}
