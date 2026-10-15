import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Meta mesajlaşma kuralları: 24 saat penceresi, HUMAN_AGENT (7 gün), çıkış listesi ve kişi kartı.
 * Gerçek Meta'ya istek gitmez; fetch taklit edilir.
 */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sp-policy-"));

const { orgsRepo, usersRepo, orgSettingsRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { inboxRepo } = await import("../src/core/repos/inbox.js");
const { rulesRepo } = await import("../src/core/repos/misc.js");
const { contactsRepo } = await import("../src/core/repos/contacts.js");
const { commentRulesRepo, privateRepliesRepo } = await import("../src/core/repos/comment-automation.js");
const { parseMetaWebhook } = await import("../src/providers/index.js");
const { handleInbound, replyToConversation, sendReply } = await import("../src/services/dm-engine.js");
const { decideSend, HUMAN_AGENT_WINDOW_MS, STANDARD_WINDOW_MS } = await import("../src/services/messaging-policy.js");
const { getContact, updateContact, normalizeContactPatch } = await import("../src/services/contacts.js");
const { processPrivateReplyQueue } = await import("../src/services/comment-automation.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "pencere@ornek.com", password: "Password123!", name: "Pencere", locale: "tr" });
const org = orgsRepo.create({ name: "Pencere Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-acc", name: "IG", accessToken: "tok", metadata: { igLogin: true } }).channel;
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };
orgSettingsRepo.set(org.id, { replyDelaySeconds: 0 });

interface Call {
  path: string;
  form: Record<string, string>;
}
const calls: Call[] = [];
let midSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  calls.push({ path: u.pathname.replace(/^\/v[\d.]+/, ""), form: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
  // Sayaç testlerde sıfırlandığı için mesaj kimliği ayrı sayaçtan (aynı konuşmada tekrar etmesin)
  if (u.pathname.endsWith("/messages")) return new Response(JSON.stringify({ message_id: `mid-${++midSeq}` }), { status: 200 });
  return new Response(JSON.stringify({ name: "Öğrenci", username: "ogrenci" }), { status: 200 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const sends = () => calls.filter((c) => c.path === "/ig-acc/messages");
const tick = () => new Promise((r) => setTimeout(r, 30));
let seq = 0;
const dm = (from: string, text: string, at = Date.now()) => ({
  object: "instagram",
  entry: [{ id: "ig-acc", time: Math.floor(at / 1000), messaging: [{ sender: { id: from }, recipient: { id: "ig-acc" }, timestamp: at, message: { mid: `in-${++seq}`, text } }] }],
});
async function deliver(body: unknown): Promise<void> {
  for (const ev of parseMetaWebhook(body as never)) await handleInbound(ev.provider, ev);
  await tick();
}

/* ---------------- Karar kuralları ---------------- */

test("karar: 24 saat içinde her mesaj; sonra otomatik engellenir, insan 7 güne kadar HUMAN_AGENT ile", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  assert.deepEqual(decideSend({ lastUserMessageAt: ago(STANDARD_WINDOW_MS - 60_000), optedOut: false, sentBy: "rule", now }), { ok: true });
  assert.equal(decideSend({ lastUserMessageAt: ago(STANDARD_WINDOW_MS + 60_000), optedOut: false, sentBy: "rule", now }).ok, false);
  assert.equal(decideSend({ lastUserMessageAt: ago(STANDARD_WINDOW_MS + 60_000), optedOut: false, sentBy: "ai", now }).ok, false);
  assert.deepEqual(decideSend({ lastUserMessageAt: ago(3 * 86400_000), optedOut: false, sentBy: "user", now }), { ok: true, tag: "HUMAN_AGENT" });
  const late = decideSend({ lastUserMessageAt: ago(HUMAN_AGENT_WINDOW_MS + 60_000), optedOut: false, sentBy: "user", now });
  assert.equal(late.ok, false);
  assert.equal(late.ok === false && late.code, "human_agent_expired");
  assert.equal(decideSend({ lastUserMessageAt: null, optedOut: false, sentBy: "rule", now }).ok, false, "hiç yazmamış kişiye otomatik mesaj yok");
  const opted = decideSend({ lastUserMessageAt: ago(60_000), optedOut: true, sentBy: "rule", now });
  assert.equal(opted.ok === false && opted.code, "opted_out");
  assert.deepEqual(decideSend({ lastUserMessageAt: ago(60_000), optedOut: true, sentBy: "user", now }), { ok: true }, "insan cevabı çıkış listesinden etkilenmez");
});

/* ---------------- Uçtan uca ---------------- */

test("pencere açıkken kural cevabı normal (RESPONSE) gider", async () => {
  rulesRepo.create(org.id, {
    name: "Selam",
    enabled: 1,
    channelId: null,
    provider: null,
    matchType: "keyword",
    pattern: "merhaba",
    replyMode: "template",
    replyText: "Selam!",
    aiInstructions: null,
    priority: 10,
    cooldownMinutes: 0,
    onlyBusinessHours: 0,
    handoffToHuman: 0,
  });
  await deliver(dm("u-1", "merhaba"));
  assert.equal(sends().length, 1);
  assert.equal(sends()[0].form.messaging_type, "RESPONSE");
  assert.equal(sends()[0].form.tag, undefined);
});

test("pencere kapalıyken otomatik mesaj gönderilmez, 'failed' ve açıklamayla kaydedilir", async () => {
  calls.length = 0;
  await deliver(dm("u-2", "bir soru", Date.now() - 2 * 86400_000));
  calls.length = 0; // ilk kayıttaki profil sorgusu ve olası cevaplar sayılmasın
  const conv = inboxRepo.findConversation(ig.id, "u-2")!;
  const msg = await sendReply(ig, conv, "Otomatik hatırlatma", "rule");
  assert.equal(msg.status, "failed");
  assert.match(msg.error ?? "", /24 saatlik/);
  assert.equal(sends().length, 0);
});

test("insan cevabı 24 saat dışında HUMAN_AGENT etiketiyle gider; 7 günden sonra hata verir", async () => {
  const conv = inboxRepo.findConversation(ig.id, "u-2")!;
  calls.length = 0;
  const msg = await replyToConversation(ctx, conv.id, "Merhaba, geç dönüş için kusura bakma");
  assert.equal(msg.status, "sent");
  assert.equal(sends().length, 1);
  assert.equal(sends()[0].form.messaging_type, "MESSAGE_TAG");
  assert.equal(sends()[0].form.tag, "HUMAN_AGENT");

  await deliver(dm("u-3", "eski mesaj", Date.now() - 8 * 86400_000));
  const old = inboxRepo.findConversation(ig.id, "u-3")!;
  calls.length = 0;
  await assert.rejects(() => replyToConversation(ctx, old.id, "çok geç"), /7 günden fazla/);
  assert.equal(sends().length, 0);
});

test("çıkış: 'DURDUR' yazana bir kez onay gider, sonra hiçbir otomatik mesaj gitmez", async () => {
  orgSettingsRepo.set(org.id, { optOutReply: "Tamam {{name}}, otomatik mesaj gelmeyecek." });
  await deliver(dm("u-4", "merhaba"));
  calls.length = 0;
  await deliver(dm("u-4", "DURDUR lütfen"));
  assert.equal(sends().length, 1);
  assert.match(JSON.parse(sends()[0].form.message).text, /otomatik mesaj gelmeyecek/);
  assert.ok(contactsRepo.isOptedOut(ig.id, "u-4"));
  const conv = inboxRepo.findConversation(ig.id, "u-4")!;
  assert.equal(conv.mode, "manual");

  calls.length = 0;
  inboxRepo.setMode(conv.id, "auto"); // biri yanlışlıkla otomatiğe alsa bile
  await deliver(dm("u-4", "merhaba"));
  assert.equal(sends().length, 0, "çıkış yapan kişiye kural cevabı gitmez");
  const auto = await sendReply(ig, inboxRepo.findConversation(ig.id, "u-4")!, "kampanya!", "rule");
  assert.equal(auto.status, "failed");
  assert.match(auto.error ?? "", /durdurdu/);

  const human = await replyToConversation(ctx, conv.id, "Tabii, sorun olursa buradayız.");
  assert.equal(human.status, "sent", "insan cevabı gider");
});

test("çıkış listesindeki kişiye yorumdan DM de gitmez", async () => {
  commentRulesRepo.create(org.id, {
    name: "Link",
    enabled: 1,
    channelId: null,
    mediaIds: [],
    matchType: "any",
    pattern: null,
    dmText: "Link burada",
    publicReplies: [],
    includeReplies: 0,
    botNotice: 1,
    buttons: [],
    priority: 1,
  });
  await deliver({
    object: "instagram",
    entry: [{ id: "ig-acc", time: Math.floor(Date.now() / 1000), changes: [{ field: "comments", value: { id: "cm-9", text: "link?", from: { id: "u-4", username: "ogr" }, media: { id: "m-1" } } }] }],
  });
  calls.length = 0;
  await processPrivateReplyQueue();
  assert.equal(sends().length, 0);
  const row = privateRepliesRepo.get(ig.id, "cm-9")!;
  assert.equal(row.status, "skipped");
  assert.match(row.error ?? "", /durdurdu/);
});

test("kişi kartı: etiketler, alanlar, pencere zamanı ve çıkıştan geri alma", () => {
  const conv = inboxRepo.findConversation(ig.id, "u-4")!;
  let card = getContact(ctx, conv.id);
  assert.ok(card.optedOutAt);
  assert.equal(card.metaWindow, true);
  assert.ok(card.lastUserMessageAt);
  assert.equal(new Date(card.windowOpenUntil!).getTime() - new Date(card.lastUserMessageAt!).getTime(), STANDARD_WINDOW_MS);

  card = updateContact(ctx, conv.id, { tags: [" YDS ", "yds", "B1 hedefi"], fields: { seviye: "B1", eposta: "ogr@ornek.com", bos: "  " } });
  assert.deepEqual(card.tags, ["YDS", "B1 hedefi"]);
  assert.deepEqual(card.fields, { seviye: "B1", eposta: "ogr@ornek.com" });

  card = updateContact(ctx, conv.id, { optedOut: false });
  assert.equal(card.optedOutAt, null);
  assert.ok(!contactsRepo.isOptedOut(ig.id, "u-4"));
  assert.deepEqual(card.tags, ["YDS", "B1 hedefi"], "çıkıştan geri alma etiketleri silmez");

  const viewer: Ctx = { ...ctx, role: "viewer" };
  assert.throws(() => updateContact(viewer, conv.id, { tags: ["x"] }));
});

test("etiket ve alan sınırları", () => {
  const p = normalizeContactPatch({ tags: Array.from({ length: 30 }, (_, i) => `t${i}`), fields: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, "v"])) });
  assert.equal(p.tags!.length, 20);
  assert.equal(Object.keys(p.fields!).length, 20);
  assert.equal(normalizeContactPatch({ tags: ["a".repeat(60)] }).tags![0].length, 40);
});

test("yorum yazmak 24 saat penceresini açmaz; konuşma kimliği kişi kimliğinden farklı olsa da pencere bulunur", async () => {
  await deliver({
    object: "instagram",
    entry: [{ id: "ig-acc", time: Math.floor(Date.now() / 1000), changes: [{ field: "comments", value: { id: "cm-w", text: "harika", from: { id: "u-7", username: "yorumcu" }, media: { id: "m-2" } } }] }],
  });
  assert.equal(contactsRepo.lastUserMessageAt(ig.id, "u-7"), null, "yorum sayılmaz");
  const dmConv = inboxRepo.ensureConversation({ orgId: org.id, channelId: ig.id, externalId: "u-7", participantId: "u-7" });
  const blocked = await sendReply(ig, dmConv, "Merhaba!", "rule");
  assert.equal(blocked.status, "failed");

  // Konuşma kimliği farklı (ör. simülasyon) ama kişi aynı: pencere kişiye göre hesaplanır
  inboxRepo.recordInbound({ orgId: org.id, channelId: ig.id, conversationExternalId: "sim:u-8", participantId: "u-8", text: "selam" });
  assert.ok(contactsRepo.lastUserMessageAt(ig.id, "u-8"));
});
