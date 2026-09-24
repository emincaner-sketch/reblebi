import { config } from "../../core/config.js";
import type { Channel } from "../../core/types.js";
import { http } from "../http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "../types.js";
import { GRAPH, graph, metaOAuthCallback, metaOAuthStart, sendPageMessage } from "./common.js";

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
    return {
      likes: Number(r.reactions?.summary?.total_count ?? 0),
      comments: Number(r.comments?.summary?.total_count ?? 0),
      shares: Number(r.shares?.count ?? 0),
    };
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
