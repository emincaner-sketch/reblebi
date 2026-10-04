import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-prov-"));
process.env.DATA_DIR = dir;
process.env.GOOGLE_CLIENT_ID = "gid";
process.env.GOOGLE_CLIENT_SECRET = "gsecret";

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { inboxRepo } = await import("../src/core/repos/inbox.js");
const { getProvider } = await import("../src/providers/index.js");
const { handleInbound, replyToConversation } = await import("../src/services/dm-engine.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "prov@ornek.com", password: "Password123!", name: "P", locale: "tr" });
const org = orgsRepo.create({ name: "Prov Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };
const bsky = channelsRepo.upsert({ orgId: org.id, provider: "bluesky", externalId: "did:plc:abc", name: "@leblebi.bsky.social", accessToken: "jwt", metadata: { did: "did:plc:abc" } }).channel;
const pin = channelsRepo.upsert({ orgId: org.id, provider: "pinterest", externalId: "pin-user", name: "Pin", accessToken: "ptok" }).channel;
const tw = channelsRepo.upsert({ orgId: org.id, provider: "twitch", externalId: "twitch_leblebi", name: "Twitch", accessToken: "oauth:ttok" }).channel;
const gmb = channelsRepo.upsert({ orgId: org.id, provider: "gmb", externalId: "accounts/1/locations/2", name: "Dükkan", accessToken: "gtok", metadata: { locationId: "accounts/1/locations/2" } }).channel;
const th = channelsRepo.upsert({ orgId: org.id, provider: "threads", externalId: "th-1", name: "Threads", accessToken: "thtok" }).channel;
const yt = channelsRepo.upsert({ orgId: org.id, provider: "youtube", externalId: "UC-own", name: "Kanal", accessToken: "ytok" }).channel;

const calls: Array<{ url: string; method: string; body: string; headers: Record<string, string> }> = [];
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
const recent = new Date(Date.now() - 3600_000).toISOString();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const u = new URL(url);
  calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? ""), headers: (init?.headers ?? {}) as Record<string, string> });
  if (u.hostname === "public.api.bsky.app") {
    if (u.pathname.endsWith("app.bsky.actor.getProfile")) return j({ did: "did:plc:abc", handle: "leblebi.bsky.social", followersCount: 321, followsCount: 12, postsCount: 45 });
    if (u.pathname.endsWith("app.bsky.feed.getPosts")) return j({ posts: [{ uri: u.searchParams.get("uris"), likeCount: 9, repostCount: 2, quoteCount: 1, replyCount: 4 }] });
  }
  if (u.hostname === "api.pinterest.com") {
    if (u.pathname === "/v5/user_account") return j({ follower_count: 800, following_count: 20, pin_count: 150, monthly_views: 12000 });
    if (u.pathname === "/v5/user_account/analytics") {
      const d = u.searchParams.get("start_date");
      return j({ all: { daily_metrics: [{ date: d, data_status: "READY", metrics: { IMPRESSION: 900, SAVE: 30, PIN_CLICK: 40, OUTBOUND_CLICK: 12, ENGAGEMENT: 80 } }] } });
    }
  }
  if (u.hostname === "graph.threads.net" && u.pathname.endsWith("/threads_insights")) {
    const bd = u.searchParams.get("breakdown");
    if (bd) return j({ data: [{ name: "follower_demographics", total_value: { breakdowns: [{ dimension_keys: [bd], results: bd === "country" ? [{ dimension_values: ["TR"], value: 90 }, { dimension_values: ["DE"], value: 10 }] : [] }] } }] });
    return j({
      data: [
        { name: "views", values: [{ value: 120, end_time: "x" }, { value: 30, end_time: "y" }] },
        { name: "clicks", total_value: { breakdowns: [{ dimension_keys: ["link_url"], results: [{ dimension_values: ["https://a.com"], value: 4 }, { dimension_values: ["https://b.com"], value: 3 }] }] } },
      ],
    });
  }
  if (u.hostname === "id.twitch.tv") return j({ client_id: "cid", user_id: "77", login: "leblebi", scopes: ["user:write:chat"] });
  if (u.hostname === "api.twitch.tv") {
    if (u.pathname.endsWith("/users")) return j({ data: [{ id: u.searchParams.get("login") === "leblebi" ? "77" : "88", login: u.searchParams.get("login") }] });
    if (u.pathname.endsWith("/chat/messages")) {
      const b = JSON.parse(String(init?.body ?? "{}"));
      if (b.message.includes("yasak")) return j({ data: [{ message_id: "", is_sent: false, drop_reason: { code: "msg_rejected", message: "AutoMod engelledi" } }] });
      return j({ data: [{ message_id: "msg-1", is_sent: true }] });
    }
    if (u.pathname.endsWith("/channels/followers")) return j({ total: 4321 });
    if (u.pathname.endsWith("/videos")) return j({ data: [{ view_count: 100 }, { view_count: 250 }] });
  }
  if (u.hostname === "businessprofileperformance.googleapis.com")
    return j({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS", timeSeries: { datedValues: [{ value: "120" }] } },
            { dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", timeSeries: { datedValues: [{ value: "30" }] } },
            { dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [{ value: "7" }] } },
            { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{}] } },
            { dailyMetric: "BUSINESS_DIRECTION_REQUESTS", timeSeries: { datedValues: [{ value: "5" }] } },
          ],
        },
      ],
    });
  if (u.hostname === "mybusiness.googleapis.com") {
    if (init?.method === "PUT") return j({ comment: "ok" });
    if (u.searchParams.get("pageSize") === "1") return j({ averageRating: 4.6, totalReviewCount: 58 });
    return j({
      reviews: [
        { reviewId: "rv1", name: "accounts/1/locations/2/reviews/rv1", reviewer: { displayName: "Ayşe K." }, starRating: "FOUR", comment: "Leblebiler taze ama kargo geç geldi", createTime: recent, updateTime: recent },
        { reviewId: "rv0", name: "accounts/1/locations/2/reviews/rv0", reviewer: { displayName: "Eski" }, starRating: "FIVE", comment: "Eski", createTime: "2020-01-01T00:00:00Z", updateTime: "2020-01-01T00:00:00Z" },
      ],
    });
  }
  if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/commentThreads")) {
    assert.equal(u.searchParams.get("allThreadsRelatedToChannelId"), "UC-own");
    return j({
      items: [
        { id: "t1", snippet: { videoId: "v1", topLevelComment: { id: "yc1", snippet: { authorDisplayName: "İzleyici", authorChannelId: { value: "UC-fan" }, textOriginal: "Tarifin devamı gelecek mi?", publishedAt: recent } } } },
        { id: "t2", snippet: { videoId: "v1", topLevelComment: { id: "yc2", snippet: { authorDisplayName: "Kanal", authorChannelId: { value: "UC-own" }, textOriginal: "Teşekkürler", publishedAt: recent } } } },
      ],
    });
  }
  if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/comments")) return j({ id: "reply-1" });
  return j({}, 404);
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const range = { since: Math.floor(Date.now() / 1000) - 86400 * 2, until: Math.floor(Date.now() / 1000) - 86400 };

