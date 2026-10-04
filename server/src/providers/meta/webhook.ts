import type { ProviderId } from "../../core/types.js";
import type { InboundEvent } from "../types.js";
import { graph } from "./common.js";

export interface ParsedMetaEvent extends InboundEvent {
  provider: ProviderId;
}

interface MessagingEntry {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: Array<{ type: string; payload?: { url?: string; title?: string } }>;
  };
}

interface WebhookBody {
  object?: string;
  entry?: Array<{
    id: string;
    time?: number;
    messaging?: MessagingEntry[];
    changes?: Array<{
      field?: string;
      value?: {
        /* Yorumlar: Instagram "comments" ve Sayfa "feed" (item=comment) */
        id?: string;
        text?: string;
        message?: string;
        from?: { id?: string; username?: string; name?: string };
        media?: { id?: string; media_product_type?: string };
        parent_id?: string;
        item?: string;
        verb?: string;
        comment_id?: string;
        post_id?: string;
        created_time?: number;
        messaging_product?: string;
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          image?: { id?: string; caption?: string; mime_type?: string };
          video?: { id?: string; caption?: string };
          audio?: { id?: string };
          document?: { id?: string; filename?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
        }>;
      };
    }>;
  }>;
}

function attachmentsToText(atts: Array<{ type: string; payload?: { url?: string; title?: string } }> | undefined): string {
  if (!atts?.length) return "";
  return atts.map((a) => `[${a.type}${a.payload?.title ? ": " + a.payload.title : ""}]`).join(" ");
}

type Entry = NonNullable<WebhookBody["entry"]>[number];

/**
 * Gönderi yorumları: her (gönderi, yorumcu) çifti gelen kutusunda bir konu olur ("c:<gönderi>:<yorumcu>").
 * Hesabın kendi yanıtları (from = hesap) ve silme/düzenleme olayları atlanır.
 */
function parseCommentChanges(provider: ProviderId, entry: Entry): ParsedMetaEvent[] {
  const out: ParsedMetaEvent[] = [];
  for (const ch of entry.changes ?? []) {
    const v = ch.value;
    if (!v) continue;
    if (provider === "instagram" && ch.field === "comments") {
      const from = v.from?.id;
      const mediaId = v.media?.id;
      if (!from || !mediaId || !v.id || from === entry.id) continue;
      out.push({
        provider,
        kind: "comment",
        accountExternalId: entry.id,
        conversationExternalId: `c:${mediaId}:${from}`,
        participantId: from,
        participantName: v.from?.username ? `@${v.from.username}` : null,
        externalMessageId: v.id,
        text: v.text ?? "",
        metadata: { kind: "comment", mediaId, commentId: v.id, parentId: v.parent_id ?? null, productType: v.media?.media_product_type ?? null },
        receivedAt: entry.time ? new Date(entry.time * 1000).toISOString() : undefined,
      });
    } else if (provider === "facebook" && ch.field === "feed" && v.item === "comment" && v.verb === "add") {
      const from = v.from?.id;
      if (!from || !v.comment_id || !v.post_id || from === entry.id) continue;
      out.push({
        provider,
        kind: "comment",
        accountExternalId: entry.id,
        conversationExternalId: `c:${v.post_id}:${from}`,
        participantId: from,
        participantName: v.from?.name ?? null,
        externalMessageId: v.comment_id,
        text: v.message ?? "",
        metadata: { kind: "comment", mediaId: v.post_id, commentId: v.comment_id, parentId: v.parent_id && v.parent_id !== v.post_id ? v.parent_id : null },
        receivedAt: v.created_time ? new Date(v.created_time * 1000).toISOString() : undefined,
      });
    }
  }
  return out;
}

/** Meta webhook gövdesini ortak gelen-mesaj olaylarına çevirir (IG DM, Messenger, WhatsApp, IG/FB yorumları) */
export function parseMetaWebhook(body: WebhookBody): ParsedMetaEvent[] {
  const out: ParsedMetaEvent[] = [];
  const object = body.object;
  for (const entry of body.entry ?? []) {
    if (object === "instagram" || object === "page") {
      const provider: ProviderId = object === "instagram" ? "instagram" : "facebook";
      out.push(...parseCommentChanges(provider, entry));
      for (const m of entry.messaging ?? []) {
        if (!m.message || m.message.is_echo || !m.sender?.id) continue;
        const text = m.message.text ?? attachmentsToText(m.message.attachments);
        out.push({
          provider,
          accountExternalId: m.recipient?.id ?? entry.id,
          conversationExternalId: m.sender.id,
          participantId: m.sender.id,
          externalMessageId: m.message.mid ?? null,
          text,
          attachments: (m.message.attachments ?? []).map((a) => ({ type: a.type, url: a.payload?.url, name: a.payload?.title })),
          receivedAt: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
        });
      }
    } else if (object === "whatsapp_business_account") {
      for (const ch of entry.changes ?? []) {
        const v = ch.value;
        if (!v?.messages?.length) continue;
        const phoneNumberId = v.metadata?.phone_number_id ?? entry.id;
        const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
        for (const msg of v.messages) {
          let text = msg.text?.body ?? "";
          if (!text) {
            if (msg.type === "image") text = `[görsel]${msg.image?.caption ? " " + msg.image.caption : ""}`;
            else if (msg.type === "video") text = `[video]${msg.video?.caption ? " " + msg.video.caption : ""}`;
            else if (msg.type === "audio") text = "[sesli mesaj]";
            else if (msg.type === "document") text = `[dosya: ${msg.document?.filename ?? ""}]`;
            else if (msg.type === "button") text = msg.button?.text ?? "[buton]";
            else if (msg.type === "interactive") text = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "[etkileşim]";
            else text = `[${msg.type ?? "mesaj"}]`;
          }
          out.push({
            provider: "whatsapp",
            accountExternalId: phoneNumberId,
            conversationExternalId: msg.from,
            participantId: msg.from,
            participantName: names.get(msg.from) ?? null,
            externalMessageId: msg.id,
            text,
            receivedAt: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : undefined,
          });
        }
      }
    }
  }
  return out;
}

/** IG/Messenger kullanıcı adını en iyi çabayla getirir (izin yoksa null) */
export async function lookupParticipant(
  provider: ProviderId,
  participantId: string,
  token: string,
): Promise<{ name: string | null; avatar: string | null }> {
  try {
    if (provider === "instagram") {
      const r = await graph<{ name?: string; username?: string; profile_pic?: string }>(`/${participantId}`, token, {
        params: { fields: "name,username,profile_pic" },
      });
      return { name: r.name ?? (r.username ? "@" + r.username : null), avatar: r.profile_pic ?? null };
    }
    if (provider === "facebook") {
      const r = await graph<{ first_name?: string; last_name?: string; name?: string; profile_pic?: string }>(`/${participantId}`, token, {
        params: { fields: "first_name,last_name,name,profile_pic" },
      });
      const name = r.name ?? [r.first_name, r.last_name].filter(Boolean).join(" ");
      return { name: name || null, avatar: r.profile_pic ?? null };
    }
  } catch {
    /* profil bilgisi opsiyonel */
  }
  return { name: null, avatar: null };
}
