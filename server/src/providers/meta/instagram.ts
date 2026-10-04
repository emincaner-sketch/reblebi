import { config } from "../../core/config.js";
import type { Channel } from "../../core/types.js";
import { sleep } from "../http.js";
import { ProviderError, type AudienceBreakdown, type Provider, type PublishInput, type PublishMedia, type PublishResult } from "../types.js";
import { fetchInsights, GRAPH, graph, insightBreakdown, insightNumber, metaOAuthCallback, metaOAuthStart, sendPageMessage, waitForContainer } from "./common.js";

async function createContainer(igId: string, token: string, params: Record<string, unknown>): Promise<string> {
  const r = await graph<{ id: string }>(`/${igId}/media`, token, { method: "POST", params });
  return r.id;
}

async function publishContainer(igId: string, token: string, creationId: string): Promise<PublishResult> {
  // Görsel konteynerler genelde anında hazırdır; video/reel/story-video için durum beklenir
  await waitForContainer(`${GRAPH()}/${creationId}`, token, { timeoutMs: 6 * 60_000 });
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await graph<{ id: string }>(`/${igId}/media_publish`, token, { method: "POST", params: { creation_id: creationId } });
      let url: string | null = null;
      try {
        const info = await graph<{ permalink?: string }>(`/${r.id}`, token, { params: { fields: "permalink" } });
        url = info.permalink ?? null;
      } catch {
        /* permalink alınamazsa sorun değil */
      }
      return { externalId: r.id, url };
    } catch (e) {
      lastErr = e;
      // "Media ID is not available" (kod 9007 / alt kod 2207027) -> biraz daha bekle
      await sleep(5000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError("Instagram yayınlama başarısız");
}

function mediaParams(m: PublishMedia, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return m.kind === "video" ? { video_url: m.publicUrl, media_type: "VIDEO", ...extra } : { image_url: m.publicUrl, ...extra };
}

export const instagramProvider: Provider = {
  id: "instagram",
  label: "Instagram",
  color: "#E1306C",
  connectMode: "oauth",
  capabilities: {
    post: true,
    story: true,
    reel: true,
    video: true,
    thread: false,
    dm: true,
    inbound: "webhook",
    analytics: true,
    maxTextLength: 2200,
    comments: true,
    maxMedia: 10,
    requiresMedia: true,
    mediaNote: "Gönderi: 1-10 görsel/video (carousel). Reel: MP4 9:16, 3sn-15dk. Hikaye: 1 görsel (9:16) veya video (<60sn). Medya herkese açık URL ile çekilir (PUBLIC_URL https olmalı).",
  },
  settingFields: [
    { key: "shareToFeed", label: "Reel akışta da görünsün", type: "boolean", default: true, appliesTo: ["reel"] },
    { key: "coverUrl", label: "Reel kapak görseli URL", type: "text", appliesTo: ["reel"] },
    { key: "locationId", label: "Konum ID (isteğe bağlı)", type: "text", appliesTo: ["post", "reel"] },
  ],
  isConfigured: () => Boolean(config.meta.appId && config.meta.appSecret),
  oauthStart: metaOAuthStart,
  oauthCallback: (code, redirectUri) => metaOAuthCallback(code, redirectUri),

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const igId = channel.externalId;
    const token = channel.accessToken;
    const media = input.media;
    if (!media.length) throw new ProviderError("Instagram için en az bir görsel ya da video gerekli");

    if (input.kind === "story") {
      const m = media[0];
      const id = await createContainer(igId, token, {
        media_type: "STORIES",
        ...(m.kind === "video" ? { video_url: m.publicUrl } : { image_url: m.publicUrl }),
      });
      return publishContainer(igId, token, id);
    }

    if (input.kind === "reel" || input.kind === "video") {
      const v = media.find((m) => m.kind === "video");
      if (!v) throw new ProviderError("Reel için bir MP4 video gerekli");
      const id = await createContainer(igId, token, {
        media_type: "REELS",
        video_url: v.publicUrl,
        caption: input.text,
        share_to_feed: input.settings.shareToFeed === false ? false : true,
        cover_url: (input.settings.coverUrl as string) || undefined,
        location_id: (input.settings.locationId as string) || undefined,
      });
      return publishContainer(igId, token, id);
    }

    if (media.length === 1) {
      const m = media[0];
      const id = await createContainer(igId, token, {
        ...(m.kind === "video" ? { media_type: "REELS", video_url: m.publicUrl, share_to_feed: true } : { image_url: m.publicUrl }),
        caption: input.text,
        location_id: (input.settings.locationId as string) || undefined,
      });
      return publishContainer(igId, token, id);
    }

    // Carousel (2-10 öğe)
    const children: string[] = [];
    for (const m of media.slice(0, 10)) {
      const cid = await createContainer(igId, token, mediaParams(m, { is_carousel_item: true }));
      if (m.kind === "video") await waitForContainer(`${GRAPH()}/${cid}`, token);
      children.push(cid);
    }
    const parent = await createContainer(igId, token, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption: input.text,
      location_id: (input.settings.locationId as string) || undefined,
    });
    return publishContainer(igId, token, parent);
  },

  async sendMessage({ channel, participantId, text }) {
    const pageId = (channel.metadata.pageId as string) || channel.externalId;
    const id = await sendPageMessage(pageId, channel.accessToken, participantId, text);
    return { externalId: id };
  },

  async fetchMetrics(channel: Channel) {
    const token = channel.accessToken;
    const basic = await graph<{ followers_count?: number; media_count?: number }>(`/${channel.externalId}`, token, {
      params: { fields: "followers_count,media_count" },
    });
    const metrics: Record<string, number> = {
      followers: Number(basic.followers_count ?? 0),
      posts: Number(basic.media_count ?? 0),
    };
    try {
      const ins = await graph<{ data?: Array<{ name: string; total_value?: { value: number }; values?: Array<{ value: number }> }> }>(
        `/${channel.externalId}/insights`,
        token,
        { params: { metric: "reach,accounts_engaged", period: "day", metric_type: "total_value" } },
      );
      for (const d of ins.data ?? []) {
        const v = d.total_value?.value ?? d.values?.[d.values.length - 1]?.value;
        if (typeof v === "number") metrics[d.name === "reach" ? "reach" : "engagement"] = v;
      }
    } catch {
      /* insights opsiyonel */
    }
    return metrics;
  },

  async publishComment(channel: Channel, parentExternalId: string, text: string, replyToExternalId?: string | null) {
    const edge = replyToExternalId ? `/${replyToExternalId}/replies` : `/${parentExternalId}/comments`;
    const r = await graph<{ id: string }>(edge, channel.accessToken, { method: "POST", params: { message: text } });
    return { externalId: r.id };
  },

  async fetchPostMetrics(channel: Channel, externalId: string) {
    const base = await graph<{ like_count?: number; comments_count?: number; media_product_type?: string }>(`/${externalId}`, channel.accessToken, {
      params: { fields: "like_count,comments_count,media_product_type" },
    });
    const m: Record<string, number> = { likes: Number(base.like_count ?? 0), comments: Number(base.comments_count ?? 0) };
    // İçerik biçimine göre desteklenen metrikler farklı: geçersiz biri tüm isteği düşürmesin
    const type = (base.media_product_type ?? "FEED").toUpperCase();
    const metrics =
      type === "STORY"
        ? ["reach", "views", "replies", "shares", "total_interactions"]
        : type === "REELS"
          ? ["reach", "views", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"]
          : ["reach", "views", "saved", "shares", "total_interactions", "profile_visits", "follows"];
    const rows = await fetchInsights(`/${externalId}/insights`, channel.accessToken, metrics, {});
    for (const [name, row] of rows) {
      const v = insightNumber(row);
      if (v === null) continue;
      // Ortak adlar: saved → saves, ig_reels_avg_watch_time (ms) → avgWatchMs
      const key = name === "saved" ? "saves" : name === "ig_reels_avg_watch_time" ? "avgWatchMs" : name === "profile_visits" ? "profileVisits" : name === "total_interactions" ? "totalInteractions" : name;
      m[key] = v;
    }
    return m;
  },

  async fetchDailyInsights(channel: Channel, range: { since: number; until: number }) {
    const out: Record<string, number> = {};
    const names: Record<string, string> = { reach: "reach", views: "views", profile_views: "profileViews", website_clicks: "websiteClicks", accounts_engaged: "engaged" };
    const rows = await fetchInsights(`/${channel.externalId}/insights`, channel.accessToken, Object.keys(names), { period: "day", metric_type: "total_value", since: range.since, until: range.until });
    for (const [name, row] of rows) {
      const v = insightNumber(row);
      if (v !== null && names[name]) out[names[name]] = v;
    }
    // Takipçi dengesi: FOLLOWER = takip eden, NON_FOLLOWER = takibi bırakan
    const fu = await fetchInsights(`/${channel.externalId}/insights`, channel.accessToken, ["follows_and_unfollows"], {
      period: "day",
      metric_type: "total_value",
      breakdown: "follow_type",
      since: range.since,
      until: range.until,
    });
    const split = insightBreakdown(fu.get("follows_and_unfollows"));
    if (split.FOLLOWER !== undefined) out.follows = split.FOLLOWER;
    if (split.NON_FOLLOWER !== undefined) out.unfollows = split.NON_FOLLOWER;
    return out;
  },

  async fetchAudience(channel: Channel) {
    // follower_demographics en az 100 takipçide döner; her kırılım ayrı istek ister
    const out: AudienceBreakdown = {};
    for (const bd of ["country", "city", "age", "gender"] as const) {
      const rows = await fetchInsights(`/${channel.externalId}/insights`, channel.accessToken, ["follower_demographics"], { period: "lifetime", metric_type: "total_value", breakdown: bd });
      const rec = insightBreakdown(rows.get("follower_demographics"));
      if (Object.keys(rec).length) out[bd] = rec;
    }
    return out;
  },

  async healthCheck(channel: Channel) {
    try {
      await graph(`/${channel.externalId}`, channel.accessToken, { params: { fields: "id,username" } });
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};

/* ---------------- Rakip takibi: Business Discovery ---------------- */

export interface DiscoveredAccount {
  username: string;
  name: string | null;
  avatarUrl: string | null;
  biography: string | null;
  followers: number | null;
  mediaCount: number | null;
  media: Array<{ id: string; caption: string; likes: number | null; comments: number | null; timestamp: string; type: string; permalink: string | null }>;
}

/**
 * Başka bir Instagram işletme/içerik üreticisi hesabının herkese açık metrikleri (kendi IG hesabının jetonuyla).
 * Kişisel hesaplar ve gizli beğeni sayıları dönmez; o alanlar null kalır.
 */
export async function businessDiscovery(igUserId: string, token: string, username: string): Promise<DiscoveredAccount> {
  const clean = username.replace(/^@/, "").trim().toLowerCase();
  const fields = `business_discovery.username(${clean}){username,name,profile_picture_url,biography,followers_count,media_count,media.limit(25){id,caption,like_count,comments_count,timestamp,media_type,permalink}}`;
  const r = await graph<{
    business_discovery?: {
      username?: string;
      name?: string;
      profile_picture_url?: string;
      biography?: string;
      followers_count?: number;
      media_count?: number;
      media?: { data?: Array<{ id: string; caption?: string; like_count?: number; comments_count?: number; timestamp?: string; media_type?: string; permalink?: string }> };
    };
  }>(`/${igUserId}`, token, { params: { fields } });
  const b = r.business_discovery;
  if (!b) throw new ProviderError("Hesap bulunamadı ya da işletme/içerik üreticisi hesabı değil", 404);
  return {
    username: b.username ?? clean,
    name: b.name ?? null,
    avatarUrl: b.profile_picture_url ?? null,
    biography: b.biography ?? null,
    followers: typeof b.followers_count === "number" ? b.followers_count : null,
    mediaCount: typeof b.media_count === "number" ? b.media_count : null,
    media: (b.media?.data ?? []).map((m) => ({
      id: m.id,
      caption: (m.caption ?? "").slice(0, 300),
      likes: typeof m.like_count === "number" ? m.like_count : null,
      comments: typeof m.comments_count === "number" ? m.comments_count : null,
      timestamp: m.timestamp ?? "",
      type: m.media_type ?? "IMAGE",
      permalink: m.permalink ?? null,
    })),
  };
}

/* ---------------- Profil ızgarası: son gönderiler ---------------- */

export interface FeedItem {
  id: string;
  caption: string;
  mediaType: string;
  imageUrl: string | null;
  permalink: string | null;
  timestamp: string;
  likes: number | null;
  comments: number | null;
}

/** Hesabın profilde görünen son gönderileri (ızgara önizlemesi için; hikâyeler dahil değil) */
export async function instagramRecentMedia(igUserId: string, token: string, limit = 30): Promise<FeedItem[]> {
  const r = await graph<{ data?: Array<{ id: string; caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number }> }>(
    `/${igUserId}/media`,
    token,
    { params: { fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count", limit } },
  );
  return (r.data ?? []).map((m) => ({
    id: m.id,
    caption: m.caption ?? "",
    mediaType: m.media_type ?? "IMAGE",
    imageUrl: (m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url) ?? m.thumbnail_url ?? null,
    permalink: m.permalink ?? null,
    timestamp: m.timestamp ?? "",
    likes: m.like_count ?? null,
    comments: m.comments_count ?? null,
  }));
}
