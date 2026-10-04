import { config } from "../core/config.js";
import type { AdAccount, AdLevel, AdMetrics, AdsProviderId } from "../core/repos/ads.js";
import { http } from "../providers/http.js";
import { GRAPH, graph } from "../providers/meta/common.js";
import { ProviderError } from "../providers/types.js";

/**
 * Reklam platformu adaptörleri. Okuma: her platform aynı biçimde satır döndürür (hesap toplamı, kampanya,
 * grup (reklam seti / reklam grubu), reklam ve Google'da anahtar kelime, gün gün). Yönetim: kampanya
 * duraklatma/başlatma, Meta gönderi öne çıkarma (duraklatılmış oluşturulur) ve Google Ads önerileri.
 */

export interface AdsRow {
  date: string;
  level: "account" | "campaign" | AdLevel;
  id: string;
  name: string | null;
  parentId?: string | null;
  parentName?: string | null;
  extra?: Record<string, unknown>;
  metrics: AdMetrics;
}

export interface ConnectedAdAccount {
  externalId: string;
  name: string;
  currency: string | null;
  extra?: Record<string, unknown>;
}

export interface AdsAdapter {
  id: AdsProviderId;
  label: string;
  /** Sunucuda eksik olan ortam değişkenleri (boşsa bağlanabilir) */
  missing(): string[];
  authUrl(state: string, redirectUri: string): string;
  exchange(q: Record<string, string | undefined>, redirectUri: string): Promise<{ token: string; refreshToken: string | null; expiresAt: string | null; accounts: ConnectedAdAccount[] }>;
  /** Kullanılabilir erişim jetonu (Google: yenileme jetonuyla saatlik yenilenir) */
  accessToken(acc: AdAccount, stored: { token: string | null; refreshToken: string | null }): Promise<{ token: string; expiresAt?: string | null; changed?: boolean }>;
  fetch(acc: AdAccount, token: string, since: string, until: string): Promise<AdsRow[]>;
  /** Bir istekte izin verilen en uzun gün aralığı */
  maxDays: number;
  /** Kampanyaların güncel yayın durumu (kimlik → durum) */
  campaignStatuses(acc: AdAccount, token: string): Promise<Record<string, CampaignState>>;
  /** Kampanyayı duraklatır ya da yeniden başlatır (yazma izni gerekir) */
  setCampaignStatus(acc: AdAccount, token: string, campaignId: string, status: "active" | "paused"): Promise<void>;
}

export type CampaignStatus = "active" | "paused" | "other";
export interface CampaignState {
  status: CampaignStatus;
  name: string | null;
}

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const put = (m: AdMetrics, k: string, v: number | undefined) => {
  if (v !== undefined) m[k] = v;
};

/* ======================================================================
   Meta (Facebook + Instagram reklamları) · Marketing API
   ====================================================================== */

