import { config } from "../../core/config.js";
import type { Channel } from "../../core/types.js";
import { expiresIn, http, sleep } from "../http.js";
import { ProviderError, type AudienceBreakdown, type Provider, type PublishInput, type PublishMedia, type PublishResult } from "../types.js";
import { fetchInsights, graph, insightBreakdown, insightNumber, waitForContainer } from "./common.js";

const TH = "https://graph.threads.net/v1.0";
const SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_insights", "threads_manage_replies", "threads_read_replies"];
/** Threads hesap insights'ı bu tarihten (2024-04-13) önceki günler için veri döndürmez */
const THREADS_INSIGHTS_SINCE = 1712991600;

async function container(userId: string, token: string, params: Record<string, unknown>): Promise<string> {
  const r = await graph<{ id: string }>(`${TH}/${userId}/threads`, token, { method: "POST", params });
  return r.id;
}

async function publishOne(userId: string, token: string, creationId: string): Promise<PublishResult> {
  await waitForContainer(`${TH}/${creationId}`, token, { timeoutMs: 5 * 60_000 });
  const r = await graph<{ id: string }>(`${TH}/${userId}/threads_publish`, token, { method: "POST", params: { creation_id: creationId } });
  let url: string | null = null;
  try {
    const info = await graph<{ permalink?: string }>(`${TH}/${r.id}`, token, { params: { fields: "permalink" } });
    url = info.permalink ?? null;
  } catch {
    /* opsiyonel */
  }
  return { externalId: r.id, url };
}

function mediaParams(m: PublishMedia): Record<string, unknown> {
  return m.kind === "video" ? { media_type: "VIDEO", video_url: m.publicUrl } : { media_type: "IMAGE", image_url: m.publicUrl };
}

/** "---" satırıyla ayrılmış metni zincir parçalarına böler */
export function splitThread(text: string, maxLen: number): string[] {
  const parts = text
    .split(/\n\s*---\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1) return parts;
  if (text.length <= maxLen) return [text];
  // Uzun metni cümle sınırlarından böl
  const out: string[] = [];
  let cur = "";
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if ((cur + " " + sentence).trim().length > maxLen && cur) {
      out.push(cur.trim());
      cur = sentence;
    } else cur = (cur + " " + sentence).trim();
  }
  if (cur) out.push(cur.trim());
  return out;
}

