import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Yorumdan DM'e: webhook -> kural -> kuyruk -> özel yanıt (private reply) + açık cevap.
 * Gerçek Meta'ya istek gitmez; fetch taklit edilir.
 */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sp-commentdm-"));

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { inboxRepo } = await import("../src/core/repos/inbox.js");
const { activityRepo } = await import("../src/core/repos/misc.js");
const { getDb } = await import("../src/core/db.js");
const { commentRulesRepo, privateRepliesRepo } = await import("../src/core/repos/comment-automation.js");
const { parseMetaWebhook } = await import("../src/providers/index.js");
const { handleInbound } = await import("../src/services/dm-engine.js");
const { BOT_NOTICE, buildDmText, commentRuleApplies, pickPublicReply, processPrivateReplyQueue, PRIVATE_REPLY_HOURLY_LIMIT } = await import(
  "../src/services/comment-automation.js"
);

const user = usersRepo.create({ email: "yorumdm@ornek.com", password: "Password123!", name: "Yorum DM", locale: "tr" });
const org = orgsRepo.create({ name: "Yorum DM Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-acc", name: "IG", accessToken: "tok", metadata: { igLogin: true } }).channel;
const fbPage = channelsRepo.upsert({ orgId: org.id, provider: "facebook", externalId: "page-1", name: "Sayfa", accessToken: "tok" }).channel;

const freeUser = usersRepo.create({ email: "ucretsiz@ornek.com", password: "Password123!", name: "Ücretsiz", locale: "tr" });
const freeOrg = orgsRepo.create({ name: "Ücretsiz Org", plan: "free", timezone: "Europe/Istanbul", locale: "tr", ownerId: freeUser.id });
channelsRepo.upsert({ orgId: freeOrg.id, provider: "instagram", externalId: "ig-free", name: "IG Free", accessToken: "tok", metadata: { igLogin: true } });

/* ---------------- fetch taklidi ---------------- */

