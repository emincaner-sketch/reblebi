import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-alist-"));
process.env.DATA_DIR = dir;

const { orgsRepo, usersRepo, orgSettingsRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { postsRepo } = await import("../src/core/repos/posts.js");
const { autolistsRepo } = await import("../src/core/repos/autolists.js");
const { libraryRepo } = await import("../src/core/repos/library.js");
const svc = await import("../src/services/autolists.js");
const { addDays, localYmd, zonedMidnight } = await import("../src/services/analytics-report.js");
import type { Ctx } from "../src/core/types.js";

const TZ = "Europe/Istanbul";
const user = usersRepo.create({ email: "oto@ornek.com", password: "Password123!", name: "O", locale: "tr" });
const org = orgsRepo.create({ name: "Oto Org", plan: "unlimited", timezone: TZ, locale: "tr", ownerId: user.id });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "admin", via: "session", locale: "tr" };
const editor: Ctx = { ...ctx, role: "editor" };
const x = channelsRepo.upsert({ orgId: org.id, provider: "x", externalId: "x1", name: "X hesabı", accessToken: "t" }).channel;
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig1", name: "IG", accessToken: "t" }).channel;

// Gerçek saatten 2 gün sonrası, yerel 10:00 (testler her gün aynı sonucu verir)
const ymd = localYmd(Date.now() + 2 * 86_400_000, TZ);
const wd = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
const at10 = (d: string) => zonedMidnight(d, TZ) + 10 * 3_600_000;
const posts = () => postsRepo.list(org.id, {}).filter((p) => p.source === "autolist");

test("slot anları: haftanın günü ve yerel saat", () => {
  const list = svc.slotInstants([{ day: wd, time: "10:00" }], TZ, at10(ymd) - 60_000, at10(addDays(ymd, 14)));
  assert.deepEqual(list, [at10(ymd), at10(addDays(ymd, 7)), at10(addDays(ymd, 14))]);
  assert.equal(new Date(list[0]).toISOString().slice(11, 16), "07:00", "İstanbul 10:00 = UTC 07:00");
});

test("açma koşulları: öğe, kanal ve saat gerekir; onay modu 'tümü' iken editör açamaz", () => {
  const l = svc.createAutolist(editor, { name: "Boş", channelIds: [x.id, "baskasinin-kanali"], slots: [{ day: wd, time: "10:00" }], repeat: true });
  assert.deepEqual(l.channelIds, [x.id], "başka alanın kanalı ayıklanır");
  assert.throws(() => svc.updateAutolist(editor, l.id, { enabled: true }), /en az bir öğe/);
  svc.addItem(editor, l.id, { kind: "post", content: "Merhaba", mediaIds: [] });
  orgSettingsRepo.set(org.id, { approvalMode: "all" });
  assert.throws(() => svc.updateAutolist(editor, l.id, { enabled: true }), /yalnızca yönetici/);
  assert.equal(svc.updateAutolist(ctx, l.id, { enabled: true }).enabled, true, "yönetici açabilir");
  orgSettingsRepo.set(org.id, { approvalMode: "none" });
  svc.removeAutolist(ctx, l.id);
});

test("vakti gelen slotta sıradaki öğe paylaşılır; aynı slot tekrar çalışmaz; döngü başa döner", async () => {
  const l = svc.createAutolist(editor, { name: "Evergreen", channelIds: [x.id], slots: [{ day: wd, time: "10:00" }], repeat: true });
  svc.addItem(editor, l.id, { kind: "post", content: "Birinci ipucu", mediaIds: [] });
  svc.addItem(editor, l.id, { kind: "post", content: "İkinci ipucu", mediaIds: [] });
  svc.updateAutolist(editor, l.id, { enabled: true });

  const up = svc.getAutolist(ctx, l.id).upcoming;
  assert.equal(up[0].at, new Date(at10(ymd)).toISOString());
  assert.deepEqual(
    up.slice(0, 3).map((u) => u.preview),
    ["Birinci ipucu", "İkinci ipucu", "Birinci ipucu"],
    "önizleme döngüyü gösterir",
  );

  assert.equal(await svc.runAutolists(at10(ymd) - 60_000), 0, "slottan önce paylaşım yok");
  assert.equal(await svc.runAutolists(at10(ymd) + 30_000), 1);
  assert.equal(await svc.runAutolists(at10(ymd) + 90_000), 0, "aynı slot ikinci kez çalışmaz");
  let p = posts();
  assert.equal(p.length, 1);
  assert.equal(p[0].content, "Birinci ipucu");
  assert.equal(p[0].status, "scheduled");
  assert.deepEqual(
    p[0].targets.map((t) => t.channelId),
    [x.id],
  );
  assert.equal(autolistsRepo.get(org.id, l.id)!.position, 1);

  await svc.runAutolists(at10(addDays(ymd, 7)) + 30_000);
  await svc.runAutolists(at10(addDays(ymd, 14)) + 30_000);
  p = posts();
  assert.deepEqual(
    p.map((x) => x.content).sort(),
    ["Birinci ipucu", "Birinci ipucu", "İkinci ipucu"],
  );
  const items = autolistsRepo.items(l.id);
  assert.equal(items[0].useCount, 2);
  assert.equal(autolistsRepo.get(org.id, l.id)!.position, 1);
  svc.removeAutolist(ctx, l.id);
});

