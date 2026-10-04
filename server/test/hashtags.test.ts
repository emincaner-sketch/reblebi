import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-hashtags-"));
process.env.DATA_DIR = dir;

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { hashtagsRepo } = await import("../src/core/repos/hashtags.js");
const { addHashtag, hashtagReport, normalizeTag, snapshotHashtags } = await import("../src/services/hashtag-tracker.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "etiket@ornek.com", password: "Password123!", name: "E", locale: "tr" });
const org = orgsRepo.create({ name: "Etiket Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-own", name: "Benim", accessToken: "tok" });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "editor", via: "session", locale: "tr" };

const calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = new URL(String(input));
  const p = u.pathname.replace(/^\/v[\d.]+/, "");
  calls.push(p + (u.searchParams.get("after") ? `?after=${u.searchParams.get("after")}` : ""));
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (p === "/ig_hashtag_search") return u.searchParams.get("q") === "yasakli" ? j({ data: [] }) : j({ data: [{ id: "h-" + u.searchParams.get("q") }] });
  if (p.endsWith("/recent_media")) {
    // 3 sayfa: 50 + 50 + 20
    const after = u.searchParams.get("after");
    if (!after) return j({ data: Array.from({ length: 50 }, (_, i) => ({ id: "r" + i })), paging: { next: `https://graph.facebook.com/v21.0${p}?after=p2` } });
    if (after === "p2") return j({ data: Array.from({ length: 50 }, (_, i) => ({ id: "s" + i })), paging: { next: `https://graph.facebook.com/v21.0${p}?after=p3` } });
    return j({ data: Array.from({ length: 20 }, (_, i) => ({ id: "t" + i })) });
  }
  if (p.endsWith("/top_media"))
    return j({
      data: [
        { id: "m1", caption: "Leblebi zamanı", like_count: 120, comments_count: 8, media_type: "IMAGE", permalink: "https://instagram.com/p/m1", timestamp: "2026-10-01T10:00:00+0000" },
        { id: "m2", caption: "Gizli beğeni", comments_count: 4, media_type: "VIDEO" },
        { id: "m3", caption: "Tarif", like_count: 300, comments_count: 20, media_type: "CAROUSEL_ALBUM" },
      ],
    });
  return j({}, 404);
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

test("etiket temizlenir", () => {
  assert.equal(normalizeTag("  #Leblebi "), "leblebi");
});

test("ekleme: arama + ilk ölçüm (sayfalı son 24 saat, gizli beğeni ortalamaya girmez)", async () => {
  const t = await addHashtag(ctx, "#Leblebi");
  assert.equal(t.hashtag, "leblebi");
  assert.equal(t.igHashtagId, "h-leblebi");
  assert.equal(t.top[0].id, "m3", "en çok etkileşim alan önce");
  const r = hashtagReport(ctx, 7);
  assert.equal(r.items[0].recentPosts, 120);
  assert.equal(r.items[0].recentCapped, false);
  assert.equal(r.items[0].avgLikes, 210);
  assert.equal(r.items[0].avgComments, 10.7);
  await assert.rejects(() => addHashtag(ctx, "leblebi"), /zaten takip/);
  await assert.rejects(() => addHashtag(ctx, "iki kelime"), /Geçerli bir hashtag/);
  await assert.rejects(() => addHashtag(ctx, "yasakli"), /bulunamadı/);
  assert.equal(hashtagsRepo.list(org.id).length, 1);
});

test("günlük ölçüm aynı gün tekrarlanmaz", async () => {
  const before = calls.length;
  assert.equal(await snapshotHashtags(), 0);
  assert.equal(calls.length, before);
  assert.equal(await snapshotHashtags(Date.now() + 86_400_000), 1);
});