interface MetaRow {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

const META_ACTIONS: Record<string, string> = {
  purchase: "purchases",
  omni_purchase: "purchases",
  lead: "leads",
  "onsite_conversion.lead_grouped": "leads",
  "onsite_conversion.messaging_conversation_started_7d": "messages",
};

export function parseMetaRow(r: MetaRow): AdMetrics {
  const m: AdMetrics = {};
  put(m, "spend", num(r.spend));
  put(m, "impressions", num(r.impressions));
  put(m, "reach", num(r.reach));
  put(m, "clicks", num(r.clicks));
  put(m, "linkClicks", num(r.inline_link_clicks));
  // Aynı sonuç birden çok action_type ile gelebilir (purchase + omni_purchase): en büyüğü alınır
  for (const a of r.actions ?? []) {
    const key = META_ACTIONS[a.action_type];
    const v = Number(a.value);
    if (key && Number.isFinite(v)) m[key] = Math.max(m[key] ?? 0, v);
  }
  if (m.purchases !== undefined || m.leads !== undefined) m.conversions = (m.purchases ?? 0) + (m.leads ?? 0);
  return m;
}

async function metaAll(path: string, token: string, params: Record<string, unknown>): Promise<MetaRow[]> {
  const out: MetaRow[] = [];
  let r = await graph<{ data?: MetaRow[]; paging?: { next?: string } }>(path, token, { params });
  out.push(...(r.data ?? []));
  for (let i = 0; i < 30 && r.paging?.next; i++) {
    r = await graph<{ data?: MetaRow[]; paging?: { next?: string } }>(r.paging.next, token);
    out.push(...(r.data ?? []));
  }
  return out;
}

export const metaAds: AdsAdapter = {
  id: "meta",
  label: "Meta",
  maxDays: 90,
  missing: () => [!config.meta.appId && "META_APP_ID", !config.meta.appSecret && "META_APP_SECRET"].filter(Boolean) as string[],
  authUrl(state, redirectUri) {
    const u = new URL(`https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth`);
    u.searchParams.set("client_id", config.meta.appId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    // ads_management: kampanya duraklatma/başlatma ve gönderi öne çıkarma (oluşturulanlar duraklatılmış başlar)
    u.searchParams.set("scope", "ads_read,ads_management");
    return u.toString();
  },
  async exchange(q, redirectUri) {
    const short = await http<{ access_token: string }>(`${GRAPH()}/oauth/access_token`, {
      query: { client_id: config.meta.appId, client_secret: config.meta.appSecret, redirect_uri: redirectUri, code: q.code },
    });
    const long = await http<{ access_token: string; expires_in?: number }>(`${GRAPH()}/oauth/access_token`, {
      query: { grant_type: "fb_exchange_token", client_id: config.meta.appId, client_secret: config.meta.appSecret, fb_exchange_token: short.access_token },
    });
    const token = long.access_token || short.access_token;
    const r = await graph<{ data?: Array<{ id: string; name?: string; currency?: string }> }>("/me/adaccounts", token, { params: { fields: "id,name,currency,account_status", limit: 100 } });
    return {
      token,
      refreshToken: null,
      expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
      accounts: (r.data ?? []).map((a) => ({ externalId: a.id, name: a.name || a.id, currency: a.currency ?? null })),
    };
  },
  async accessToken(_acc, stored) {
    if (!stored.token) throw new ProviderError("Jeton yok, hesabı yeniden bağla", 401);
    return { token: stored.token };
  },
  async fetch(acc, token, since, until) {
    const base = { time_increment: 1, time_range: { since, until }, limit: 500 };
    const fields = "spend,impressions,reach,clicks,inline_link_clicks,actions";
    const rows: AdsRow[] = [];
    for (const r of await metaAll(`/${acc.externalId}/insights`, token, { ...base, level: "account", fields })) rows.push({ date: r.date_start, level: "account", id: "", name: null, metrics: parseMetaRow(r) });
    for (const r of await metaAll(`/${acc.externalId}/insights`, token, { ...base, level: "campaign", fields: `campaign_id,campaign_name,${fields}` }))
      if (r.campaign_id) rows.push({ date: r.date_start, level: "campaign", id: r.campaign_id, name: r.campaign_name ?? null, metrics: parseMetaRow(r) });
    for (const r of await metaAll(`/${acc.externalId}/insights`, token, { ...base, level: "adset", fields: `adset_id,adset_name,campaign_id,campaign_name,${fields}` }))
      if (r.adset_id) rows.push({ date: r.date_start, level: "group", id: r.adset_id, name: r.adset_name ?? null, parentId: r.campaign_id ?? null, parentName: r.campaign_name ?? null, metrics: parseMetaRow(r) });
    for (const r of await metaAll(`/${acc.externalId}/insights`, token, { ...base, level: "ad", fields: `ad_id,ad_name,adset_id,adset_name,${fields}` }))
      if (r.ad_id) rows.push({ date: r.date_start, level: "ad", id: r.ad_id, name: r.ad_name ?? null, parentId: r.adset_id ?? null, parentName: r.adset_name ?? null, metrics: parseMetaRow(r) });
    return rows;
  },
  async campaignStatuses(acc, token) {
    const out: Record<string, CampaignState> = {};
    let r = await graph<{ data?: Array<{ id: string; name?: string; status?: string }>; paging?: { next?: string } }>(`/${acc.externalId}/campaigns`, token, { params: { fields: "id,name,status", limit: 500 } });
    for (let i = 0; i < 20; i++) {
      for (const c of r.data ?? []) out[c.id] = { status: c.status === "ACTIVE" ? "active" : c.status === "PAUSED" ? "paused" : "other", name: c.name ?? null };
      if (!r.paging?.next) break;
      r = await graph(r.paging.next, token);
    }
    return out;
  },
  async setCampaignStatus(_acc, token, campaignId, status) {
    await graph(`/${campaignId}`, token, { method: "POST", params: { status: status === "active" ? "ACTIVE" : "PAUSED" } });
  },
};

/** Para birimi en küçük birim çarpanı (TRY 100, JPY 1): Meta bütçeleri en küçük birimle ister */
export function minorUnits(currency: string | null): number {
  try {
    return 10 ** (new Intl.NumberFormat("en", { style: "currency", currency: currency || "USD" }).resolvedOptions().maximumFractionDigits ?? 2);
  } catch {
    return 100;
  }
}

export interface BoostInput {
  /** Facebook: sayfa gönderisi; Instagram: medya */
  network: "facebook" | "instagram";
  pageId: string;
  /** Facebook: "sayfa_gönderi" kimliği; Instagram: medya kimliği */
  postId: string;
  igUserId?: string | null;
  name: string;
  dailyBudget: number;
  currency: string | null;
  days: number;
  countries: string[];
  ageMin: number;
  ageMax: number;
}

/**
 * Meta gönderi öne çıkarma (Boost): kampanya → reklam seti → kreatif → reklam. Hepsi DURAKLATILMIŞ oluşturulur;
 * harcama ancak kullanıcı kampanyayı açıkça başlattığında başlar. Ara adımda hata olursa kampanya silinir.
 */
export async function metaBoost(acc: AdAccount, token: string, b: BoostInput, now = Date.now()): Promise<{ campaignId: string; adsetId: string; creativeId: string; adId: string }> {
  const act = acc.externalId;
  const camp = await graph<{ id: string }>(`/${act}/campaigns`, token, {
    method: "POST",
    params: { name: b.name, objective: "OUTCOME_ENGAGEMENT", status: "PAUSED", special_ad_categories: [], is_adset_budget_sharing_enabled: false },
  });
  try {
    const start = new Date(now + 10 * 60_000);
    const end = new Date(start.getTime() + b.days * 86_400_000);
    const adset = await graph<{ id: string }>(`/${act}/adsets`, token, {
      method: "POST",
      params: {
        name: `${b.name} · reklam seti`,
        campaign_id: camp.id,
        daily_budget: Math.round(b.dailyBudget * minorUnits(b.currency)),
        billing_event: "IMPRESSIONS",
        optimization_goal: "POST_ENGAGEMENT",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        targeting: { geo_locations: { countries: b.countries }, age_min: b.ageMin, age_max: b.ageMax, publisher_platforms: [b.network] },
        status: "PAUSED",
      },
    });
    const creative = await graph<{ id: string }>(`/${act}/adcreatives`, token, {
      method: "POST",
      params:
        b.network === "facebook"
          ? { name: `${b.name} · kreatif`, object_story_id: b.postId.includes("_") ? b.postId : `${b.pageId}_${b.postId}` }
          : { name: `${b.name} · kreatif`, object_id: b.pageId, instagram_user_id: b.igUserId, source_instagram_media_id: b.postId },
    });
    const ad = await graph<{ id: string }>(`/${act}/ads`, token, { method: "POST", params: { name: b.name, adset_id: adset.id, creative: { creative_id: creative.id }, status: "PAUSED" } });
    return { campaignId: camp.id, adsetId: adset.id, creativeId: creative.id, adId: ad.id };
  } catch (e) {
    await graph(`/${camp.id}`, token, { method: "DELETE" }).catch(() => undefined);
    throw e;
  }
}

/* ======================================================================
   Google Ads API (REST, GAQL) · salt okunur
   ====================================================================== */

const GADS = () => `https://googleads.googleapis.com/${config.googleAds.apiVersion}`;

function gadsHeaders(token: string, loginCustomerId?: string | null): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}`, "developer-token": config.googleAds.developerToken };
  const login = (loginCustomerId || config.googleAds.loginCustomerId || "").replace(/-/g, "");
  if (login) h["login-customer-id"] = login;
  return h;
}

/** GAQL sorgusu (sayfalı googleAds:search) */
export async function gaqlSearch<T = Record<string, unknown>>(customerId: string, token: string, query: string, loginCustomerId?: string | null): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 50; i++) {
    const r = await http<{ results?: T[]; nextPageToken?: string }>(`${GADS()}/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers: gadsHeaders(token, loginCustomerId),
      json: pageToken ? { query, pageToken } : { query },
    });
    out.push(...(r.results ?? []));
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

