import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

const HELIX = "https://api.twitch.tv/helix";

interface Validated {
  client_id: string;
  user_id: string;
  login: string;
  scopes?: string[];
}

/** Form ile girilen kullanıcı jetonunu doğrular: istemci kimliği, kullanıcı ve izinler */
async function validate(rawToken: string): Promise<{ token: string; v: Validated }> {
  const token = rawToken.replace(/^oauth:/i, "").trim();
  if (!token) throw new ProviderError("Twitch jetonu yok", 401);
  const v = await http<Validated>("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${token}` }, retries: 1 }).catch((e) => {
    throw new ProviderError(`Twitch jetonu geçersiz ya da süresi dolmuş: ${e instanceof Error ? e.message : e}`, 401);
  });
  return { token, v };
}

const helixHeaders = (token: string, clientId: string) => ({ Authorization: `Bearer ${token}`, "Client-Id": clientId });

/**
 * Twitch'te kanal akışı (feed) API'si yok; paylaşım kanalın sohbetine mesaj olarak gider
 * (Helix "Send Chat Message", `user:write:chat` izni). Yayın duyurusu, bağlantı ya da kısa not için.
 */
export const twitchProvider: Provider = {
  id: "twitch",
  label: "Twitch",
  color: "#9146FF",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: false,
    thread: false,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 500,
    comments: false,
    maxMedia: 0,
    mediaNote: "Paylaşım kanal sohbetine mesaj olarak gider (en fazla 500 karakter, medya yok).",
  },
  settingFields: [],
  connectFields: [
    { key: "oauthToken", label: "Twitch kullanıcı jetonu (user:write:chat izinli)", type: "text" },
    { key: "channelName", label: "Kanal adı (boşsa jetonun sahibinin kanalı)", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const raw = values.oauthToken?.trim();
    if (!raw) throw new ProviderError("Twitch jetonu zorunlu");
    const { token, v } = await validate(raw);
    if (v.scopes && !v.scopes.includes("user:write:chat")) throw new ProviderError("Jetonda user:write:chat izni yok; sohbete mesaj gönderebilmek için bu izinle yeni jeton oluştur");
    const ch = (values.channelName?.trim() || v.login).toLowerCase().replace(/^@/, "");
    let broadcasterId = v.user_id;
    if (ch !== v.login.toLowerCase()) {
      const u = await http<{ data?: Array<{ id: string; login: string }> }>(`${HELIX}/users`, { headers: helixHeaders(token, v.client_id), query: { login: ch }, retries: 1 });
      if (!u.data?.[0]) throw new ProviderError(`Twitch kanalı bulunamadı: ${ch}`);
      broadcasterId = u.data[0].id;
    }
    return [
      {
        externalId: `twitch_${ch}`,
        name: `Twitch (${ch})`,
        username: ch,
        accessToken: raw,
        tokenExpiresAt: null,
        metadata: { channelName: ch, broadcasterId, senderId: v.user_id },
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const text = input.text.trim();
    if (!text) throw new ProviderError("Twitch sohbet mesajı boş olamaz");
    if (text.length > 500) throw new ProviderError("Twitch sohbet mesajı en fazla 500 karakter olabilir");
    const { token, v } = await validate(channel.accessToken);
    const ch = (channel.metadata.channelName as string | undefined) ?? channel.username ?? v.login;
    let broadcasterId = channel.metadata.broadcasterId as string | undefined;
    if (!broadcasterId) {
      // Eski bağlantılar: kanal kimliği bağlanırken saklanmamıştı
      const u = await http<{ data?: Array<{ id: string }> }>(`${HELIX}/users`, { headers: helixHeaders(token, v.client_id), query: { login: ch }, retries: 1 });
      broadcasterId = u.data?.[0]?.id;
      if (!broadcasterId) throw new ProviderError(`Twitch kanalı bulunamadı: ${ch}`);
    }
    const r = await http<{ data?: Array<{ message_id: string; is_sent: boolean; drop_reason?: { code?: string; message?: string } | null }> }>(`${HELIX}/chat/messages`, {
      method: "POST",
      headers: helixHeaders(token, v.client_id),
      json: { broadcaster_id: broadcasterId, sender_id: v.user_id, message: text },
      retries: 0,
    });
    const m = r.data?.[0];
    if (!m?.is_sent) throw new ProviderError(`Twitch mesajı gönderilmedi: ${m?.drop_reason?.message ?? m?.drop_reason?.code ?? "bilinmeyen neden"}`, 400);
    return { externalId: m.message_id, url: `https://www.twitch.tv/${ch}` };
  },

  /**
   * Takipçi (toplam sayı ek izin istemez) ve videoların toplam izlenmesi (Helix).
   * Form ile girilen jetonun istemci kimliği /oauth2/validate ile öğrenilir.
   */
  async fetchMetrics(channel: Channel): Promise<Record<string, number>> {
    if (!channel.accessToken || channel.accessToken.startsWith("mock")) return {};
    const { token, v } = await validate(channel.accessToken);
    const headers = helixHeaders(token, v.client_id);
    const broadcasterId = (channel.metadata.broadcasterId as string | undefined) ?? v.user_id;
    const out: Record<string, number> = {};
    try {
      const f = await http<{ total?: number }>(`${HELIX}/channels/followers`, { headers, query: { broadcaster_id: broadcasterId, first: 1 }, retries: 1 });
      if (typeof f.total === "number") out.followers = f.total;
    } catch {
      /* takipçi alınamadı */
    }
    try {
      const vids = await http<{ data?: Array<{ view_count?: number }> }>(`${HELIX}/videos`, { headers, query: { user_id: broadcasterId, first: 100 }, retries: 1 });
      out.posts = vids.data?.length ?? 0;
      out.videoViews = (vids.data ?? []).reduce((a, x) => a + (x.view_count ?? 0), 0);
    } catch {
      /* video listesi alınamadı */
    }
    return out;
  },

  async healthCheck(channel: Channel) {
    try {
      await validate(channel.accessToken);
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};

/* ---------------- Rakip takibi: herkese açık kanal verisi ---------------- */

export interface PublicTwitchChannel {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  description: string | null;
  followers: number | null;
  videos: Array<{ id: string; caption: string; likes: null; comments: null; views: number | null; timestamp: string; type: string; permalink: string | null }>;
}

/** Başka bir Twitch kanalının toplam takipçisi ve son 25 videosu (bağlı kanalın jetonuyla; ek izin gerekmez) */
export async function twitchPublicChannel(rawToken: string, login: string): Promise<PublicTwitchChannel> {
  const { token, v } = await validate(rawToken);
  const headers = helixHeaders(token, v.client_id);
  const u = await http<{ data?: Array<{ id: string; login: string; display_name?: string; description?: string; profile_image_url?: string }> }>(`${HELIX}/users`, { headers, query: { login }, retries: 1 });
  const user = u.data?.[0];
  if (!user) throw new ProviderError(`Twitch kanalı bulunamadı: ${login}`, 404);
  const [f, vids] = await Promise.all([
    http<{ total?: number }>(`${HELIX}/channels/followers`, { headers, query: { broadcaster_id: user.id, first: 1 }, retries: 1 }).catch(() => ({ total: undefined })),
    http<{ data?: Array<{ id: string; title?: string; view_count?: number; created_at?: string; url?: string; type?: string }> }>(`${HELIX}/videos`, { headers, query: { user_id: user.id, first: 25 }, retries: 1 }).catch(() => ({ data: [] })),
  ]);
  return {
    login: user.login.toLowerCase(),
    name: user.display_name ?? null,
    avatarUrl: user.profile_image_url ?? null,
    description: user.description ?? null,
    followers: typeof f.total === "number" ? f.total : null,
    videos: (vids.data ?? []).map((x) => ({ id: x.id, caption: x.title ?? "", likes: null, comments: null, views: x.view_count ?? null, timestamp: x.created_at ?? "", type: (x.type ?? "archive").toUpperCase(), permalink: x.url ?? null })),
  };
}
