import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-dash-"));
process.env.DATA_DIR = dir;

const Fastify = (await import("fastify")).default;
const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { dashboardRoutes, MAX_DASHBOARDS } = await import("../src/api/routes/dashboards.js");
const { AppError } = await import("../src/core/i18n.js");
const { ZodError } = await import("zod");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "studio@ornek.com", password: "Password123!", name: "S", locale: "tr" });
const org = orgsRepo.create({ name: "Studio Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const other = orgsRepo.create({ name: "Başka", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const mine = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig1", name: "Benim", accessToken: "t" }).channel;
const theirs = channelsRepo.upsert({ orgId: other.id, provider: "instagram", externalId: "ig2", name: "Onların", accessToken: "t" }).channel;

let ctx: Ctx = { orgId: org.id, userId: user.id, role: "editor", via: "session", locale: "tr" };
const app = Fastify();
app.addHook("onRequest", async (req) => {
  (req as unknown as { ctx: Ctx }).ctx = ctx;
});
app.setErrorHandler((e, _req, reply) => {
  if (e instanceof AppError) return reply.code(e.status).send({ error: e.localized("tr") });
  if (e instanceof ZodError) return reply.code(400).send({ error: "doğrulama" });
  return reply.code(500).send({ error: String(e) });
});
await app.register(dashboardRoutes);

test("pano: hazır şablonla oluşur, düzen kaydedilir, kartlar temizlenir", async () => {
  const r = await app.inject({ method: "POST", url: "/api/dashboards", payload: { name: "Aylık özet" } });
  assert.equal(r.statusCode, 200);
  const d = r.json();
  assert.equal(d.days, 30);
  assert.equal(d.widgets.length, 7);
  assert.equal(d.widgets[0].type, "kpi");

  const p = await app.inject({
    method: "PATCH",
    url: `/api/dashboards/${d.id}`,
    payload: {
      days: 90,
      widgets: [
        { id: "a", type: "trend", size: "l", metric: "ins.reach", channelId: mine.id, provider: "facebook" },
        { id: "a", type: "kpi", size: "s" },
        { id: "b", type: "kpi", size: "s", channelId: theirs.id, provider: "instagram" },
        { id: "c", type: "note", size: "m", text: "Hedef: ayda 500 takipçi", metric: "views" },
        { id: "d", type: "networks", size: "m", metric: "followers" },
      ],
    },
  });
  assert.equal(p.statusCode, 200);
  const w = p.json().widgets;
  assert.equal(p.json().days, 90);
  assert.deepEqual(
    w.map((x: { id: string }) => x.id),
    ["a", "b", "c", "d"],
    "yinelenen kimlik atılır",
  );
  assert.equal(w[0].channelId, mine.id);
  assert.equal(w[0].provider, null, "kanal seçiliyse ağ filtresi yok sayılır");
  assert.equal(w[1].channelId, null, "başka çalışma alanının kanalı kabul edilmez");
  assert.equal(w[1].provider, "instagram");
  assert.equal(w[1].metric, "followers", "kpi ölçüsü varsayılanı");
  assert.equal(w[2].text, "Hedef: ayda 500 takipçi");
  assert.equal(w[2].metric, null);
  assert.equal(w[3].metric, null);

  const bad = await app.inject({ method: "PATCH", url: `/api/dashboards/${d.id}`, payload: { widgets: [{ id: "x", type: "kpi", size: "s", metric: "hack" }] } });
  assert.equal(bad.statusCode, 400);
  const badDays = await app.inject({ method: "PATCH", url: `/api/dashboards/${d.id}`, payload: { days: 45 } });
  assert.equal(badDays.statusCode, 400);
});

