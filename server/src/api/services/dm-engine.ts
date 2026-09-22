import { createLogger } from "../../core/logger.js";
import { channelsRepo } from "../../core/repos/channels.js";
import { inboxRepo } from "../../core/repos/inbox.js";
import { activityRepo, rulesRepo, settingsRepo } from "../../core/repos/misc.js";
import type { AutoReplyRule, Channel, Conversation, Message, ProviderId, Settings } from "../../core/types.js";
import { config } from "../../core/config.js";
import { draftReply, isAiEnabled } from "../../ai/index.js";
import { getProvider, lookupParticipant, type InboundEvent } from "../../providers/index.js";
import { ensureFreshToken } from "./publisher.js";

const log = createLogger("dm");

/* ---------------- Yardımcılar ---------------- */

export function isWithinBusinessHours(s: Settings, now = new Date()): boolean {
  if (!s.businessHoursEnabled) return true;
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
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

function ruleMatches(rule: AutoReplyRule, text: string, isFirstContact: boolean): boolean {
  const t = normalize(text);
  switch (rule.matchType) {
    case "any":
      return true;
    case "first_contact":
      return isFirstContact;
    case "keyword": {
      const words = (rule.pattern ?? "")
        .split(",")
        .map((w) => normalize(w))
        .filter(Boolean);
      return words.some((w) => t.includes(w));
    }
    case "regex": {
      if (!rule.pattern) return false;
      try {
        return new RegExp(rule.pattern, "iu").test(text);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

function containsHandoffKeyword(text: string, s: Settings): boolean {
  const t = normalize(text);
  return s.handoffKeywords
    .split(",")
    .map((w) => normalize(w))
    .filter(Boolean)
    .some((w) => t.includes(w));
}

/* ---------------- Gönderim ---------------- */

export async function sendReply(
  channel: Channel,
  conversation: Conversation,
  text: string,
  sentBy: Message["sentBy"],
  ruleId: string | null = null,
): Promise<Message> {
  const provider = getProvider(channel.provider);
  if (!provider.sendMessage) throw new Error(`${provider.label} mesaj göndermeyi desteklemiyor`);
  try {
    const fresh = await ensureFreshToken(channel);
    const r = await provider.sendMessage({ channel: fresh, conversationExternalId: conversation.externalId, participantId: conversation.participantId, text });
    return inboxRepo.recordOutbound(conversation.id, text, sentBy, { externalId: r.externalId ?? null, ruleId, status: "sent" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    activityRepo.add("error", "dm", `${channel.name}: mesaj gönderilemedi: ${msg}`, { conversationId: conversation.id });
    return inboxRepo.recordOutbound(conversation.id, text, sentBy, { ruleId, status: "failed", error: msg });
  }
}

/* ---------------- Gelen mesaj işleme ---------------- */

export async function handleInbound(provider: ProviderId, ev: InboundEvent): Promise<void> {
  const channel = channelsRepo.findByExternal(provider, ev.accountExternalId) ?? findByMetadata(provider, ev.accountExternalId);
  if (!channel) {
    log.warn("gelen mesaj için kanal bulunamadı", { provider, account: ev.accountExternalId });
    return;
  }
  let name = ev.participantName ?? null;
  let avatar = ev.participantAvatar ?? null;
  const existing = inboxRepo.findConversation(channel.id, ev.conversationExternalId);
  if (!existing && !name && (provider === "instagram" || provider === "facebook")) {
    const info = await lookupParticipant(provider, ev.participantId, channel.accessToken);
    name = info.name;
    avatar = info.avatar;
  }
  const rec = inboxRepo.recordInbound({
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
  activityRepo.add("info", "dm", `${channel.name}: ${conversation.participantName ?? conversation.participantId} yeni mesaj`, { conversationId: conversation.id });

  const settings = settingsRepo.get();
  // İnsan devralma anahtar kelimeleri
  if (containsHandoffKeyword(message.text, settings)) {
    inboxRepo.setMode(conversation.id, "manual");
    inboxRepo.flagAttention(conversation.id, true);
    activityRepo.add("warn", "dm", `${conversation.participantName ?? "Müşteri"} insan desteği istedi; konuşma manuel moda alındı`, { conversationId: conversation.id });
    return;
  }
  if (conversation.mode === "manual") {
    inboxRepo.flagAttention(conversation.id, true);
    return;
  }

  // Yanıt gecikmesi (doğal görünmesi için)
  const delay = Math.max(0, Math.min(settings.replyDelaySeconds, 60)) * 1000;
  setTimeout(() => {
    autoRespond(channel, conversation.id, message).catch((e) => log.error("oto-yanıt hatası", { e: e instanceof Error ? e.message : e }));
  }, delay);
}

function findByMetadata(provider: ProviderId, accountId: string): Channel | null {
  // Instagram webhook'larında entry.id bazen bağlı sayfa id'si olabilir
  return channelsRepo.list().find((c) => c.provider === provider && (c.metadata.pageId === accountId || c.metadata.igUserId === accountId)) ?? null;
}

async function autoRespond(channel: Channel, conversationId: string, inbound: Message): Promise<void> {
  const conversation = inboxRepo.getConversation(conversationId);
  if (!conversation || conversation.mode === "manual") return;
  const settings = settingsRepo.get();
  const withinHours = isWithinBusinessHours(settings);
  const isFirstContact = !inboxRepo.hasInboundBefore(conversation.id, inbound.id);
  const vars = { name: conversation.participantName ?? "", platform: channel.provider, kanal: channel.name };

  const rules = rulesRepo
    .list()
    .filter((r) => r.enabled)
    .filter((r) => !r.channelId || r.channelId === channel.id)
    .filter((r) => !r.provider || r.provider === channel.provider);

  for (const rule of rules) {
    if (rule.onlyBusinessHours && !withinHours) continue;
    if (!ruleMatches(rule, inbound.text, isFirstContact)) continue;
    if (inboxRepo.ruleHitRecently(rule.id, conversation.id, rule.cooldownMinutes)) continue;

    let replyText = "";
    if (rule.replyMode === "template") {
      replyText = renderTemplate(rule.replyText ?? "", vars).trim();
    } else if (isAiEnabled()) {
      const drafted = await draftReply({ platform: channel.provider, participantName: conversation.participantName, history: inboxRepo.messages(conversation.id), ruleInstructions: rule.aiInstructions });
      replyText = drafted.reply.trim();
      if (drafted.handoff) inboxRepo.flagAttention(conversation.id, true);
    } else {
      replyText = renderTemplate(rule.replyText ?? "", vars).trim();
    }
    inboxRepo.recordRuleHit(rule.id, conversation.id);
    if (replyText) await sendReply(channel, conversation, replyText, rule.replyMode === "ai" ? "ai" : "rule", rule.id);
    if (rule.handoffToHuman) {
      inboxRepo.setMode(conversation.id, "manual");
      inboxRepo.flagAttention(conversation.id, true);
    }
    return; // ilk eşleşen kural kazanır
  }

  // Kural yoksa: çalışma saati dışı mesajı ya da AI yedek yanıt
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
  if (settings.aiAutoReplyFallback && isAiEnabled()) {
    const drafted = await draftReply({ platform: channel.provider, participantName: conversation.participantName, history: inboxRepo.messages(conversation.id) });
    if (drafted.reply.trim()) await sendReply(channel, conversation, drafted.reply.trim(), "ai");
    if (drafted.handoff) {
      inboxRepo.flagAttention(conversation.id, true);
      if (drafted.intent === "complaint") inboxRepo.setMode(conversation.id, "manual");
    }
    return;
  }
  // Hiçbir otomatik yanıt yoksa dikkat bayrağı
  inboxRepo.flagAttention(conversation.id, true);
}
