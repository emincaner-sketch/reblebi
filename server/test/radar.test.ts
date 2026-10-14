import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-radar-"));
process.env.DATA_DIR = dir;

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { radarRepo } = await import("../src/core/repos/radar.js");
const radar = await import("../src/services/radar.js");
const { AppError } = await import("../src/core/i18n.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "radar@ornek.com", password: "Password123!", name: "Radar", locale: "tr" });
const org = orgsRepo.create({ name: "Radar Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const bare = orgsRepo.create({ name: "Kaynaksız", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-own", name: "YDS Matik", username: "ydsmatik", accessToken: "tok" });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };
const bareCtx: Ctx = { ...ctx, orgId: bare.id };

const DAY = 86_400_000;
let rateLimited = false;
const graphCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = new URL(String(input));
  const m = /business_discovery\.username\(([^)]+)\)/.exec(u.searchParams.get("fields") ?? "");
  if (u.pathname.endsWith("/ig-own") && m) {
    graphCalls.push(m[1]);
    if (rateLimited) return new Response(JSON.stringify({ error: { message: "Application request limit reached", code: 4 } }), { status: 400 });
    if (m[1] === "kisiselhesap") return new Response(JSON.stringify({ error: { message: "Invalid user id", code: 110 } }), { status: 400 });
    const media = Array.from({ length: 8 }, (_, i) => ({
      id: `${m[1]}-${i}`,
      permalink: `https://www.instagram.com/reel/${m[1].slice(0, 3).toUpperCase()}${i}/`,
      media_type: "VIDEO",
      media_product_type: "REELS",
      like_count: 100,
      comments_count: 10,
      view_count: i === 3 ? 60_000 : 5_000,
      caption: i === 3 ? `Der/die/das'ı ezberlemeden öğren 👇\n\nOrtak yayın: @almanca_hoca @${m[1]}\n#almanca #deutschlernen` : `Günlük Almanca #almanca`,
      timestamp: new Date(Date.now() - (i + 3) * DAY).toISOString(),
    }));
    return new Response(JSON.stringify({ business_discovery: { username: m[1], name: m[1].toUpperCase(), biography: "İş birliği: is@ornek.com", followers_count: 20_000, media_count: 300, media: { data: media } } }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

test("hesap ekleme: doğrular, niş açar, Business Discovery ile tarar, kişisel hesabı hatayla işaretler", async () => {
  const r = await radar.addRadarAccounts(ctx, { usernames: ["@almanca_ece", "https://www.instagram.com/deutsch_can/", "kisiselhesap", "geçersiz ad!"], nicheName: "Almanca", region: "TR" });
  assert.deepEqual(r.added.sort(), ["almanca_ece", "deutsch_can", "kisiselhesap"]);
  assert.deepEqual(r.invalid, ["geçersiz ad!"]);
  assert.equal(r.scan?.ok, 2);
  assert.equal(r.scan?.failed, 1);
  assert.match(radarRepo.accountByUsername(org.id, "kisiselhesap")!.lastError ?? "", /işletme\/üretici hesabı değil/);
  assert.equal(radarRepo.accountByUsername(org.id, "almanca_ece")!.email, "is@ornek.com");
  assert.equal(radar.listNiches(ctx)[0].accounts, 3);
  // Kaynaksız çalışma alanında tarama anlaşılır hata verir, hesap yine eklenir
  const b = await radar.addRadarAccounts(bareCtx, { usernames: ["almanca_ece"] });
  assert.equal(b.scan, null);
  await assert.rejects(() => radar.scanRadar(bareCtx), (e: unknown) => e instanceof AppError && e.key === "radar.no_source");
});

test("akış: Reel izlenme sıçraması hesabın kendi medyanına göre 12x", () => {
  const f = radar.radarFeed(ctx, { days: 0, minOutlier: 5 });
  assert.equal(f.total, 2);
  assert.equal(f.items[0].outlier, 12);
  assert.equal(f.items[0].metric, "views");
  assert.equal(f.items[0].kind, "REEL");
  assert.equal(f.items[0].hook, "Der/die/das'ı ezberlemeden öğren 👇");
  const nicheId = radarRepo.nicheByName(org.id, "Almanca")!.id;
  assert.equal(radar.radarFeed(ctx, { nicheId, region: "GLOBAL", days: 0 }).total, 0);
});

test("üreticiler, keşif önerileri ve içgörüler", () => {
  const c = radar.radarCreators(ctx, {});
  assert.equal(c.length, 3);
  assert.ok(c.find((x) => x.username === "almanca_ece")!.radarScore !== null);
  assert.equal(c.find((x) => x.username === "almanca_ece")!.medianViews, 5000);
  const s = radar.radarSuggestions(ctx);
  assert.deepEqual(s.map((x) => x.username), ["almanca_hoca"], "takip edilenler ve kendi hesabı önerilmez");
  assert.equal(s[0].mentionedBy.length, 2);
  radar.dismissSuggestion(ctx, "almanca_hoca");
  assert.equal(radar.radarSuggestions(ctx).length, 0);
  const ins = radar.radarInsights(ctx, { days: 90 });
  assert.equal(ins.posts, 16);
  assert.equal(ins.formats[0].kind, "REEL");
  assert.ok(ins.hooks.length >= 2);
});

test("pano, sponsor ve taslak gönderi", async () => {
  const key = radar.radarFeed(ctx, { days: 0, limit: 1 }).items[0].key;
  radar.saveRadarPost(ctx, { key, note: "ydsmatik için YDS versiyonu" });
  assert.equal(radar.radarFeed(ctx, { days: 0, limit: 1 }).items[0].saved, true);
  radar.saveRadarPost(ctx, { key, status: "producing" });
  assert.equal(radar.listSaved(ctx)[0].note, "ydsmatik için YDS versiyonu", "durum değişince not korunur");
  radar.putSponsor(ctx, { username: "@Almanca_Ece", status: "contacted", price: "5.000 TL" });
  const sp = radar.listSponsors(ctx);
  assert.equal(sp[0].username, "almanca_ece");
  assert.equal(sp[0].creator?.followers, 20_000);
  const post = await radar.radarDraft(ctx, key, "Uyarlanmış metin");
  assert.equal(post.status, "draft");
  assert.match(post.notes ?? "", /İçerik radarı · kaynak: @/);
  const ac = radar.adaptContext(ctx, key);
  assert.match(ac.performance, /12x/);
});

test("zamanlayıcı günde bir tarar; hız sınırından sonra Meta'ya istek atılmaz", async () => {
  graphCalls.length = 0;
  assert.equal(await radar.snapshotRadar(), 0, "bugün taranmış hesaplar atlanır (kişisel hesap hatası da bugünün taraması sayılır)");
  assert.equal(graphCalls.length, 0);
  rateLimited = true;
  const r = await radar.scanRadar(ctx);
  assert.equal(r.failed, 3);
  assert.equal(graphCalls.length, 1);
  assert.match(r.message ?? "", /hız sınırı/);
});
