import type { Channel } from "../core/types.js";
import { fileBlob, http } from "./http.js";
import { ProviderError, type InboundEvent, type Provider, type PublishInput, type PublishResult } from "./types.js";

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

interface TgResp<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function call<T>(token: string, method: string, opts: { json?: unknown; multipart?: FormData; query?: Record<string, string | number> } = {}): Promise<T> {
  const r = await http<TgResp<T>>(api(token, method), { method: opts.json || opts.multipart ? "POST" : "GET", json: opts.json, multipart: opts.multipart, query: opts.query, retries: 1 });
  if (!r.ok) throw new ProviderError(`Telegram: ${r.description ?? "hata"}`);
  return r.result as T;
}

export const telegramProvider: Provider = {
  id: "telegram",
  label: "Telegram",
  color: "#229ED9",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: true,
    thread: false,
    dm: true,
    inbound: "poll",
    analytics: true,
    maxTextLength: 4096,
    mediaNote: "Kanal/grup gönderisi: metin, 1-10 görsel/video (albüm). Bot, kanala yönetici olarak eklenmiş olmalı. DM: kullanıcıların bota yazdığı mesajlar.",
  },
  settingFields: [
    { key: "disableNotification", label: "Sessiz gönder", type: "boolean", default: false },
    { key: "pin", label: "Gönderiyi sabitle", type: "boolean", default: false },
  ],
  connectFields: [
    { key: "botToken", label: "Bot token", type: "text", help: "@BotFather > /newbot ile alınır" },
    { key: "chatId", label: "Kanal / grup (@kullaniciadi veya -100... id)", type: "text", help: "Gönderilerin paylaşılacağı yer. Boş bırakılırsa sadece DM için kullanılır." },
    { key: "displayName", label: "Görünen ad", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const token = values.botToken?.trim();
    if (!token) throw new ProviderError("Bot token zorunlu");
    const me = await call<{ id: number; username?: string; first_name?: string }>(token, "getMe");
    let chatTitle: string | null = null;
    let chatId = values.chatId?.trim() || "";
    if (chatId) {
      const chat = await call<{ id: number; title?: string; username?: string; type: string }>(token, "getChat", { query: { chat_id: chatId } });
      chatTitle = chat.title ?? (chat.username ? "@" + chat.username : null);
      chatId = String(chat.id);
    }
    return [
      {
        externalId: String(me.id),
        name: values.displayName?.trim() || chatTitle || me.first_name || "Telegram",
        username: me.username ?? null,
        accessToken: token,
        tokenExpiresAt: null,
        metadata: { chatId: chatId || null, chatTitle, botUsername: me.username ?? null },
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const token = channel.accessToken;
    const chatId = channel.metadata.chatId as string | null;
    if (!chatId) throw new ProviderError("Bu Telegram kanalı için hedef sohbet (chatId) tanımlı değil");
    const silent = Boolean(input.settings.disableNotification);
    const media = input.media.filter((m) => m.kind === "image" || m.kind === "video").slice(0, 10);
    let messageId: number;
    if (media.length === 0) {
      const r = await call<{ message_id: number }>(token, "sendMessage", { json: { chat_id: chatId, text: input.text.slice(0, 4096), disable_notification: silent } });
      messageId = r.message_id;
    } else if (media.length === 1) {
      const m = media[0];
      const fd = new FormData();
      fd.append("chat_id", chatId);
      fd.append("caption", input.text.slice(0, 1024));
      fd.append("disable_notification", String(silent));
      fd.append(m.kind === "video" ? "video" : "photo", fileBlob(m.localPath, m.mime), m.filename);
      const r = await call<{ message_id: number }>(token, m.kind === "video" ? "sendVideo" : "sendPhoto", { multipart: fd });
      messageId = r.message_id;
    } else {
      const fd = new FormData();
      fd.append("chat_id", chatId);
      fd.append("disable_notification", String(silent));
      const group = media.map((m, i) => ({
        type: m.kind === "video" ? "video" : "photo",
        media: `attach://file${i}`,
        caption: i === 0 ? input.text.slice(0, 1024) : undefined,
      }));
      media.forEach((m, i) => fd.append(`file${i}`, fileBlob(m.localPath, m.mime), m.filename));
      fd.append("media", JSON.stringify(group));
      const r = await call<Array<{ message_id: number }>>(token, "sendMediaGroup", { multipart: fd });
      messageId = r[0]?.message_id;
      if (input.text.length > 1024) {
        await call(token, "sendMessage", { json: { chat_id: chatId, text: input.text.slice(1024, 5120), disable_notification: true } });
      }
    }
    if (input.settings.pin) {
      try {
        await call(token, "pinChatMessage", { json: { chat_id: chatId, message_id: messageId, disable_notification: true } });
      } catch {
        /* sabitleme yetkisi yoksa yoksay */
      }
    }
    const username = channel.metadata.chatTitle && String(channel.metadata.chatTitle).startsWith("@") ? String(channel.metadata.chatTitle).slice(1) : null;
    return { externalId: String(messageId), url: username ? `https://t.me/${username}/${messageId}` : null };
  },

  async sendMessage({ channel, participantId, text }) {
    const r = await call<{ message_id: number }>(channel.accessToken, "sendMessage", { json: { chat_id: participantId, text: text.slice(0, 4096) } });
    return { externalId: String(r.message_id) };
  },

  async pollInbound(channel: Channel, cursor: string | null) {
    const offset = cursor ? Number(cursor) + 1 : undefined;
    const updates = await call<Array<{ update_id: number; message?: { message_id: number; date: number; text?: string; caption?: string; chat: { id: number; type: string; first_name?: string; last_name?: string; username?: string; title?: string }; from?: { id: number; first_name?: string; last_name?: string; username?: string }; photo?: unknown; video?: unknown; voice?: unknown; document?: { file_name?: string } } }>>(
      channel.accessToken,
      "getUpdates",
      { json: { offset, timeout: 0, allowed_updates: ["message"], limit: 100 } },
    );
    const events: InboundEvent[] = [];
    let last = cursor;
    for (const u of updates) {
      last = String(u.update_id);
      const m = u.message;
      if (!m || m.chat.type !== "private" || !m.from) continue;
      let text = m.text ?? m.caption ?? "";
      if (!text) {
        if (m.photo) text = "[görsel]";
        else if (m.video) text = "[video]";
        else if (m.voice) text = "[sesli mesaj]";
        else if (m.document) text = `[dosya: ${m.document.file_name ?? ""}]`;
        else text = "[mesaj]";
      }
      const name = [m.from.first_name, m.from.last_name].filter(Boolean).join(" ") || (m.from.username ? "@" + m.from.username : null);
      events.push({
        accountExternalId: channel.externalId,
        conversationExternalId: String(m.chat.id),
        participantId: String(m.chat.id),
        participantName: name,
        externalMessageId: `tg_${m.chat.id}_${m.message_id}`,
        text,
        receivedAt: new Date(m.date * 1000).toISOString(),
      });
    }
    return { events, cursor: last };
  },

  async fetchMetrics(channel: Channel) {
    const chatId = channel.metadata.chatId as string | null;
    if (!chatId) return {} as Record<string, number>;
    const count = await call<number>(channel.accessToken, "getChatMemberCount", { query: { chat_id: chatId } });
    return { followers: Number(count ?? 0) };
  },

  async healthCheck(channel: Channel) {
    try {
      await call(channel.accessToken, "getMe");
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};
