import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-repmail-"));
process.env.DATA_DIR = dir;
delete process.env.SMTP_HOST;

const { orgsRepo, usersRepo, orgSettingsRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { postsRepo } = await import("../src/core/repos/posts.js");
const { postMetricsRepo } = await import("../src/core/repos/misc.js");
const { duePeriod, parseRecipients, buildReportEmail, sendScheduledReports } = await import("../src/services/report-email.js");
const { devOutbox } = await import("../src/services/mailer.js");

const owner = usersRepo.create({ email: "sahip@ornek.com", password: "Password123!", name: "Sahip", locale: "tr" });
const org = orgsRepo.create({ name: "Rapor Mail", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: owner.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-r", name: "IG", accessToken: "x" }).channel;

// İstanbul: 2026-09-28 pazartesi 10:00 = 07:00 UTC
const MONDAY_10 = Date.parse("2026-09-28T07:00:00Z");

test("dönem: haftalık pazartesi 09:00 sonrası geçen hafta, aylık ayın ilk günü geçen ay", () => {
  assert.deepEqual(duePeriod("weekly", "Europe/Istanbul", MONDAY_10), { key: "weekly:2026-09-28", from: "2026-09-21", to: "2026-09-27" });
  assert.equal(duePeriod("weekly", "Europe/Istanbul", Date.parse("2026-09-28T05:00:00Z")), null, "08:00 henüz erken");
  assert.equal(duePeriod("weekly", "Europe/Istanbul", Date.parse("2026-09-29T07:00:00Z")), null, "salı değil");
  assert.deepEqual(duePeriod("monthly", "Europe/Istanbul", Date.parse("2026-10-01T07:00:00Z")), { key: "monthly:2026-10-01", from: "2026-09-01", to: "2026-09-30" });
  assert.equal(duePeriod("monthly", "Europe/Istanbul", MONDAY_10), null);
});

test("alıcı listesi doğrulanır", () => {
  assert.deepEqual(parseRecipients("a@x.com, B@y.com;a@x.com"), ["a@x.com", "b@y.com"]);
  assert.deepEqual(parseRecipients(""), []);
  assert.equal(parseRecipients("gecersiz"), null);
  assert.equal(parseRecipients(Array.from({ length: 11 }, (_, i) => `k${i}@x.com`).join(",")), null);
});

test("e-posta içeriği: marka, kaçış, KPI ve en iyi gönderi", () => {
  const post = postsRepo.create({ orgId: org.id, kind: "post", content: "Yeni sezon <b>leblebi</b>", status: "published", source: "panel", targets: [{ channelId: ig.id }] });
  postsRepo.updateTarget(post.targets[0].id, { status: "published", publishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), externalId: "e1" });
  postMetricsRepo.set(post.targets[0].id, { likes: 12, comments: 3, shares: 1, views: 300 });
  orgSettingsRepo.set(org.id, { brandName: "Leblebi & Co", reportColor: "#f5d90a", reportIntro: "Merhaba ekip" });
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const m = buildReportEmail(orgsRepo.get(org.id)!, orgSettingsRepo.get(org.id), { from, to: today }, "weekly");
  assert.match(m.subject, /Leblebi & Co · Haftalık sosyal medya özeti/);
  assert.ok(m.html.includes("Leblebi &amp; Co"));
  assert.ok(m.html.includes("&lt;b&gt;leblebi&lt;/b&gt;"), "gönderi metni kaçışlı");
  assert.ok(!m.html.includes("<b>leblebi</b>"));
  assert.ok(m.html.includes("color:#1a1726;text-decoration:none"), "açık renkte koyu düğme yazısı");
  assert.ok(m.text.includes("Etkileşim: 16"));
  assert.ok(m.text.includes("Merhaba") === false, "giriş notu yalnızca HTML'de");
  assert.ok(m.html.includes("Merhaba ekip"));
});

test("zamanlanmış gönderim dönem başına bir kez, sahip ve yöneticilere", async () => {
  orgSettingsRepo.set(org.id, { reportEmail: "weekly", reportRecipients: "" });
  const before = devOutbox().length;
  assert.equal(await sendScheduledReports(MONDAY_10), 1);
  assert.equal(devOutbox()[0].to, "sahip@ornek.com");
  assert.equal(await sendScheduledReports(MONDAY_10 + 3_600_000), 0, "aynı hafta ikinci kez gitmez");
  assert.equal(devOutbox().length, before + 1);

  orgSettingsRepo.set(org.id, { reportRecipients: "ajans@ornek.com, musteri@ornek.com", reportLastSent: "" });
  assert.equal(await sendScheduledReports(MONDAY_10), 2);
  orgSettingsRepo.set(org.id, { reportEmail: "off", reportLastSent: "" });
  assert.equal(await sendScheduledReports(MONDAY_10), 0);
});