test("15 dakikadan eski kaçırılmış slot telafi edilmez; tekrarsız liste bitince kapanır", async () => {
  const before = posts().length;
  const l = svc.createAutolist(editor, { name: "Kampanya serisi", channelIds: [x.id], slots: [{ day: wd, time: "10:00" }], repeat: false });
  svc.addItem(editor, l.id, { kind: "post", content: "Tek seferlik", mediaIds: [] });
  svc.updateAutolist(editor, l.id, { enabled: true });
  assert.equal(await svc.runAutolists(at10(ymd) + 20 * 60_000), 0, "20 dk gecikmeli: atlanır");
  assert.equal(await svc.runAutolists(at10(addDays(ymd, 7)) + 60_000), 1);
  const cur = autolistsRepo.get(org.id, l.id)!;
  assert.equal(cur.enabled, false, "liste bitti, kapandı");
  assert.equal(posts().length, before + 1);
  svc.removeAutolist(ctx, l.id);
});

test("uygun olmayan öğe kuyruğu kilitlemez: atlanır ve hata kaydedilir", async () => {
  const l = svc.createAutolist(editor, { name: "IG", channelIds: [ig.id], slots: [{ day: wd, time: "10:00" }], repeat: true });
  svc.addItem(editor, l.id, { kind: "post", content: "Görselsiz IG gönderisi", mediaIds: [] });
  svc.addItem(editor, l.id, { kind: "post", content: "İkinci", mediaIds: [] });
  svc.updateAutolist(editor, l.id, { enabled: true });
  assert.equal(await svc.runAutolists(at10(ymd) + 30_000), 0);
  const cur = autolistsRepo.get(org.id, l.id)!;
  assert.equal(cur.position, 1, "sıradaki öğeye geçildi");
  assert.ok(cur.lastError && cur.lastError.length > 0);
  assert.equal(cur.enabled, true);
  svc.removeAutolist(ctx, l.id);
});

test("öğe işlemleri: kütüphaneden içe aktarma, sıralama, sıradakinden önceki öğe silinince sıra korunur", () => {
  const l = svc.createAutolist(editor, { name: "Sıra", channelIds: [x.id], slots: [], repeat: true });
  const t1 = libraryRepo.create(org.id, { type: "post", name: "Şablon", content: "Kütüphaneden", createdBy: user.id });
  const h = libraryRepo.create(org.id, { type: "hashtags", name: "Etiketler", content: "#a #b", createdBy: user.id });
  assert.deepEqual(svc.importFromLibrary(editor, l.id, [t1.id, h.id, "yok"]), { added: 1 });
  const a = svc.addItem(editor, l.id, { kind: "post", content: "A", mediaIds: [] });
  const b = svc.addItem(editor, l.id, { kind: "post", content: "B", mediaIds: [] });
  const order = svc.reorderItems(editor, l.id, [b.id, a.id]);
  assert.deepEqual(
    order.map((i) => i.content),
    ["B", "A", "Kütüphaneden"],
  );
  svc.updateAutolist(editor, l.id, { position: 2 });
  svc.removeItem(editor, l.id, b.id);
  const cur = autolistsRepo.get(org.id, l.id)!;
  assert.equal(cur.position, 1);
  assert.equal(autolistsRepo.items(l.id)[cur.position].content, "Kütüphaneden", "sıradaki öğe aynı kaldı");
  assert.throws(() => svc.addItem(editor, l.id, { kind: "post", content: "  ", mediaIds: [] }), /Boş şablon/);
  assert.throws(() => svc.createAutolist({ ...ctx, role: "viewer" }, { name: "x", channelIds: [], slots: [], repeat: true }), /yetki|izin/i);
});
