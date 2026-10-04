import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-site-"));
process.env.DATA_DIR = dir;
process.env.PUBLIC_URL = "https://app.ornek.test";

const Fastify = (await import("fastify")).default;
const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const svc = await import("../src/services/site-analytics.js");
const { websitePublicRoutes } = await import("../src/api/routes/website.js");
const { getDb } = await import("../src/core/db.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "site@ornek.com", password: "Password123!", name: "S", locale: "tr" });
const org = orgsRepo.create({ name: "Site Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "admin", via: "session", locale: "tr" };
const CHROME = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("alan adı temizlenir; yinelenen ve geçersiz reddedilir; yalnızca yönetici", () => {
  assert.equal(svc.normalizeDomain("https://www.Leblebi.com.tr/urunler?x=1"), "leblebi.com.tr");
  assert.equal(svc.normalizeDomain("çöp alan"), null);
  const s = svc.addSite(ctx, "www.leblebi.com.tr");
  assert.equal(s.domain, "leblebi.com.tr");
  assert.equal(s.token.length >= 16, true);
  assert.throws(() => svc.addSite(ctx, "leblebi.com.tr"), /zaten ekli/);
  assert.throws(() => svc.addSite({ ...ctx, role: "editor" }, "baska.com"), /yetki/);
});

test("toplama: tekil ziyaretçi, giriş kaynağı, sosyal ağ, UTM, cihaz; bot ve başka alan adı sayılmaz", () => {
  const site = svc.listSites(ctx)[0];
  const now = Date.parse("2026-10-04T09:00:00Z");
  const hit = (url: string, ref: string | null, ip: string, ua = CHROME, width = 1440, origin: string | null = "https://leblebi.com.tr") =>
    svc.recordHit({ token: site.token, url, referrer: ref, width }, { ip, ua, lang: "tr-TR,tr;q=0.9", country: null, origin }, now);

  assert.equal(hit("https://leblebi.com.tr/?utm_source=instagram&utm_campaign=ekim", "https://l.instagram.com/", "1.1.1.1", IPHONE, 390), true);
  assert.equal(hit("https://leblebi.com.tr/urunler/", "https://leblebi.com.tr/", "1.1.1.1", IPHONE, 390), true, "aynı kişi ikinci sayfa");
  assert.equal(hit("https://www.leblebi.com.tr/", null, "2.2.2.2"), true, "www alt alan adı kabul");
  assert.equal(hit("https://leblebi.com.tr/", "https://www.google.com/search?q=leblebi", "3.3.3.3"), true);
  assert.equal(hit("https://leblebi.com.tr/", null, "4.4.4.4", "Googlebot/2.1 (+http://www.google.com/bot.html)"), false, "bot");
  assert.equal(hit("https://sahte.com/", null, "5.5.5.5"), false, "başka alan adı");
  assert.equal(hit("https://leblebi.com.tr/", null, "6.6.6.6", CHROME, 1440, "https://sahte.com"), false, "başka origin");
  assert.equal(svc.recordHit({ token: "yok", url: "https://leblebi.com.tr/" }, { ip: "1", ua: CHROME }, now), false);

  // Raporu o güne göre almak için tarihleri bugüne kaydır
  const today = new Date().toISOString().slice(0, 10);
  getDb().prepare("UPDATE site_daily SET date = ? WHERE site_id = ?").run(today, site.id);
  const r = svc.siteReport(ctx, site.id, 7);
  assert.equal(r.totals.views, 4);
  assert.equal(r.totals.visitors, 3);
  assert.equal(r.totals.viewsPerVisitor, 1.3);
  assert.equal(r.totals.social, 1);
  assert.deepEqual(
    r.pages.map((p) => [p.key, p.views]),
    [
      ["/", 3],
      ["/urunler", 1],
    ],
  );
  assert.deepEqual(r.referrers.map((x) => x.key).sort(), ["(doğrudan)", "google.com", "l.instagram.com"]);
  assert.deepEqual(r.social, [{ key: "Instagram", views: 1, entries: 1 }]);
  assert.equal(r.utm[0].key, "instagram");
  assert.equal(r.campaigns[0].key, "ekim");
  assert.deepEqual(r.devices.map((d) => [d.key, d.entries]).sort(), [
    ["desktop", 2],
    ["mobile", 1],
  ]);
  assert.equal(r.browsers.find((b) => b.key === "Safari")?.entries, 1);
  assert.equal(r.langs[0].key, "tr");
  assert.equal(
    getDb().prepare("SELECT COUNT(*) c FROM site_seen").get()!.c,
    3,
    "yalnızca hash saklanır, IP saklanmaz",
  );
  svc.purgeSeen(now + 3 * 86_400_000);
  assert.equal(getDb().prepare("SELECT COUNT(*) c FROM site_seen").get()!.c, 0);
});

test("herkese açık uçlar: izleme kodu ve text/plain toplama (204, hatalı istekte de)", async () => {
  const app = Fastify();
  await app.register(websitePublicRoutes);
  const js = await app.inject({ method: "GET", url: "/api/public/t.js" });
  assert.equal(js.statusCode, 200);
  assert.match(js.headers["content-type"] as string, /javascript/);
  assert.match(js.body, /https:\/\/app\.ornek\.test\/api\/public\/collect/);
  assert.match(js.body, /sendBeacon/);
  const site = svc.listSites(ctx)[0];
  const before = (getDb().prepare("SELECT SUM(views) v FROM site_daily WHERE site_id = ? AND dim = ''").get(site.id) as { v: number }).v;
  const ok = await app.inject({ method: "POST", url: "/api/public/collect", headers: { "content-type": "text/plain", "user-agent": CHROME, origin: "https://leblebi.com.tr" }, payload: JSON.stringify({ k: site.token, u: "https://leblebi.com.tr/iletisim", r: null, w: 1280 }) });
  assert.equal(ok.statusCode, 204);
  const bad = await app.inject({ method: "POST", url: "/api/public/collect", headers: { "content-type": "text/plain" }, payload: "bozuk" });
  assert.equal(bad.statusCode, 204);
  const after = (getDb().prepare("SELECT SUM(views) v FROM site_daily WHERE site_id = ? AND dim = ''").get(site.id) as { v: number }).v;
  assert.equal(after, before + 1);
});