interface GadsMetrics {
  costMicros?: string;
  impressions?: string;
  clicks?: string;
  conversions?: number;
}

export function parseGadsMetrics(m: GadsMetrics | undefined): AdMetrics {
  const out: AdMetrics = {};
  const cost = num(m?.costMicros);
  if (cost !== undefined) out.spend = Math.round((cost / 1_000_000) * 100) / 100;
  put(out, "impressions", num(m?.impressions));
  put(out, "clicks", num(m?.clicks));
  put(out, "conversions", num(m?.conversions));
  return out;
}

const GADS_METRICS = "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions";

async function refreshGoogle(refreshToken: string): Promise<{ token: string; expiresAt: string }> {
  const r = await http<{ access_token: string; expires_in?: number }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    form: { grant_type: "refresh_token", client_id: config.google.clientId, client_secret: config.google.clientSecret, refresh_token: refreshToken },
    retries: 1,
  });
  return { token: r.access_token, expiresAt: new Date(Date.now() + (r.expires_in ?? 3600) * 1000).toISOString() };
}

export const googleAds: AdsAdapter = {
  id: "google",
  label: "Google Ads",
  maxDays: 90,
  missing: () =>
    [!config.google.clientId && "GOOGLE_CLIENT_ID", !config.google.clientSecret && "GOOGLE_CLIENT_SECRET", !config.googleAds.developerToken && "GOOGLE_ADS_DEVELOPER_TOKEN"].filter(Boolean) as string[],
  authUrl(state, redirectUri) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", config.google.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "https://www.googleapis.com/auth/adwords");
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("state", state);
    return u.toString();
  },
  async exchange(q, redirectUri) {
    const t = await http<{ access_token: string; refresh_token?: string; expires_in?: number }>("https://oauth2.googleapis.com/token", {
      method: "POST",
      form: { code: q.code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" },
      retries: 0,
    });
    const list = await http<{ resourceNames?: string[] }>(`${GADS()}/customers:listAccessibleCustomers`, { headers: gadsHeaders(t.access_token, null) });
    const accounts: ConnectedAdAccount[] = [];
    const seen = new Set<string>();
    for (const rn of list.resourceNames ?? []) {
      const cid = rn.split("/")[1];
      if (!cid) continue;
      try {
        const [row] = await gaqlSearch<{ customer?: { id?: string; descriptiveName?: string; currencyCode?: string; manager?: boolean } }>(
          cid,
          t.access_token,
          "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1",
          cid,
        );
        const c = row?.customer;
        if (!c?.id) continue;
        if (c.manager) {
          // Yönetici (MCC) hesabı: altındaki müşteri hesapları onun kimliğiyle sorgulanır
          const kids = await gaqlSearch<{ customerClient?: { id?: string; descriptiveName?: string; currencyCode?: string; manager?: boolean } }>(
            cid,
            t.access_token,
            "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager FROM customer_client WHERE customer_client.level <= 1",
            cid,
          );
          for (const k of kids) {
            const kc = k.customerClient;
            if (!kc?.id || kc.manager || seen.has(kc.id)) continue;
            seen.add(kc.id);
            accounts.push({ externalId: kc.id, name: kc.descriptiveName || kc.id, currency: kc.currencyCode ?? null, extra: { loginCustomerId: cid } });
          }
        } else if (!seen.has(c.id)) {
          seen.add(c.id);
          accounts.push({ externalId: c.id, name: c.descriptiveName || c.id, currency: c.currencyCode ?? null, extra: {} });
        }
      } catch {
        /* erişilemeyen hesap atlanır */
      }
    }
    return { token: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(), accounts };
  },
  async accessToken(acc, stored) {
    const fresh = acc.tokenExpiresAt && Date.parse(acc.tokenExpiresAt) - Date.now() > 120_000;
    if (stored.token && fresh) return { token: stored.token };
    if (!stored.refreshToken) throw new ProviderError("Google yenileme jetonu yok, hesabı yeniden bağla", 401);
    const r = await refreshGoogle(stored.refreshToken);
    return { token: r.token, expiresAt: r.expiresAt, changed: true };
  },
  async fetch(acc, token, since, until) {
    const login = (acc.extra.loginCustomerId as string | undefined) ?? null;
    const where = `segments.date BETWEEN '${since}' AND '${until}'`;
    const q = <T>(query: string) => gaqlSearch<T & { segments?: { date?: string }; metrics?: GadsMetrics }>(acc.externalId, token, query, login);
    const rows: AdsRow[] = [];
    for (const r of await q<object>(`SELECT segments.date, ${GADS_METRICS} FROM customer WHERE ${where}`))
      if (r.segments?.date) rows.push({ date: r.segments.date, level: "account", id: "", name: null, metrics: parseGadsMetrics(r.metrics) });
    for (const r of await q<{ campaign?: { id?: string; name?: string } }>(`SELECT segments.date, campaign.id, campaign.name, ${GADS_METRICS} FROM campaign WHERE ${where}`))
      if (r.segments?.date && r.campaign?.id) rows.push({ date: r.segments.date, level: "campaign", id: r.campaign.id, name: r.campaign.name ?? null, metrics: parseGadsMetrics(r.metrics) });
    for (const r of await q<{ adGroup?: { id?: string; name?: string }; campaign?: { id?: string; name?: string } }>(
      `SELECT segments.date, ad_group.id, ad_group.name, campaign.id, campaign.name, ${GADS_METRICS} FROM ad_group WHERE ${where}`,
    ))
      if (r.segments?.date && r.adGroup?.id)
        rows.push({ date: r.segments.date, level: "group", id: r.adGroup.id, name: r.adGroup.name ?? null, parentId: r.campaign?.id ?? null, parentName: r.campaign?.name ?? null, metrics: parseGadsMetrics(r.metrics) });
    for (const r of await q<{ adGroupAd?: { ad?: { id?: string; name?: string; type?: string } }; adGroup?: { id?: string; name?: string } }>(
      `SELECT segments.date, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group.id, ad_group.name, ${GADS_METRICS} FROM ad_group_ad WHERE ${where}`,
    ))
      if (r.segments?.date && r.adGroupAd?.ad?.id)
        rows.push({
          date: r.segments.date,
          level: "ad",
          id: r.adGroupAd.ad.id,
          name: r.adGroupAd.ad.name || null,
          parentId: r.adGroup?.id ?? null,
          parentName: r.adGroup?.name ?? null,
          extra: { type: r.adGroupAd.ad.type ?? null },
          metrics: parseGadsMetrics(r.metrics),
        });
    for (const r of await q<{ adGroupCriterion?: { criterionId?: string; keyword?: { text?: string; matchType?: string } }; adGroup?: { id?: string; name?: string } }>(
      `SELECT segments.date, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.id, ad_group.name, ${GADS_METRICS} FROM keyword_view WHERE ${where}`,
    ))
      if (r.segments?.date && r.adGroupCriterion?.criterionId)
        rows.push({
          date: r.segments.date,
          level: "keyword",
          // Aynı kriter kimliği farklı reklam gruplarında olabilir
          id: `${r.adGroup?.id ?? ""}~${r.adGroupCriterion.criterionId}`,
          name: r.adGroupCriterion.keyword?.text ?? null,
          parentId: r.adGroup?.id ?? null,
          parentName: r.adGroup?.name ?? null,
          extra: { matchType: r.adGroupCriterion.keyword?.matchType ?? null },
          metrics: parseGadsMetrics(r.metrics),
        });
    return rows;
  },
  async campaignStatuses(acc, token) {
    const login = (acc.extra.loginCustomerId as string | undefined) ?? null;
    const out: Record<string, CampaignState> = {};
    for (const r of await gaqlSearch<{ campaign?: { id?: string; name?: string; status?: string } }>(acc.externalId, token, "SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != 'REMOVED'", login))
      if (r.campaign?.id) out[r.campaign.id] = { status: r.campaign.status === "ENABLED" ? "active" : r.campaign.status === "PAUSED" ? "paused" : "other", name: r.campaign.name ?? null };
    return out;
  },
  async setCampaignStatus(acc, token, campaignId, status) {
    await gadsMutate(acc, token, "campaigns:mutate", { operations: [{ update: { resourceName: `customers/${acc.externalId}/campaigns/${campaignId}`, status: status === "active" ? "ENABLED" : "PAUSED" }, updateMask: "status" }] });
  },
};