interface Call {
  host: string;
  path: string;
  form: Record<string, string>;
}
const calls: Call[] = [];
/** Sıradaki yanıtlar (boşsa başarılı) */
let failures: Array<{ status: number; body: unknown }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
  calls.push({ host: u.hostname, path: u.pathname.replace(/^\/v[\d.]+/, ""), form });
  const fail = failures.shift();
  if (fail) return new Response(JSON.stringify(fail.body), { status: fail.status });
  if (u.pathname.endsWith("/messages")) return new Response(JSON.stringify({ recipient_id: "r", message_id: `mid-${calls.length}` }), { status: 200 });
  return new Response(JSON.stringify({ id: `pub-${calls.length}` }), { status: 200 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const nowSec = () => Math.floor(Date.now() / 1000);
const igComment = (id: string, text: string, opts: { from?: string; media?: string; parent?: string; account?: string; time?: number } = {}) => ({
  object: "instagram",
  entry: [
    {
      id: opts.account ?? "ig-acc",
      time: opts.time ?? nowSec(),
      changes: [
        {
          field: "comments",
          value: { id, text, parent_id: opts.parent, from: { id: opts.from ?? "u-1", username: "ogrenci" }, media: { id: opts.media ?? "media-1", media_product_type: "FEED" } },
        },
      ],
    },
  ],
});
async function deliver(body: unknown): Promise<void> {
  for (const ev of parseMetaWebhook(body as never)) await handleInbound(ev.provider, ev);
}
const queued = (channelId = ig.id) => privateRepliesRepo.list(org.id, { limit: 500 }).filter((r) => r.channelId === channelId);
const reset = () => {
  getDb().prepare("DELETE FROM private_replies").run();
  getDb().prepare("DELETE FROM comment_rules").run();
  calls.length = 0;
  failures = [];
};
const baseRule = {
  name: "Link isteyenlere DM",
  enabled: 1,
  channelId: null,
  mediaIds: [] as string[],
  matchType: "keyword" as const,
  pattern: "link*, indir*",
  dmText: "Merhaba {{name}}! Uygulama linki: https://ydsmatik.com",
  publicReplies: ["DM'den yazdım 📩", "Mesaj kutuna baktın mı? 📩"],
  includeReplies: 0,
  botNotice: 1,
  priority: 10,
};

/* ---------------- Saf fonksiyonlar ---------------- */

test("kural seçimi: kapalı kural, kanal, gönderi listesi, cevap yorumu ve metin", () => {
  const r = { ...baseRule, channelId: null as string | null };
  assert.equal(commentRuleApplies(r, "ch", "m1", "Link alabilir miyim?", false), true);
  assert.equal(commentRuleApplies({ ...r, enabled: 0 }, "ch", "m1", "link", false), false);
  assert.equal(commentRuleApplies({ ...r, channelId: "baska" }, "ch", "m1", "link", false), false);
  assert.equal(commentRuleApplies({ ...r, mediaIds: ["m2"] }, "ch", "m1", "link", false), false);
  assert.equal(commentRuleApplies({ ...r, mediaIds: ["m1"] }, "ch", "m1", "link", false), true);
  assert.equal(commentRuleApplies(r, "ch", "m1", "link", true), false, "cevap yorumu varsayılan olarak tetiklemez");
  assert.equal(commentRuleApplies({ ...r, includeReplies: 1 }, "ch", "m1", "link", true), true);
  assert.equal(commentRuleApplies(r, "ch", "m1", "harika video", false), false);
  assert.equal(commentRuleApplies({ ...r, matchType: "any" }, "ch", "m1", "harika video", false), true);
});

test("DM metni: isim yerleştirilir, otomatik mesaj notu eklenir; açık cevap varyasyonu seçilir", () => {
  assert.equal(buildDmText({ dmText: "Merhaba {{name}}!", botNotice: 1 }, "@ogrenci"), `Merhaba ogrenci!\n\n${BOT_NOTICE}`);
  assert.equal(buildDmText({ dmText: "Selam {{ isim }}", botNotice: 0 }, null), "Selam");
  assert.equal(pickPublicReply(["a", "b", "c"], () => 0), "a");
  assert.equal(pickPublicReply(["a", "b", "c"], () => 0.99), "c");
  assert.equal(pickPublicReply([" ", ""], () => 0), null);
  assert.equal(pickPublicReply([], () => 0), null);
});

/* ---------------- Uçtan uca ---------------- */

test("uyan yorum kuyruğa girer; aynı webhook tekrar gelirse ikinci kayıt oluşmaz", async () => {
  reset();
  commentRulesRepo.create(org.id, baseRule);
  const body = igComment("c-1", "Link alabilir miyim?");
  await deliver(body);
  await deliver(body);
  const rows = queued();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "queued");
  assert.equal(rows[0].commentId, "c-1");
  assert.equal(rows[0].commenterId, "u-1");
  assert.match(rows[0].dmText, /Merhaba ogrenci!/);
  assert.ok(rows[0].dmText.endsWith(BOT_NOTICE));
  assert.equal(calls.length, 0, "webhook sırasında Meta'ya istek gitmez; gönderimi kuyruk yapar");
});

test("kuyruk: özel yanıt comment_id alıcısıyla gider, sonra açık cevap yazılır, gelen kutusuna kaydedilir", async () => {
  const r = await processPrivateReplyQueue();
  assert.deepEqual(r, { sent: 1, processed: 1 });
  assert.equal(calls.length, 2);

  const dm = calls[0];
  assert.equal(dm.host, "graph.instagram.com");
  assert.equal(dm.path, "/ig-acc/messages");
  assert.deepEqual(JSON.parse(dm.form.recipient), { comment_id: "c-1" });
  assert.match(JSON.parse(dm.form.message).text, /ydsmatik\.com/);

  const pub = calls[1];
  assert.equal(pub.path, "/c-1/replies");
  assert.ok(baseRule.publicReplies.includes(pub.form.message));

  const row = privateRepliesRepo.get(ig.id, "c-1")!;
  assert.equal(row.status, "sent");
  assert.ok(row.dmMessageId?.startsWith("mid-"));
  assert.ok(row.publicReplyId?.startsWith("pub-"));
  assert.ok(row.sentAt);

  const conv = inboxRepo.findConversation(ig.id, "u-1")!;
  assert.ok(conv, "DM konuşması açılmalı");
  const out = inboxRepo.messages(conv.id, 10);
  assert.equal(out.length, 1);
  assert.equal(out[0].direction, "out");
  assert.equal(out[0].sentBy, "rule");
  assert.equal(out[0].ruleId, row.ruleId);

  assert.deepEqual(await processPrivateReplyQueue(), { sent: 0, processed: 0 }, "gönderilen kayıt tekrar işlenmez");
});

test("kişi aynı gönderide ikinci kez yorum yapınca tekrar DM gitmez; başka gönderide gider", async () => {
  await deliver(igComment("c-2", "link link!", { media: "media-1" }));
  await deliver(igComment("c-3", "linki atar mısın", { media: "media-2" }));
  const ids = queued().map((r) => r.commentId).sort();
  assert.deepEqual(ids, ["c-1", "c-3"]);
});

test("uymayan yorum, cevap yorumu ve kapalı kural kuyruğa girmez", async () => {
  reset();
  const rule = commentRulesRepo.create(org.id, baseRule);
  await deliver(igComment("d-1", "harika paylaşım", { from: "u-2" }));
  await deliver(igComment("d-2", "link?", { from: "u-3", parent: "d-1" }));
  commentRulesRepo.update(org.id, rule.id, { enabled: 0 });
  await deliver(igComment("d-3", "link?", { from: "u-4" }));
  assert.equal(queued().length, 0);
});

test("ücretsiz planda (gelen kutusu yok) yorumdan DM çalışmaz", async () => {
  reset();
  commentRulesRepo.create(freeOrg.id, baseRule);
  await deliver(igComment("f-1", "link?", { account: "ig-free" }));
  assert.equal(privateRepliesRepo.list(freeOrg.id).length, 0);
});

test("7 günden eski yorum kuyruğa girmez; kuyrukta 7 günü geçen kayıt 'expired' olur ve gönderilmez", async () => {
  reset();
  commentRulesRepo.create(org.id, baseRule);
  await deliver(igComment("e-1", "link?", { from: "u-5", time: nowSec() - 8 * 86400 }));
  assert.equal(queued().length, 0);

  await deliver(igComment("e-2", "link?", { from: "u-6" }));
  const later = new Date(Date.now() + 8 * 86400_000);
  await processPrivateReplyQueue(later);
  assert.equal(privateRepliesRepo.get(ig.id, "e-2")!.status, "expired");
  assert.equal(calls.length, 0);
});

test("kural gönderimden önce kapatılırsa ya da konuşma insana devredildiyse gönderilmez", async () => {
  reset();
  const rule = commentRulesRepo.create(org.id, baseRule);
  await deliver(igComment("k-1", "link?", { from: "u-7" }));
  commentRulesRepo.update(org.id, rule.id, { enabled: 0 });
  await processPrivateReplyQueue();
  assert.equal(privateRepliesRepo.get(ig.id, "k-1")!.status, "skipped");

  commentRulesRepo.update(org.id, rule.id, { enabled: 1 });
  const conv = inboxRepo.ensureConversation({ orgId: org.id, channelId: ig.id, externalId: "u-8", participantId: "u-8" });
  inboxRepo.setMode(conv.id, "manual");
  await deliver(igComment("k-2", "link?", { from: "u-8" }));
  await processPrivateReplyQueue();
  const row = privateRepliesRepo.get(ig.id, "k-2")!;
  assert.equal(row.status, "skipped");
  assert.match(row.error ?? "", /insana/);
  assert.equal(calls.length, 0);
});

test("kalıcı hata (4xx) tekrar denenmez, 'failed' olur ve etkinlik kaydına yazılır", async () => {
  reset();
  commentRulesRepo.create(org.id, { ...baseRule, publicReplies: [] });
  await deliver(igComment("h-1", "link?", { from: "u-9" }));
  failures = [{ status: 400, body: { error: { message: "This comment has already been replied to", code: 10900 } } }];
  await processPrivateReplyQueue();
  const row = privateRepliesRepo.get(ig.id, "h-1")!;
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 1);
  assert.match(row.error ?? "", /10900/);
  assert.equal(calls.length, 1);
  assert.ok(activityRepo.list(org.id, 20).some((a) => a.message.includes("yorumdan DM gönderilemedi")));
});

