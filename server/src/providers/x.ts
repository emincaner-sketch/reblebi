import { config } from "../core/config.js";
import type { Channel } from "../core/types.js";
import { pkcePair } from "../core/crypto.js";
import { expiresIn, fileBlob, http, sleep } from "./http.js";
import { ProviderError, type InboundEvent, type Provider, type PublishInput, type PublishMedia, type PublishResult } from "./types.js";
import { splitThread } from "./meta/threads.js";

const API = "https://api.x.com/2";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "dm.read", "dm.write", "media.write"];

function basicAuth(): Record<string, string> {
  if (!config.x.clientSecret) return {};
  return { Authorization: "Basic " + Buffer.from(`${config.x.clientId}:${config.x.clientSecret}`).toString("base64") };
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function mediaCategory(m: PublishMedia): string {
  if (m.kind === "video") return "tweet_video";
  return m.mime === "image/gif" ? "tweet_gif" : "tweet_image";
}

/** X v2 parçalı medya yükleme (initialize -> append -> finalize -> status) */
async function uploadMedia(token: string, m: PublishMedia): Promise<string> {
  const file = await fileBlob(m.localPath, m.mime);
  const init = await http<{ data: { id: string } }>(`${API}/media/upload/initialize`, {
    method: "POST",
    headers: bearer(token),
    json: { media_type: m.mime, total_bytes: file.size, media_category: mediaCategory(m) },
  });
  const mediaId = init.data.id;
  const CHUNK = 4 * 1024 * 1024;
  let idx = 0;
  for (let off = 0; off < file.size; off += CHUNK) {
    const fd = new FormData();
    fd.append("media", file.slice(off, off + CHUNK, m.mime));
    fd.append("segment_index", String(idx++));
    await http(`${API}/media/upload/${mediaId}/append`, { method: "POST", headers: bearer(token), multipart: fd, timeoutMs: 120_000 });
  }
  const fin = await http<{ data: { id: string; processing_info?: { state: string; check_after_secs?: number } } }>(
    `${API}/media/upload/${mediaId}/finalize`,
    { method: "POST", headers: bearer(token) },
  );
  let info = fin.data.processing_info;
  const deadline = Date.now() + 5 * 60_000;
  while (info && info.state !== "succeeded" && Date.now() < deadline) {
    if (info.state === "failed") throw new ProviderError("X medya işleme başarısız");
    await sleep((info.check_after_secs ?? 3) * 1000);
    const st = await http<{ data: { processing_info?: { state: string; check_after_secs?: number } } }>(`${API}/media/upload`, {
      headers: bearer(token),
      query: { command: "STATUS", media_id: mediaId },
    });
    info = st.data.processing_info;
  }
  return mediaId;
}

export const xProvider: Provider = {
  id: "x",
  label: "X (Twitter)",
  color: "#111111",
  connectMode: "oauth",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: true,
    thread: true,
    dm: true,
    inbound: "poll",
    analytics: true,
    maxTextLength: 280,
    comments: true,
    maxMedia: 4,
    mediaNote: "En fazla 4 görsel ya da 1 video. DM okuma/yazma için ücretli API katmanı gerekir.",
  },
  settingFields: [
    {
      key: "replySettings",
      label: "Kimler yanıtlayabilir",
      type: "select",
      options: [
        { value: "", label: "Herkes" },
        { value: "following", label: "Takip ettiklerim" },
        { value: "mentionedUsers", label: "Etiketlenenler" },
      ],
    },
  ],
  isConfigured: () => Boolean(config.x.clientId),

  oauthStart(redirectUri, state) {
    const { verifier, challenge } = pkcePair();
    const u = new URL("https://x.com/i/oauth2/authorize");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", config.x.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("scope", SCOPES.join(" "));
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    return { url: u.toString(), codeVerifier: verifier };
  },

  async oauthCallback(code, redirectUri, codeVerifier) {
    const tok = await http<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(`${API}/oauth2/token`, {
      method: "POST",
      headers: basicAuth(),
      form: { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier ?? "", client_id: config.x.clientId },
    });
    const me = await http<{ data: { id: string; name: string; username: string; profile_image_url?: string } }>(`${API}/users/me`, {
      headers: bearer(tok.access_token),
      query: { "user.fields": "profile_image_url" },
    });
    return [
      {
        externalId: me.data.id,
        name: me.data.name,
        username: me.data.username,
        avatarUrl: me.data.profile_image_url?.replace("_normal", "_400x400") ?? null,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        tokenExpiresAt: expiresIn(tok.expires_in),
        scopes: tok.scope ?? SCOPES.join(" "),
      },
    ];
  },

  async refreshToken(channel) {
    if (!channel.refreshToken) return null;
    const tok = await http<{ access_token: string; refresh_token?: string; expires_in?: number }>(`${API}/oauth2/token`, {
      method: "POST",
      headers: basicAuth(),
      form: { grant_type: "refresh_token", refresh_token: channel.refreshToken, client_id: config.x.clientId },
    });
    return { accessToken: tok.access_token, refreshToken: tok.refresh_token ?? channel.refreshToken, tokenExpiresAt: expiresIn(tok.expires_in) };
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const token = channel.accessToken;
    const parts = input.kind === "thread" ? splitThread(input.text, 280) : [input.text];
    const mediaIds: string[] = [];
    const video = input.media.find((m) => m.kind === "video");
    const toUpload = video ? [video] : input.media.filter((m) => m.kind === "image").slice(0, 4);
    for (const m of toUpload) mediaIds.push(await uploadMedia(token, m));

    let first: PublishResult | null = null;
    let replyTo: string | null = null;
    for (let i = 0; i < parts.length; i++) {
      const body: Record<string, unknown> = { text: parts[i] };
      if (i === 0 && mediaIds.length) body.media = { media_ids: mediaIds };
      if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
      if (i === 0 && input.settings.replySettings) body.reply_settings = input.settings.replySettings;
      const r = await http<{ data: { id: string } }>(`${API}/tweets`, { method: "POST", headers: bearer(token), json: body });
      const res = { externalId: r.data.id, url: `https://x.com/${channel.username ?? "i"}/status/${r.data.id}` };
      if (!first) first = res;
      replyTo = r.data.id;
    }
    if (!first) throw new ProviderError("Boş içerik");
    return first;
  },

  async sendMessage({ channel, participantId, text }) {
    const r = await http<{ data?: { dm_event_id?: string } }>(`${API}/dm_conversations/with/${participantId}/messages`, {
      method: "POST",
      headers: bearer(channel.accessToken),
      json: { text },
    });
    return { externalId: r.data?.dm_event_id ?? null };
  },

  async pollInbound(channel: Channel, cursor: string | null) {
    const r = await http<{
      data?: Array<{ id: string; text?: string; created_at?: string; sender_id?: string; dm_conversation_id?: string; event_type?: string }>;
      includes?: { users?: Array<{ id: string; name?: string; username?: string; profile_image_url?: string }> };
    }>(`${API}/dm_events`, {
      headers: bearer(channel.accessToken),
      query: {
        "dm_event.fields": "id,text,created_at,sender_id,dm_conversation_id,event_type",
        expansions: "sender_id",
        "user.fields": "name,username,profile_image_url",
        event_types: "MessageCreate",
        max_results: 50,
      },
      retries: 0,
    });
    const users = new Map((r.includes?.users ?? []).map((u) => [u.id, u]));
    const events: InboundEvent[] = [];
    let newest = cursor;
    for (const ev of r.data ?? []) {
      if (!newest || BigInt(ev.id) > BigInt(newest)) newest = ev.id;
      if (cursor && BigInt(ev.id) <= BigInt(cursor)) continue;
      if (!ev.sender_id || ev.sender_id === channel.externalId) continue;
      const u = users.get(ev.sender_id);
      events.push({
        accountExternalId: channel.externalId,
        conversationExternalId: ev.dm_conversation_id ?? ev.sender_id,
        participantId: ev.sender_id,
        participantName: u?.name ?? (u?.username ? "@" + u.username : null),
        participantAvatar: u?.profile_image_url ?? null,
        externalMessageId: ev.id,
        text: ev.text ?? "",
        receivedAt: ev.created_at,
      });
    }
    // İlk çalıştırmada geçmişi yanıtlamamak için cursor'u en yeniye ayarla, olayları yayınlama
    if (!cursor) return { events: [], cursor: newest };
    return { events: events.reverse(), cursor: newest };
  },

  async fetchMetrics(channel: Channel) {
    const me = await http<{ data: { public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number } } }>(`${API}/users/me`, {
      headers: bearer(channel.accessToken),
      query: { "user.fields": "public_metrics" },
    });
    const pm = me.data.public_metrics ?? {};
    return { followers: Number(pm.followers_count ?? 0), following: Number(pm.following_count ?? 0), posts: Number(pm.tweet_count ?? 0) };
  },

  async publishComment(channel: Channel, parentExternalId: string, text: string, replyToExternalId?: string | null) {
    const r = await http<{ data: { id: string } }>(`${API}/tweets`, {
      method: "POST",
      headers: bearer(channel.accessToken),
      json: { text, reply: { in_reply_to_tweet_id: replyToExternalId ?? parentExternalId } },
    });
    return { externalId: r.data.id };
  },

  async fetchPostMetrics(channel: Channel, externalId: string) {
    const r = await http<{ data?: { public_metrics?: Record<string, number> } }>(`${API}/tweets/${externalId}`, {
      headers: bearer(channel.accessToken),
      query: { "tweet.fields": "public_metrics" },
      retries: 0,
    });
    const pm = r.data?.public_metrics ?? {};
    return {
      likes: Number(pm.like_count ?? 0),
      comments: Number(pm.reply_count ?? 0),
      shares: Number(pm.retweet_count ?? 0) + Number(pm.quote_count ?? 0),
      views: Number(pm.impression_count ?? 0),
    };
  },

  async healthCheck(channel: Channel) {
    try {
      await http(`${API}/users/me`, { headers: bearer(channel.accessToken) });
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};
