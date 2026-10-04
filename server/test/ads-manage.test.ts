import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-adsm-"));
process.env.DATA_DIR = dir;
process.env.META_APP_ID = "app-1";
process.env.META_APP_SECRET = "secret-1";
process.env.GOOGLE_CLIENT_ID = "gid";
process.env.GOOGLE_CLIENT_SECRET = "gsecret";
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-tok";

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { adsRepo } = await import("../src/core/repos/ads.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { postsRepo } = await import("../src/core/repos/posts.js");
const { adsReport, boostPost, listRecommendations, recommendationAction, setCampaignStatus, syncAdAccount } = await import("../src/services/ads.js");
const { minorUnits } = await import("../src/services/ads-providers.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "reklamyonet@ornek.com", password: "Password123!", name: "R", locale: "tr" });
const org = orgsRepo.create({ name: "Yönetim Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "admin", via: "session", locale: "tr" };
const meta = adsRepo.upsert(org.id, { provider: "meta", externalId: "act_9", name: "Meta", currency: "TRY", token: "m-tok", tokenExpiresAt: null });
const gads = adsRepo.upsert(org.id, { provider: "google", externalId: "333", name: "Google", currency: "TRY", token: "g-tok", tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(), refreshToken: "g-rt", extra: { loginCustomerId: "999" } });
const tt = adsRepo.upsert(org.id, { provider: "tiktok", externalId: "7001", name: "TikTok", currency: "USD", token: "t-tok", tokenExpiresAt: null });
const fb = channelsRepo.upsert({ orgId: org.id, provider: "facebook", externalId: "pg1", name: "Sayfa", accessToken: "p" }).channel;
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig1", name: "IG", accessToken: "p", metadata: { pageId: "pg1" } }).channel;
const x = channelsRepo.upsert({ orgId: org.id, provider: "x", externalId: "x1", name: "X", accessToken: "p" }).channel;

function published(channelId: string, externalId: string) {
  const p = postsRepo.create({ orgId: org.id, kind: "post", content: "Yeni   sezon fındık geldi", status: "published", publishAt: new Date().toISOString(), source: "panel", createdBy: user.id, targets: [{ channelId }] });
  postsRepo.updateTarget(p.targets[0].id, { status: "published", publishedAt: new Date().toISOString(), externalId, externalUrl: null });
  return postsRepo.get(org.id, p.id)!;
}
const fbPost = published(fb.id, "pg1_555");
const igPost = published(ig.id, "1789");
const xPost = published(x.id, "tw1");

const calls: Array<{ method: string; url: URL; body: string; headers: Record<string, string> }> = [];
const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
let failAd = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = String(init?.body ?? "");
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  calls.push({ method, url: u, body, headers });
  const p = u.pathname.replace(/^\/v[\d.]+/, "");
  if (u.hostname === "graph.facebook.com") {
    if (p === "/act_9/insights") return j({ data: [] });
    if (p === "/act_9/campaigns" && method === "GET") return j({ data: [{ id: "c1", name: "Yaz", status: "ACTIVE" }, { id: "c2", name: "Eski", status: "ARCHIVED" }] });
    if (p === "/act_9/campaigns" && method === "POST") return j({ id: "newc" });
    if (p === "/act_9/adsets") return j({ id: "news" });
    if (p === "/act_9/adcreatives") return j({ id: "newcr" });
    if (p === "/act_9/ads") return failAd ? j({ error: { message: "Invalid parameter", code: 100 } }, 400) : j({ id: "newad" });
    if (p === "/c1" && method === "POST") return new URLSearchParams(body).get("access_token") === "m-tok" ? j({ success: true }) : j({}, 401);
    if (p === "/denied" && method === "POST") return j({ error: { message: "(#200) Requires ads_management permission", code: 200 } }, 403);
    if (p === "/newc" && method === "DELETE") return j({ success: true });
  }
  if (u.hostname === "googleads.googleapis.com") {
    assert.equal(headers["login-customer-id"], "999");
    if (p === "/customers/333/campaigns:mutate") return j({ results: [{ resourceName: "customers/333/campaigns/77" }] });
    if (p === "/customers/333/recommendations:apply" || p === "/customers/333/recommendations:dismiss") return j({ results: [{}] });
    if (p === "/customers/333/googleAds:search") {
      const q = JSON.parse(body).query as string;
      if (q.includes("FROM recommendation"))
        return j({
          results: [
            { recommendation: { resourceName: "customers/333/recommendations/r1", type: "CAMPAIGN_BUDGET", campaign: "customers/333/campaigns/77", impact: { baseMetrics: { clicks: 100, costMicros: "50000000" }, potentialMetrics: { clicks: 140, costMicros: "70000000" } } } },
            { recommendation: { resourceName: "customers/333/recommendations/r2", type: "KEYWORD", dismissed: true } },
          ],
        });
      if (q.includes("campaign.status")) return j({ results: [{ campaign: { id: "77", name: "Arama", status: "ENABLED" } }] });
      return j({ results: [] });
    }
  }
  if (u.hostname === "business-api.tiktok.com") {
    if (p.endsWith("/campaign/status/update/")) {
      const b = JSON.parse(body);
      assert.deepEqual(b, { advertiser_id: "7001", campaign_ids: ["tc1"], operation_status: "DISABLE" });
      return j({ code: 0, data: { campaign_ids: ["tc1"] } });
    }
  }
  return j({}, 404);
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

test("para birimi en küçük birim çarpanı", () => {
  assert.equal(minorUnits("TRY"), 100);
  assert.equal(minorUnits("JPY"), 1);
  assert.equal(minorUnits(null), 100);
});

test("kampanya durumu: senkronda okunur, raporda görünür; duraklat/başlat platforma gider; yetki", async () => {
  await syncAdAccount(meta, 3);
  let rep = adsReport(ctx, { accountId: meta.id, days: 7 });
  assert.deepEqual((adsRepo.get(org.id, meta.id)!.extra.campaigns as Record<string, unknown>).c1, { status: "active", name: "Yaz" });

  await assert.rejects(() => setCampaignStatus({ ...ctx, role: "editor" }, meta.id, "c1", "paused"), /yetki|izin|forbidden/i);
  const r = await setCampaignStatus(ctx, meta.id, "c1", "paused");
  assert.equal(r.status, "paused");
  const post = calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/c1"))!;
  assert.equal(new URLSearchParams(post.body).get("status"), "PAUSED");
  assert.equal((adsRepo.get(org.id, meta.id)!.extra.campaigns as Record<string, { status: string }>).c1.status, "paused");

  await assert.rejects(() => setCampaignStatus(ctx, meta.id, "denied", "active"), /yazma izni vermedi/);

  await setCampaignStatus(ctx, gads.id, "77", "paused");
  const mut = calls.find((c) => c.url.pathname.endsWith("/campaigns:mutate"))!;
  assert.deepEqual(JSON.parse(mut.body), { operations: [{ update: { resourceName: "customers/333/campaigns/77", status: "PAUSED" }, updateMask: "status" }] });
  await setCampaignStatus(ctx, tt.id, "tc1", "paused");
  rep = adsReport(ctx, { accountId: gads.id, days: 7 });
  assert.ok(rep);
});

test("Meta öne çıkarma: her şey duraklatılmış; bütçe en küçük birimde; IG için sayfa + medya; uygunsuz gönderi reddedilir", async () => {
  const r = await boostPost(ctx, meta.id, { postId: fbPost.id, targetId: fbPost.targets[0].id, dailyBudget: 150.5, days: 7, countries: ["TR"], ageMin: 25, ageMax: 44 });
  assert.equal(r.status, "paused");
  assert.equal(r.name, "Öne çıkarma · Yeni sezon fındık geldi");
  assert.match(r.manageUrl, /act=9&selected_campaign_ids=newc/);
  const form = (suffix: string) => new URLSearchParams(calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith(suffix)).at(-1)!.body);
  assert.equal(form("/act_9/campaigns").get("status"), "PAUSED");
  assert.equal(form("/act_9/campaigns").get("objective"), "OUTCOME_ENGAGEMENT");
  const adset = form("/act_9/adsets");
  assert.equal(adset.get("status"), "PAUSED");
  assert.equal(adset.get("daily_budget"), "15050");
  assert.deepEqual(JSON.parse(adset.get("targeting")!), { geo_locations: { countries: ["TR"] }, age_min: 25, age_max: 44, publisher_platforms: ["facebook"] });
  assert.equal(form("/act_9/adcreatives").get("object_story_id"), "pg1_555");
  assert.equal(form("/act_9/ads").get("status"), "PAUSED");

  // Rapor: harcaması olmayan öne çıkarma duraklatılmış görünür
  const rep = adsReport(ctx, { accountId: meta.id, days: 7 });
  const c = rep.campaigns.find((x) => x.id === "newc")!;
  assert.equal(c.status, "paused");
  assert.equal(c.spend, null);

  await boostPost(ctx, meta.id, { postId: igPost.id, targetId: igPost.targets[0].id, dailyBudget: 50, days: 3, countries: ["TR", "DE"], ageMin: 18, ageMax: 65 });
  const cr = form("/act_9/adcreatives");
  assert.equal(cr.get("object_id"), "pg1");
  assert.equal(cr.get("instagram_user_id"), "ig1");
  assert.equal(cr.get("source_instagram_media_id"), "1789");

  await assert.rejects(() => boostPost(ctx, meta.id, { postId: xPost.id, targetId: xPost.targets[0].id, dailyBudget: 10, days: 1, countries: ["TR"], ageMin: 18, ageMax: 65 }), /öne çıkarılamaz/);
  await assert.rejects(() => boostPost(ctx, gads.id, { postId: fbPost.id, targetId: fbPost.targets[0].id, dailyBudget: 10, days: 1, countries: ["TR"], ageMin: 18, ageMax: 65 }), /yalnızca Meta/);

  // Reklam adımı başarısızsa kampanya silinir (yarım kalan yapı bırakılmaz)
  failAd = true;
  await assert.rejects(() => boostPost(ctx, meta.id, { postId: fbPost.id, targetId: fbPost.targets[0].id, dailyBudget: 10, days: 1, countries: ["TR"], ageMin: 18, ageMax: 65 }), /reddetti/);
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url.pathname.endsWith("/newc")));
  failAd = false;
});

test("Google Ads önerileri: yoksayılanlar gizlenir, kampanya adı eşlenir; uygula/yoksay yalnızca kendi hesabının önerisi", async () => {
  await syncAdAccount(adsRepo.get(org.id, gads.id)!, 3);
  const list = (await listRecommendations(ctx, gads.id))!;
  assert.equal(list.length, 1);
  assert.equal(list[0].type, "CAMPAIGN_BUDGET");
  assert.equal(list[0].campaignId, "77");
  assert.equal(list[0].campaignName, "Arama");
  assert.deepEqual(list[0].potential, { clicks: 140, spend: 70 });
  await recommendationAction(ctx, gads.id, "customers/333/recommendations/r1", "apply");
  const ap = calls.find((c) => c.url.pathname.endsWith("recommendations:apply"))!;
  assert.deepEqual(JSON.parse(ap.body), { operations: [{ resourceName: "customers/333/recommendations/r1" }] });
  await assert.rejects(() => recommendationAction(ctx, gads.id, "customers/444/recommendations/x", "dismiss"), /reddetti/);
  await assert.rejects(() => listRecommendations(ctx, meta.id), /yalnızca Google/);
});
