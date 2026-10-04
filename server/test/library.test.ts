import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-library-"));
process.env.DATA_DIR = dir;

const Fastify = (await import("fastify")).default;
const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { mediaRepo } = await import("../src/core/repos/misc.js");
const { libraryRoutes, normalizeHashtags } = await import("../src/api/routes/library.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "kutuphane@ornek.com", password: "Password123!", name: "K", locale: "tr" });
const org = orgsRepo.create({ name: "Kütüphane Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const other = orgsRepo.create({ name: "Başka", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const mine = mediaRepo.create({ id: "med_mine", orgId: org.id, filename: "a.jpg", originalName: "a.jpg", mime: "image/jpeg", size: 10, kind: "image" });
const theirs = mediaRepo.create({ id: "med_theirs", orgId: other.id, filename: "b.jpg", originalName: "b.jpg", mime: "image/jpeg", size: 10, kind: "image" });

let ctx: Ctx = { orgId: org.id, userId: user.id, role: "editor", via: "session", locale: "tr" };
const app = Fastify();
app.addHook("onRequest", async (req) => {
  (req as unknown as { ctx: Ctx }).ctx = ctx;
});
await app.register(libraryRoutes);

test("hashtag grubu temizlenir: # eklenir, tekrar ve geçersiz atılır", () => {
  assert.equal(normalizeHashtags("leblebi #Kuruyemiş, #leblebi ##tarif  geçersiz-etiket çerez"), "#leblebi #Kuruyemiş #tarif #çerez");
});

test("şablon ve hashtag grubu; başka alanın medyası kabul edilmez; kullanım sırası", async () => {
  const t1 = await app.inject({ method: "POST", url: "/api/library", payload: { type: "post", name: "Haftalık kampanya", kind: "reel", content: "Bu hafta %20 indirim", mediaIds: [mine.id, theirs.id] } });
  assert.equal(t1.statusCode, 200);
  assert.deepEqual(t1.json().mediaIds, [mine.id]);
  const h = await app.inject({ method: "POST", url: "/api/library", payload: { type: "hashtags", name: "Marka", content: "leblebi kuruyemiş" } });
  assert.equal(h.json().content, "#leblebi #kuruyemiş");
  const t2 = await app.inject({ method: "POST", url: "/api/library", payload: { type: "post", name: "Tarif", content: "Leblebili granola" } });
  await app.inject({ method: "POST", url: `/api/library/${t2.json().id}/use` });
  const list = (await app.inject({ method: "GET", url: "/api/library?type=post" })).json() as Array<{ name: string }>;
  assert.deepEqual(list.map((x) => x.name), ["Tarif", "Haftalık kampanya"], "çok kullanılan öne gelir");
  const empty = await app.inject({ method: "POST", url: "/api/library", payload: { type: "hashtags", name: "Boş", content: "!!!" } });
  assert.equal(empty.statusCode, 400);
});

test("izleyici yazamaz, başka çalışma alanı göremez", async () => {
  ctx = { ...ctx, role: "viewer" };
  const r = await app.inject({ method: "POST", url: "/api/library", payload: { type: "post", name: "X", content: "x" } });
  assert.equal(r.statusCode, 403);
  ctx = { ...ctx, orgId: other.id, role: "owner" };
  const list = (await app.inject({ method: "GET", url: "/api/library" })).json() as unknown[];
  assert.equal(list.length, 0);
});
