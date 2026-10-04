import { config } from "../core/config.js";
import type { Channel } from "../core/types.js";
import { expiresIn, http } from "./http.js";
import { ProviderError, type ConnectedAccount, type InboundEvent, type Provider, type PublishInput, type PublishResult } from "./types.js";

const GMB_SCOPE = "https://www.googleapis.com/auth/business.manage";
const GMB_IMPRESSIONS = ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"];
const GMB_POLL_MS = 30 * 60_000;
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** v4 konum yolu (accounts/…/locations/…); elle girilmiş eksik kimlikte null */
function gmbPath(channel: Channel): string | null {
  const p = (channel.metadata.locationId as string) || channel.externalId;
  return /^accounts\/[^/]+\/locations\/[^/]+$/.test(p) && !channel.accessToken.startsWith("mock") ? p : null;
}

function parseCursor(c: string | null): { at: number; since: string | null } {
  try {
    const j = c ? (JSON.parse(c) as { at?: number; since?: string }) : {};
    return { at: Number(j.at ?? 0), since: j.since ?? null };
  } catch {
    return { at: 0, since: null };
  }
}

export const gmbProvider: Provider = {
  id: "gmb",
  label: "Google Business",
  color: "#4285F4",
  /** Google istemcisi tanımlıysa OAuth (jeton yenilenir); değilse eski form ile elle jeton */
  get connectMode() {
    return config.google.clientId && config.google.clientSecret ? ("oauth" as const) : ("form" as const);
  },
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: false,
    thread: false,
    dm: false,
    inbound: "poll",
    analytics: true,
    maxTextLength: 1500,
    maxMedia: 1,
    mediaNote: "Google Haritalar ve Arama işletme profilinde güncelleme gönderisi: metin, buton ve görsel.",
  },
  settingFields: [
    {
      key: "actionType",
      label: "Harekete Geçirici Buton",
      type: "select",
      options: [
        { value: "NONE", label: "Butonsuz" },
        { value: "LEARN_MORE", label: "Daha Fazla Bilgi" },
        { value: "BOOK", label: "Rezervasyon Yap" },
        { value: "ORDER", label: "Sipariş Ver" },
        { value: "SHOP", label: "Satın Al" },
        { value: "SIGN_UP", label: "Kaydol" },
        { value: "CALL", label: "Şimdi Ara" },
      ],
      default: "LEARN_MORE",
    },
    { key: "actionUrl", label: "Buton Web Adresi (URL)", type: "text" },
  ],
  connectFields: [
    { key: "accessToken", label: "Google OAuth Access Token", type: "text", help: "Google Business Profile API erişim token'ı" },
    { key: "locationId", label: "İşletme Konum ID (accounts/.../locations/...)", type: "text", help: "Google İşletme Profili Konum Kimliği" },
    { key: "displayName", label: "İşletme Adı", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const token = values.accessToken?.trim();
    if (!token) throw new ProviderError("Google API Access Token zorunlu");
    const locId = values.locationId?.trim() || "locations/primary";
    return [
      {
        externalId: locId,
        name: values.displayName?.trim() || "Google İşletme Profili",
        username: values.displayName?.trim() || null,
        accessToken: token,
        tokenExpiresAt: null,
        metadata: { locationId: locId },
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const locId = (channel.metadata.locationId as string) || "locations/primary";
    const actionType = (input.settings.actionType as string) || "NONE";
    const actionUrl = input.settings.actionUrl as string | undefined;

    const postPayload: Record<string, any> = {
      languageCode: "tr",
      summary: input.text.slice(0, 1500),
      topicType: "STANDARD",
    };

    if (actionType !== "NONE" && actionUrl) {
      postPayload.callToAction = {
        actionType,
        url: actionUrl,
      };
    }

    if (input.media.length > 0 && input.media[0].publicUrl) {
      postPayload.media = [
        {
          mediaFormat: "PHOTO",
          sourceUrl: input.media[0].publicUrl,
        },
      ];
    }

    try {
      const res = await http<{ name?: string }>(`https://mybusiness.googleapis.com/v4/${locId}/localPosts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        json: postPayload,
      });

      const postId = res.name || `gmb_${Date.now()}`;
      return { externalId: postId, url: "https://business.google.com" };
    } catch (e: any) {
      throw new ProviderError(e.message || "Google İşletme yayını başarısız");
    }
  },

  /* ---------------- OAuth (Google istemcisi tanımlıysa): business.manage ---------------- */

  oauthStart(redirectUri, state) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", config.google.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", GMB_SCOPE);
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("include_granted_scopes", "true");
    u.searchParams.set("state", state);
    return { url: u.toString() };
  },

  /** Kod → jeton → hesaplar → konumlar; her konum ayrı bir kanal olur (v4 yolu: accounts/…/locations/…) */
  async oauthCallback(code, redirectUri) {
    const tok = await http<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>("https://oauth2.googleapis.com/token", {
      form: { code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" },
    });
    const auth = { Authorization: `Bearer ${tok.access_token}` };
    const accounts = await http<{ accounts?: Array<{ name: string; accountName?: string }> }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers: auth });
    const out: ConnectedAccount[] = [];
    for (const acc of accounts.accounts ?? []) {
      let pageToken: string | undefined;
      for (let i = 0; i < 10; i++) {
        const locs = await http<{ locations?: Array<{ name: string; title?: string }>; nextPageToken?: string }>(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations`,
          { headers: auth, query: { readMask: "name,title", pageSize: 100, pageToken } },
        );
        for (const l of locs.locations ?? []) {
          const path = `${acc.name}/${l.name}`; // accounts/1/locations/2
          out.push({
            externalId: path,
            name: l.title || path,
            username: null,
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token ?? null,
            tokenExpiresAt: expiresIn(tok.expires_in),
            scopes: tok.scope ?? GMB_SCOPE,
            metadata: { locationId: path, accountName: acc.accountName ?? null },
          });
        }
        pageToken = locs.nextPageToken;
        if (!pageToken) break;
      }
    }
    if (!out.length) throw new ProviderError("Bu Google hesabında yönetilen işletme konumu bulunamadı");
    return out;
  },

  async refreshToken(channel) {
    if (!channel.refreshToken || !config.google.clientId) return null;
    const tok = await http<{ access_token: string; expires_in?: number }>("https://oauth2.googleapis.com/token", {
      form: { client_id: config.google.clientId, client_secret: config.google.clientSecret, refresh_token: channel.refreshToken, grant_type: "refresh_token" },
    });
    return { accessToken: tok.access_token, tokenExpiresAt: expiresIn(tok.expires_in) };
  },

  /* ---------------- Analitik ---------------- */

  /** Değerlendirme özeti: toplam değerlendirme ve ortalama puan */
  async fetchMetrics(channel: Channel): Promise<Record<string, number>> {
    const loc = gmbPath(channel);
    if (!loc) return {};
    const r = await http<{ averageRating?: number; totalReviewCount?: number }>(`https://mybusiness.googleapis.com/v4/${loc}/reviews`, {
      headers: { Authorization: `Bearer ${channel.accessToken}` },
      query: { pageSize: 1 },
      retries: 1,
    });
    const out: Record<string, number> = {};
    if (typeof r.totalReviewCount === "number") out.reviews = r.totalReviewCount;
    if (typeof r.averageRating === "number") out.rating = Math.round(r.averageRating * 100) / 100;
    return out;
  },

  /** Performans (tamamlanmış gün): Haritalar + Arama görüntülenmesi, web sitesi tıklaması, arama, yol tarifi */
  async fetchDailyInsights(channel: Channel, range: { since: number; until: number }): Promise<Record<string, number>> {
    const loc = gmbPath(channel);
    if (!loc) return {};
    const locId = loc.split("/").slice(-2).join("/"); // locations/2
    const d = new Date(((range.since + range.until) / 2) * 1000);
    const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    const metrics = [...GMB_IMPRESSIONS, "WEBSITE_CLICKS", "CALL_CLICKS", "BUSINESS_DIRECTION_REQUESTS"];
    const qs = [
      ...metrics.map((x) => `dailyMetrics=${x}`),
      `dailyRange.start_date.year=${y}`,
      `dailyRange.start_date.month=${m}`,
      `dailyRange.start_date.day=${dd}`,
      `dailyRange.end_date.year=${y}`,
      `dailyRange.end_date.month=${m}`,
      `dailyRange.end_date.day=${dd}`,
    ].join("&");
    const r = await http<{
      multiDailyMetricTimeSeries?: Array<{ dailyMetricTimeSeries?: Array<{ dailyMetric: string; timeSeries?: { datedValues?: Array<{ value?: string }> } }> }>;
    }>(`https://businessprofileperformance.googleapis.com/v1/${locId}:fetchMultiDailyMetricsTimeSeries?${qs}`, { headers: { Authorization: `Bearer ${channel.accessToken}` }, retries: 1 });
    const sum: Record<string, number> = {};
    let any = false;
    for (const group of r.multiDailyMetricTimeSeries ?? [])
      for (const s of group.dailyMetricTimeSeries ?? []) {
        // Değeri olmayan gün 0 demektir (Google sıfırları boş bırakır); en az bir seri gelmişse gün hazırdır
        if (s.timeSeries?.datedValues?.length) any = true;
        const v = (s.timeSeries?.datedValues ?? []).reduce((a, x) => a + Number(x.value ?? 0), 0);
        sum[s.dailyMetric] = (sum[s.dailyMetric] ?? 0) + v;
      }
    if (!any) return {};
    return {
      views: GMB_IMPRESSIONS.reduce((a, k) => a + (sum[k] ?? 0), 0),
      websiteClicks: sum.WEBSITE_CLICKS ?? 0,
      calls: sum.CALL_CLICKS ?? 0,
      directions: sum.BUSINESS_DIRECTION_REQUESTS ?? 0,
    };
  },

  /* ---------------- Değerlendirmeler (gelen kutusu) ---------------- */

  /** 30 dakikada bir yeni / güncellenen değerlendirmeler (yoklama 15 sn'de bir çağırır; aradaki çağrılar boş döner) */
  async pollInbound(channel: Channel, cursor: string | null) {
    const loc = gmbPath(channel);
    const state = parseCursor(cursor);
    if (!loc || Date.now() - state.at < GMB_POLL_MS) return { events: [], cursor };
    const r = await http<{
      reviews?: Array<{ reviewId: string; name: string; reviewer?: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean }; starRating?: string; comment?: string; createTime?: string; updateTime?: string }>;
    }>(`https://mybusiness.googleapis.com/v4/${loc}/reviews`, { headers: { Authorization: `Bearer ${channel.accessToken}` }, query: { pageSize: 50, orderBy: "updateTime desc" }, retries: 1 });
    // İlk çalıştırmada yalnızca son 7 gün (eski değerlendirmeler gelen kutusunu doldurmasın)
    const since = state.since ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
    const fresh = (r.reviews ?? []).filter((x) => (x.updateTime ?? x.createTime ?? "") > since);
    const events: InboundEvent[] = fresh.map((x) => {
      const stars = STARS[x.starRating ?? ""] ?? 0;
      const who = x.reviewer?.isAnonymous ? "Anonim" : x.reviewer?.displayName || "Google kullanıcısı";
      return {
        accountExternalId: channel.externalId,
        kind: "review",
        conversationExternalId: `r:${x.reviewId}`,
        participantId: `review:${x.reviewId}`,
        participantName: who,
        participantAvatar: x.reviewer?.profilePhotoUrl ?? null,
        externalMessageId: `${x.reviewId}@${x.updateTime ?? x.createTime ?? ""}`,
        text: `${"★".repeat(stars)}${"☆".repeat(5 - stars)}${x.comment ? ` ${x.comment}` : ""}`,
        metadata: { kind: "review", reviewName: x.name, rating: stars },
        receivedAt: x.updateTime ?? x.createTime,
      };
    });
    const newest = [since, ...fresh.map((x) => x.updateTime ?? x.createTime ?? "")].sort().pop()!;
    return { events, cursor: JSON.stringify({ at: Date.now(), since: newest }) };
  },

  async replyReview(channel: Channel, reviewName: string, text: string) {
    await http(`https://mybusiness.googleapis.com/v4/${reviewName}/reply`, { method: "PUT", headers: { Authorization: `Bearer ${channel.accessToken}` }, json: { comment: text } });
    return { externalId: `${reviewName}/reply` };
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
