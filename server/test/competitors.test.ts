import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-competitors-"));
process.env.DATA_DIR = dir;

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { competitorsRepo } = await import("../src/core/repos/competitors.js");
const { addCompetitor, competitorReport, snapshotCompetitors, summarize } = await import("../src/services/competitors.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "rakip@ornek.com", password: "Password123!", name: "Rakip", locale: "tr" });
const org = orgsRepo.create({ name: "Rakip Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const noIg = orgsRepo.create({ name: "IG yok", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-own", name: "Benim", username: "benimhesap", accessToken: "tok" });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };

let followers = 1000;
const calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = new URL(String(input));
  const fields = u.searchParams.get("fields") ?? "";
  calls.push(fields);
  const m = /business_discovery\.username\(([^)]+)\)/.exec(fields);
  if (u.pathname.endsWith("/ig-own") && m) {
    if (m[1] === "kisiselhesap") return new Response(JSON.stringify({ error: { message: "Invalid user id", code: 110 } }), { status: 400 });
    const now = Date.now();
    return new Response(
      JSON.stringify({
        business_discovery: {
          username: m[1],
          name: "Rakip Kuruyemiş",
          followers_count: followers,
          media_count: 120,
          media: {
            data: [
              { id: "1", caption: "Yeni ürün", like_count: 100, comments_count: 10, timestamp: new Date(now - 2 * 86_400_000).toISOString(), media_type: "IMAGE", permalink: "https://instagram.com/p/1" },
              { id: "2", caption: "Kampanya", like_count: 50, comments_count: 4, timestamp: new Date(now - 10 * 86_400_000).toISOString(), media_type: "VIDEO" },
              { id: "3", caption: "Eski", comments_count: 2, timestamp: new Date(now - 60 * 86_400_000).toISOString(), media_type: "IMAGE" },
            ],
          },
        },
      }),
      { status: 200 },
    );
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

test("özet: 30 günde gönderi, beğenisi gizli gönderi ortalamaya girmez, etkileşim oranı", () => {
  const s = summarize({
    followers: 1000,
    media: [
      { id: "1", caption: "", likes: 100, comments: 10, timestamp: new Date().toISOString(), type: "IMAGE", permalink: null },
      { id: "2", caption: "", likes: null, comments: 2, timestamp: new Date(Date.now() - 40 * 86_400_000).toISOString(), type: "IMAGE", permalink: null },
    ],
  });
  assert.equal(s.postsLast30, 1);
  assert.equal(s.avgLikes, 100);
  assert.equal(s.avgComments, 6);
  assert.equal(s.engagementRate, 10.6);
});

test("ekleme: kullanıcı adı/URL temizlenir, doğrulanır, yinelenen ve kendi hesap reddedilir", async () => {
  const c = await addCompetitor(ctx, "https://www.instagram.com/RakipKuruyemis/?hl=tr");
  assert.equal(c.username, "rakipkuruyemis");
  assert.equal(c.name, "Rakip Kuruyemiş");
  assert.equal(c.recent.length, 3);
  await assert.rejects(() => addCompetitor(ctx, "@rakipkuruyemis"), /zaten takip/);
  await assert.rejects(() => addCompetitor(ctx, "benimhesap"), /zaten bu çalışma alanına bağlı/);
  await assert.rejects(() => addCompetitor(ctx, "kisiselhesap"), /bulunamadı/);
  await assert.rejects(() => addCompetitor(ctx, "geçersiz ad!"), /Geçerli bir Instagram/);
  await assert.rejects(() => addCompetitor({ ...ctx, orgId: noIg.id }, "baska"), /Instagram işletme hesabı bağla/);
  assert.equal(competitorsRepo.list(org.id).length, 1, "başarısız eklemeler kayıt açmaz");
});

test("günlük anlık görüntü: aynı gün tekrar çekilmez; rapor değişimi hesaplar", async () => {
  const before = calls.length;
  assert.equal(await snapshotCompetitors(), 0, "bugün zaten eklemede çekildi");
  assert.equal(calls.length, before);

  // Dünkü değeri geriye yaz, bugün takipçi arttı
  const c = competitorsRepo.list(org.id)[0];
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  competitorsRepo.upsertSnapshot(c.id, yesterday, { followers: 900, mediaCount: 118, metrics: {} });
  followers = 1100;
  const tomorrow = Date.now() + 86_400_000;
  assert.equal(await snapshotCompetitors(tomorrow), 1);

  const r = competitorReport(ctx, 30);
  const item = r.items[0];
  assert.equal(item.followers, 1000, "rapor bugüne kadar (yarınki anlık görüntü aralık dışında)");
  assert.equal(item.followersDelta, 100);
  assert.equal(item.postsLast30, 2);
  assert.equal(item.topPosts[0].id, "1");
  assert.equal(r.self.length, 1);
  assert.equal(r.self[0].username, "benimhesap");
  assert.equal(r.canTrack, true);
});

test("YouTube ve Bluesky rakipleri: tanıtıcı temizlenir, kaynak kanal gerekir, ağ başına ayrı kayıt", async () => {
  const { addCompetitor: add, normalizeHandle } = await import("../src/services/competitors.js");
  assert.equal(normalizeHandle("youtube", "https://www.youtube.com/@RakipTV/videos"), "rakiptv");
  assert.equal(normalizeHandle("youtube", "https://youtube.com/channel/UCabcdefghijklmnopqrstuv"), "UCabcdefghijklmnopqrstuv");
  assert.equal(normalizeHandle("bluesky", "https://bsky.app/profile/Rakip.bsky.social"), "rakip.bsky.social");
  assert.equal(normalizeHandle("bluesky", "rakip"), null);

  await assert.rejects(() => add(ctx, "@rakiptv", "youtube"), /YouTube kanalı bağla/);
  channelsRepo.upsert({ orgId: org.id, provider: "youtube", externalId: "UC-own", name: "Benim TV", username: "benimtv", accessToken: "ytok" });

  const prev = globalThis.fetch;
  const now = Date.now();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.pathname.endsWith("/youtube/v3/channels")) {
      if (u.searchParams.get("forHandle") === "@yokboyle") return j({ items: [] });
      return j({ items: [{ id: "UCrakip", snippet: { title: "Rakip TV", customUrl: "@rakiptv" }, statistics: { subscriberCount: "5000", videoCount: "80" }, contentDetails: { relatedPlaylists: { uploads: "UUrakip" } } }] });
    }
    if (u.pathname.endsWith("/playlistItems")) return j({ items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: { videoId: "v2" } }] });
    if (u.pathname.endsWith("/videos")) {
      assert.equal(u.searchParams.get("id"), "v1,v2");
      return j({
        items: [
          { id: "v1", snippet: { title: "Tarif", publishedAt: new Date(now - 86_400_000).toISOString() }, statistics: { viewCount: "1000", likeCount: "80", commentCount: "20" } },
          { id: "v2", snippet: { title: "Vlog", publishedAt: new Date(now - 5 * 86_400_000).toISOString() }, statistics: { viewCount: "3000", commentCount: "10" } },
        ],
      });
    }
    if (u.hostname === "public.api.bsky.app") {
      if (u.pathname.endsWith("getProfile")) return j({ did: "did:plc:x", handle: "rakip.bsky.social", displayName: "Rakip", followersCount: 400, postsCount: 30 });
      if (u.pathname.endsWith("getAuthorFeed"))
        return j({ feed: [{ post: { uri: "at://did:plc:x/app.bsky.feed.post/3k", record: { text: "Merhaba", createdAt: new Date(now - 86_400_000).toISOString() }, likeCount: 12, replyCount: 3, repostCount: 4, quoteCount: 1 } }] });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    const yt = await add(ctx, "https://www.youtube.com/@RakipTV", "youtube");
    assert.equal(yt.provider, "youtube");
    assert.equal(yt.username, "rakiptv");
    assert.equal(yt.recent[0].views, 1000);
    await assert.rejects(() => add(ctx, "@benimtv", "youtube"), /zaten bu çalışma alanına bağlı/);
    await assert.rejects(() => add(ctx, "@yokboyle", "youtube"), /bulunamadı/);

    const bs = await add(ctx, "@rakip.bsky.social", "bluesky");
    assert.equal(bs.recent[0].shares, 5);
    assert.equal(bs.recent[0].permalink, "https://bsky.app/profile/did:plc:x/post/3k");
    // Aynı ad başka ağda ayrı rakip sayılır
    assert.equal(competitorsRepo.findByUsername(org.id, "rakiptv", "instagram"), null);

    const r = competitorReport(ctx, 30);
    const ytItem = r.items.find((i) => i.provider === "youtube")!;
    assert.equal(ytItem.followers, 5000);
    assert.equal(ytItem.avgViews, 2000);
    assert.equal(ytItem.avgLikes, 80, "beğenisi gizli video ortalamaya girmez");
    assert.equal(ytItem.engagementRate, 1.9);
    assert.equal(ytItem.topPosts[0].id, "v2", "YouTube'da en çok izlenen önde");
    assert.equal(r.items.find((i) => i.provider === "bluesky")!.engagementRate, 3.75);
    assert.deepEqual(r.tracking, { instagram: true, facebook: false, youtube: true, twitch: false, bluesky: true });
    assert.ok(r.self.some((s) => s.provider === "youtube"));
  } finally {
    globalThis.fetch = prev;
  }
});

