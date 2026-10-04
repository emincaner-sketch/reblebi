import crypto from "node:crypto";
import { config } from "../core/config.js";
import { AppError, notFound } from "../core/i18n.js";
import { createLogger } from "../core/logger.js";
import { adsRepo, type AdAccount, type AdLevel, type AdMetrics, type AdsProviderId } from "../core/repos/ads.js";
import { channelsRepo } from "../core/repos/channels.js";
import { orgsRepo } from "../core/repos/orgs.js";
import { postsRepo } from "../core/repos/posts.js";
import type { Ctx } from "../core/types.js";
import { ProviderError } from "../providers/types.js";
import { requireRole } from "./access.js";
import { ADS_ADAPTERS, googleRecommendationAction, googleRecommendations, metaBoost, parseMetaRow, type CampaignState } from "./ads-providers.js";
import { addDays, localYmd } from "./analytics-report.js";

/**
 * Reklamlar (Metricool "Ads" karşılığı): Meta, Google Ads ve TikTok Ads.
 * Her platform ayrı bir izin ekranı açar; mevcut kanal izinlerine dokunulmaz.
 * Günlük hesap, kampanya, grup, reklam ve (Google) anahtar kelime metrikleri yerelde saklanır; panel buradan okur.
 * Yönetim (yalnızca yönetici rolü): kampanya duraklat/başlat, Meta gönderi öne çıkarma (duraklatılmış oluşturulur,
 * harcama kullanıcı başlatınca başlar), Google Ads önerilerini uygulama/yoksayma.
 */

const log = createLogger("ads");
const STATE_TTL_MS = 10 * 60_000;
const pending = new Map<string, { orgId: string; userId: string; provider: AdsProviderId; exp: number }>();

export const ADS_PROVIDERS: AdsProviderId[] = ["meta", "google", "tiktok"];
export const isAdsProvider = (v: string): v is AdsProviderId => (ADS_PROVIDERS as string[]).includes(v);

/** Eski çağrılarla uyum: Meta satır ayrıştırıcısı */
export const parseAdRow = parseMetaRow;

export function adsConfigured(provider: AdsProviderId = "meta"): boolean {
  return ADS_ADAPTERS[provider].missing().length === 0;
}

/** Platform uygulamasına eklenmesi gereken yönlendirme adresi */
export function adsRedirectUri(provider: AdsProviderId = "meta"): string {
  return `${config.appUrl}/api/ads/${provider}/callback`;
}

export function adsConnectUrl(ctx: Ctx, provider: AdsProviderId = "meta"): string {
  requireRole(ctx, "admin");
  if (!adsConfigured(provider)) throw new AppError(400, "ads.not_configured");
  if (!ctx.userId) throw new AppError(403, "err.forbidden");
  const now = Date.now();
  for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
  const state = crypto.randomBytes(24).toString("base64url");
  pending.set(state, { orgId: ctx.orgId, userId: ctx.userId, provider, exp: now + STATE_TTL_MS });
  return ADS_ADAPTERS[provider].authUrl(state, adsRedirectUri(provider));
}

export async function finishAdsConnect(provider: AdsProviderId, query: Record<string, string | undefined>, userId: string | null): Promise<{ orgId: string; accounts: AdAccount[] }> {
  const state = query.state ?? "";
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.exp < Date.now() || !userId || p.userId !== userId || p.provider !== provider) throw new AppError(400, "ads.state");
  const r = await ADS_ADAPTERS[provider].exchange(query, adsRedirectUri(provider));
  const accounts = r.accounts.map((a) =>
    adsRepo.upsert(p.orgId, { provider, externalId: a.externalId, name: a.name, currency: a.currency, token: r.token, tokenExpiresAt: r.expiresAt, refreshToken: r.refreshToken, extra: a.extra }),
  );
  if (!accounts.length) throw new AppError(400, "ads.no_accounts");
  // İlk 30 günü arka planda doldur (yönlendirme beklemesin)
  setImmediate(() => {
    for (const a of accounts) void syncAdAccount(a, 30).catch(() => undefined);
  });
  return { orgId: p.orgId, accounts };
}

/* ---------------- Senkronizasyon ---------------- */