test("Bluesky: herkese açık profil ve gönderi metrikleri (jeton gönderilmez)", async () => {
  const m = await getProvider("bluesky").fetchMetrics!(bsky);
  assert.deepEqual(m, { followers: 321, following: 12, posts: 45 });
  const pm = await getProvider("bluesky").fetchPostMetrics!(bsky, "at://did:plc:abc/app.bsky.feed.post/1");
  assert.deepEqual(pm, { likes: 9, comments: 4, shares: 3 });
  const c = calls.find((x) => x.url.includes("public.api.bsky.app"))!;
  assert.equal(c.headers.Authorization, undefined);
});

test("Pinterest: hesap, günlük analitik eşlemesi", async () => {
  assert.deepEqual(await getProvider("pinterest").fetchMetrics!(pin), { followers: 800, following: 20, posts: 150, monthlyViews: 12000 });
  assert.deepEqual(await getProvider("pinterest").fetchDailyInsights!(pin, range), { views: 900, saves: 30, clicks: 40, websiteClicks: 12, engaged: 80 });
});

test("Twitch: doğrulamadan istemci kimliği, takipçi ve video izlenmesi", async () => {
  const m = await getProvider("twitch").fetchMetrics!(tw);
  assert.deepEqual(m, { followers: 4321, posts: 2, videoViews: 350 });
  const helix = calls.find((x) => x.url.includes("api.twitch.tv"))!;
  assert.equal(helix.headers["Client-Id"], "cid");
  assert.equal(helix.headers.Authorization, "Bearer ttok", "oauth: öneki atılır");
});

test("Twitch: paylaşım gerçekten sohbete gider; reddedilen mesaj hata olur (sahte başarı yok)", async () => {
  const p = getProvider("twitch");
  const r = await p.publish(tw, { kind: "post", text: "Yayın başladı!", media: [], settings: {} });
  assert.equal(r.externalId, "msg-1");
  const post = calls.filter((x) => x.url.includes("/chat/messages")).at(-1)!;
  assert.equal(post.method, "POST");
  assert.deepEqual(JSON.parse(post.body), { broadcaster_id: "77", sender_id: "77", message: "Yayın başladı!" });
  await assert.rejects(() => p.publish(tw, { kind: "post", text: "yasak kelime", media: [], settings: {} }), /AutoMod engelledi/);
  await assert.rejects(() => p.publish(tw, { kind: "post", text: "x".repeat(501), media: [], settings: {} }), /500 karakter/);
  const conn = await p.connectWithForm!({ oauthToken: "oauth:abc", channelName: "baska" });
  assert.equal(conn[0].metadata.broadcasterId, "88");
  assert.equal(conn[0].metadata.senderId, "77");
});

