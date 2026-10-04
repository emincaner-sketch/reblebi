import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-feed-"));
process.env.DATA_DIR = dir;

const Fastify = (await import("fastify")).default;
const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { feedRoutes } = await import("../src/api/routes/feed.js");
const { AppError } = await import("../src/core/i18n.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "feed@ornek.com", password: "Password123!", name: "F", locale: "tr" });
const org = orgsRepo.create({ name: "Feed Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "17841", name: "IG", accessToken: "igtok" }).channel;
const broken = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "999", name: "IG2", accessToken: "bad" }).channel;
const x = channelsRepo.upsert({ orgId: org.id, provider: "x", externalId: "x1", name: "X", accessToken: "t" }).channel;
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "viewer", via: "session", locale: "tr" };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = new URL(String(input));
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (u.hostname === "graph.facebook.com" && u.pathname.endsWith("/17841/media")) {
    assert.match(u.searchParams.get("fields") ?? "", /thumbnail_url/);
    return j({
      data: [
        { id: "m1", caption: "Reel", media_type: "VIDEO", media_url: "https://cdn/x.mp4", thumbnail_url: "https://cdn/x.jpg", permalink: "https://instagram.com/p/1", timestamp: "2026-10-01T10:00:00+0000", like_count: 50 },
        { id: "m2", media_type: "IMAGE", media_url: "https://cdn/y.jpg", timestamp: "2026-09-30T10:00:00+0000" },
      ],
    });
  }
  if (u.hostname === "graph.facebook.com") return j({ error: { message: "Invalid OAuth access token", code: 190 } }, 400);
  return j({}, 404);
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const app = Fastify();
app.addHook("onRequest", async (req) => {
  (req as unknown as { ctx: Ctx }).ctx = ctx;
});
app.setErrorHandler((e, _req, reply) => reply.code(e instanceof AppError ? e.status : 500).send({ error: String(e) }));
await app.register(feedRoutes);

test("Instagram ızgarası: video için kapak görseli, izinsiz kanal boş döner, diğer ağlar reddedilir", async () => {
  const r = await app.inject({ method: "GET", url: `/api/channels/${ig.id}/feed` });
  assert.equal(r.statusCode, 200);
  const b = r.json();
  assert.equal(b.live, true);
  assert.equal(b.items[0].imageUrl, "https://cdn/x.jpg", "video → thumbnail");
  assert.equal(b.items[1].imageUrl, "https://cdn/y.jpg");
  const bad = (await app.inject({ method: "GET", url: `/api/channels/${broken.id}/feed` })).json();
  assert.equal(bad.live, false);
  assert.deepEqual(bad.items, []);
  assert.equal((await app.inject({ method: "GET", url: `/api/channels/${x.id}/feed` })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: `/api/channels/yok/feed` })).statusCode, 404);
});
