import { config } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import type { Channel } from "../../core/types.js";
import { http, sleep } from "../http.js";
import { ProviderError, type AudienceBreakdown, type ConnectedAccount, type OAuthStart, type Provider, type PublishInput, type PublishMedia, type PublishResult } from "../types.js";
import { channelBase, fetchInsights, GRAPH, graph, IG_GRAPH, insightBreakdown, insightNumber, metaOAuthCallback, metaOAuthStart, sendCommentPrivateReply, sendPageMessage, waitForContainer } from "./common.js";

async function createContainer(igId: string, token: string, params: Record<string, unknown>, base?: string): Promise<string> {
  const r = await graph<{ id: string }>(`/${igId}/media`, token, { method: "POST", params, base });
  return r.id;
}

async function publishContainer(igId: string, token: string, creationId: string, base?: string): Promise<PublishResult> {
  // Görsel konteynerler genelde anında hazırdır; video/reel/story-video için durum beklenir
  await waitForContainer(`${base ?? GRAPH()}/${creationId}`, token, { timeoutMs: 6 * 60_000 });
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await graph<{ id: string }>(`/${igId}/media_publish`, token, { method: "POST", params: { creation_id: creationId }, base });
      let url: string | null = null;
      try {
        const info = await graph<{ permalink?: string }>(`/${r.id}`, token, { params: { fields: "permalink" }, base });
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
    const base = channelBase(channel);
    const media = input.media;
    if (!media.length) throw new ProviderError("Instagram için en az bir görsel ya da video gerekli");

    if (input.kind === "story") {
      const m = media[0];
      const id = await createContainer(igId, token, {
        media_type: "STORIES",
        ...(m.kind === "video" ? { video_url: m.publicUrl } : { image_url: m.publicUrl }),
      }, base);
      return publishContainer(igId, token, id, base);
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
      }, base);
      return publishContainer(igId, token, id, base);
    }

    if (media.length === 1) {
      const m = media[0];
      const id = await createContainer(igId, token, {
        ...(m.kind === "video" ? { media_type: "REELS", video_url: m.publicUrl, share_to_feed: true } : { image_url: m.publicUrl }),
        caption: input.text,
        location_id: (input.settings.locationId as string) || undefined,
      }, base);
      return publishContainer(igId, token, id, base);
    }

    // Carousel (2-10 öğe)
    const children: string[] = [];
    for (const m of media.slice(0, 10)) {
      const cid = await createContainer(igId, token, mediaParams(m, { is_carousel_item: true }), base);
      if (m.kind === "video") await waitForContainer(`${base ?? GRAPH()}/${cid}`, token);
      children.push(cid);
    }
    const parent = await createContainer(igId, token, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption: input.text,
      location_id: (input.settings.locationId as string) || undefined,
    }, base);
    return publishContainer(igId, token, parent, base);
  },

  async sendMessage({ channel, participantId, text }) {
    if (channel.metadata.igLogin) {
      const r = await graph<{ message_id?: string }>(`/${channel.externalId}/messages`, channel.accessToken, {
        method: "POST",
        params: { recipient: { id: participantId }, message: { text } },
        base: IG_GRAPH(),
      });
      return { externalId: r.message_id ?? null };
    }
    const pageId = (channel.metadata.pageId as string) || channel.externalId;
    const id = await sendPageMessage(pageId, channel.accessToken, participantId, text);
    return { externalId: id };
  },

  async sendPrivateReply(channel, commentId, message) {
    if (channel.metadata.igLogin) return { externalId: await sendCommentPrivateReply(channel.externalId, channel.accessToken, commentId, message, IG_GRAPH()) };
    const pageId = (channel.metadata.pageId as string) || channel.externalId;
    return { externalId: await sendCommentPrivateReply(pageId, channel.accessToken, commentId, message) };
  },

  async fetchMetrics(channel: Channel) {
    const token = channel.accessToken;
    const base = channelBase(channel);
    const basic = await graph<{ followers_count?: number; media_count?: number }>(`/${channel.externalId}`, token, {
      params: { fields: "followers_count,media_count" },
      base,
    });
    const metrics: Record<string, number> = {
      followers: Number(basic.followers_count ?? 0),
      posts: Number(basic.media_count ?? 0),
    };
    try {
      const ins = await graph<{ data?: Array<{ name: string; total_value?: { value: number }; values?: Array<{ value: number }> }> }>(
        `/${channel.externalId}/insights`,
        token,
        { params: { metric: "reach,accounts_engaged", period: "day", metric_type: "total_value" }, base },
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
    const r = await graph<{ id: string }>(edge, channel.accessToken, { method: "POST", params: { message: text }, base: channelBase(channel) });
    return { externalId: r.id };
  },

  async fetchPostMetrics(channel: Channel, externalId: string) {
    const base = await graph<{ like_count?: number; comments_count?: number; media_product_type?: string }>(`/${externalId}`, channel.accessToken, {
      params: { fields: "like_count,comments_count,media_product_type" },
      base: channelBase(channel),
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
    const rows = await fetchInsights(`/${externalId}/insights`, channel.accessToken, metrics, {}, channelBase(channel));
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
    const rows = await fetchInsights(`/${channel.externalId}/insights`, channel.accessToken, Object.keys(names), { period: "day", metric_type: "total_value", since: range.since, until: range.until }, channelBase(channel));
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
    }, channelBase(channel));
    const split = insightBreakdown(fu.get("follows_and_unfollows"));
    if (split.FOLLOWER !== undefined) out.follows = split.FOLLOWER;
    if (split.NON_FOLLOWER !== undefined) out.unfollows = split.NON_FOLLOWER;
    return out;
  },

  async fetchAudience(channel: Channel) {
    // follower_demographics en az 100 takipçide döner; her kırılım ayrı istek ister
    const out: AudienceBreakdown = {};
    for (const bd of ["country", "city", "age", "gender"] as const) {
      const rows = await fetchInsights(`/${channel.externalId}/insights`, channel.accessToken, ["follower_demographics"], { period: "lifetime", metric_type: "total_value", breakdown: bd }, channelBase(channel));
      const rec = insightBreakdown(rows.get("follower_demographics"));
      if (Object.keys(rec).length) out[bd] = rec;
    }
    return out;
  },

  /** Instagram Login jetonu 60 gün geçerlidir; süresi dolmadan yenilenir */
  async refreshToken(channel: Channel) {
    if (!channel.metadata.igLogin) return null;
    const r = await http<{ access_token: string; expires_in?: number }>("https://graph.instagram.com/refresh_access_token", {
      query: { grant_type: "ig_refresh_token", access_token: channel.accessToken },
    });
    return { accessToken: r.access_token, tokenExpiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null };
  },

  async healthCheck(channel: Channel) {
    try {
      await graph(`/${channel.externalId}`, channel.accessToken, { params: { fields: "id,username" }, base: channelBase(channel) });
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
export async function businessDiscovery(igUserId: string, token: string, username: string, base?: string): Promise<DiscoveredAccount> {
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
  }>(`/${igUserId}`, token, { params: { fields }, base });
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
export async function instagramRecentMedia(igUserId: string, token: string, limit = 30, base?: string): Promise<FeedItem[]> {
  const r = await graph<{ data?: Array<{ id: string; caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number }> }>(
    `/${igUserId}/media`,
    token,
    { params: { fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count", limit }, base },
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

/* ---------------- Instagram Login (Facebook Sayfası gerektirmez) ---------------- */

/** "Instagram API with Instagram Login" izinleri */
export const IG_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
  "instagram_business_manage_insights",
];

/** Instagram ile giriş hesabı için abone olunan webhook alanları */
export const IG_WEBHOOK_FIELDS = "messages,messaging_postbacks,message_reactions,comments,live_comments";

const log = createLogger("instagram");

export const instagramLoginFlow = {
  label: "Instagram",
  isConfigured: () => Boolean(config.instagram.appId && config.instagram.appSecret),

  oauthStart(redirectUri: string, state: string): OAuthStart {
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.searchParams.set("client_id", config.instagram.appId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", IG_LOGIN_SCOPES.join(","));
    u.searchParams.set("enable_fb_login", "0");
    return { url: u.toString() };
  },

  async oauthCallback(code: string, redirectUri: string): Promise<ConnectedAccount[]> {
    const short = await http<{ access_token?: string; user_id?: number | string; data?: Array<{ access_token: string; user_id: number | string }> }>("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      form: { client_id: config.instagram.appId, client_secret: config.instagram.appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code },
    });
    const shortToken = short.access_token ?? short.data?.[0]?.access_token;
    if (!shortToken) throw new ProviderError("Instagram jeton vermedi");
    const long = await http<{ access_token: string; expires_in?: number }>("https://graph.instagram.com/access_token", {
      query: { grant_type: "ig_exchange_token", client_secret: config.instagram.appSecret, access_token: shortToken },
    });
    const token = long.access_token;
    const me = await graph<{ id?: string; user_id?: string; username?: string; name?: string; profile_picture_url?: string; account_type?: string }>("/me", token, {
      params: { fields: "user_id,username,name,profile_picture_url,account_type" },
      base: IG_GRAPH(),
    });
    const igId = String(me.user_id ?? short.user_id ?? me.id ?? "");
    if (!igId) throw new ProviderError("Instagram hesap kimliği alınamadı");
    if (me.account_type && !/BUSINESS|CREATOR|MEDIA_CREATOR/i.test(me.account_type)) {
      throw new ProviderError("Bu hesap Profesyonel (İşletme veya İçerik Üreticisi) değil. Instagram uygulamasında Ayarlar > Hesap türü bölümünden profesyonel hesaba geç ve tekrar dene.");
    }
    // Gelen kutusu için webhook aboneliği (en iyi çaba: uygulama modu/izin yüzünden başarısız olabilir).
    // Hata bağlantıyı durdurmaz ama kanal bilgisine ve loga yazılır; abonelik sonradan Meta panelinden de yapılabilir.
    let webhookSubscribeError: string | null = null;
    try {
      await graph(`/${igId}/subscribed_apps`, token, { method: "POST", params: { subscribed_fields: IG_WEBHOOK_FIELDS }, base: IG_GRAPH() });
    } catch (e) {
      webhookSubscribeError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      log.warn("Instagram webhook aboneliği yapılamadı", { igId, error: webhookSubscribeError });
    }
    return [
      {
        provider: "instagram",
        externalId: igId,
        name: me.name ?? me.username ?? "Instagram",
        username: me.username ?? null,
        avatarUrl: me.profile_picture_url ?? null,
        accessToken: token,
        tokenExpiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
        scopes: IG_LOGIN_SCOPES.join(","),
        metadata: { igLogin: true, igUserId: igId, accountType: me.account_type ?? null, webhookSubscribeError },
      },
    ];
  },
};