test("boş şablon, sınır, yetki ve çalışma alanı yalıtımı", async () => {
  const blank = await app.inject({ method: "POST", url: "/api/dashboards", payload: { name: "Boş", template: "blank" } });
  assert.equal(blank.json().widgets.length, 0);

  ctx = { ...ctx, orgId: other.id };
  assert.equal((await app.inject({ method: "GET", url: "/api/dashboards" })).json().items.length, 0);
  const foreign = await app.inject({ method: "PATCH", url: `/api/dashboards/${blank.json().id}`, payload: { name: "x" } });
  assert.equal(foreign.statusCode, 404);
  ctx = { ...ctx, orgId: org.id, role: "viewer" };
  assert.equal((await app.inject({ method: "GET", url: "/api/dashboards" })).json().items.length, 2, "izleyici panoları görür");
  assert.equal((await app.inject({ method: "POST", url: "/api/dashboards", payload: { name: "y" } })).statusCode, 403);
  ctx = { ...ctx, role: "editor" };

  for (let i = 2; i < MAX_DASHBOARDS; i++) await app.inject({ method: "POST", url: "/api/dashboards", payload: { name: `P${i}`, template: "blank" } });
  const over = await app.inject({ method: "POST", url: "/api/dashboards", payload: { name: "fazla" } });
  assert.equal(over.statusCode, 400);
  assert.match(over.json().error, /En fazla 20 pano/);

  const del = await app.inject({ method: "DELETE", url: `/api/dashboards/${blank.json().id}` });
  assert.equal(del.statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/dashboards" })).json().items.length, MAX_DASHBOARDS - 1);
});

test("pano e-postası: alıcı doğrulanır, pazartesi 09:00 sonrası bir kez gider, kart değerleri ve not içerikte", async () => {
  const { sendScheduledDashboards, buildDashboardEmail } = await import("../src/services/dashboard-email.js");
  const { devOutbox } = await import("../src/services/mailer.js");
  ctx = { ...ctx, orgId: org.id, role: "editor" };
  const created = await app.inject({ method: "POST", url: "/api/dashboards", payload: { name: "E-posta panosu", template: "blank" } });
  const id = created.json().id;
  const bad = await app.inject({ method: "PATCH", url: `/api/dashboards/${id}`, payload: { email: { freq: "weekly", recipients: "gecersiz-adres" } } });
  assert.equal(bad.statusCode, 400);
  const ok = await app.inject({
    method: "PATCH",
    url: `/api/dashboards/${id}`,
    payload: {
      widgets: [
        { id: "k1", type: "kpi", size: "s", metric: "posts" },
        { id: "n1", type: "note", size: "m", title: "Hedef", text: "Ayda 20 gönderi" },
        { id: "t1", type: "topPosts", size: "m" },
      ],
      email: { freq: "weekly", recipients: "Musteri@Ornek.com, ekip@ornek.com" },
    },
  });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().email, { freq: "weekly", recipients: "musteri@ornek.com, ekip@ornek.com", lastSent: null });

  // 2026-10-05 pazartesi, İstanbul 10:00 (= 07:00 UTC)
  const MONDAY_10 = Date.parse("2026-10-05T07:00:00Z");
  const before = devOutbox().length;
  assert.equal(await sendScheduledDashboards(Date.parse("2026-10-05T05:00:00Z")), 0, "09:00 öncesi gitmez");
  assert.equal(await sendScheduledDashboards(MONDAY_10), 2, "iki alıcı");
  assert.equal(await sendScheduledDashboards(MONDAY_10 + 3_600_000), 0, "aynı hafta ikinci kez gitmez");
  assert.equal(devOutbox().length, before + 2);
  const mail = devOutbox()[0];
  assert.match(mail.subject, /E-posta panosu/);
  assert.match(mail.text, /Gönderi: 0/);
  assert.match(mail.text, /Ayda 20 gönderi/);
  assert.match(mail.text, /Bu dönemde veri yok/);

  const d = (await app.inject({ method: "GET", url: "/api/dashboards" })).json().items.find((x: { id: string }) => x.id === id);
  assert.equal(d.email.lastSent, "weekly:2026-10-05");
  const html = buildDashboardEmail(orgsRepo.get(org.id)!, d, { from: "2026-09-28", to: "2026-10-04" }, "weekly").html;
  assert.match(html, /Panoyu aç/);
  assert.doesNotMatch(html, /<script/i);
});
