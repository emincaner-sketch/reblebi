import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-ads-"));
process.env.DATA_DIR = dir;
process.env.META_APP_ID = "app-1";
process.env.META_APP_SECRET = "secret-1";
process.env.GOOGLE_CLIENT_ID = "gid";
process.env.GOOGLE_CLIENT_SECRET = "gsecret";
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-tok";
process.env.TIKTOK_ADS_APP_ID = "tt-app";
process.env.TIKTOK_ADS_SECRET = "tt-secret";

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { adsRepo } = await import("../src/core/repos/ads.js");
const { adsConnectUrl, adsReport, finishAdsConnect, parseAdRow, syncAdAccount } = await import("../src/services/ads.js");
const { parseGadsMetrics, parseTtMetrics } = await import("../src/services/ads-providers.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "reklam@ornek.com", password: "Password123!", name: "Reklam", locale: "tr" });
const org = orgsRepo.create({ name: "Reklam Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const seen: Array<{ url: URL; headers: Record<string, string>; body: string }> = [];
const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  const body = String(init?.body ?? "");
  seen.push({ url: u, headers, body });
  const p = u.pathname.replace(/^\/v[\d.]+/, "");

  /* ---- Meta ---- */
  if (u.hostname === "graph.facebook.com") {
    if (p === "/oauth/access_token") return j({ access_token: u.searchParams.get("grant_type") ? "long-tok" : "short-tok", expires_in: 5_000_000 });
    if (p === "/me/adaccounts") return j({ data: [{ id: "act_1", name: "Leblebi Reklam", currency: "TRY", account_status: 1 }] });
    if (p === "/act_1/insights") {
      const level = u.searchParams.get("level");
      if (level === "account") {
        if (u.searchParams.get("after") === "p2") return j({ data: [{ date_start: day(0), spend: "50.00", impressions: "5000", reach: "3000", clicks: "100", inline_link_clicks: "80" }] });
        return j({
          data: [{ date_start: day(1), spend: "100.50", impressions: "10000", reach: "6000", clicks: "200", inline_link_clicks: "150", actions: [{ action_type: "purchase", value: "3" }, { action_type: "omni_purchase", value: "4" }] }],
          paging: { next: `https://graph.facebook.com/v21.0/act_1/insights?level=account&after=p2` },
        });
      }
      if (level === "campaign") return j({ data: [{ date_start: day(1), campaign_id: "c1", campaign_name: "Yeni sezon", spend: "80", impressions: "8000", reach: "5000", clicks: "160" }, { date_start: day(0), campaign_id: "c1", campaign_name: "Yeni sezon", spend: "40", impressions: "4000", clicks: "70" }] });
      if (level === "adset") return j({ data: [{ date_start: day(1), adset_id: "s1", adset_name: "Kadın 25-34", campaign_id: "c1", campaign_name: "Yeni sezon", spend: "80", impressions: "8000", clicks: "160" }] });
      if (level === "ad") return j({ data: [{ date_start: day(1), ad_id: "a1", ad_name: "Reel 1", adset_id: "s1", adset_name: "Kadın 25-34", spend: "80", impressions: "8000", clicks: "160" }] });
    }
  }

  /* ---- Google ---- */
  if (u.hostname === "oauth2.googleapis.com") {
    const f = new URLSearchParams(body);
    if (f.get("grant_type") === "authorization_code") return j({ access_token: "g-at-1", refresh_token: "g-rt", expires_in: 3600 });
    if (f.get("grant_type") === "refresh_token") return j({ access_token: "g-at-2", expires_in: 3600 });
  }
  if (u.hostname === "googleads.googleapis.com") {
    if (headers["developer-token"] !== "dev-tok") return j({ error: { message: "no dev token" } }, 401);
    if (p === "/customers:listAccessibleCustomers") return j({ resourceNames: ["customers/111", "customers/999"] });
    const m = /^\/customers\/(\d+)\/googleAds:search$/.exec(p);
    if (m) {
      const q = JSON.parse(body).query as string;
      const cid = m[1];
      if (q.includes("FROM customer_client")) return j({ results: [{ customerClient: { id: "222", descriptiveName: "Alt Müşteri", currencyCode: "EUR", manager: false } }, { customerClient: { id: "999", manager: true } }] });
      if (q.includes("FROM customer LIMIT 1"))
        return j({ results: [{ customer: cid === "999" ? { id: "999", descriptiveName: "Ajans MCC", currencyCode: "TRY", manager: true } : { id: "111", descriptiveName: "Leblebi Google", currencyCode: "TRY", manager: false } }] });
      const met = { costMicros: "12500000", impressions: "1000", clicks: "40", conversions: 2 };
      if (q.includes("FROM customer WHERE")) return j({ results: [{ segments: { date: day(1) }, metrics: met }] });
      if (q.includes("FROM campaign")) return j({ results: [{ segments: { date: day(1) }, campaign: { id: "gc1", name: "Arama · Leblebi" }, metrics: met }] });
      if (q.includes("FROM ad_group WHERE")) return j({ results: [{ segments: { date: day(1) }, adGroup: { id: "ag1", name: "Leblebi al" }, campaign: { id: "gc1", name: "Arama · Leblebi" }, metrics: met }] });
      if (q.includes("FROM ad_group_ad")) return j({ results: [{ segments: { date: day(1) }, adGroupAd: { ad: { id: "ad9", name: "", type: "RESPONSIVE_SEARCH_AD" } }, adGroup: { id: "ag1", name: "Leblebi al" }, metrics: met }] });
      if (q.includes("FROM keyword_view"))
        return j({
          results: [{ segments: { date: day(1) }, adGroupCriterion: { criterionId: "k1", keyword: { text: "leblebi satın al", matchType: "PHRASE" } }, adGroup: { id: "ag1", name: "Leblebi al" }, metrics: met }],
          nextPageToken: q.includes("PAGE2") ? undefined : undefined,
        });
    }
  }

  /* ---- TikTok ---- */
  if (u.hostname === "business-api.tiktok.com") {
    if (p.endsWith("/oauth2/access_token/")) return j({ code: 0, message: "OK", data: { access_token: "tt-tok", advertiser_ids: ["7001"] } });
    if (p.endsWith("/advertiser/info/")) return j({ code: 0, data: { list: [{ advertiser_id: "7001", name: "Leblebi TikTok", currency: "USD" }] } });
    if (p.endsWith("/report/integrated/get/")) {
      if (headers["access-token"] !== "tt-tok") return j({ code: 40105, message: "Access token is incorrect" });
      const level = u.searchParams.get("data_level");
      const metrics = JSON.parse(u.searchParams.get("metrics") ?? "[]") as string[];
      assert.ok(metrics.includes("spend"));
      const base = { spend: "9.5", impressions: "2000", clicks: "30", reach: "1500", conversion: "3" };
      const page = Number(u.searchParams.get("page"));
      if (level === "AUCTION_ADVERTISER") return j({ code: 0, data: { list: [{ dimensions: { advertiser_id: "7001", stat_time_day: `${day(1)} 00:00:00` }, metrics: base }], page_info: { total_page: 1 } } });
      if (level === "AUCTION_CAMPAIGN")
        return j({
          code: 0,
          data: { list: [{ dimensions: { campaign_id: page === 1 ? "tc1" : "tc2", stat_time_day: `${day(1)} 00:00:00` }, metrics: { ...base, campaign_name: page === 1 ? "Reels" : "Spark" } }], page_info: { total_page: 2 } },
        });
      if (level === "AUCTION_ADGROUP") return j({ code: 0, data: { list: [{ dimensions: { adgroup_id: "tg1", stat_time_day: `${day(1)} 00:00:00` }, metrics: { ...base, adgroup_name: "18-34", campaign_id: "tc1", campaign_name: "Reels" } }], page_info: { total_page: 1 } } });
      if (level === "AUCTION_AD") return j({ code: 0, data: { list: [{ dimensions: { ad_id: "ta1", stat_time_day: `${day(1)} 00:00:00` }, metrics: { ...base, ad_name: "Video 1", adgroup_id: "tg1", adgroup_name: "18-34" } }], page_info: { total_page: 1 } } });
    }
  }
  return j({}, 404);
}) as typeof fetch;
// Bağlantı sonrası arka plan senkronu (setImmediate) bitmeden gerçek fetch geri gelmesin: sahte jetonla dışarı istek gitmez
test.after(async () => {
  await new Promise((r) => setTimeout(r, 500));
  globalThis.fetch = realFetch;
});

const stateOf = (url: string) => new URL(url).searchParams.get("state")!;

test("ayrıştırıcılar: Meta aynı sonucu çift saymaz; Google mikro birimi; TikTok dönüşüm", () => {
  assert.deepEqual(parseAdRow({ date_start: "2026-10-01", spend: "12.5", impressions: "1000", clicks: "", actions: [{ action_type: "purchase", value: "3" }, { action_type: "omni_purchase", value: "4" }, { action_type: "lead", value: "2" }] }), {
    spend: 12.5,
    impressions: 1000,
    purchases: 4,
    leads: 2,
    conversions: 6,
  });
  assert.deepEqual(parseGadsMetrics({ costMicros: "12500000", impressions: "1000", clicks: "40", conversions: 2 }), { spend: 12.5, impressions: 1000, clicks: 40, conversions: 2 });
  assert.deepEqual(parseTtMetrics({ spend: "9.5", impressions: "2000", clicks: "30", reach: "1500", conversion: "3" }), { spend: 9.5, impressions: 2000, clicks: 30, reach: 1500, conversions: 3 });
});

test("Meta: okuma + reklam yönetimi izni, state kullanıcıya ve platforma bağlı; reklam seti ve reklam düzeyi", async () => {
  const url = new URL(adsConnectUrl(ctx, "meta"));
  assert.equal(url.searchParams.get("scope"), "ads_read,ads_management");
  await assert.rejects(() => finishAdsConnect("meta", { code: "c", state: url.searchParams.get("state")! }, "baska"), /zaman aşımına/);
  const s2 = stateOf(adsConnectUrl(ctx, "meta"));
  await assert.rejects(() => finishAdsConnect("google", { code: "c", state: s2 }, user.id), /zaman aşımına/, "başka platformun state'i geçmez");
  const r = await finishAdsConnect("meta", { code: "c", state: stateOf(adsConnectUrl(ctx, "meta")) }, user.id);
  assert.equal(r.accounts[0].provider, "meta");
  assert.equal(adsRepo.token(r.accounts[0].id), "long-tok");
  assert.throws(() => adsConnectUrl({ ...ctx, role: "editor" }, "meta"), "bağlama yönetici ister");

  await syncAdAccount(r.accounts[0], 7);
  const rep = adsReport(ctx, { accountId: r.accounts[0].id, days: 7 });
  assert.equal(rep.totals?.spend, 150.5);
  assert.equal(rep.totals?.cpm, 10.03);
  assert.equal(rep.campaigns[0].spend, 120);
  assert.equal(rep.groups[0].name, "Kadın 25-34");
  assert.equal(rep.groups[0].parentName, "Yeni sezon");
  assert.equal(rep.ads[0].name, "Reel 1");
  assert.equal(rep.keywords.length, 0);
});

test("Google Ads: yönetici hesabının altındaki müşteri, geliştirici jetonu, jeton yenileme, anahtar kelimeler", async () => {
  const url = new URL(adsConnectUrl(ctx, "google"));
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/adwords");
  assert.equal(url.searchParams.get("access_type"), "offline");
  const r = await finishAdsConnect("google", { code: "c", state: url.searchParams.get("state")! }, user.id);
  const ids = r.accounts.map((a) => a.externalId).sort();
  assert.deepEqual(ids, ["111", "222"], "MCC'nin kendisi değil, altındaki müşteri hesabı eklenir");
  const child = r.accounts.find((a) => a.externalId === "222")!;
  assert.equal(child.extra.loginCustomerId, "999");
  assert.equal(adsRepo.refreshToken(child.id), "g-rt");

  // Süresi dolmuş jeton: senkron önce yeniler
  adsRepo.setToken(child.id, "eski", new Date(Date.now() - 1000).toISOString());
  await syncAdAccount(adsRepo.get(org.id, child.id)!, 7);
  assert.equal(adsRepo.get(org.id, child.id)?.lastError, null);
  assert.equal(adsRepo.token(child.id), "g-at-2");
  const searchCall = seen.find((c) => c.url.pathname.includes("/customers/222/googleAds:search"))!;
  assert.equal(searchCall.headers["login-customer-id"], "999");
  assert.equal(searchCall.headers.authorization, "Bearer g-at-2");
  assert.match(searchCall.url.pathname, /^\/v25\//, "varsayılan API sürümü");

  const rep = adsReport(ctx, { accountId: child.id, days: 7 });
  assert.equal(rep.account?.provider, "google");
  assert.equal(rep.totals?.spend, 12.5);
  assert.equal(rep.totals?.costPerConversion, 6.25);
  assert.equal(rep.groups[0].name, "Leblebi al");
  assert.equal(rep.ads.length, 1);
  assert.equal(rep.keywords[0].name, "leblebi satın al");
  assert.equal(rep.keywords[0].extra.matchType, "PHRASE");
});

test("TikTok Ads: auth_code, sayfalı rapor, 30 günlük parçalar", async () => {
  const url = new URL(adsConnectUrl(ctx, "tiktok"));
  assert.equal(url.hostname, "business-api.tiktok.com");
  const r = await finishAdsConnect("tiktok", { auth_code: "ac", state: url.searchParams.get("state")! }, user.id);
  assert.equal(r.accounts[0].currency, "USD");
  const before = seen.filter((c) => c.url.pathname.endsWith("/report/integrated/get/")).length;
  await syncAdAccount(r.accounts[0], 45);
  const reportCalls = seen.filter((c) => c.url.pathname.endsWith("/report/integrated/get/")).slice(before);
  const ranges = new Set(reportCalls.map((c) => `${c.url.searchParams.get("start_date")}..${c.url.searchParams.get("end_date")}`));
  assert.equal(ranges.size, 2, "45 gün iki parçada istenir (30 + 15)");
  const rep = adsReport(ctx, { accountId: r.accounts[0].id, days: 7 });
  assert.equal(rep.totals?.conversions, 3, "iki parçada da aynı gün döndü; aynı satır üstüne yazılır, toplam bir kez sayılır");
  assert.deepEqual(rep.campaigns.map((c) => c.name).sort(), ["Reels", "Spark"]);
  assert.equal(rep.groups[0].parentName, "Reels");
  assert.equal(rep.ads[0].name, "Video 1");
  assert.equal(adsRepo.get(org.id, r.accounts[0].id)?.lastError, null);
});

test("platform listesi: eksik ayarlar raporda görünür", () => {
  const rep = adsReport(ctx, { days: 7 });
  assert.deepEqual(rep.providers.map((p) => p.id), ["meta", "google", "tiktok"]);
  assert.ok(rep.providers.every((p) => p.configured && p.missing.length === 0));
  assert.match(rep.providers[1].redirectUri, /\/api\/ads\/google\/callback$/);
});