test("Threads hesap insights: günlük görüntülenme toplanır, tıklama kırılımdan, kitle ülke kırılımı; 2024 öncesi istenmez", async () => {
  const p = getProvider("threads");
  assert.deepEqual(await p.fetchDailyInsights!(th, range), { views: 150, clicks: 7 });
  const req = calls.filter((x) => x.url.includes("threads_insights")).at(-1)!;
  assert.match(req.url, /metric=views%2Cclicks|metric=views,clicks/);
  const a = await p.fetchAudience!(th);
  assert.deepEqual(a.country, { TR: 90, DE: 10 });
  assert.equal(a.age, undefined, "boş kırılım yazılmaz");
  const before = calls.length;
  assert.deepEqual(await p.fetchDailyInsights!(th, { since: 1700000000, until: 1700086400 }), {});
  assert.equal(calls.length, before, "eski tarih için istek atılmaz");
});

test("Google Business: OAuth modu, performans (tekrarlı metrik parametreleri), değerlendirme özeti", async () => {
  assert.equal(getProvider("gmb").connectMode, "oauth");
  const v = await getProvider("gmb").fetchDailyInsights!(gmb, range);
  assert.deepEqual(v, { views: 150, websiteClicks: 7, calls: 0, directions: 5 });
  const perf = calls.find((x) => x.url.includes("businessprofileperformance"))!;
  assert.match(perf.url, /\/v1\/locations\/2:fetchMultiDailyMetricsTimeSeries\?/);
  assert.equal((perf.url.match(/dailyMetrics=/g) ?? []).length, 7);
  assert.deepEqual(await getProvider("gmb").fetchMetrics!(gmb), { reviews: 58, rating: 4.6 });
});

test("Google Business değerlendirmeleri: 30 dk kısıtlı yoklama, gelen kutusu konusu, yanıt", async () => {
  const p = getProvider("gmb");
  const r1 = await p.pollInbound!(gmb, null);
  assert.equal(r1.events.length, 1, "ilk çalıştırmada eski değerlendirme gelmez");
  assert.equal(r1.events[0].kind, "review");
  assert.match(r1.events[0].text, /^★★★★☆ Leblebiler taze/);
  const r2 = await p.pollInbound!(gmb, r1.cursor);
  assert.equal(r2.events.length, 0);
  assert.equal(r2.cursor, r1.cursor, "30 dakika dolmadan istek atılmaz");

  for (const ev of r1.events) await handleInbound("gmb", ev, gmb.id);
  const conv = inboxRepo.findConversation(gmb.id, "r:rv1")!;
  assert.equal(conv.metadata.kind, "review");
  assert.equal(conv.needsAttention, 1);
  const msg = await replyToConversation(ctx, conv.id, "Geri bildiriminiz için teşekkürler!");
  assert.equal(msg.status, "sent");
  const put = calls.find((x) => x.method === "PUT")!;
  assert.match(put.url, /v4\/accounts\/1\/locations\/2\/reviews\/rv1\/reply$/);
  assert.match(put.body, /teşekkürler/);
});

test("YouTube yorumları: kendi yorumu atlanır, 10 dk kısıtlı, yanıt yoruma gider", async () => {
  const p = getProvider("youtube");
  const r = await p.pollInbound!(yt, null);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].conversationExternalId, "c:v1:UC-fan");
  const again = await p.pollInbound!(yt, r.cursor);
  assert.equal(again.events.length, 0);
  for (const ev of r.events) await handleInbound("youtube", ev, yt.id);
  const conv = inboxRepo.findConversation(yt.id, "c:v1:UC-fan")!;
  const msg = await replyToConversation(ctx, conv.id, "Evet, haftaya!");
  assert.equal(msg.status, "sent");
  const post = calls.find((x) => x.url.includes("/youtube/v3/comments") && x.method === "POST")!;
  assert.match(post.body, /"parentId":"yc1"/);
});

test("API'ye bağlanmamış ağlar sahte başarı dönmez: bağlantı kapalı, paylaşım açık hata verir", async () => {
  for (const id of ["dribbble", "kick", "lemmy", "nostr", "warpcast"] as const) {
    const p = getProvider(id);
    assert.equal(p.isConfigured(), false, id);
    await assert.rejects(() => p.publish(tw, { kind: "post", text: "Merhaba", media: [], settings: {} }), /henüz desteklenmiyor/, id);
  }
});
