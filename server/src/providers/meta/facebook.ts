import { config } from "../../core/config.js";
import type { Channel } from "../../core/types.js";
import { http } from "../http.js";
import { ProviderError, type AudienceBreakdown, type Provider, type PublishInput, type PublishResult } from "../types.js";
import { fetchInsights, GRAPH, graph, insightNumber, metaOAuthCallback, metaOAuthStart, sendPageMessage } from "./common.js";

async function uploadUnpublishedPhoto(pageId: string, token: string, url: string): Promise<string> {
  const r = await graph<{ id: string }>(`/${pageId}/photos`, token, { method: "POST", params: { url, published: false } });
  return r.id;
}

/** video_stories / video_reels için ortak akış: start -> upload (file_url) -> finish */
async function hostedVideoFlow(
  pageId: string,
  token: string,
  edge: "video_stories" | "video_reels",
  fileUrl: string,
  finishParams: Record<string, unknown>,
): Promise<{ id: string; postId?: string }> {
  const start = await graph<{ video_id: string; upload_url: string }>(`/${pageId}/${edge}`, token, {
    method: "POST",
    params: { upload_phase: "start" },
  });
  await http(start.upload_url, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_url: fileUrl },
    body: "",
  });
  const fin = await graph<{ success?: boolean; post_id?: string }>(`/${pageId}/${edge}`, token, {
    method: "POST",
    params: { upload_phase: "finish", video_id: start.video_id, ...finishParams },
  });
  if (fin.success === false) throw new ProviderError(`${edge} yayınlanamadı`);
  return { id: start.video_id, postId: fin.post_id };
}