test("Facebook Sayfası ve Twitch kanalı rakipleri: adres temizlenir, gönderi okunamazsa yalnızca takipçi, Twitch'te izlenme sıralaması", async () => {
  const { addCompetitor: add, normalizeHandle } = await import("../src/services/competitors.js");
  assert.equal(normalizeHandle("facebook", "https://www.facebook.com/RakipKuruyemis/?ref=x"), "rakipkuruyemis");
  assert.equal(normalizeHandle("facebook", "https://facebook.com/profile.php?id=100012345678"), "100012345678");
  assert.equal(normalizeHandle("twitch", "https://www.twitch.tv/RakipYayin"), "rakipyayin");
  assert.equal(normalizeHandle("twitch", "ab"), null);

  await assert.rejects(() => add(ctx, "rakipkuruyemis", "facebook"), /Facebook Sayfası bağla/);
  await assert.rejects(() => add(ctx, "rakipyayin", "twitch"), /Twitch kanalı bağla/);
  channelsRepo.upsert({ orgId: org.id, provider: "facebook", externalId: "pg-own", name: "Benim Sayfa", username: "benimsayfa", accessToken: "pgtok" });
  channelsRepo.upsert({ orgId: org.id, provider: "twitch", externalId: "twitch_benimyayin", name: "Twitch (benimyayin)", username: "benimyayin", accessToken: "oauth:twtok" });

  const prev = globalThis.fetch;
  const now = Date.now();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (u.hostname === "graph.facebook.com") {
      if (u.pathname.endsWith("/rakipkuruyemis")) return j({ id: "555", username: "RakipKuruyemis", name: "Rakip Kuruyemiş", fan_count: 9000, followers_count: 12000 });
      if (u.pathname.endsWith("/sessizsayfa")) return j({ id: "777", name: "Sessiz", followers_count: 300 });
      if (u.pathname.endsWith("/555/posts"))
        return j({
          data: [
            { id: "555_1", message: "Kampanya", created_time: new Date(now - 86_400_000).toISOString(), reactions: { summary: { total_count: 120 } }, comments: { summary: { total_count: 30 } }, shares: { count: 6 } },
            { id: "555_2", message: "Tarif", created_time: new Date(now - 3 * 86_400_000).toISOString(), reactions: { summary: { total_count: 60 } }, comments: { summary: { total_count: 10 } } },
          ],
        });
      if (u.pathname.endsWith("/777/posts")) return j({ error: { message: "Requires Page Public Content Access", code: 10 } }, 400);
    }
    if (u.hostname === "id.twitch.tv") return j({ client_id: "cid", user_id: "1", login: "benimyayin", scopes: ["user:write:chat"] });
    if (u.hostname === "api.twitch.tv") {
      if (u.pathname.endsWith("/users")) return u.searchParams.get("login") === "rakipyayin" ? j({ data: [{ id: "42", login: "RakipYayin", display_name: "RakipYayin" }] }) : j({ data: [] });
      if (u.pathname.endsWith("/channels/followers")) return j({ total: 2500 });
      if (u.pathname.endsWith("/videos"))
        return j({
          data: [
            { id: "v1", title: "Kavurma yayını", view_count: 300, created_at: new Date(now - 86_400_000).toISOString(), url: "https://www.twitch.tv/videos/v1" },
            { id: "v2", title: "Soru cevap", view_count: 900, created_at: new Date(now - 2 * 86_400_000).toISOString(), url: "https://www.twitch.tv/videos/v2" },
          ],
        });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    const fb = await add(ctx, "https://www.facebook.com/RakipKuruyemis", "facebook");
    assert.equal(fb.username, "rakipkuruyemis");
    assert.equal(fb.recent.length, 2);
    assert.equal(fb.recent[0].shares, 6);
    const quiet = await add(ctx, "sessizsayfa", "facebook");
    assert.equal(quiet.recent.length, 0, "gönderi izni yoksa yine de eklenir");
    await assert.rejects(() => add(ctx, "benimsayfa", "facebook"), /zaten bu çalışma alanına bağlı/);

    const tw = await add(ctx, "twitch.tv/RakipYayin", "twitch");
    assert.equal(tw.username, "rakipyayin");
    await assert.rejects(() => add(ctx, "yokboylebirkanal", "twitch"), /bulunamadı/);

    const r = competitorReport(ctx, 30);
    const fbItem = r.items.find((i) => i.id === fb.id)!;
    assert.equal(fbItem.followers, 12000);
    assert.equal(fbItem.avgLikes, 90);
    assert.equal(fbItem.engagementRate, 0.92);
    const twItem = r.items.find((i) => i.id === tw.id)!;
    assert.equal(twItem.followers, 2500);
    assert.equal(twItem.avgViews, 600);
    assert.equal(twItem.engagementRate, null, "Twitch'te beğeni/yorum yok");
    assert.equal(twItem.topPosts[0].id, "v2");
    assert.equal(r.tracking.facebook, true);
    assert.equal(r.tracking.twitch, true);
  } finally {
    globalThis.fetch = prev;
  }
});
