import fs from "node:fs";
import { config } from "../core/config.js";
import type { Channel } from "../core/types.js";
import { expiresIn, http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.force-ssl"];

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export const youtubeProvider: Provider = {
  id: "youtube",
  label: "YouTube",
  color: "#FF0000",
  connectMode: "oauth",
  capabilities: {
    post: false,
    story: false,
    reel: true,
    video: true,
    thread: false,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 5000,
    comments: true,
    maxMedia: 1,
    requiresMedia: true,
    requiresVideo: true,
    mediaNote: "1 video dosyası (MP4/MOV). Shorts için dikey video + başlıkta #Shorts. Metin = açıklama; başlık ayarlardan girilir.",
  },
  settingFields: [
    { key: "title", label: "Video başlığı (zorunlu)", type: "text", help: "En fazla 100 karakter" },
    {
      key: "privacyStatus",
      label: "Gizlilik",
      type: "select",
      options: [
        { value: "public", label: "Herkese açık" },
        { value: "unlisted", label: "Liste dışı" },
        { value: "private", label: "Özel" },
      ],
      default: "public",
    },
    { key: "tags", label: "Etiketler (virgülle)", type: "text" },
    { key: "categoryId", label: "Kategori ID", type: "text", default: "22", help: "22 = People & Blogs, 27 = Education, 28 = Science & Tech" },
    { key: "madeForKids", label: "Çocuklara yönelik", type: "boolean", default: false },
  ],
  isConfigured: () => Boolean(config.google.clientId && config.google.clientSecret),

  oauthStart(redirectUri, state) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", config.google.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", SCOPES.join(" "));
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("include_granted_scopes", "true");
    u.searchParams.set("state", state);
    return { url: u.toString() };
  },

  async oauthCallback(code, redirectUri) {
    const tok = await http<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>("https://oauth2.googleapis.com/token", {
      form: { code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" },
    });
    const ch = await http<{ items?: Array<{ id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }> }>(
      "https://www.googleapis.com/youtube/v3/channels",
      { headers: bearer(tok.access_token), query: { part: "snippet", mine: "true" } },
    );
    const item = ch.items?.[0];
    if (!item) throw new ProviderError("Bu Google hesabında YouTube kanalı bulunamadı");
    return [
      {
        externalId: item.id,
        name: item.snippet.title,
        username: item.snippet.customUrl ?? null,
        avatarUrl: item.snippet.thumbnails?.default?.url ?? null,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        tokenExpiresAt: expiresIn(tok.expires_in),
        scopes: tok.scope ?? SCOPES.join(" "),
      },
    ];
  },

  async refreshToken(channel) {
    if (!channel.refreshToken) return null;
    const tok = await http<{ access_token: string; expires_in?: number }>("https://oauth2.googleapis.com/token", {
      form: { client_id: config.google.clientId, client_secret: config.google.clientSecret, refresh_token: channel.refreshToken, grant_type: "refresh_token" },
    });
    return { accessToken: tok.access_token, tokenExpiresAt: expiresIn(tok.expires_in) };
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const video = input.media.find((m) => m.kind === "video");
    if (!video) throw new ProviderError("YouTube için bir video dosyası gerekli");
    const title = String(input.settings.title || input.text.split("\n")[0] || "Video").slice(0, 100);
    const tags = String(input.settings.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const meta = {
      snippet: { title, description: input.text.slice(0, 5000), tags: tags.length ? tags : undefined, categoryId: String(input.settings.categoryId || "22") },
      status: { privacyStatus: (input.settings.privacyStatus as string) || "public", selfDeclaredMadeForKids: Boolean(input.settings.madeForKids) },
    };
    const buf = fs.readFileSync(video.localPath);
    const initRes = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        ...bearer(channel.accessToken),
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": video.mime || "video/mp4",
        "X-Upload-Content-Length": String(buf.length),
      },
      body: JSON.stringify(meta),
    });
    if (!initRes.ok) throw new ProviderError(`YouTube ${initRes.status}: ${(await initRes.text()).slice(0, 400)}`, initRes.status, undefined, initRes.status >= 500);
    const location = initRes.headers.get("location");
    if (!location) throw new ProviderError("YouTube yükleme oturumu açılamadı");
    const up = await fetch(location, { method: "PUT", headers: { "Content-Type": video.mime || "video/mp4", "Content-Length": String(buf.length) }, body: buf });
    if (!up.ok) throw new ProviderError(`YouTube yükleme ${up.status}: ${(await up.text()).slice(0, 400)}`, up.status, undefined, up.status >= 500);
    const data = (await up.json()) as { id: string };
    return { externalId: data.id, url: `https://youtu.be/${data.id}` };
  },

  async fetchMetrics(channel: Channel) {
    const r = await http<{ items?: Array<{ statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string } }> }>(
      "https://www.googleapis.com/youtube/v3/channels",
      { headers: bearer(channel.accessToken), query: { part: "statistics", id: channel.externalId } },
    );
    const s = r.items?.[0]?.statistics ?? {};
    return { followers: Number(s.subscriberCount ?? 0), views: Number(s.viewCount ?? 0), posts: Number(s.videoCount ?? 0) };
  },

  async publishComment(channel: Channel, parentExternalId: string, text: string, replyToExternalId?: string | null) {
    if (replyToExternalId) {
      const r = await http<{ id: string }>("https://www.googleapis.com/youtube/v3/comments", {
        method: "POST",
        headers: bearer(channel.accessToken),
        query: { part: "snippet" },
        json: { snippet: { parentId: replyToExternalId, textOriginal: text } },
      });
      return { externalId: r.id };
    }
    const r = await http<{ id: string; snippet?: { topLevelComment?: { id: string } } }>("https://www.googleapis.com/youtube/v3/commentThreads", {
      method: "POST",
      headers: bearer(channel.accessToken),
      query: { part: "snippet" },
      json: { snippet: { videoId: parentExternalId, topLevelComment: { snippet: { textOriginal: text } } } },
    });
    return { externalId: r.snippet?.topLevelComment?.id ?? r.id };
  },

  async fetchPostMetrics(channel: Channel, externalId: string) {
    const r = await http<{ items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }> }>(
      "https://www.googleapis.com/youtube/v3/videos",
      { headers: bearer(channel.accessToken), query: { part: "statistics", id: externalId }, retries: 0 },
    );
    const s = r.items?.[0]?.statistics ?? {};
    return { views: Number(s.viewCount ?? 0), likes: Number(s.likeCount ?? 0), comments: Number(s.commentCount ?? 0) };
  },

  async healthCheck(channel: Channel) {
    try {
      await http("https://www.googleapis.com/youtube/v3/channels", { headers: bearer(channel.accessToken), query: { part: "id", mine: "true" } });
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};