export const facebookProvider: Provider = {
  id: "facebook",
  label: "Facebook Sayfası",
  color: "#1877F2",
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
    maxTextLength: 63206,
    comments: true,
    maxMedia: 10,
    mediaNote: "Görsel: JPG/PNG. Video: MP4 (reels 9:16). Hikaye: 1 görsel veya 1 video.",
  },
  settingFields: [
    { key: "link", label: "Bağlantı (isteğe bağlı)", type: "text", appliesTo: ["post"], help: "Metinle birlikte paylaşılacak URL" },
  ],
  isConfigured: () => Boolean(config.meta.appId && config.meta.appSecret),
  oauthStart: metaOAuthStart,
  oauthCallback: (code, redirectUri) => metaOAuthCallback(code, redirectUri),

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const pageId = channel.externalId;
    const token = channel.accessToken;
    const images = input.media.filter((m) => m.kind === "image");
    const videos = input.media.filter((m) => m.kind === "video");

    if (input.kind === "story") {
      if (videos[0]) {
        const r = await hostedVideoFlow(pageId, token, "video_stories", videos[0].publicUrl, {});
        return { externalId: r.postId ?? r.id, url: `https://www.facebook.com/${pageId}` };
      }
      if (images[0]) {
        const photoId = await uploadUnpublishedPhoto(pageId, token, images[0].publicUrl);
        const r = await graph<{ success?: boolean; post_id?: string }>(`/${pageId}/photo_stories`, token, {
          method: "POST",
          params: { photo_id: photoId },
        });
        return { externalId: r.post_id ?? photoId, url: `https://www.facebook.com/${pageId}` };
      }
      throw new ProviderError("Hikaye için bir görsel ya da video gerekli");
    }

    if (input.kind === "reel" || (input.kind === "video" && videos[0])) {
      if (!videos[0]) throw new ProviderError("Reel için bir video gerekli");
      if (input.kind === "reel") {
        const r = await hostedVideoFlow(pageId, token, "video_reels", videos[0].publicUrl, {
          video_state: "PUBLISHED",
          description: input.text,
        });
        return { externalId: r.postId ?? r.id, url: `https://www.facebook.com/reel/${r.id}` };
      }
      const r = await graph<{ id: string }>(`/${pageId}/videos`, token, {
        method: "POST",
        params: { file_url: videos[0].publicUrl, description: input.text, title: (input.settings.title as string) || undefined },
      });
      return { externalId: r.id, url: `https://www.facebook.com/${pageId}/videos/${r.id}` };
    }

    // Normal gönderi
    if (images.length === 1 && videos.length === 0) {
      const r = await graph<{ id: string; post_id?: string }>(`/${pageId}/photos`, token, {
        method: "POST",
        params: { url: images[0].publicUrl, message: input.text },
      });
      const postId = r.post_id ?? r.id;
      return { externalId: postId, url: `https://www.facebook.com/${postId}` };
    }
    if (images.length > 1) {
      const ids: string[] = [];
      for (const img of images) ids.push(await uploadUnpublishedPhoto(pageId, token, img.publicUrl));
      const r = await graph<{ id: string }>(`/${pageId}/feed`, token, {
        method: "POST",
        params: { message: input.text, attached_media: ids.map((id) => ({ media_fbid: id })) },
      });
      return { externalId: r.id, url: `https://www.facebook.com/${r.id}` };
    }
    if (videos[0]) {
      const r = await graph<{ id: string }>(`/${pageId}/videos`, token, {
        method: "POST",
        params: { file_url: videos[0].publicUrl, description: input.text },
      });
      return { externalId: r.id, url: `https://www.facebook.com/${pageId}/videos/${r.id}` };
    }
    const r = await graph<{ id: string }>(`/${pageId}/feed`, token, {
      method: "POST",
      params: { message: input.text, link: (input.settings.link as string) || undefined },
    });
    return { externalId: r.id, url: `https://www.facebook.com/${r.id}` };
  },

  async sendMessage({ channel, participantId, text }) {
    const id = await sendPageMessage(channel.externalId, channel.accessToken, participantId, text);
    return { externalId: id };
  },

  async fetchMetrics(channel: Channel) {
    const token = channel.accessToken;
    const basic = await graph<{ followers_count?: number; fan_count?: number }>(`/${channel.externalId}`, token, {
      params: { fields: "followers_count,fan_count" },
    });
    const metrics: Record<string, number> = {
      followers: Number(basic.followers_count ?? basic.fan_count ?? 0),
      likes: Number(basic.fan_count ?? 0),
    };
    try {
      const ins = await graph<{ data?: Array<{ name: string; values?: Array<{ value: number }> }> }>(
        `/${channel.externalId}/insights`,
        token,
        { params: { metric: "page_impressions_unique,page_post_engagements", period: "day" } },
      );
      for (const d of ins.data ?? []) {
        const last = d.values?.[d.values.length - 1]?.value;
        if (typeof last === "number") metrics[d.name === "page_impressions_unique" ? "reach" : "engagement"] = last;
      }
    } catch {
      /* insights izni yoksa temel metriklerle yetin */
    }
    return metrics;
  },

  async publishComment(channel: Channel, parentExternalId: string, text: string, replyToExternalId?: string | null) {
    const r = await graph<{ id: string }>(`/${replyToExternalId ?? parentExternalId}/comments`, channel.accessToken, { method: "POST", params: { message: text } });
    return { externalId: r.id };
  },

  async fetchPostMetrics(channel: Channel, externalId: string) {
    const r = await graph<{ reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } }>(
      `/${externalId}`,
      channel.accessToken,
      { params: { fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares" } },
    );
    const m: Record<string, number> = {
      likes: Number(r.reactions?.summary?.total_count ?? 0),
      comments: Number(r.comments?.summary?.total_count ?? 0),
      shares: Number(r.shares?.count ?? 0),
    };
    // Gönderi insights (read_insights): erişim, tıklama, video görüntülenme; izin yoksa temel metrikler kalır
    const rows = await fetchInsights(`/${externalId}/insights`, channel.accessToken, ["post_impressions_unique", "post_clicks", "post_video_views"], {});
    const names: Record<string, string> = { post_impressions_unique: "reach", post_clicks: "clicks", post_video_views: "views" };
    for (const [name, row] of rows) {
      const v = insightNumber(row);
      if (v !== null && names[name]) m[names[name]] = v;
    }
    return m;
  },

  async fetchDailyInsights(channel: Channel, range: { since: number; until: number }) {
    const out: Record<string, number> = {};
    // Meta sayfa metriklerini zaman zaman yeniden adlandırıyor: yeni ad önce, eski ad yedek
    const names: Record<string, string> = {
      page_impressions_unique: "reach",
      page_media_view: "views",
      page_views_total: "profileViews",
      page_daily_follows_unique: "follows",
      page_daily_unfollows_unique: "unfollows",
      page_post_engagements: "engaged",
    };
    const rows = await fetchInsights(`/${channel.externalId}/insights`, channel.accessToken, Object.keys(names), { period: "day", since: range.since, until: range.until });
    for (const [name, row] of rows) {
      const v = insightNumber(row);
      if (v !== null && names[name] && out[names[name]] === undefined) out[names[name]] = v;
    }
    return out;
  },

  async fetchAudience(channel: Channel) {
    const out: AudienceBreakdown = {};
    const rows = await fetchInsights(`/${channel.externalId}/insights`, channel.accessToken, ["page_fans_country", "page_fans_city"], { period: "lifetime" });
    for (const [name, key] of [
      ["page_fans_country", "country"],
      ["page_fans_city", "city"],
    ] as const) {
      const vals = rows.get(name)?.values ?? [];
      const last = vals[vals.length - 1]?.value;
      if (last && typeof last === "object" && Object.keys(last).length) out[key] = last;
    }
    return out;
  },

  async healthCheck(channel: Channel) {
    try {
      await graph(`/${channel.externalId}`, channel.accessToken, { params: { fields: "id,name" } });
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};

export { GRAPH };

/* ---------------- Rakip takibi: herkese açık Sayfa verisi ---------------- */

export interface PublicPage {
  id: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  about: string | null;
  followers: number | null;
  posts: Array<{ id: string; caption: string; likes: number | null; comments: number | null; shares: number | null; timestamp: string; type: string; permalink: string | null }>;
}

/**
 * Başka bir Facebook Sayfasının herkese açık bilgileri ve son gönderileri (bağlı Sayfanın jetonuyla).
 * Meta "Page Public Metadata Access" (profil) ve "Page Public Content Access" (gönderiler) özelliklerini ister;
 * gönderiler okunamazsa yalnızca takipçi bilgisi döner.
 */
export async function facebookPagePublic(token: string, ref: string): Promise<PublicPage> {
  const p = await graph<{ id: string; username?: string; name?: string; about?: string; fan_count?: number; followers_count?: number; picture?: { data?: { url?: string } } }>(`/${encodeURIComponent(ref)}`, token, {
    params: { fields: "id,username,name,about,fan_count,followers_count,picture.type(large)" },
  });
  if (!p?.id) throw new ProviderError("Sayfa bulunamadı", 404);
  let posts: PublicPage["posts"] = [];
  try {
    const r = await graph<{
      data?: Array<{ id: string; message?: string; created_time?: string; permalink_url?: string; status_type?: string; shares?: { count?: number }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }>;
    }>(`/${p.id}/posts`, token, {
      params: { fields: "id,message,created_time,permalink_url,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)", limit: 25 },
    });
    posts = (r.data ?? []).map((x) => ({
      id: x.id,
      caption: x.message ?? "",
      likes: x.reactions?.summary?.total_count ?? null,
      comments: x.comments?.summary?.total_count ?? null,
      shares: x.shares?.count ?? 0,
      timestamp: x.created_time ?? "",
      type: x.status_type ?? "POST",
      permalink: x.permalink_url ?? null,
    }));
  } catch {
    /* Page Public Content Access yoksa gönderiler okunamaz */
  }
  return { id: p.id, username: (p.username ?? p.id).toLowerCase(), name: p.name ?? null, avatarUrl: p.picture?.data?.url ?? null, about: p.about ?? null, followers: p.followers_count ?? p.fan_count ?? null, posts };
}