export async function syncAdAccount(acc: AdAccount, days = 3, now = Date.now()): Promise<void> {
  const adapter = ADS_ADAPTERS[acc.provider];
  const tz = orgsRepo.get(acc.orgId)?.timezone || "Europe/Istanbul";
  const until = localYmd(now, tz);
  try {
    const t = await adapter.accessToken(acc, { token: adsRepo.token(acc.id), refreshToken: adsRepo.refreshToken(acc.id) });
    if (t.changed) adsRepo.setToken(acc.id, t.token, t.expiresAt ?? null);
    // Platformun aralık sınırına göre parçalara böl (TikTok günlük kırılımda 30 gün)
    for (let end = until, left = days; left > 0; ) {
      const span = Math.min(left, adapter.maxDays);
      const start = addDays(end, -(span - 1));
      for (const row of await adapter.fetch(acc, t.token, start, end)) {
        if (row.level === "account") adsRepo.upsertDay(acc.id, row.date, "", null, row.metrics);
        else if (row.level === "campaign") adsRepo.upsertDay(acc.id, row.date, row.id, row.name, row.metrics);
        else adsRepo.upsertEntity(acc.id, { date: row.date, level: row.level, id: row.id, name: row.name, parentId: row.parentId, parentName: row.parentName, extra: row.extra, metrics: row.metrics });
      }
      left -= span;
      end = addDays(start, -1);
    }
    // Kampanya durumları (yönetim için); hata metrikleri engellemez
    try {
      adsRepo.mergeExtra(acc.id, { campaigns: await adapter.campaignStatuses(acc, t.token) });
    } catch (e) {
      log.debug("kampanya durumları alınamadı", { account: acc.id, msg: e instanceof Error ? e.message : e });
    }
    adsRepo.markSynced(acc.id, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    adsRepo.markSynced(acc.id, msg);
    log.warn("reklam metrikleri alınamadı", { account: acc.id, provider: acc.provider, msg });
  }
}

/** Zamanlayıcı: 6 saatte bir son 3 gün (platformlar son günleri geç kesinleştirir) */
export async function syncAllAdAccounts(now = Date.now()): Promise<number> {
  let n = 0;
  for (const acc of adsRepo.listAll()) {
    if (acc.lastSyncedAt && now - Date.parse(acc.lastSyncedAt) < 6 * 3600_000) continue;
    await syncAdAccount(acc, 3, now);
    n++;
  }
  return n;
}

export async function syncNow(ctx: Ctx, id: string): Promise<AdAccount> {
  requireRole(ctx, "editor");
  const acc = adsRepo.get(ctx.orgId, id);
  if (!acc) throw notFound("ad_account");
  await syncAdAccount(acc, 30);
  return adsRepo.get(ctx.orgId, id)!;
}

/* ---------------- Yönetim ---------------- */

async function liveToken(acc: AdAccount): Promise<string> {
  const t = await ADS_ADAPTERS[acc.provider].accessToken(acc, { token: adsRepo.token(acc.id), refreshToken: adsRepo.refreshToken(acc.id) });
  if (t.changed) adsRepo.setToken(acc.id, t.token, t.expiresAt ?? null);
  return t.token;
}

function managed(ctx: Ctx, id: string): AdAccount {
  requireRole(ctx, "admin");
  const acc = adsRepo.get(ctx.orgId, id);
  if (!acc) throw notFound("ad_account");
  return acc;
}

/** Platform yazma hatasını anlaşılır biçimde iletir (izin eksikse hesap yeniden bağlanmalı) */
function writeError(e: unknown): never {
  if (e instanceof AppError) throw e;
  const msg = e instanceof Error ? e.message : String(e);
  if ((e instanceof ProviderError && (e.status === 401 || e.status === 403)) || /permission|ads_management|scope|authoriz/i.test(msg)) throw new AppError(400, "ads.write_permission");
  throw new AppError(400, "ads.write_failed", { msg: msg.slice(0, 300) });
}

const campaignsOf = (acc: AdAccount) => (acc.extra.campaigns ?? {}) as Record<string, CampaignState>;

export async function setCampaignStatus(ctx: Ctx, id: string, campaignId: string, status: "active" | "paused"): Promise<{ campaignId: string; status: "active" | "paused" }> {
  const acc = managed(ctx, id);
  try {
    await ADS_ADAPTERS[acc.provider].setCampaignStatus(acc, await liveToken(acc), campaignId, status);
  } catch (e) {
    writeError(e);
  }
  const cur = campaignsOf(acc);
  adsRepo.mergeExtra(acc.id, { campaigns: { ...cur, [campaignId]: { status, name: cur[campaignId]?.name ?? null } } });
  log.info("kampanya durumu değişti", { account: acc.id, campaignId, status, by: ctx.userId });
  return { campaignId, status };
}

export interface BoostRequest {
  postId: string;
  targetId: string;
  name?: string;
  dailyBudget: number;
  days: number;
  countries: string[];
  ageMin: number;
  ageMax: number;
}

/** Meta: yayınlanmış Facebook/Instagram gönderisini öne çıkarır. Her şey DURAKLATILMIŞ oluşturulur. */
export async function boostPost(ctx: Ctx, id: string, b: BoostRequest) {
  const acc = managed(ctx, id);
  if (acc.provider !== "meta") throw new AppError(400, "ads.boost_meta_only");
  const post = postsRepo.get(ctx.orgId, b.postId);
  const target = post?.targets.find((x) => x.id === b.targetId);
  if (!post || !target) throw notFound("post");
  const channel = channelsRepo.get(ctx.orgId, target.channelId);
  if (!channel || (channel.provider !== "facebook" && channel.provider !== "instagram") || target.status !== "published" || !target.externalId) throw new AppError(400, "ads.boost_not_eligible");
  const pageId = channel.provider === "facebook" ? channel.externalId : (channel.metadata.pageId as string | undefined);
  if (!pageId) throw new AppError(400, "ads.boost_not_eligible");
  const text = (target.content ?? post.content).replace(/\s+/g, " ").trim().slice(0, 40);
  const name = (b.name?.trim() || `Öne çıkarma · ${text || channel.name}`).slice(0, 120);
  let r: Awaited<ReturnType<typeof metaBoost>>;
  try {
    r = await metaBoost(acc, await liveToken(acc), {
      network: channel.provider,
      pageId,
      postId: target.externalId,
      igUserId: channel.provider === "instagram" ? channel.externalId : null,
      name,
      dailyBudget: b.dailyBudget,
      currency: acc.currency,
      days: b.days,
      countries: b.countries,
      ageMin: b.ageMin,
      ageMax: b.ageMax,
    });
  } catch (e) {
    writeError(e);
  }
  const boosts = ((acc.extra.boosts as unknown[]) ?? []).slice(-49);
  adsRepo.mergeExtra(acc.id, {
    campaigns: { ...campaignsOf(acc), [r.campaignId]: { status: "paused", name } },
    boosts: [...boosts, { campaignId: r.campaignId, postId: post.id, targetId: target.id, name, dailyBudget: b.dailyBudget, days: b.days, createdAt: new Date().toISOString(), by: ctx.userId }],
  });
  log.info("gönderi öne çıkarma oluşturuldu (duraklatılmış)", { account: acc.id, campaignId: r.campaignId, by: ctx.userId });
  const act = acc.externalId.replace(/^act_/, "");
  return { ...r, name, status: "paused" as const, manageUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${r.campaignId}` };
}

export async function listRecommendations(ctx: Ctx, id: string) {
  const acc = managed(ctx, id);
  if (acc.provider !== "google") throw new AppError(400, "ads.recommendations_google_only");
  const names = campaignsOf(acc);
  try {
    const list = await googleRecommendations(acc, await liveToken(acc));
    return list.map((r) => ({ ...r, campaignName: r.campaignId ? (names[r.campaignId]?.name ?? null) : null }));
  } catch (e) {
    writeError(e);
  }
}

export async function recommendationAction(ctx: Ctx, id: string, resourceName: string, action: "apply" | "dismiss"): Promise<{ ok: true }> {
  const acc = managed(ctx, id);
  if (acc.provider !== "google") throw new AppError(400, "ads.recommendations_google_only");
  try {
    await googleRecommendationAction(acc, await liveToken(acc), resourceName, action);
  } catch (e) {
    writeError(e);
  }
  log.info("Google Ads önerisi", { account: acc.id, action, by: ctx.userId });
  return { ok: true };
}

/* ---------------- Rapor ---------------- */

type Num = number | null;
const KEYS = ["spend", "impressions", "reach", "clicks", "linkClicks", "conversions", "purchases", "leads", "messages"] as const;
type Totals = Record<(typeof KEYS)[number], Num>;
const sumKey = (rows: AdMetrics[], k: string): Num => (rows.some((r) => typeof r[k] === "number") ? rows.reduce((a, r) => a + (r[k] ?? 0), 0) : null);
const totalsOf = (rows: AdMetrics[]): Totals => Object.fromEntries(KEYS.map((k) => [k, sumKey(rows, k)])) as Totals;
const derive = (t: Totals) => ({
  ctr: t.impressions ? Math.round(((t.clicks ?? 0) / t.impressions) * 10000) / 100 : null,
  cpc: t.clicks && t.spend !== null ? Math.round(((t.spend ?? 0) / t.clicks) * 100) / 100 : null,
  cpm: t.impressions && t.spend !== null ? Math.round(((t.spend ?? 0) / t.impressions) * 1000 * 100) / 100 : null,
  costPerConversion: t.conversions && t.spend !== null ? Math.round(((t.spend ?? 0) / t.conversions) * 100) / 100 : null,
});

/** Dönem içinde varlık bazında toplar (kampanya, grup, reklam, anahtar kelime) */
function aggregate(rows: Array<{ id: string; name: string | null; parentId?: string | null; parentName?: string | null; extra?: Record<string, unknown>; metrics: AdMetrics }>) {
  const map = new Map<string, { id: string; name: string; parentId: string | null; parentName: string | null; extra: Record<string, unknown>; rows: AdMetrics[] }>();
  for (const r of rows) {
    const c = map.get(r.id) ?? { id: r.id, name: r.name ?? r.id, parentId: r.parentId ?? null, parentName: r.parentName ?? null, extra: r.extra ?? {}, rows: [] };
    c.rows.push(r.metrics);
    if (r.name) c.name = r.name;
    if (r.parentName) c.parentName = r.parentName;
    map.set(r.id, c);
  }
  return [...map.values()]
    .map((c) => {
      const t = totalsOf(c.rows);
      return { id: c.id, name: c.name, parentId: c.parentId, parentName: c.parentName, extra: c.extra, ...t, ...derive(t) };
    })
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
}

export function adsReport(ctx: Ctx, q: { accountId?: string; days?: number }) {
  const accounts = adsRepo.list(ctx.orgId);
  const acc = (q.accountId ? accounts.find((a) => a.id === q.accountId) : null) ?? accounts.find((a) => a.enabled) ?? accounts[0] ?? null;
  const tz = orgsRepo.get(ctx.orgId)?.timezone || "Europe/Istanbul";
  const n = Math.min(Math.max(Math.round(q.days ?? 30), 7), 366);
  const to = localYmd(Date.now(), tz);
  const from = addDays(to, -(n - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(n - 1));
  const providers = ADS_PROVIDERS.map((id) => ({ id, label: ADS_ADAPTERS[id].label, configured: adsConfigured(id), missing: ADS_ADAPTERS[id].missing(), redirectUri: adsRedirectUri(id) }));
  const base = { configured: adsConfigured("meta"), redirectUri: adsRedirectUri("meta"), providers, accounts, range: { from, to, days: n, prevFrom, prevTo, tz } };
  if (!acc) return { ...base, account: null, totals: null, prev: null, daily: [], campaigns: [], groups: [], ads: [], keywords: [] };

  const rows = adsRepo.rows(acc.id, prevFrom, to);
  const accountRows = rows.filter((r) => r.campaignId === "");
  const totals = totalsOf(accountRows.filter((r) => r.date >= from).map((r) => r.metrics));
  const prev = totalsOf(accountRows.filter((r) => r.date < from).map((r) => r.metrics));
  const byDate = new Map(accountRows.map((r) => [r.date, r.metrics]));
  const daily: Array<{ date: string } & Record<string, Num | string>> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const m = byDate.get(d);
    daily.push({ date: d, spend: m?.spend ?? null, impressions: m?.impressions ?? null, reach: m?.reach ?? null, clicks: m?.clicks ?? null, conversions: m?.conversions ?? null });
  }
  const states = campaignsOf(acc);
  const campaigns = aggregate(rows.filter((r) => r.campaignId && r.date >= from).map((r) => ({ id: r.campaignId, name: r.campaignName, metrics: r.metrics }))).map((c) => ({
    ...c,
    status: states[c.id]?.status ?? null,
  }));
  // Henüz harcaması olmayan öne çıkarmalar da listede görünsün (duraklatılmış başlar, buradan başlatılır)
  for (const bst of (acc.extra.boosts as Array<{ campaignId: string; name: string }> | undefined) ?? []) {
    const st = states[bst.campaignId];
    if (!st || st.status === "other" || campaigns.some((c) => c.id === bst.campaignId)) continue;
    const t0 = totalsOf([]);
    campaigns.push({ id: bst.campaignId, name: st.name ?? bst.name, parentId: null, parentName: null, extra: { boost: true }, ...t0, ...derive(t0), status: st.status });
  }
  const level = (l: AdLevel) => aggregate(adsRepo.entities(acc.id, l, from, to));

  return {
    ...base,
    account: acc,
    totals: { ...totals, ...derive(totals) },
    prev: { ...prev, ...derive(prev) },
    daily,
    campaigns,
    groups: level("group"),
    ads: level("ad"),
    keywords: acc.provider === "google" ? level("keyword") : [],
  };
}
