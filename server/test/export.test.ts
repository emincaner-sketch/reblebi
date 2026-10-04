import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-export-"));
process.env.DATA_DIR = dir;

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { postsRepo } = await import("../src/core/repos/posts.js");
const { analyticsRepo, postMetricsRepo } = await import("../src/core/repos/misc.js");
const { insightsRepo } = await import("../src/core/repos/insights.js");
const { dailyExport, toCsv } = await import("../src/services/export.js");

const user = usersRepo.create({ email: "disa@ornek.com", password: "Password123!", name: "D", locale: "tr" });
const org = orgsRepo.create({ name: "Dışa Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-x", name: "IG, \"Hesap\"", accessToken: "x" }).channel;
const ymd = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

analyticsRepo.upsert(ig.id, ymd(10), { followers: 1000 });
analyticsRepo.upsert(ig.id, ymd(2), { followers: 1040 });
insightsRepo.mergeDay(ig.id, ymd(2), { reach: 300, follows: 9 });
const post = postsRepo.create({ orgId: org.id, kind: "post", content: "x", status: "published", source: "panel", targets: [{ channelId: ig.id }] });
const at = new Date(`${ymd(2)}T09:00:00Z`);
postsRepo.updateTarget(post.targets[0].id, { status: "published", publishedAt: at.toISOString(), externalId: "e" });
postMetricsRepo.set(post.targets[0].id, { likes: 10, comments: 2, shares: 1, saves: 3, views: 400 });

test("kanal × gün satırları: takipçi taşınır, gönderi ve insights doğru güne yazılır", () => {
  const r = dailyExport(org.id, { from: ymd(4), to: ymd(0) });
  assert.equal(r.rows.length, 5);
  const d4 = r.rows.find((x) => x.date === ymd(4))!;
  assert.equal(d4.followers, 1000, "önceki değer taşınır");
  assert.equal(d4.posts, 0);
  assert.equal(d4.reach, null, "veri yoksa boş, sıfır değil");
  const d2 = r.rows.find((x) => x.date === ymd(2))!;
  assert.equal(d2.followers, 1040);
  assert.equal(d2.posts, 1);
  assert.equal(d2.interactions, 16);
  assert.equal(d2.postViews, 400);
  assert.equal(d2.reach, 300);
  assert.equal(d2.follows, 9);
});

test("CSV: başlık ve kaçış", () => {
  const csv = toCsv(dailyExport(org.id, { from: ymd(2), to: ymd(2) }).rows);
  const [head, line] = csv.split("\n");
  assert.ok(head.startsWith("date,network,channel,channelId,followers"));
  assert.ok(line.includes('"IG, ""Hesap"""'), "virgül ve tırnak kaçışlı");
});