test("geçici hata (5xx) sonra yeniden denenir; zamanı gelmeden denenmez", async () => {
  reset();
  commentRulesRepo.create(org.id, { ...baseRule, publicReplies: [] });
  await deliver(igComment("g-1", "link?", { from: "u-10" }));
  const t0 = new Date();
  // http() kendi içinde 3 kez dener; üçü de 500 dönsün
  failures = Array.from({ length: 3 }, () => ({ status: 500, body: { error: { message: "geçici", code: 2 } } }));
  await processPrivateReplyQueue(t0);
  let row = privateRepliesRepo.get(ig.id, "g-1")!;
  assert.equal(row.status, "queued");
  assert.equal(row.attempts, 1);
  assert.ok(new Date(row.nextAttemptAt).getTime() >= t0.getTime() + 60_000);

  assert.deepEqual(await processPrivateReplyQueue(new Date(t0.getTime() + 30_000)), { sent: 0, processed: 0 });
  const r = await processPrivateReplyQueue(new Date(t0.getTime() + 61_000));
  assert.equal(r.sent, 1);
  row = privateRepliesRepo.get(ig.id, "g-1")!;
  assert.equal(row.status, "sent");
  assert.equal(row.attempts, 2);
});

test("saatlik sınır: kanal başına son bir saatte en fazla PRIVATE_REPLY_HOURLY_LIMIT deneme", async () => {
  reset();
  commentRulesRepo.create(org.id, { ...baseRule, publicReplies: [] });
  for (let i = 0; i < 12; i++) await deliver(igComment(`l-${i}`, "link?", { from: `lim-${i}`, media: "media-lim" }));
  const now = new Date(Date.now() + 1000);
  // Son bir saatte (sınırın 5 altı) deneme yapılmış kayıtlar
  const recent = new Date(now.getTime() - 30 * 60_000).toISOString();
  const ins = getDb().prepare(
    `INSERT INTO private_replies (channel_id, comment_id, org_id, rule_id, media_id, commenter_id, commented_at, status, attempts, next_attempt_at, last_attempt_at, dm_text, created_at, sent_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, 'sent', 1, ?, ?, 'x', ?, ?)`,
  );
  for (let i = 0; i < PRIVATE_REPLY_HOURLY_LIMIT - 5; i++) ins.run(ig.id, `old-${i}`, org.id, "media-old", `old-u-${i}`, recent, recent, recent, recent, recent);

  const r = await processPrivateReplyQueue(now);
  assert.equal(r.sent, 5, "sınıra kadar gönderilir");
  assert.equal(queued().filter((x) => x.status === "queued").length, 7, "kalanlar kuyrukta bekler");

  const later = await processPrivateReplyQueue(new Date(now.getTime() + 31 * 60_000));
  assert.equal(later.sent, 7, "eski denemeler bir saatten çıkınca kalanlar gider");
});

