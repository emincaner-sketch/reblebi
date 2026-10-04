import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-report-"));
process.env.DATA_DIR = dir;

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { postsRepo } = await import("../src/core/repos/posts.js");
const { analyticsRepo, postMetricsRepo } = await import("../src/core/repos/misc.js");
const { analyticsReport } = await import("../src/services/analytics-report.js");

const user = usersRepo.create({ email: "rapor@ornek.com", password: "Password123!", name: "Rapor", locale: "tr" });
const org = orgsRepo.create({ name: "Rapor Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-1", name: "IG Hesap", accessToken: "x" }).channel;
const fb = channelsRepo.upsert({ orgId: org.id, provider: "facebook", externalId: "fb-1", name: "FB Sayfa", accessToken: "x" }).channel;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Yayınlanmış gönderi + metrik */
function published(channelId: string, when: Date, content: string, metrics?: Record<string, number>, kind: "post" | "reel" = "post") {
  const post = postsRepo.create({ orgId: org.id, kind, content, status: "published", source: "panel", targets: [{ channelId }] });
  const target = post.targets[0];
  postsRepo.updateTarget(target.id, { status: "published", publishedAt: when.toISOString(), externalId: `ext-${target.id}` });
  if (metrics) postMetricsRepo.set(target.id, metrics);
  return target.id;
}

// Takipçi: önceki dönemden taşınan değer + dönem içinde artış
analyticsRepo.upsert(ig.id, ymd(daysAgo(20)), { followers: 100 });
analyticsRepo.upsert(ig.id, ymd(daysAgo(5)), { followers: 130 });
analyticsRepo.upsert(fb.id, ymd(daysAgo(3)), { followers: 40 });

// Bu dönem (son 10 gün): 3 gönderi, biri metriksiz
published(ig.id, daysAgo(4), "Yeni sezon #YeniSezon #keten", { likes: 10, comments: 2, shares: 1, views: 200 });
published(ig.id, daysAgo(2), "Kampanya #yenisezon", { likes: 5, comments: 0, shares: 0, views: 100 }, "reel");
published(fb.id, daysAgo(1), "Metriği henüz yok #keten");
// Önceki dönem (10–19 gün önce): 1 gönderi
published(ig.id, daysAgo(12), "Eski gönderi", { likes: 3, comments: 1, shares: 0, views: 50 });

test("dönem ve karşılaştırma toplamları", () => {
  const r = analyticsReport(org.id, { days: 10 });
  assert.equal(r.range.days, 10);
  assert.equal(r.kpis.posts.value, 3);
  assert.equal(r.kpis.posts.prev, 1);
  // Metriği olmayan gönderi sıfır sayılmaz ama gönderi sayısına girer
  assert.equal(r.kpis.postsWithMetrics.value, 2);
  assert.equal(r.kpis.interactions.value, 18);
  assert.equal(r.kpis.interactions.prev, 4);
  assert.equal(r.kpis.views.value, 300);
  assert.equal(r.kpis.engagementRate.value, 6);
});

test("takipçi: aralık başındaki değer taşınır, bağlantı öncesi null kalır", () => {
  const r = analyticsReport(org.id, { days: 10 });
  assert.equal(r.kpis.followers.value, 170);
  assert.equal(r.kpis.followers.prev, 100);
  // İlk gün: Instagram taşınan 100, Facebook henüz yok → toplam 100 (null sayılmaz)
  assert.equal(r.daily[0].followers, 100);
  assert.equal(r.followersByProvider.facebook?.[0], null);
  assert.equal(r.daily[r.daily.length - 1].followers, 170);
});

test("ağ süzgeci, hashtag ve içerik türü", () => {
  const r = analyticsReport(org.id, { days: 10, provider: "instagram" });
  assert.equal(r.kpis.posts.value, 2);
  assert.equal(r.networks.length, 2, "kenar menü için tüm ağlar döner");
  const tag = r.hashtags.find((h) => h.tag.toLowerCase() === "#yenisezon");
  assert.ok(tag, "büyük/küçük harf birleşir");
  assert.equal(tag!.posts, 2);
  assert.equal(tag!.interactions, 18);
  assert.deepEqual(
    r.kinds.map((k) => k.kind).sort(),
    ["post", "reel"],
  );
});

test("gönderi listesi ve ısı haritası", () => {
  const r = analyticsReport(org.id, { days: 10 });
  assert.equal(r.posts.length, 3);
  const noMetrics = r.posts.find((p) => !p.hasMetrics);
  assert.ok(noMetrics);
  assert.equal(noMetrics!.interactions, null);
  const cells = r.heatmap.cells.reduce((a, c) => a + c.posts, 0);
  assert.equal(cells, 3);
  assert.ok(r.heatmap.cells.every((c) => c.weekday >= 0 && c.weekday <= 6 && c.hour >= 0 && c.hour <= 23));
});

test("kampanya süzgeci yalnızca kampanyanın gönderilerini ve kanallarını sayar", async () => {
  const { campaignsRepo } = await import("../src/core/repos/content.js");
  const camp = campaignsRepo.create(org.id, { name: "Yeni sezon", source: "panel" });
  const post = postsRepo.create({ orgId: org.id, kind: "post", content: "Kampanya gönderisi #yenisezon", status: "published", source: "panel", campaignId: camp.id, targets: [{ channelId: fb.id }] });
  postsRepo.updateTarget(post.targets[0].id, { status: "published", publishedAt: daysAgo(1).toISOString(), externalId: "ext-camp" });
  postMetricsRepo.set(post.targets[0].id, { likes: 7, comments: 1, shares: 0, views: 40 });
  const r = analyticsReport(org.id, { days: 10, campaignId: camp.id });
  assert.equal(r.kpis.posts.value, 1);
  assert.equal(r.kpis.interactions.value, 8);
  assert.deepEqual(r.channels.map((c) => c.provider), ["facebook"]);
});

test("geçersiz aralık güvenli biçimde düzeltilir", () => {
  const r = analyticsReport(org.id, { from: "2099-01-01", to: "2099-02-01" });
  assert.ok(r.range.to <= r.range.today);
  assert.ok(r.range.from <= r.range.to);
});