async function gadsMutate(acc: AdAccount, token: string, path: string, body: unknown): Promise<unknown> {
  return http(`${GADS()}/customers/${acc.externalId}/${path}`, { method: "POST", headers: gadsHeaders(token, (acc.extra.loginCustomerId as string | undefined) ?? null), json: body, retries: 0 });
}

export interface GadsRecommendation {
  resourceName: string;
  type: string;
  campaignId: string | null;
  /** Önerinin tahmini etkisi: şimdiki ve uygulanırsa (haftalık) */
  base: AdMetrics;
  potential: AdMetrics;
}

/** Google Ads önerileri (Metricool "Recommendations" karşılığı): yoksayılmamış olanlar */
export async function googleRecommendations(acc: AdAccount, token: string): Promise<GadsRecommendation[]> {
  const login = (acc.extra.loginCustomerId as string | undefined) ?? null;
  const metric = (p: string) => `recommendation.impact.${p}_metrics.impressions, recommendation.impact.${p}_metrics.clicks, recommendation.impact.${p}_metrics.cost_micros, recommendation.impact.${p}_metrics.conversions`;
  type M = { impressions?: number; clicks?: number; costMicros?: string; conversions?: number };
  const rows = await gaqlSearch<{ recommendation?: { resourceName?: string; type?: string; campaign?: string; dismissed?: boolean; impact?: { baseMetrics?: M; potentialMetrics?: M } } }>(
    acc.externalId,
    token,
    `SELECT recommendation.resource_name, recommendation.type, recommendation.campaign, recommendation.dismissed, ${metric("base")}, ${metric("potential")} FROM recommendation`,
    login,
  );
  const conv = (m: M | undefined): AdMetrics => {
    const out: AdMetrics = {};
    put(out, "impressions", num(m?.impressions));
    put(out, "clicks", num(m?.clicks));
    put(out, "conversions", num(m?.conversions));
    const c = num(m?.costMicros);
    if (c !== undefined) out.spend = Math.round((c / 1_000_000) * 100) / 100;
    return out;
  };
  return rows
    .map((r) => r.recommendation)
    .filter((r): r is NonNullable<typeof r> => Boolean(r?.resourceName) && !r?.dismissed)
    .map((r) => ({ resourceName: r.resourceName!, type: r.type ?? "UNKNOWN", campaignId: r.campaign?.split("/").pop() ?? null, base: conv(r.impact?.baseMetrics), potential: conv(r.impact?.potentialMetrics) }));
}

