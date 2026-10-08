import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-listening-"));
process.env.DATA_DIR = dir;
delete process.env.REDDIT_CLIENT_ID;
delete process.env.BRAVE_SEARCH_API_KEY;

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { listeningRepo } = await import("../src/core/repos/listening.js");
const { notificationsRepo } = await import("../src/core/repos/content.js");
const { lexiconSentiment } = await import("../src/services/sentiment.js");
const { createQuery, listQueries, listeningReport, listMentions, markAllSeen, mentionsCsv, patchMention, runQuery, runDueListening, updateQuery, MAX_QUERIES } = await import("../src/services/listening.js");
const { matches, normalizeUrl, parseFeed, resetSourceState } = await import("../src/services/listening-sources.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "dinle@ornek.com", password: "Password123!", name: "Dinle", locale: "tr" });
const org = orgsRepo.create({ name: "Dinleme Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
channelsRepo.upsert({ orgId: org.id, provider: "bluesky", externalId: "did:plc:own", name: "Biz", username: "leblebici.bsky.social", accessToken: "tok" });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };
const viewer: Ctx = { ...ctx, role: "viewer" };

const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
const ymdh = (minAgo: number) => iso(minAgo).replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const calls: string[] = [];
let gdeltBody: unknown = {
  articles: [
    { url: "https://haber.example/leblebi-fiyatlari", title: "Leblebi fiyatları arttı", seendate: ymdh(90), domain: "haber.example", language: "Turkish" },
    { url: "https://gazete.example/corum", title: "Çorum leblebisi tescillendi, harika haber", seendate: ymdh(300), domain: "gazete.example", language: "Turkish" },
  ],
};
let feedXml: string | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = new URL(String(input));
  calls.push(`${u.hostname}${u.pathname}?${u.searchParams.toString()}`);
  if (u.hostname === "api.gdeltproject.org") return new Response(typeof gdeltBody === "string" ? gdeltBody : JSON.stringify(gdeltBody), { status: 200 });
  if (u.hostname === "api.bsky.app") {
    return new Response(
      JSON.stringify({
        posts: [
          { uri: "at://did:plc:a/app.bsky.feed.post/1", author: { handle: "ayse.bsky.social" }, record: { text: "Leblebi Kuruyemiş siparişim gelmedi, berbat", createdAt: iso(30) }, likeCount: 3, replyCount: 1 },
          { uri: "at://did:plc:b/app.bsky.feed.post/2", author: { handle: "mehmet.bsky.social" }, record: { text: "Leblebi Kuruyemiş çok lezzetli, tavsiye ederim", createdAt: iso(60) }, likeCount: 10 },
          { uri: "at://did:plc:own/app.bsky.feed.post/3", author: { handle: "leblebici.bsky.social" }, record: { text: "Leblebi Kuruyemiş kampanya başladı", createdAt: iso(20) } },
          { uri: "at://did:plc:c/app.bsky.feed.post/4", author: { handle: "spam.bsky.social" }, record: { text: "Leblebi Kuruyemiş bedava çekiliş", createdAt: iso(10) } },
        ],
      }),
      { status: 200 },
    );
  }
  if (u.hostname === "www.hurriyet.com.tr" && u.pathname === "/rss/anasayfa" && feedXml) return new Response(feedXml, { status: 200 });
  if (u.hostname === "hn.algolia.com") return new Response(JSON.stringify({ hits: [] }), { status: 200 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

test("sözlük: Türkçe ekler, olumsuzluk ve -sız eki", () => {
  assert.equal(lexiconSentiment("Ürünler çok lezzetliydi, teşekkürler"), "positive");
  assert.equal(lexiconSentiment("Siparişim gelmedi, rezalet"), "negative");
  assert.equal(lexiconSentiment("Hiç memnun değilim"), "negative");
  assert.equal(lexiconSentiment("Kargo sorunsuz geldi"), "positive");
  assert.equal(lexiconSentiment("This is not good"), "negative");
  assert.equal(lexiconSentiment("Great snacks, loved them"), "positive");
  assert.equal(lexiconSentiment("Yarın Çorum'da festival var"), "neutral");
  assert.equal(lexiconSentiment("Kabak tatlısı tarifi"), "neutral");
});

test("sorgu: doğrulama, yineleme temizliği, yetki ve üst sınır", async () => {
  await assert.rejects(() => createQuery(ctx, { name: "x", terms: ["ab"] }), (e: Error) => e.name === "ZodError");
  await assert.rejects(() => createQuery(viewer, { name: "x", terms: ["leblebi"] }), /yetkin yok/);
  const q = await createQuery(ctx, { name: "Marka", terms: ["Leblebi Kuruyemiş", "leblebi kuruyemiş", "Çorum leblebisi"], excludes: ["çekiliş"], sources: ["news", "bluesky", "hn", "reddit"] });
  assert.deepEqual(q.terms, ["Leblebi Kuruyemiş", "Çorum leblebisi"]);
  assert.equal(q.lang, "tr");
  // createQuery ilk taramayı arka planda başlatır; bitmesini bekle
  for (let i = 0; i < 50 && !listeningRepo.get(org.id, q.id)!.lastRunAt; i++) await new Promise((r) => setTimeout(r, 20));
  const l = listQueries(ctx);
  const reddit = l.sources.find((s) => s.id === "reddit")!;
  assert.equal(reddit.available, false);
  assert.equal(reddit.needs, "platform");
  assert.equal(l.sources.find((s) => s.id === "youtube")!.needs, "channel");
  for (let i = 1; i < MAX_QUERIES; i++) await createQuery(ctx, { name: `Q${i}`, terms: [`terim${i}`], sources: ["hn"] });
  await assert.rejects(() => createQuery(ctx, { name: "fazla", terms: ["fazlası"] }), /En fazla 5/);
});

test("tarama: haber + Bluesky, hariç tutulan ve kendi hesap elenir, ikinci taramada yineleme yok", async () => {
  const q = listeningRepo.list(org.id).find((x) => x.name === "Marka")!;
  const items = listMentions(ctx, { query: q.id, limit: 50 }).items;
  // GDELT 2 + Bluesky 2 (kendi hesap ve "çekiliş" elendi)
  assert.equal(items.length, 4);
  assert.ok(!items.some((m) => m.author === "@leblebici.bsky.social"));
  assert.ok(!items.some((m) => (m.snippet ?? "").includes("çekiliş")));
  const neg = items.find((m) => m.externalId === "at://did:plc:a/app.bsky.feed.post/1")!;
  assert.equal(neg.sentiment, "negative");
  assert.equal(neg.url, "https://bsky.app/profile/ayse.bsky.social/post/1");
  assert.equal(neg.engagement, 4);
  assert.equal(items.find((m) => m.source === "news" && m.site === "gazete.example")!.sentiment, "positive");
  // Reddit anahtarı yok: atlandı, kaynak durumunda hata değil
  assert.equal(listeningRepo.get(org.id, q.id)!.state.reddit, undefined);
  // GDELT sorgusu: tırnaklı terimler OR, hariç tutulan, dil
  const g = decodeURIComponent(calls.find((c) => c.startsWith("api.gdeltproject.org"))!.replace(/\+/g, " "));
  assert.match(g, /\("Leblebi Kuruyemiş" OR "Çorum leblebisi"\) -"çekiliş" sourcelang:turkish/);

  // Aralık dolmadan zamanlayıcı yeniden çekmez; dolunca çeker ve aynı kayıtları eklemez
  calls.length = 0;
  resetSourceState();
  const r1 = await runQuery(listeningRepo.get(org.id, q.id)!, { now: now + 5 * 60_000 });
  assert.equal(r1.added, 0);
  assert.equal(calls.length, 0);
  const r2 = await runQuery(listeningRepo.get(org.id, q.id)!, { now: now + 2 * 3_600_000 });
  assert.equal(r2.added, 0);
  assert.ok(calls.some((c) => c.startsWith("api.gdeltproject.org")));
  assert.equal(listMentions(ctx, { query: q.id }).total, 4);
});

test("kaynak hatası diğerlerini durdurmaz; zamanlayıcı bildirim üretir", async () => {
  const q = listeningRepo.list(org.id).find((x) => x.name === "Marka")!;
  gdeltBody = "The specified phrase is too short.";
  listeningRepo.resetState(q.id);
  const before = notificationsRepo.list(org.id, user.id, 50).length;
  resetSourceState();
  // Yeni bir Bluesky gönderisi: önceki kayıtları sil ki yeni sayılsın
  for (const m of listMentions(ctx, { query: q.id, source: "bluesky" }).items) patchMention(ctx, m.id, { status: "hidden" });
  const added = await runDueListening(now + 3 * 3_600_000);
  const st = listeningRepo.get(org.id, q.id)!.state;
  assert.match(st.news!.error!, /too short/);
  assert.equal(st.bluesky!.error, null);
  assert.equal(added, 0);
  assert.equal(notificationsRepo.list(org.id, user.id, 50).length, before);
  gdeltBody = { articles: [{ url: "https://yeni.example/x", title: "Leblebi Kuruyemiş yeni şube açtı", seendate: ymdh(5), domain: "yeni.example" }] };
  listeningRepo.resetState(q.id);
  resetSourceState();
  const added2 = await runDueListening(now + 4 * 3_600_000);
  assert.equal(added2, 1);
  const n = notificationsRepo.list(org.id, user.id, 50);
  assert.equal(n.length, before + 1);
  assert.match(n[0].title, /1 yeni bahsetme: Marka/);
  assert.equal(n[0].link, `/app/analytics/mentions?query=${q.id}`);
});

test("liste, durum, rapor, CSV ve terim değişince imleç sıfırlanır", async () => {
  const q = listeningRepo.list(org.id).find((x) => x.name === "Marka")!;
  const all = listMentions(ctx, { query: q.id });
  assert.equal(all.total, 3); // 2 Bluesky gizlendi
  assert.equal(listMentions(ctx, { query: q.id, view: "hidden" }).total, 2);
  const first = all.items[0];
  const starred = patchMention(ctx, first.id, { starred: true, sentiment: "negative" });
  assert.equal(starred.starred, true);
  assert.equal(starred.sentimentBy, "user");
  assert.equal(listMentions(ctx, { view: "starred" }).total, 1);
  assert.equal(listMentions(ctx, { q: "şube" }).total, 1);
  assert.ok(markAllSeen(ctx, q.id) >= 3);
  assert.equal(listQueries(ctx).items.find((x) => x.id === q.id)!.unread, 0);

  const rep = listeningReport(ctx, { days: 30 });
  assert.equal(rep.totals.mentions, 3);
  assert.equal(rep.dates.length, 30);
  assert.equal(rep.bySourceDaily.news.reduce((a: number, b: number) => a + b, 0), 3);
  assert.equal(rep.shareOfVoice.find((s) => s.id === q.id)!.count, 3);
  assert.equal(rep.shareOfVoice.length, MAX_QUERIES);
  assert.ok(rep.sites.some((s) => s.key === "haber.example"));

  const csv = mentionsCsv(ctx, { query: q.id });
  assert.ok(csv.startsWith("﻿published_at,query,source"));
  assert.equal(csv.trim().split("\r\n").length, 4);

  await assert.rejects(async () => patchMention(viewer, first.id, { status: "seen" }), /yetkin yok/);
  listeningRepo.saveState(q.id, { news: { lastRun: new Date().toISOString(), error: null } }, new Date().toISOString());
  updateQuery(ctx, q.id, { name: "Marka 2" });
  assert.ok(listeningRepo.get(org.id, q.id)!.state.news);
  resetSourceState();
  updateQuery(ctx, q.id, { terms: ["Leblebi Kuruyemiş"] });
  assert.deepEqual(listeningRepo.get(org.id, q.id)!.state, {});
  // Arka planda başlayan yeniden taramanın bitmesini bekle (test sonrası açık iş kalmasın)
  for (let i = 0; i < 100 && !listeningRepo.get(org.id, q.id)!.state.news; i++) await new Promise((r) => setTimeout(r, 20));
});

test("RSS: ayrıştırma (RSS + Atom), kelime başı eşleşme, bağlantı tekilleştirme", async () => {
  const rss = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[Leblebi Kuruyemiş Çorum'da fabrika açtı]]></title><link>https://www.hurriyet.com.tr/ekonomi/leblebi-123?utm_source=rss&amp;id=5</link><description>&lt;p&gt;Yeni tesis &amp;amp; istihdam&lt;/p&gt;</description><pubDate>${new Date(now - 30 * 60_000).toUTCString()}</pubDate></item><item><title>Kaliteli kahvaltı önerileri</title><link>https://www.hurriyet.com.tr/x</link></item></channel></rss>`;
  const items = parseFeed(rss);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Leblebi Kuruyemiş Çorum'da fabrika açtı");
  assert.equal(items[0].url, "https://www.hurriyet.com.tr/ekonomi/leblebi-123?utm_source=rss&id=5");
  assert.equal(items[0].id, "https://hurriyet.com.tr/ekonomi/leblebi-123?id=5");
  assert.equal(items[0].summary, "Yeni tesis & istihdam");
  const atom = `<feed><entry><title>Leblebi news</title><link rel="alternate" href="https://ornek.example/a"/><published>2026-10-01T10:00:00Z</published><summary>x</summary></entry></feed>`;
  assert.equal(parseFeed(atom)[0].url, "https://ornek.example/a");
  const fake = { terms: ["ali", "leblebi"], excludes: [] } as unknown as Parameters<typeof matches>[0];
  assert.equal(matches(fake, "Kaliteli ürün"), false);
  assert.equal(matches(fake, "Ali Bey geldi"), true);
  assert.equal(matches(fake, "LEBLEBİCİ dükkânı"), true);
  assert.equal(normalizeUrl("https://WWW.Ornek.example/a/?utm_medium=x#top"), "https://ornek.example/a");

  // Havuzdaki haber + aynı haberin GDELT'teki izleme parametreli kopyası tek kayıt olur
  const q = listeningRepo.list(org.id).find((x) => x.name === "Marka 2")!;
  feedXml = rss;
  gdeltBody = { articles: [{ url: "https://hurriyet.com.tr/ekonomi/leblebi-123?id=5&utm_campaign=g", title: "Leblebi Kuruyemiş fabrika", seendate: ymdh(20), domain: "hurriyet.com.tr" }] };
  resetSourceState();
  listeningRepo.resetState(q.id);
  const before = listMentions(ctx, { query: q.id, source: "news", view: "hidden" }).total + listMentions(ctx, { query: q.id, source: "news" }).total;
  const r = await runQuery(listeningRepo.get(org.id, q.id)!, { manual: true });
  assert.equal(r.bySource.news!.added, 1);
  const after = listMentions(ctx, { query: q.id, source: "news" }).items.find((m) => m.site === "hurriyet.com.tr")!;
  assert.equal(after.title, "Leblebi Kuruyemiş Çorum'da fabrika açtı");
  assert.equal(listMentions(ctx, { query: q.id, source: "news" }).total + listMentions(ctx, { query: q.id, source: "news", view: "hidden" }).total, before + 1);
  feedXml = null;
});
