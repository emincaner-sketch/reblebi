import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-insights-"));
process.env.DATA_DIR = dir;

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { insightsRepo } = await import("../src/core/repos/insights.js");
const { getProvider } = await import("../src/providers/index.js");
const { collectChannelInsights } = await import("../src/services/insights.js");
const { analyticsReport, addDays, localYmd } = await import("../src/services/analytics-report.js");

const user = usersRepo.create({ email: "ins@ornek.com", password: "Password123!", name: "Ins", locale: "tr" });
const org = orgsRepo.create({ name: "Insights Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-1", name: "IG", accessToken: "tok" }).channel;
const fb = channelsRepo.upsert({ orgId: org.id, provider: "facebook", externalId: "pg-1", name: "Sayfa", accessToken: "tok" }).channel;
const li = channelsRepo.upsert({ orgId: org.id, provider: "linkedin", externalId: "urn:li:organization:42", name: "Şirket", accessToken: "tok", metadata: { type: "organization" } }).channel;
const liPerson = channelsRepo.upsert({ orgId: org.id, provider: "linkedin", externalId: "urn:li:person:7", name: "Kişi", accessToken: "tok", metadata: { type: "person" } }).channel;
const liCalls: Array<{ url: string; version: string }> = [];
const yt = channelsRepo.upsert({ orgId: org.id, provider: "youtube", externalId: "UC-1", name: "Kanal", accessToken: "tok" }).channel;

/* ---------------- Graph API taklidi ---------------- */

const calls: string[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const bad = () => json({ error: { message: "(#100) Invalid metric", type: "OAuthException", code: 100 } }, 400);
const total = (name: string, value: number) => ({ name, period: "day", total_value: { value } });
const breakdown = (name: string, results: Array<[string, number]>) => ({ name, total_value: { breakdowns: [{ dimension_keys: ["x"], results: results.map(([k, v]) => ({ dimension_values: [k], value: v })) }] } });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  const p = u.pathname.replace(/^\/v[\d.]+/, "");
  const metric = u.searchParams.get("metric") ?? "";
  calls.push(`${p}?${metric}${u.searchParams.get("breakdown") ? `&${u.searchParams.get("breakdown")}` : ""}`);
  if (p === "/ig-1/insights") {
    if (metric === "follows_and_unfollows")
      return json({
        data: [
          breakdown("follows_and_unfollows", [
            ["FOLLOWER", 12],
            ["NON_FOLLOWER", 3],
          ]),
        ],
      });
    if (metric === "follower_demographics") {
      const bd = u.searchParams.get("breakdown");
      const map: Record<string, Array<[string, number]>> = {
        country: [
          ["TR", 500],
          ["DE", 20],
        ],
        city: [["İstanbul, Türkiye", 210]],
        age: [
          ["25-34", 300],
          ["18-24", 120],
        ],
        gender: [
          ["F", 320],
          ["M", 190],
        ],
      };
      return json({ data: [breakdown("follower_demographics", map[bd ?? ""] ?? [])] });
    }
    // Birleşik istekte website_clicks desteklenmiyor: tümü reddedilir, tek tek denenir
    if (metric.includes(",")) return bad();
    const vals: Record<string, number> = { reach: 400, views: 900, profile_views: 35, accounts_engaged: 60 };
    return metric in vals ? json({ data: [total(metric, vals[metric])] }) : bad();
  }
  if (p === "/pg-1/insights") {
    if (metric.includes(",")) return bad();
    const vals: Record<string, number> = { page_impressions_unique: 150, page_views_total: 9, page_daily_follows_unique: 4, page_daily_unfollows_unique: 1 };
    return metric in vals ? json({ data: [{ name: metric, period: "day", values: [{ value: vals[metric], end_time: "x" }] }] }) : bad();
  }
  if (p === "/m-reel") return json({ like_count: 40, comments_count: 5, media_product_type: "REELS" });
  if (p === "/m-reel/insights") {
    const names = metric.split(",");
    if (names.includes("profile_visits")) return bad();
    return json({ data: names.map((n) => ({ name: n, period: "lifetime", values: [{ value: n === "ig_reels_avg_watch_time" ? 5400 : 10 }] })) });
  }
  if (u.hostname === "api.linkedin.com") {
    liCalls.push({ url: String(input), version: String(((init?.headers ?? {}) as Record<string, string>)["LinkedIn-Version"] ?? "") });
    if (u.pathname.endsWith("/organizationalEntityShareStatistics")) return json({ elements: [{ totalShareStatistics: { impressionCount: 800, uniqueImpressionsCount: 500, clickCount: 30 } }] });
    if (u.pathname.endsWith("/organizationalEntityFollowerStatistics")) return json({ elements: [{ followerGains: { organicFollowerGain: 4, paidFollowerGain: 1 } }] });
    if (u.pathname.endsWith("/organizationPageStatistics")) return json({ elements: [{ totalPageStatistics: { views: { allPageViews: { pageViews: 12 } } } }] });
  }
  if (u.hostname === "youtubeanalytics.googleapis.com") {
    assert.equal(u.searchParams.get("ids"), "channel==MINE");
    const dims = u.searchParams.get("dimensions");
    if (dims === "country") return json({ columnHeaders: [{ name: "country" }, { name: "views" }], rows: [["TR", 900], ["DE", 60]] });
    if (dims === "ageGroup,gender")
      return json({ columnHeaders: [{ name: "ageGroup" }, { name: "gender" }, { name: "viewerPercentage" }], rows: [["age18-24", "female", 20], ["age18-24", "male", 15], ["age25-34", "male", 65]] });
    // Son 2 gün YouTube henüz veri vermiyor (çalışma alanı saatine göre; gece yarısı UTC farkından etkilenmesin)
    const d = u.searchParams.get("startDate")!;
    if (d >= addDays(localYmd(Date.now(), "Europe/Istanbul"), -2)) return json({ columnHeaders: [], rows: [] });
    return json({ columnHeaders: [{ name: "views" }, { name: "estimatedMinutesWatched" }, { name: "subscribersGained" }, { name: "subscribersLost" }], rows: [[300, 450, 7, 2]] });
  }
  return json({}, 404);
}) as typeof fetch;