export async function googleRecommendationAction(acc: AdAccount, token: string, resourceName: string, action: "apply" | "dismiss"): Promise<void> {
  if (!resourceName.startsWith(`customers/${acc.externalId}/recommendations/`)) throw new ProviderError("Geçersiz öneri", 400);
  await gadsMutate(acc, token, action === "apply" ? "recommendations:apply" : "recommendations:dismiss", { operations: [{ resourceName }] });
}

/* ======================================================================
   TikTok Business API v1.3 · salt okunur
   ====================================================================== */

const TT = "https://business-api.tiktok.com/open_api/v1.3";

interface TtEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

async function tt<T>(path: string, token: string | null, opts: { query?: Record<string, unknown>; json?: unknown } = {}): Promise<T> {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) query[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  const r = await http<TtEnvelope<T>>(`${TT}${path}`, {
    method: opts.json ? "POST" : "GET",
    headers: token ? { "Access-Token": token } : {},
    query,
    json: opts.json,
  });
  if (r.code !== 0) throw new ProviderError(`TikTok: ${r.message ?? r.code}`, 400, r, false);
  return r.data as T;
}

interface TtReportRow {
  dimensions: Record<string, string>;
  metrics: Record<string, string>;
}

export function parseTtMetrics(m: Record<string, string>): AdMetrics {
  const out: AdMetrics = {};
  put(out, "spend", num(m.spend));
  put(out, "impressions", num(m.impressions));
  put(out, "reach", num(m.reach));
  put(out, "clicks", num(m.clicks));
  put(out, "conversions", num(m.conversion));
  return out;
}