test("süreç gönderim sırasında kapandıysa takılı kayıt kuyruğa geri alınır", async () => {
  reset();
  commentRulesRepo.create(org.id, { ...baseRule, publicReplies: [] });
  await deliver(igComment("s-1", "link?", { from: "u-11" }));
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  getDb().prepare("UPDATE private_replies SET status = 'sending', attempts = 1, last_attempt_at = ? WHERE comment_id = 's-1'").run(stale);
  const r = await processPrivateReplyQueue();
  assert.equal(r.sent, 1);
  assert.equal(privateRepliesRepo.get(ig.id, "s-1")!.status, "sent");
});

test("Facebook sayfa yorumu: özel yanıt graph.facebook.com/{sayfa}/messages adresine gider", async () => {
  reset();
  commentRulesRepo.create(org.id, { ...baseRule, publicReplies: [] });
  await deliver({
    object: "page",
    entry: [
      {
        id: "page-1",
        changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "fc-1", post_id: "page-1_55", from: { id: "p-7", name: "Ayşe" }, message: "İndir linki?", created_time: nowSec() } }],
      },
    ],
  });
  await processPrivateReplyQueue();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, "graph.facebook.com");
  assert.equal(calls[0].path, "/page-1/messages");
  assert.deepEqual(JSON.parse(calls[0].form.recipient), { comment_id: "fc-1" });
  assert.equal(privateRepliesRepo.get(fbPage.id, "fc-1")!.status, "sent");
});

/* ---------------- Düğmeler ve hızlı cevaplar ---------------- */

