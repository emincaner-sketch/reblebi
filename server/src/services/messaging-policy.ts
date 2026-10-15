import { contactsRepo } from "../core/repos/contacts.js";
import type { Channel, Conversation, Message } from "../core/types.js";

/**
 * Meta mesajlaşma kuralları (Instagram ve Messenger DM):
 * - Kişinin son mesajından sonraki 24 saat içinde her mesaj gönderilebilir.
 * - 24 saat geçtiyse otomatik mesaj gönderilemez; insan cevabı HUMAN_AGENT etiketiyle 7 güne kadar gidebilir.
 * - Çıkış listesindeki kişiye ("durdur/stop") otomatik mesaj gönderilmez; insan cevabı kurallara göre gider.
 * Yorum ve değerlendirme cevapları (herkese açık) ile yorumdan DM'e özel yanıtlar bu kurala girmez.
 */

export const STANDARD_WINDOW_MS = 24 * 3600_000;
export const HUMAN_AGENT_WINDOW_MS = 7 * 86400_000;

export type SendDecision = { ok: true; tag?: "HUMAN_AGENT" } | { ok: false; code: "opted_out" | "window_closed" | "human_agent_expired"; message: string };

/** Bu konuşmaya Meta DM kuralları uygulanır mı (Instagram/Facebook DM konuşması) */
export function isMetaDmConversation(channel: Pick<Channel, "provider">, conversation: Pick<Conversation, "metadata">): boolean {
  if (channel.provider !== "instagram" && channel.provider !== "facebook") return false;
  const kind = conversation.metadata?.kind;
  return kind !== "comment" && kind !== "review";
}

export interface WindowInfo {
  lastUserMessageAt: string | null;
  /** Otomatik ve insan mesajları bu zamana kadar serbest */
  windowOpenUntil: string | null;
  /** İnsan cevabı HUMAN_AGENT etiketiyle bu zamana kadar gidebilir */
  humanAgentUntil: string | null;
}

export function windowInfo(lastUserMessageAt: string | null): WindowInfo {
  if (!lastUserMessageAt) return { lastUserMessageAt: null, windowOpenUntil: null, humanAgentUntil: null };
  const t = new Date(lastUserMessageAt).getTime();
  return {
    lastUserMessageAt,
    windowOpenUntil: new Date(t + STANDARD_WINDOW_MS).toISOString(),
    humanAgentUntil: new Date(t + HUMAN_AGENT_WINDOW_MS).toISOString(),
  };
}

/** Gönderim kararı: sentBy "user" insan cevabıdır; "rule" ve "ai" otomatiktir */
export function decideSend(input: { lastUserMessageAt: string | null; optedOut: boolean; sentBy: Message["sentBy"]; now?: Date }): SendDecision {
  const automated = input.sentBy !== "user";
  if (automated && input.optedOut) return { ok: false, code: "opted_out", message: "Kişi otomatik mesajları durdurdu (çıkış listesinde)" };
  const now = (input.now ?? new Date()).getTime();
  const age = input.lastUserMessageAt ? now - new Date(input.lastUserMessageAt).getTime() : Number.POSITIVE_INFINITY;
  if (age <= STANDARD_WINDOW_MS) return { ok: true };
  if (automated) return { ok: false, code: "window_closed", message: "24 saatlik mesajlaşma penceresi kapalı: kişi son 24 saatte yazmadığı için otomatik mesaj gönderilmedi" };
  if (age <= HUMAN_AGENT_WINDOW_MS) return { ok: true, tag: "HUMAN_AGENT" };
  return { ok: false, code: "human_agent_expired", message: "Kişinin son mesajından bu yana 7 günden fazla geçti; Meta bu konuşmaya mesaj gönderilmesine izin vermiyor" };
}

/** Konuşma için gönderim kararı (Meta dışı kanallarda yalnızca çıkış listesi uygulanır) */
export function sendDecisionFor(channel: Channel, conversation: Conversation, sentBy: Message["sentBy"], now = new Date()): SendDecision {
  if (!isMetaDmConversation(channel, conversation)) {
    if (sentBy !== "user" && conversation.metadata?.kind !== "comment" && conversation.metadata?.kind !== "review" && contactsRepo.isOptedOut(channel.id, conversation.participantId))
      return { ok: false, code: "opted_out", message: "Kişi otomatik mesajları durdurdu (çıkış listesinde)" };
    return { ok: true };
  }
  return decideSend({
    lastUserMessageAt: contactsRepo.lastUserMessageAt(channel.id, conversation.participantId),
    optedOut: contactsRepo.isOptedOut(channel.id, conversation.participantId),
    sentBy,
    now,
  });
}
