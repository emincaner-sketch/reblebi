import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-comments-"));
process.env.DATA_DIR = dir;

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { inboxRepo } = await import("../src/core/repos/inbox.js");
const { parseMetaWebhook } = await import("../src/providers/index.js");
const { handleInbound, replyToConversation } = await import("../src/services/dm-engine.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "yorum@ornek.com", password: "Password123!", name: "Yorum", locale: "tr" });
const org = orgsRepo.create({ name: "Yorum Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-acc", name: "IG", accessToken: "tok" }).channel;
channelsRepo.upsert({ orgId: org.id, provider: "facebook", externalId: "page-1", name: "Sayfa", accessToken: "tok" });
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };

const posted: Array<{ path: string; body: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  posted.push({ path: u.pathname.replace(/^\/v[\d.]+/, ""), body: String(init?.body ?? "") });
  return new Response(JSON.stringify({ id: `reply-${posted.length}` }), { status: 200 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const igComment = (id: string, text: string, parent?: string) => ({
  object: "instagram",
  entry: [{ id: "ig-acc", time: 1_790_000_000, changes: [{ field: "comments", value: { id, text, parent_id: parent, from: { id: "u-9", username: "musteri" }, media: { id: "media-1", media_product_type: "FEED" } } }] }],
});

test("ayrıştırma: IG yorumu ve sayfa yorumu; hesabın kendi yorumu ve beğeni olayı atlanır", () => {
  const ig = parseMetaWebhook(igComment("cm-1", "Fiyatı nedir?"));
  assert.equal(ig.length, 1);
  assert.equal(ig[0].kind, "comment");
  assert.equal(ig[0].conversationExternalId, "c:media-1:u-9");
  assert.equal(ig[0].participantName, "@musteri");

  const own = parseMetaWebhook({ object: "instagram", entry: [{ id: "ig-acc", changes: [{ field: "comments", value: { id: "x", text: "Teşekkürler", from: { id: "ig-acc" }, media: { id: "media-1" } } }] }] });
  assert.equal(own.length, 0);

  const fb = parseMetaWebhook({
    object: "page",
    entry: [
      {
        id: "page-1",
        changes: [
          { field: "feed", value: { item: "comment", verb: "add", comment_id: "fc-1", post_id: "page-1_55", from: { id: "p-7", name: "Ayşe" }, message: "Kargo ne zaman?", created_time: 1_790_000_000 } },
          { field: "feed", value: { item: "reaction", verb: "add", post_id: "page-1_55", from: { id: "p-8" } } },
        ],
      },
    ],
  });
  assert.equal(fb.length, 1);
  assert.equal(fb[0].conversationExternalId, "c:page-1_55:p-7");
});

test("gelen kutusu: yorum konusu açılır, otomatik yanıt verilmez, ikinci yorum aynı konuya düşer", async () => {
  for (const ev of parseMetaWebhook(igComment("cm-1", "Fiyatı nedir?"))) await handleInbound(ev.provider, ev);
  for (const ev of parseMetaWebhook(igComment("cm-2", "Bir de kargo?", "cm-1"))) await handleInbound(ev.provider, ev);
  const conv = inboxRepo.findConversation(ig.id, "c:media-1:u-9");
  assert.ok(conv);
  assert.equal(conv!.metadata.kind, "comment");
  assert.equal(conv!.metadata.commentId, "cm-2");
  assert.equal(conv!.metadata.parentId, "cm-1");
  assert.equal(conv!.needsAttention, 1, "ekip görsün diye işaretlenir");
  assert.equal(inboxRepo.messages(conv!.id, 10).length, 2);
  assert.equal(posted.length, 0, "otomatik yanıt ya da profil sorgusu yok");
});

test("yanıt: üst seviye yoruma herkese açık yanıt olarak gider", async () => {
  const conv = inboxRepo.findConversation(ig.id, "c:media-1:u-9")!;
  const msg = await replyToConversation(ctx, conv.id, "Merhaba, fiyat 120 TL.");
  assert.equal(msg.status, "sent");
  assert.equal(posted[0].path, "/cm-1/replies", "IG yalnızca üst seviye yoruma yanıt kabul eder");
  assert.match(posted[0].body, /message=Merhaba/);
});