test.after(() => {
  globalThis.fetch = realFetch;
});

test("Instagram günlük insights: desteklenmeyen metrik atlanır, takip/takipten çıkma ayrılır", async () => {
  const v = await getProvider("instagram").fetchDailyInsights!(ig, { since: 1, until: 2 });
  assert.deepEqual(v, { reach: 400, views: 900, profileViews: 35, engaged: 60, follows: 12, unfollows: 3 });
  assert.ok(!("websiteClicks" in v), "verilmeyen metrik 0 yazılmaz");
});

test("Instagram reel metrikleri biçime göre istenir", async () => {
  const m = await getProvider("instagram").fetchPostMetrics!(ig, "m-reel");
  assert.equal(m.likes, 40);
  assert.equal(m.saves, 10);
  assert.equal(m.avgWatchMs, 5400);
  assert.ok(!calls.some((c) => c.startsWith("/m-reel/insights") && c.includes("profile_visits")), "reel için profil ziyareti istenmez");
});

test("Facebook sayfa insights eski/yeni metrik adlarıyla", async () => {
  const v = await getProvider("facebook").fetchDailyInsights!(fb, { since: 1, until: 2 });
  assert.deepEqual(v, { reach: 150, profileViews: 9, follows: 4, unfollows: 1 });
});

test("toplama: 7 gün doldurulur, ikinci çalıştırmada tekrar istenmez; kitle kaydedilir", async () => {
  const r1 = await collectChannelInsights(ig);
  assert.equal(r1.days, 7);
  assert.equal(r1.audience, true);
  const before = calls.length;
  const r2 = await collectChannelInsights(ig);
  assert.equal(r2.days, 0);
  assert.equal(calls.length, before, "aynı günler ve taze kitle için istek yok");
  assert.deepEqual(insightsRepo.audience(ig.id)?.data.country, { TR: 500, DE: 20 });
});

test("rapor: insights toplamları ve kitle", () => {
  const r = analyticsReport(org.id, { days: 7, provider: "instagram" });
  assert.equal(r.insights.available, true);
  // Son 7 günün 6'sı aralıkta (bugün henüz tamamlanmadı, 7 gün önce aralık dışında)
  assert.equal(r.insights.kpis.reach.value, 400 * 6);
  assert.equal(r.insights.kpis.follows.value, 12 * 6);
  assert.equal(r.insights.kpis.websiteClicks.value, null);
  assert.equal(r.insights.daily.reach[r.insights.daily.reach.length - 1], null, "bugün için değer yok");
  assert.equal(r.audience?.country[0].key, "TR");
  assert.deepEqual(r.audience?.age.map((a) => a.key), ["18-24", "25-34"], "yaş grupları sıralı");
  const fbOnly = analyticsReport(org.id, { days: 7, provider: "facebook" });
  assert.equal(fbOnly.insights.available, false);
  assert.equal(fbOnly.audience, null);
});

test("YouTube Analytics: izlenme süresi ve abone dengesi; gecikmeli günler işaretlenmez; izleyici kitlesi yüzde", async () => {
  const r = await collectChannelInsights(yt);
  assert.equal(r.days, 5, "son 2 gün boş: veri gelen 5 gün yazılır");
  assert.equal(r.audience, true);
  const again = await collectChannelInsights(yt);
  assert.equal(again.days, 0);
  const rep = analyticsReport(org.id, { days: 7, provider: "youtube" });
  assert.equal(rep.insights.kpis.watchMinutes.value, 450 * 4, "aralıkta 4 gün (bugün ve son 2 gün hariç)");
  assert.equal(rep.insights.kpis.follows.value, 7 * 4);
  assert.equal(rep.audience?.basis, "viewers");
  assert.equal(rep.audience?.percent, true);
  assert.deepEqual(rep.audience?.gender.find((g) => g.key === "M")?.value, 80);
  // Özet görünümde Instagram takipçi sayıları YouTube yüzdeleriyle karışmaz
  const all = analyticsReport(org.id, { days: 7 });
  assert.equal(all.audience?.percent, false);
  assert.equal(all.audience?.country[0].value, 500, "yalnızca sayı tabanlı (Instagram) kitle");
});

test("LinkedIn şirket sayfası: gösterim, erişim, sayfa ziyareti, yeni takipçi; kişisel profil boş", async () => {
  const v = await getProvider("linkedin").fetchDailyInsights!(li, { since: 1_790_000_000, until: 1_790_086_400 });
  assert.deepEqual(v, { views: 800, reach: 500, clicks: 30, follows: 5, profileViews: 12 });
  assert.ok(liCalls[0].url.includes("timeIntervals=(timeRange:(start:1790000000000,end:1790086400000),timeGranularityType:DAY)"), "Rest.li yapısı kodlanmaz");
  assert.ok(liCalls[0].url.includes("organizationalEntity=urn%3Ali%3Aorganization%3A42"), "URN kodlanır");
  assert.equal(liCalls[0].version, "202609");
  assert.deepEqual(await getProvider("linkedin").fetchDailyInsights!(liPerson, { since: 1, until: 2 }), {});
});