const { metaMessagePayload, validateOutboundMessage } = await import("../src/providers/meta/common.js");
const { createCommentRule } = await import("../src/services/comment-automation.js");
import type { Ctx } from "../src/core/types.js";
const ownerCtx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };

test("mesaj biçimi: düz metin, button template ve hızlı cevaplar", () => {
  assert.deepEqual(metaMessagePayload({ text: "Selam" }), { text: "Selam" });
  const withButtons = metaMessagePayload({
    text: "Ne istersin?",
    buttons: [
      { type: "postback", title: "Seviye testi", payload: "p1" },
      { type: "web_url", title: "Siteye git", url: "https://ydsmatik.com" },
    ],
    quickReplies: [{ title: "Kelime", payload: "q1" }],
  });
  assert.deepEqual(withButtons, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: "Ne istersin?",
        buttons: [
          { type: "postback", title: "Seviye testi", payload: "p1" },
          { type: "web_url", url: "https://ydsmatik.com", title: "Siteye git" },
        ],
      },
    },
    quick_replies: [{ content_type: "text", title: "Kelime", payload: "q1" }],
  });
});

test("mesaj sınırları: 3 düğme, 13 hızlı cevap, 20 karakter başlık, https, 640 karakter", () => {
  const pb = (i: number) => ({ type: "postback" as const, title: `B${i}`, payload: `p${i}` });
  assert.throws(() => validateOutboundMessage({ text: "x", buttons: [pb(1), pb(2), pb(3), pb(4)] }), /3 düğme/);
  assert.throws(() => validateOutboundMessage({ text: "x", quickReplies: Array.from({ length: 14 }, (_, i) => ({ title: `Q${i}`, payload: `q${i}` })) }), /13 hızlı/);
  validateOutboundMessage({ text: "x", quickReplies: Array.from({ length: 13 }, (_, i) => ({ title: `Q${i}`, payload: `q${i}` })) });
  assert.throws(() => validateOutboundMessage({ text: "x", buttons: [{ type: "postback", title: "a".repeat(21), payload: "p" }] }), /20/);
  validateOutboundMessage({ text: "x", buttons: [{ type: "postback", title: "Öğretmenle konuş 📩", payload: "p" }] });
  // Emoji iki karakter sayılır (Meta'nın sayımı belirsiz; güvenli taraf)
  assert.throws(() => validateOutboundMessage({ text: "x", buttons: [{ type: "postback", title: "Öğretmenle konuş 📩📩", payload: "p" }] }), /20/);
  assert.throws(() => validateOutboundMessage({ text: "x", buttons: [{ type: "web_url", title: "Site", url: "http://ydsmatik.com" }] }), /https/);
  assert.throws(() => validateOutboundMessage({ text: "a".repeat(641), buttons: [pb(1)] }), /640/);
  validateOutboundMessage({ text: "a".repeat(641) });
  assert.throws(() => validateOutboundMessage({ text: "  " }), /boş/);
});

test("ayrıştırma: düğmeye basma (postback) ve hızlı cevap", () => {
  const evs = parseMetaWebhook({
    object: "instagram",
    entry: [
      {
        id: "ig-acc",
        time: nowSec(),
        messaging: [
          { sender: { id: "u-1" }, recipient: { id: "ig-acc" }, timestamp: Date.now(), postback: { mid: "pb-x", title: "Linki gönder", payload: "cr:r1:0" } },
          { sender: { id: "u-2" }, recipient: { id: "ig-acc" }, timestamp: Date.now(), message: { mid: "m-x", text: "Kelime", quick_reply: { payload: "q1" } } },
        ],
      },
    ],
  } as never);
  assert.equal(evs.length, 2);
  assert.deepEqual(evs[0].postback, { payload: "cr:r1:0", title: "Linki gönder" });
  assert.equal(evs[0].externalMessageId, "pb-x");
  assert.equal(evs[0].text, "Linki gönder");
  assert.deepEqual(evs[1].postback, { payload: "q1", title: "Kelime" });
});

