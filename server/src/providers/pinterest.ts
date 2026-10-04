import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

export const pinterestProvider: Provider = {
  id: "pinterest",
  label: "Pinterest",
  color: "#E60023",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: true,
    thread: false,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 500,
    maxMedia: 5,
    requiresMedia: true,
    mediaNote: "Pinterest panoları için en az bir görsel veya video zorunludur. Pano (Board) ID belirtilmelidir.",
  },
  settingFields: [
    { key: "boardId", label: "Pano ID (Board ID)", type: "text" },
    { key: "link", label: "Hedef Web Sitesi Linki", type: "text" },
    { key: "title", label: "Pin Başlığı", type: "text" },
  ],
  connectFields: [
    { key: "accessToken", label: "Pinterest Access Token", type: "text", help: "Pinterest Developers portalından alınan token" },
    { key: "defaultBoardId", label: "Varsayılan Pano ID (Board ID)", type: "text", help: "Pin'lerin ekleneceği varsayılan pano ID'si" },
    { key: "displayName", label: "Hesap Adı", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const token = values.accessToken?.trim();
    if (!token) throw new ProviderError("Pinterest Access Token zorunlu");
    return [
      {
        externalId: `pin_${Date.now()}`,
        name: values.displayName?.trim() || "Pinterest",
        username: values.displayName?.trim() || null,
        accessToken: token,
        tokenExpiresAt: null,
        metadata: { defaultBoardId: values.defaultBoardId?.trim() || null },
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const boardId = (input.settings.boardId as string) || (channel.metadata.defaultBoardId as string);
    if (!boardId) {
      throw new ProviderError("Pinterest için Pano ID (Board ID) zorunludur");
    }

    const mediaUrl = input.media[0]?.publicUrl;
    if (!mediaUrl) {
      throw new ProviderError("Pinterest için en az bir görsel URL zorunludur");
    }

    const title = (input.settings.title as string) || input.text.split("\n")[0].slice(0, 100);
    const link = (input.settings.link as string) || undefined;

    try {
      const res = await http<{ id?: string }>("https://api.pinterest.com/v5/pins", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        json: {
          board_id: boardId,
          title: title,
          description: input.text.slice(0, 500),
          link: link,
          media_source: {
            source_type: "image_url",
            url: mediaUrl,
          },
        },
      });

      const pinId = res.id || `pin_${Date.now()}`;
      return { externalId: pinId, url: `https://www.pinterest.com/pin/${pinId}/` };
    } catch (e: any) {
      throw new ProviderError(e.message || "Pinterest yayını başarısız");
    }
  },

  /** Takipçi ve pin sayısı (user_accounts:read) */
  async fetchMetrics(channel: Channel): Promise<Record<string, number>> {
    if (channel.accessToken.startsWith("mock")) return {};
    const a = await http<{ follower_count?: number; following_count?: number; pin_count?: number; monthly_views?: number }>("https://api.pinterest.com/v5/user_account", {
      headers: { Authorization: `Bearer ${channel.accessToken}` },
      retries: 1,
    });
    const out: Record<string, number> = {};
    if (typeof a.follower_count === "number") out.followers = a.follower_count;
    if (typeof a.following_count === "number") out.following = a.following_count;
    if (typeof a.pin_count === "number") out.posts = a.pin_count;
    if (typeof a.monthly_views === "number") out.monthlyViews = a.monthly_views;
    return out;
  },

  /** Hesap analitiği: gösterim, kaydetme, pin tıklaması, dış bağlantı tıklaması, etkileşim (tamamlanmış gün) */
  async fetchDailyInsights(channel: Channel, range: { since: number; until: number }): Promise<Record<string, number>> {
    if (channel.accessToken.startsWith("mock")) return {};
    const day = new Date(((range.since + range.until) / 2) * 1000).toISOString().slice(0, 10);
    const r = await http<{ all?: { daily_metrics?: Array<{ date?: string; data_status?: string; metrics?: Record<string, number> }> } }>("https://api.pinterest.com/v5/user_account/analytics", {
      headers: { Authorization: `Bearer ${channel.accessToken}` },
      query: { start_date: day, end_date: day, metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK,ENGAGEMENT" },
      retries: 1,
    });
    const row = (r.all?.daily_metrics ?? []).find((d) => d.date === day && (d.data_status ?? "READY") === "READY");
    if (!row?.metrics) return {};
    const m = row.metrics;
    const out: Record<string, number> = {};
    const put = (k: string, v: unknown) => {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    };
    put("views", m.IMPRESSION);
    put("saves", m.SAVE);
    put("clicks", m.PIN_CLICK);
    put("websiteClicks", m.OUTBOUND_CLICK);
    put("engaged", m.ENGAGEMENT);
    return out;
  },

  /** Pin metrikleri (son 90 gün): gösterim, kaydetme, pin ve bağlantı tıklaması */
  async fetchPostMetrics(channel: Channel, externalId: string): Promise<Record<string, number>> {
    if (channel.accessToken.startsWith("mock") || externalId.startsWith("mock") || externalId.startsWith("pin_")) return {};
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
    const r = await http<{ all?: { summary_metrics?: Record<string, number>; lifetime_metrics?: Record<string, number> } }>(
      `https://api.pinterest.com/v5/pins/${encodeURIComponent(externalId)}/analytics`,
      { headers: { Authorization: `Bearer ${channel.accessToken}` }, query: { start_date: start, end_date: end, metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK" }, retries: 0 },
    );
    const m = r.all?.summary_metrics ?? r.all?.lifetime_metrics ?? {};
    const out: Record<string, number> = {};
    if (typeof m.IMPRESSION === "number") out.views = m.IMPRESSION;
    if (typeof m.SAVE === "number") out.saves = m.SAVE;
    if (typeof m.PIN_CLICK === "number") out.clicks = m.PIN_CLICK;
    if (typeof m.OUTBOUND_CLICK === "number") out.linkClicks = m.OUTBOUND_CLICK;
    return out;
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