export const threadsProvider: Provider = {
  id: "threads",
  label: "Threads",
  color: "#000000",
  connectMode: "oauth",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: true,
    thread: true,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 500,
    comments: true,
    maxMedia: 20,
    mediaNote: "En fazla 500 karakter. Görsel/video herkese açık URL ile çekilir. Zincir için parçaları --- ile ayır.",
  },
  settingFields: [
    {
      key: "replyControl",
      label: "Kimler yanıtlayabilir",
      type: "select",
      options: [
        { value: "everyone", label: "Herkes" },
        { value: "accounts_you_follow", label: "Takip ettiklerim" },
        { value: "mentioned_only", label: "Sadece etiketlenenler" },
      ],
      default: "everyone",
    },
  ],
  isConfigured: () => Boolean(config.threads.appId && config.threads.appSecret),

  oauthStart(redirectUri, state) {
    const u = new URL("https://www.threads.com/oauth/authorize");
    u.searchParams.set("client_id", config.threads.appId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("scope", SCOPES.join(","));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", state);
    return { url: u.toString() };
  },

  async oauthCallback(code, redirectUri) {
    const short = await http<{ access_token: string; user_id: string }>("https://graph.threads.net/oauth/access_token", {
      form: { client_id: config.threads.appId, client_secret: config.threads.appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code },
    });
    const long = await http<{ access_token: string; expires_in?: number }>("https://graph.threads.net/access_token", {
      query: { grant_type: "th_exchange_token", client_secret: config.threads.appSecret, access_token: short.access_token },
    });
    const me = await graph<{ id: string; username?: string; name?: string; threads_profile_picture_url?: string }>(`${TH}/me`, long.access_token, {
      params: { fields: "id,username,name,threads_profile_picture_url" },
    });
    return [
      {
        externalId: me.id,
        name: me.name ?? me.username ?? "Threads",
        username: me.username ?? null,
        avatarUrl: me.threads_profile_picture_url ?? null,
        accessToken: long.access_token,
        tokenExpiresAt: expiresIn(long.expires_in ?? 60 * 86400),
        scopes: SCOPES.join(","),
      },
    ];
  },

  async refreshToken(channel) {
    const r = await http<{ access_token: string; expires_in?: number }>("https://graph.threads.net/refresh_access_token", {
      query: { grant_type: "th_refresh_token", access_token: channel.accessToken },
    });
    return { accessToken: r.access_token, tokenExpiresAt: expiresIn(r.expires_in ?? 60 * 86400) };
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const userId = channel.externalId;
    const token = channel.accessToken;
    const replyControl = (input.settings.replyControl as string) || undefined;
    const parts = input.kind === "thread" ? splitThread(input.text, 500) : [input.text];
    let first: PublishResult | null = null;
    let replyTo: string | null = null;
    for (let i = 0; i < parts.length; i++) {
      const text = parts[i];
      const media = i === 0 ? input.media : [];
      let cid: string;
      if (media.length === 0) {
        cid = await container(userId, token, { media_type: "TEXT", text, reply_control: replyControl, reply_to_id: replyTo ?? undefined });
      } else if (media.length === 1) {
        cid = await container(userId, token, { ...mediaParams(media[0]), text, reply_control: replyControl, reply_to_id: replyTo ?? undefined });
      } else {
        const children: string[] = [];
        for (const m of media.slice(0, 20)) {
          const child = await container(userId, token, { ...mediaParams(m), is_carousel_item: true });
          await waitForContainer(`${TH}/${child}`, token);
          children.push(child);
        }
        cid = await container(userId, token, { media_type: "CAROUSEL", children: children.join(","), text, reply_control: replyControl, reply_to_id: replyTo ?? undefined });
      }
      const res = await publishOne(userId, token, cid);
      if (!first) first = res;
      replyTo = res.externalId;
      if (i < parts.length - 1) await sleep(1500);
    }
    if (!first) throw new ProviderError("Boş içerik");
    return first;
  },

  async fetchMetrics(channel: Channel) {
    const r = await graph<{ data?: Array<{ name: string; total_value?: { value: number }; values?: Array<{ value: number }> }> }>(
      `${TH}/${channel.externalId}/threads_insights`,
      channel.accessToken,
      { params: { metric: "views,likes,replies,followers_count" } },
    );
    const metrics: Record<string, number> = {};
    for (const d of r.data ?? []) {
      const v = d.total_value?.value ?? d.values?.[d.values.length - 1]?.value;
      if (typeof v === "number") metrics[d.name === "followers_count" ? "followers" : d.name] = v;
    }
    return metrics;
  },

  /**
   * Hesap düzeyi günlük değerler (threads_manage_insights): görüntülenme ve bağlantı tıklaması.
   * Beğeni/yanıt/yeniden paylaşım gönderi metriklerinden gelir; takipçi dengesi saatlik anlık görüntülerden.
   */
  async fetchDailyInsights(channel: Channel, range: { since: number; until: number }) {
    if (range.until <= THREADS_INSIGHTS_SINCE) return {};
    const rows = await fetchInsights(`${TH}/${channel.externalId}/threads_insights`, channel.accessToken, ["views", "clicks"], {
      since: Math.max(range.since, THREADS_INSIGHTS_SINCE),
      until: range.until,
    });
    const out: Record<string, number> = {};
    const views = insightNumber(rows.get("views"));
    if (views !== null) out.views = views;
    // clicks yalnızca bağlantı kırılımıyla dönebilir: kırılımlar toplanır
    const clicksRow = rows.get("clicks");
    const clicks = insightNumber(clicksRow) ?? (clicksRow ? Object.values(insightBreakdown(clicksRow)).reduce((a, b) => a + b, 0) : null);
    if (clicks !== null) out.clicks = clicks;
    return out;
  },

  /** Takipçi kitlesi (en az 100 takipçide döner); her kırılım ayrı istek */
  async fetchAudience(channel: Channel) {
    const out: AudienceBreakdown = {};
    for (const bd of ["country", "city", "age", "gender"] as const) {
      const rows = await fetchInsights(`${TH}/${channel.externalId}/threads_insights`, channel.accessToken, ["follower_demographics"], { breakdown: bd });
      const rec = insightBreakdown(rows.get("follower_demographics"));
      if (Object.keys(rec).length) out[bd] = rec;
    }
    return out;
  },

  async publishComment(channel: Channel, parentExternalId: string, text: string, replyToExternalId?: string | null) {
    const cid = await container(channel.externalId, channel.accessToken, { media_type: "TEXT", text, reply_to_id: replyToExternalId ?? parentExternalId });
    const r = await publishOne(channel.externalId, channel.accessToken, cid);
    return { externalId: r.externalId };
  },

  async fetchPostMetrics(channel: Channel, externalId: string) {
    const r = await graph<{ data?: Array<{ name: string; values?: Array<{ value: number }>; total_value?: { value: number } }> }>(
      `${TH}/${externalId}/insights`,
      channel.accessToken,
      { params: { metric: "views,likes,replies,reposts,quotes" } },
    );
    const m: Record<string, number> = {};
    for (const d of r.data ?? []) {
      const v = d.total_value?.value ?? d.values?.[0]?.value;
      if (typeof v === "number") m[d.name === "replies" ? "comments" : d.name] = v;
    }
    return m;
  },

  async healthCheck(channel: Channel) {
    try {
      await graph(`${TH}/me`, channel.accessToken, { params: { fields: "id" } });
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};