const TT_METRICS = ["spend", "impressions", "clicks", "reach", "conversion"];

export const tiktokAds: AdsAdapter = {
  id: "tiktok",
  label: "TikTok Ads",
  // Günlük kırılımda TikTok en fazla 30 günlük aralık kabul eder
  maxDays: 30,
  missing: () => [!config.tiktokAds.appId && "TIKTOK_ADS_APP_ID", !config.tiktokAds.secret && "TIKTOK_ADS_SECRET"].filter(Boolean) as string[],
  authUrl(state, redirectUri) {
    const u = new URL("https://business-api.tiktok.com/portal/auth");
    u.searchParams.set("app_id", config.tiktokAds.appId);
    u.searchParams.set("state", state);
    u.searchParams.set("redirect_uri", redirectUri);
    return u.toString();
  },
  async exchange(q) {
    const code = q.auth_code || q.code;
    const t = await tt<{ access_token: string; advertiser_ids?: string[] }>("/oauth2/access_token/", null, { json: { app_id: config.tiktokAds.appId, secret: config.tiktokAds.secret, auth_code: code } });
    const ids = t.advertiser_ids ?? [];
    const accounts: ConnectedAdAccount[] = [];
    if (ids.length) {
      const info = await tt<{ list?: Array<{ advertiser_id: string; name?: string; currency?: string }> }>("/advertiser/info/", t.access_token, {
        query: { advertiser_ids: ids, fields: ["advertiser_id", "name", "currency"] },
      });
      for (const a of info.list ?? []) accounts.push({ externalId: a.advertiser_id, name: a.name || a.advertiser_id, currency: a.currency ?? null });
    }
    // TikTok uzun ömürlü jetonu süresizdir (kullanıcı yetkiyi kaldırana kadar)
    return { token: t.access_token, refreshToken: null, expiresAt: null, accounts };
  },
  async accessToken(_acc, stored) {
    if (!stored.token) throw new ProviderError("Jeton yok, hesabı yeniden bağla", 401);
    return { token: stored.token };
  },
  async fetch(acc, token, since, until) {
    const levels: Array<{ dataLevel: string; dim: string; level: AdsRow["level"]; extraMetrics: string[]; map: (d: Record<string, string>, m: Record<string, string>) => Partial<AdsRow> }> = [
      { dataLevel: "AUCTION_ADVERTISER", dim: "advertiser_id", level: "account", extraMetrics: [], map: () => ({ id: "", name: null }) },
      { dataLevel: "AUCTION_CAMPAIGN", dim: "campaign_id", level: "campaign", extraMetrics: ["campaign_name"], map: (d, m) => ({ id: d.campaign_id, name: m.campaign_name ?? null }) },
      {
        dataLevel: "AUCTION_ADGROUP",
        dim: "adgroup_id",
        level: "group",
        extraMetrics: ["adgroup_name", "campaign_id", "campaign_name"],
        map: (d, m) => ({ id: d.adgroup_id, name: m.adgroup_name ?? null, parentId: m.campaign_id ?? null, parentName: m.campaign_name ?? null }),
      },
      { dataLevel: "AUCTION_AD", dim: "ad_id", level: "ad", extraMetrics: ["ad_name", "adgroup_id", "adgroup_name"], map: (d, m) => ({ id: d.ad_id, name: m.ad_name ?? null, parentId: m.adgroup_id ?? null, parentName: m.adgroup_name ?? null }) },
    ];
    const rows: AdsRow[] = [];
    for (const l of levels) {
      for (let page = 1; page <= 50; page++) {
        const data = await tt<{ list?: TtReportRow[]; page_info?: { total_page?: number } }>("/report/integrated/get/", token, {
          query: {
            advertiser_id: acc.externalId,
            report_type: "BASIC",
            data_level: l.dataLevel,
            dimensions: [l.dim, "stat_time_day"],
            metrics: [...TT_METRICS, ...l.extraMetrics],
            start_date: since,
            end_date: until,
            page,
            page_size: 1000,
          },
        });
        for (const r of data.list ?? []) {
          const date = (r.dimensions.stat_time_day ?? "").slice(0, 10);
          const mapped = l.map(r.dimensions, r.metrics);
          if (!date || mapped.id === undefined) continue;
          rows.push({ date, level: l.level, id: mapped.id ?? "", name: mapped.name ?? null, parentId: mapped.parentId ?? null, parentName: mapped.parentName ?? null, metrics: parseTtMetrics(r.metrics) });
        }
        if (page >= (data.page_info?.total_page ?? 1)) break;
      }
    }
    return rows;
  },
  async campaignStatuses(acc, token) {
    const out: Record<string, CampaignState> = {};
    for (let page = 1; page <= 20; page++) {
      const data = await tt<{ list?: Array<{ campaign_id: string; campaign_name?: string; operation_status?: string }>; page_info?: { total_page?: number } }>("/campaign/get/", token, {
        query: { advertiser_id: acc.externalId, fields: ["campaign_id", "campaign_name", "operation_status"], page, page_size: 1000 },
      });
      for (const c of data.list ?? []) out[c.campaign_id] = { status: c.operation_status === "ENABLE" ? "active" : c.operation_status === "DISABLE" ? "paused" : "other", name: c.campaign_name ?? null };
      if (page >= (data.page_info?.total_page ?? 1)) break;
    }
    return out;
  },
  async setCampaignStatus(acc, token, campaignId, status) {
    await tt("/campaign/status/update/", token, { json: { advertiser_id: acc.externalId, campaign_ids: [campaignId], operation_status: status === "active" ? "ENABLE" : "DISABLE" } });
  },
};

export const ADS_ADAPTERS: Record<AdsProviderId, AdsAdapter> = { meta: metaAds, google: googleAds, tiktok: tiktokAds };
