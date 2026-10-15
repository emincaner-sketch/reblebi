import { notFound } from "../core/i18n.js";
import { channelsRepo } from "../core/repos/channels.js";
import { contactsRepo } from "../core/repos/contacts.js";
import { inboxRepo } from "../core/repos/inbox.js";
import type { Ctx } from "../core/types.js";
import { requireRole } from "./access.js";
import { isMetaDmConversation, windowInfo, type WindowInfo } from "./messaging-policy.js";

/** Kişi kartı: etiketler, alanlar, çıkış durumu ve Meta mesajlaşma penceresi */
export interface ContactView extends WindowInfo {
  conversationId: string;
  channelId: string;
  participantId: string;
  name: string | null;
  tags: string[];
  fields: Record<string, string>;
  optedOutAt: string | null;
  optedOutReason: string | null;
  /** Instagram/Facebook DM'i mi (24 saat penceresi uygulanır) */
  metaWindow: boolean;
}

export interface ContactPatch {
  tags?: string[];
  fields?: Record<string, string>;
  optedOut?: boolean;
}

function load(ctx: Ctx, conversationId: string) {
  const conv = inboxRepo.getConversation(ctx.orgId, conversationId);
  if (!conv) throw notFound("conversation");
  const channel = channelsRepo.get(ctx.orgId, conv.channelId);
  if (!channel) throw notFound("channel");
  return { conv, channel };
}

export function getContact(ctx: Ctx, conversationId: string): ContactView {
  const { conv, channel } = load(ctx, conversationId);
  const c = contactsRepo.get(channel.id, conv.participantId);
  // Son kullanıcı mesajı kişinin DM konuşmasından (yorum konusundan açılsa da)
  return {
    conversationId: conv.id,
    channelId: channel.id,
    participantId: conv.participantId,
    name: conv.participantName,
    tags: c?.tags ?? [],
    fields: c?.fields ?? {},
    optedOutAt: c?.optedOutAt ?? null,
    optedOutReason: c?.optedOutReason ?? null,
    metaWindow: isMetaDmConversation(channel, { metadata: {} }),
    ...windowInfo(contactsRepo.lastUserMessageAt(channel.id, conv.participantId)),
  };
}

/** Etiketler: kırpılır, tekrarlar atılır (büyük/küçük harf duyarsız), en fazla 20. Alanlar: boş değer alanı siler, en fazla 20. */
export function normalizeContactPatch(patch: ContactPatch): ContactPatch {
  const out: ContactPatch = { optedOut: patch.optedOut };
  if (patch.tags) {
    const seen = new Set<string>();
    out.tags = patch.tags
      .map((t) => t.trim().replace(/\s+/g, " ").slice(0, 40))
      .filter((t) => t && !seen.has(t.toLocaleLowerCase("tr-TR")) && seen.add(t.toLocaleLowerCase("tr-TR")))
      .slice(0, 20);
  }
  if (patch.fields) {
    out.fields = Object.fromEntries(
      Object.entries(patch.fields)
        .map(([k, v]) => [k.trim().slice(0, 40), String(v ?? "").trim().slice(0, 200)] as const)
        .filter(([k, v]) => k && v)
        .slice(0, 20),
    );
  }
  return out;
}

export function updateContact(ctx: Ctx, conversationId: string, raw: ContactPatch): ContactView {
  requireRole(ctx, "editor");
  const { conv, channel } = load(ctx, conversationId);
  const patch = normalizeContactPatch(raw);
  if (patch.tags || patch.fields) contactsRepo.upsert(ctx.orgId, channel.id, conv.participantId, { tags: patch.tags, fields: patch.fields });
  if (patch.optedOut !== undefined) {
    const cur = contactsRepo.get(channel.id, conv.participantId);
    if (patch.optedOut && !cur?.optedOutAt) contactsRepo.setOptOut(ctx.orgId, channel.id, conv.participantId, new Date().toISOString(), "panel");
    if (!patch.optedOut && cur?.optedOutAt) contactsRepo.setOptOut(ctx.orgId, channel.id, conv.participantId, null);
  }
  return getContact(ctx, conversationId);
}
