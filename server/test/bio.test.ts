import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-bio-"));
process.env.DATA_DIR = dir;
process.env.DISABLE_SCHEDULER = "1";

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { bioRepo } = await import("../src/core/repos/bio.js");
const { checkSlug, createBioPage, updateBioPage, normalizeUrl, sourceOf, isBot, renderBioPage, bioStats, trackBio } = await import("../src/services/bio.js");
const { bioPublicRoutes } = await import("../src/api/routes/bio.js");
const Fastify = (await import("fastify")).default;
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "bio@ornek.com", password: "Password123!", name: "Bio", locale: "tr" });
const org = orgsRepo.create({ name: "Bio Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };

test("adres kuralları", () => {
  assert.equal(checkSlug("leblebi-kuruyemis"), "ok");
  assert.equal(checkSlug("ab"), "invalid");
  assert.equal(checkSlug("-leblebi"), "invalid");
  assert.equal(checkSlug("Leblebi Kuru"), "invalid");
  assert.equal(checkSlug("a--b"), "invalid");
  assert.equal(checkSlug("app"), "reserved");
  createBioPage(ctx, { slug: "leblebi", title: "Leblebi" });
  assert.equal(checkSlug("leblebi"), "taken");
  assert.equal(checkSlug("LEBLEBI"), "taken", "büyük/küçük harf aynı adres");
});

test("bağlantı güvenliği: yalnızca http(s), mailto, tel", () => {
  assert.equal(normalizeUrl("leblebi.com/magaza"), "https://leblebi.com/magaza");
  assert.equal(normalizeUrl("mailto:selam@leblebi.com"), "mailto:selam@leblebi.com");
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("data:text/html,x"), null);
  assert.equal(normalizeUrl("ftp://leblebi.com"), null);
  assert.equal(normalizeUrl("sadece-kelime"), null);
  const page = bioRepo.bySlug("leblebi")!;
  assert.throws(() => updateBioPage(ctx, page.id, { links: [{ id: "", label: "Kötü", url: "javascript:alert(1)", enabled: true }] }));
});

test("sayfa çizimi: kaçış, düğme kontrastı, kaynaklı tıklama adresi", () => {
  const page = bioRepo.bySlug("leblebi")!;
  const p = updateBioPage(ctx, page.id, {
    title: `Leblebi <script>alert("x")</script>`,
    bio: "Kavrulmuş & taze",
    theme: { accent: "#f5d90a", background: "dark" },
    links: [{ id: "", label: "Mağaza", url: "leblebi.com", enabled: true }, { id: "", label: "Gizli", url: "leblebi.com/gizli", enabled: false }],
    socials: [{ network: "instagram", url: "instagram.com/leblebi" }, { network: "email", url: "selam@leblebi.com" }],
  });
  assert.equal(p.socials[1].url, "mailto:selam@leblebi.com");
  const html = renderBioPage(p, { locale: "tr", source: "instagram" });
  assert.ok(!html.includes("<script>"), "başlık kaçışlı");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Kavrulmuş &amp; taze"));
  assert.ok(html.includes(`/l/leblebi/go/${p.links[0].id}?s=instagram`));
  assert.ok(!html.includes("Gizli"), "kapalı bağlantı görünmez");
  // Açık sarı vurguda beyaz yazı okunmaz: koyu yazıya geçer
  assert.match(html, /\.bt\{[^}]*color:#1a1726/);
  const preview = renderBioPage(p, { locale: "tr", preview: true });
  assert.ok(preview.includes(`href="https://leblebi.com/"`), "önizlemede doğrudan hedef");
  assert.ok(preview.includes("noindex"));
});

test("kaynak ve bot tespiti", () => {
  assert.equal(sourceOf("Mozilla/5.0 (iPhone) Instagram 300.0", undefined, undefined), "instagram");
  assert.equal(sourceOf("Mozilla/5.0", "https://l.facebook.com/", undefined), "facebook");
  assert.equal(sourceOf("Mozilla/5.0", "https://t.co/abc", undefined), "x");
  assert.equal(sourceOf("Mozilla/5.0", undefined, "ig"), "instagram");
  assert.equal(sourceOf("Mozilla/5.0", undefined, "bilinmeyen"), "other");
  assert.equal(sourceOf("Mozilla/5.0", undefined, undefined), "direct");
  assert.ok(isBot("facebookexternalhit/1.1"));
  assert.ok(isBot("Googlebot/2.1"));
  assert.ok(isBot(undefined));
  assert.ok(!isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Instagram 300.0"));
});

test("herkese açık sayfa, yönlendirme ve sayaçlar", async () => {
  const app = Fastify();
  await app.register(bioPublicRoutes);
  const page = bioRepo.bySlug("leblebi")!;
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Instagram 300.0";

  const view = await app.inject({ method: "GET", url: "/l/leblebi", headers: { "user-agent": ua } });
  assert.equal(view.statusCode, 200);
  assert.match(String(view.headers["content-type"]), /text\/html/);
  await app.inject({ method: "GET", url: "/l/leblebi", headers: { "user-agent": "Googlebot/2.1" } });
  const upper = await app.inject({ method: "GET", url: "/l/LEBLEBI" });
  assert.equal(upper.statusCode, 301);

  const go = await app.inject({ method: "GET", url: `/l/leblebi/go/${page.links[0].id}?s=instagram`, headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(go.statusCode, 302);
  assert.equal(go.headers.location, "https://leblebi.com/");
  const hidden = await app.inject({ method: "GET", url: `/l/leblebi/go/${page.links[1].id}`, headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(hidden.headers.location, "/l/leblebi", "kapalı bağlantı sayfaya döner");
  const unknown = await app.inject({ method: "GET", url: "/l/yok-boyle-bir-sayfa" });
  assert.equal(unknown.statusCode, 404);

  updateBioPage(ctx, page.id, { published: false });
  assert.equal((await app.inject({ method: "GET", url: "/l/leblebi" })).statusCode, 404);
  updateBioPage(ctx, page.id, { published: true });

  const s = bioStats(ctx, page.id, 30);
  assert.equal(s.totals.views, 1, "bot sayılmaz");
  assert.equal(s.totals.clicks, 1);
  assert.equal(s.totals.ctr, 100);
  assert.deepEqual(s.sources, [{ source: "instagram", views: 1, clicks: 1 }]);
  assert.equal(s.links.find((l) => l.id === page.links[0].id)?.clicks, 1);
  assert.equal(s.daily.length, 30);
  await app.close();
});

test("sayaç günlük satırda toplanır", () => {
  const page = bioRepo.bySlug("leblebi")!;
  for (let i = 0; i < 5; i++) trackBio(page, "", "tiktok");
  const s = bioStats(ctx, page.id, 7);
  assert.equal(s.sources.find((x) => x.source === "tiktok")?.views, 5);
});
