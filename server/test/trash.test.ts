import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-trash-"));
process.env.DATA_DIR = dir;

const { getDb } = await import("../src/core/db.js");
const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { postsRepo } = await import("../src/core/repos/posts.js");
const { postMetricsRepo } = await import("../src/core/repos/misc.js");
const { postNotesRepo } = await import("../src/core/repos/content.js");
const { trashRepo, TRASH_DAYS } = await import("../src/core/repos/trash.js");
const { deletePost, listTrash, purgeTrash, restorePost } = await import("../src/services/posts.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "cop@ornek.com", password: "Password123!", name: "Çöp", locale: "tr" });
const org = orgsRepo.create({ name: "Çöp Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const other = orgsRepo.create({ name: "Başka Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-1", name: "IG", accessToken: "x" }).channel;
const fb = channelsRepo.upsert({ orgId: org.id, provider: "facebook", externalId: "fb-1", name: "FB", accessToken: "x" }).channel;

const ctx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };
const viewer: Ctx = { ...ctx, role: "viewer" };
const otherCtx: Ctx = { ...ctx, orgId: other.id };

test("silinen gönderi çöp kutusuna düşer, hedefleri, notları ve metrikleriyle geri gelir", () => {
  const post = postsRepo.create({ orgId: org.id, kind: "post", content: "Yayınlanmış gönderi #leblebi", status: "published", source: "panel", targets: [{ channelId: ig.id }, { channelId: fb.id }] });
  const target = post.targets[0];
  postsRepo.updateTarget(target.id, { status: "published", publishedAt: new Date().toISOString(), externalId: "ext-1" });
  postMetricsRepo.set(target.id, { likes: 9, comments: 1 });
  postNotesRepo.add(post.id, { authorUserId: user.id, authorName: "Çöp", text: "Not", source: "team" });

  deletePost(ctx, post.id);
  assert.equal(postsRepo.get(org.id, post.id), null);
  const items = listTrash(ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, post.id);
  assert.equal(items[0].preview, "Yayınlanmış gönderi #leblebi");
  assert.deepEqual(items[0].channelIds.sort(), [fb.id, ig.id].sort());
  assert.ok(items[0].expiresAt > items[0].deletedAt);

  // Başka çalışma alanı göremez, geri alamaz
  assert.equal(listTrash(otherCtx).length, 0);
  assert.throws(() => restorePost(otherCtx, post.id));
  // İzleyici geri alamaz
  assert.throws(() => restorePost(viewer, post.id));

  const restored = restorePost(ctx, post.id);
  assert.equal(restored.id, post.id);
  assert.equal(restored.status, "published");
  assert.equal(restored.targets.length, 2);
  assert.equal(restored.toDraft, false);
  assert.equal(postMetricsRepo.getMany([target.id]).get(target.id)?.metrics.likes, 9, "metrikler hedef kimliğiyle yeniden bağlanır");
  assert.equal(postNotesRepo.list(post.id).length, 1);
  assert.equal(listTrash(ctx).length, 0);
});

test("zamanı geçmiş planlı gönderi taslak olarak döner, kaldırılan kanalın hedefi düşer", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const post = postsRepo.create({ orgId: org.id, kind: "post", content: "Planlı", status: "scheduled", publishAt: future, source: "panel", targets: [{ channelId: ig.id }, { channelId: fb.id }] });
  deletePost(ctx, post.id);
  // Silindikten sonra yayın saati geçti ve Facebook kanalı kaldırıldı
  getDb().prepare("UPDATE deleted_posts SET snapshot = json_set(snapshot, '$.post.publish_at', ?) WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), post.id);
  channelsRepo.remove(org.id, fb.id);

  const restored = restorePost(ctx, post.id);
  assert.equal(restored.status, "draft");
  assert.equal(restored.toDraft, true);
  assert.equal(restored.droppedTargets, 1);
  assert.deepEqual(restored.targets.map((t) => t.channelId), [ig.id]);
  assert.equal(postsRepo.claimDue(50).some((p) => p.id === post.id), false, "zamanlayıcı yayınlamaz");
});

test("kalıcı silme, boşaltma ve süre dolumu", () => {
  const a = postsRepo.create({ orgId: org.id, kind: "post", content: "A", status: "draft", source: "panel", targets: [{ channelId: ig.id }] });
  const b = postsRepo.create({ orgId: org.id, kind: "post", content: "B", status: "draft", source: "panel", targets: [{ channelId: ig.id }] });
  const c = postsRepo.create({ orgId: org.id, kind: "post", content: "C", status: "draft", source: "panel", targets: [{ channelId: ig.id }] });
  for (const p of [a, b, c]) deletePost(ctx, p.id);
  assert.equal(listTrash(ctx).length, 3);

  assert.deepEqual(purgeTrash(ctx, a.id), { removed: 1 });
  assert.throws(() => purgeTrash({ ...ctx, role: "editor" }, null), "boşaltma yönetici ister");

  const old = new Date(Date.now() - (TRASH_DAYS + 1) * 86_400_000).toISOString();
  getDb().prepare("UPDATE deleted_posts SET deleted_at = ? WHERE id = ?").run(old, b.id);
  assert.deepEqual(listTrash(ctx).map((x) => x.id), [c.id], "süresi dolan otomatik silinir");

  assert.deepEqual(purgeTrash(ctx, null), { removed: 1 });
  assert.equal(trashRepo.list(org.id).length, 0);
});
