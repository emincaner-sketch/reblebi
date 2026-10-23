import { config } from "../core/config.js";
import type { Channel } from "../core/types.js";
import { expiresIn, fileBlob, http } from "./http.js";
import { ProviderError, type AudienceBreakdown, type InboundEvent, type Provider, type PublishInput, type PublishResult } from "./types.js";

/** Yorum yoklaması en fazla bu sıklıkta (YouTube Data API kotası) */
const YT_POLL_MS = 10 * 60_000;

// yt-analytics.readonly: Analitik > YouTube hesap insights (izlenme süresi, abone kazanımı/kaybı, izleyici kitlesi)
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

/** YouTube Analytics API v2 raporu (kanal sahibi olarak) */
async function ytAnalytics(channel: Channel, q: Record<string, string>): Promise<{ columnHeaders?: Array<{ name: string }>; rows?: Array<Array<string | number>> }> {
  return http("https://youtubeanalytics.googleapis.com/v2/reports", { headers: bearer(channel.accessToken), query: { ids: "channel==MINE", ...q }, retries: 1 });
}

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
    inbound: "poll",
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
    const file = await fileBlob(video.localPath, video.mime || "video/mp4");
    const initRes = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        ...bearer(channel.accessToken),
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": video.mime || "video/mp4",
        "X-Upload-Content-Length": String(file.size),
      },
      body: JSON.stringify(meta),
    });
    if (!initRes.ok) throw new ProviderError(`YouTube ${initRes.status}: ${(await initRes.text()).slice(0, 400)}`, initRes.status, undefined, initRes.status >= 500);
    const location = initRes.headers.get("location");
    if (!location) throw new ProviderError("YouTube yükleme oturumu açılamadı");
    // Parçalı gönderim (256 KiB katı): büyük videolar belleğe tek seferde alınmaz; ara parçalara 308 döner
    const CHUNK = 16 * 1024 * 1024;
    let up: Response | undefined;
    for (let start = 0; start < file.size; start += CHUNK) {
      const part = file.slice(start, Math.min(start + CHUNK, file.size));
      up = await fetch(location, {
        method: "PUT",
        headers: { "Content-Type": video.mime || "video/mp4", "Content-Length": String(part.size), "Content-Range": `bytes ${start}-${start + part.size - 1}/${file.size}` },
        body: part,
      });
      if (up.status === 308) continue;
      if (!up.ok) throw new ProviderError(`YouTube yükleme ${up.status}: ${(await up.text()).slice(0, 400)}`, up.status, undefined, up.status >= 500);
    }
    if (!up?.ok) throw new ProviderError("YouTube yükleme tamamlanamadı");
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

  /** YouTube Analytics (yt-analytics.readonly): tamamlanmış günün izlenme, izlenme süresi, abone kazanımı/kaybı */
  async fetchDailyInsights(channel: Channel, range: { since: number; until: number }) {
    // Günün ortası UTC'de aynı takvim günüdür (±12 saat dilimleri için)
    const day = new Date(((range.since + range.until) / 2) * 1000).toISOString().slice(0, 10);
    const r = await ytAnalytics(channel, { startDate: day, endDate: day, metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost" });
    const row = r.rows?.[0];
    if (!row) return {};
    const col = (name: string) => {
      const i = (r.columnHeaders ?? []).findIndex((h) => h.name === name);
      const v = i >= 0 ? Number(row[i]) : NaN;
      return Number.isFinite(v) ? v : undefined;
    };
    const out: Record<string, number> = {};
    const put = (k: string, v: number | undefined) => {
      if (v !== undefined) out[k] = v;
    };
    put("views", col("views"));
    put("watchMinutes", col("estimatedMinutesWatched"));
    put("follows", col("subscribersGained"));
    put("unfollows", col("subscribersLost"));
    return out;
  },

  /** İzleyici kitlesi (son 28 gün): ülkeye göre izlenme; yaş ve cinsiyet izleyici yüzdesi olarak */
  async fetchAudience(channel: Channel) {
    const end = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const start = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    const out: AudienceBreakdown = { basis: "viewers" };
    const country = await ytAnalytics(channel, { startDate: start, endDate: end, dimensions: "country", metrics: "views", sort: "-views", maxResults: "25" }).catch(() => null);
    if (country?.rows?.length) out.country = Object.fromEntries(country.rows.map((r) => [String(r[0]), Number(r[1])]));
    const demo = await ytAnalytics(channel, { startDate: start, endDate: end, dimensions: "ageGroup,gender", metrics: "viewerPercentage" }).catch(() => null);
    if (demo?.rows?.length) {
      const age: Record<string, number> = {};
      const gender: Record<string, number> = {};
      for (const [a, g, v] of demo.rows as Array<[string, string, number]>) {
        const ak = String(a).replace(/^age/, "");
        const gk = g === "female" ? "F" : g === "male" ? "M" : "U";
        age[ak] = Math.round(((age[ak] ?? 0) + Number(v)) * 10) / 10;
        gender[gk] = Math.round(((gender[gk] ?? 0) + Number(v)) * 10) / 10;
      }
      out.age = age;
      out.gender = gender;
      out.percent = true;
    }
    return Object.keys(out).length > 1 ? out : {};
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

  /**
   * Kanalın videolarına gelen yeni yorumlar (gelen kutusu, "Yorumlar"). Yoklama 15 sn'de bir çağırır;
   * kota için en fazla 10 dakikada bir istek atılır (commentThreads.list = 1 birim).
   */
  async pollInbound(channel: Channel, cursor: string | null) {
    let state: { at: number; since: string | null } = { at: 0, since: null };
    try {
      if (cursor) state = { at: 0, since: null, ...(JSON.parse(cursor) as object) } as typeof state;
    } catch {
      /* eski biçim */
    }
    if (Date.now() - state.at < YT_POLL_MS) return { events: [], cursor };
    const r = await http<{
      items?: Array<{
        id: string;
        snippet?: {
          videoId?: string;
          topLevelComment?: { id: string; snippet?: { authorDisplayName?: string; authorProfileImageUrl?: string; authorChannelId?: { value?: string }; textOriginal?: string; publishedAt?: string } };
        };
      }>;
    }>("https://www.googleapis.com/youtube/v3/commentThreads", {
      headers: bearer(channel.accessToken),
      query: { part: "snippet", allThreadsRelatedToChannelId: channel.externalId, order: "time", maxResults: 50, textFormat: "plainText" },
      retries: 1,
    });
    // İlk çalıştırmada yalnızca son 3 gün (eski yorumlar gelen kutusunu doldurmasın)
    const since = state.since ?? new Date(Date.now() - 3 * 86_400_000).toISOString();
    const events: InboundEvent[] = [];
    let newest = since;
    for (const t of r.items ?? []) {
      const c = t.snippet?.topLevelComment;
      const s = c?.snippet;
      const author = s?.authorChannelId?.value;
      if (!c || !s?.publishedAt || !t.snippet?.videoId || s.publishedAt <= since) continue;
      if (s.publishedAt > newest) newest = s.publishedAt;
      if (author === channel.externalId) continue; // kanalın kendi yorumu
      events.push({
        accountExternalId: channel.externalId,
        kind: "comment",
        conversationExternalId: `c:${t.snippet.videoId}:${author ?? c.id}`,
        participantId: author ?? c.id,
        participantName: s.authorDisplayName ?? null,
        participantAvatar: s.authorProfileImageUrl ?? null,
        externalMessageId: c.id,
        text: s.textOriginal ?? "",
        metadata: { kind: "comment", mediaId: t.snippet.videoId, commentId: c.id, parentId: null },
        receivedAt: s.publishedAt,
      });
    }
    return { events, cursor: JSON.stringify({ at: Date.now(), since: newest }) };
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

/* ---------------- Rakip takibi: herkese açık kanal verisi ---------------- */

export interface PublicChannel {
  id: string;
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  description: string | null;
  subscribers: number | null;
  videoCount: number | null;
  videos: Array<{ id: string; caption: string; likes: number | null; comments: number | null; views: number | null; timestamp: string; type: string; permalink: string | null }>;
}

/**
 * Başka bir YouTube kanalının herkese açık istatistikleri ve son 25 videosu (bağlı kanalın jetonuyla; 3 kota birimi).
 * `ref`: @tanıtıcı ya da UC… kanal kimliği. Abone sayısını gizleyen kanallarda subscribers null döner.
 */
export async function youtubePublicChannel(token: string, ref: string): Promise<PublicChannel> {
  const query: Record<string, string> = { part: "snippet,statistics,contentDetails" };
  if (/^UC[\w-]{22}$/.test(ref)) query.id = ref;
  else query.forHandle = ref.startsWith("@") ? ref : `@${ref}`;
  const r = await http<{
    items?: Array<{
      id: string;
      snippet?: { title?: string; description?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
      statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  }>("https://www.googleapis.com/youtube/v3/channels", { headers: bearer(token), query, retries: 1 });
  const ch = r.items?.[0];
  if (!ch) throw new ProviderError("Kanal bulunamadı", 404);
  const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v));
  let videos: PublicChannel["videos"] = [];
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  if (uploads) {
    const pl = await http<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>("https://www.googleapis.com/youtube/v3/playlistItems", {
      headers: bearer(token),
      query: { part: "contentDetails", playlistId: uploads, maxResults: 25 },
      retries: 1,
    }).catch(() => ({ items: [] }));
    const ids = (pl.items ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => Boolean(x));
    if (ids.length) {
      const v = await http<{ items?: Array<{ id: string; snippet?: { title?: string; publishedAt?: string }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }> }>(
        "https://www.googleapis.com/youtube/v3/videos",
        { headers: bearer(token), query: { part: "snippet,statistics", id: ids.join(",") }, retries: 1 },
      );
      videos = (v.items ?? []).map((x) => ({
        id: x.id,
        caption: x.snippet?.title ?? "",
        likes: num(x.statistics?.likeCount),
        comments: num(x.statistics?.commentCount),
        views: num(x.statistics?.viewCount),
        timestamp: x.snippet?.publishedAt ?? "",
        type: "VIDEO",
        permalink: `https://www.youtube.com/watch?v=${x.id}`,
      }));
    }
  }
  return {
    id: ch.id,
    handle: (ch.snippet?.customUrl ?? ch.id).replace(/^@/, ""),
    name: ch.snippet?.title ?? null,
    avatarUrl: ch.snippet?.thumbnails?.default?.url ?? null,
    description: ch.snippet?.description ?? null,
    subscribers: ch.statistics?.hiddenSubscriberCount ? null : num(ch.statistics?.subscriberCount),
    videoCount: num(ch.statistics?.videoCount),
    videos,
  };
}