test("kural doğrulaması: düğme ya bağlantı ya cevap olmalı, https, düğmeli DM 640 karakter", () => {
  reset();
  const base = { ...baseRule, enabled: 0 };
  assert.throws(() => createCommentRule(ownerCtx, { ...base, buttons: [{ title: "İkisi", url: "https://a.com", replyText: "x" }] }), /bağlantı ya da/);
  assert.throws(() => createCommentRule(ownerCtx, { ...base, buttons: [{ title: "Hiçbiri" }] }), /bağlantı ya da/);
  assert.throws(() => createCommentRule(ownerCtx, { ...base, buttons: [{ title: "Site", url: "http://a.com" }] }), /https/);
  assert.throws(() => createCommentRule(ownerCtx, { ...base, dmText: "a".repeat(620), buttons: [{ title: "Site", url: "https://a.com" }] }), /640/);
  const ok = createCommentRule(ownerCtx, { ...base, buttons: [{ title: "Site", url: "https://a.com" }] });
  assert.equal(ok.buttons.length, 1);
});

test("düğmeli ilk DM: button template gider; düğmeye basınca cevap bir kez gönderilir", async () => {
  reset();
  const rule = commentRulesRepo.create(org.id, {
    ...baseRule,
    publicReplies: [],
    buttons: [
      { title: "Linki gönder", replyText: "İşte link: https://ydsmatik.com 🎉" },
      { title: "Siteye git", url: "https://ydsmatik.com" },
    ],
  });
  await deliver(igComment("b-1", "link?", { from: "u-20" }));
  await processPrivateReplyQueue();
  assert.equal(calls.length, 1);
  const msg = JSON.parse(calls[0].form.message);
  assert.equal(msg.attachment.payload.template_type, "button");
  assert.deepEqual(msg.attachment.payload.buttons, [
    { type: "postback", title: "Linki gönder", payload: `cr:${rule.id}:0` },
    { type: "web_url", url: "https://ydsmatik.com", title: "Siteye git" },
  ]);
  const conv = inboxRepo.findConversation(ig.id, "u-20")!;
  assert.match(inboxRepo.messages(conv.id, 5)[0].text, /\[Linki gönder\] \[Siteye git\]$/);

  const tap = {
    object: "instagram",
    entry: [{ id: "ig-acc", time: nowSec(), messaging: [{ sender: { id: "u-20" }, recipient: { id: "ig-acc" }, timestamp: Date.now(), postback: { mid: "pb-1", title: "Linki gönder", payload: `cr:${rule.id}:0` } }] }],
  };
  calls.length = 0;
  await deliver(tap);
  await deliver(tap); // Meta aynı olayı tekrar gönderirse
  const sends = calls.filter((c) => c.path === "/ig-acc/messages");
  assert.equal(sends.length, 1, "cevap bir kez gitmeli");
  assert.deepEqual(JSON.parse(sends[0].form.recipient), { id: "u-20" });
  assert.equal(JSON.parse(sends[0].form.message).text, "İşte link: https://ydsmatik.com 🎉");
  const texts = inboxRepo.messages(conv.id, 10).map((m) => `${m.direction}:${m.text}`);
  // Aynı milisaniyedeki mesajların sırası değişebilir; içerik kontrol edilir
  assert.equal(texts.length, 3);
  assert.ok(texts.includes("in:Linki gönder"));
  assert.ok(texts.includes("out:İşte link: https://ydsmatik.com 🎉"));
});

test("düğmeye basıldığında kural kapalıysa ya da konuşma insandaysa cevap gitmez, ekip görür", async () => {
  const rule = commentRulesRepo.list(org.id)[0];
  const tap = (mid: string) => ({
    object: "instagram",
    entry: [{ id: "ig-acc", time: nowSec(), messaging: [{ sender: { id: "u-20" }, recipient: { id: "ig-acc" }, timestamp: Date.now(), postback: { mid, title: "Linki gönder", payload: `cr:${rule.id}:0` } }] }],
  });
  calls.length = 0;
  commentRulesRepo.update(org.id, rule.id, { enabled: 0 });
  await deliver(tap("pb-2"));
  commentRulesRepo.update(org.id, rule.id, { enabled: 1 });
  const conv = inboxRepo.findConversation(ig.id, "u-20")!;
  inboxRepo.setMode(conv.id, "manual");
  await deliver(tap("pb-3"));
  assert.equal(calls.filter((c) => c.path === "/ig-acc/messages").length, 0);
  assert.equal(inboxRepo.getConversationById(conv.id)!.needsAttention, 1);
});
