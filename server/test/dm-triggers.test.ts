import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * DM tetikleyicileri: hikâyede bahsetme, hikâyeye cevap ve ig.me/m.me ref bağlantısı.
 * Gerçek Meta'ya istek gitmez; fetch taklit edilir.
 */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sp-triggers-"));

const { orgsRepo, usersRepo, orgSettingsRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { inboxRepo } = await import("../src/core/repos/inbox.js");
const { rulesRepo } = await import("../src/core/repos/misc.js");
const { contactsRepo } = await import("../src/core/repos/contacts.js");
const { getDb } = await import("../src/core/db.js");
const { parseMetaWebhook } = await import("../src/providers/index.js");
const { handleInbound, ruleMatches, refMatches, isSignalOnly } = await import("../src/services/dm-engine.js");

const user = usersRepo.create({ email: "tetik@ornek.com", password: "Password123!", name: "Tetik", locale: "tr" });
const org = orgsRepo.create({ name: "Tetik Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-acc", name: "IG", accessToken: "tok", metadata: { igLogin: true } }).channel;
orgSettingsRepo.set(org.id, { replyDelaySeconds: 0, welcomeMessage: "", aiAutoReplyFallback: 0 });

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
  if (u.pathname.endsWith("/messages")) return new Response(JSON.stringify({ message_id: `mid-${++midSeq}` }), { status: 200 });
  return new Response(JSON.stringify({ username: "ogrenci" }), { status: 200 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const sends = () => calls.filter((c) => c.path === "/ig-acc/messages");
const sentTexts = () => sends().map((c) => JSON.parse(c.form.message).text as string);
const tick = () => new Promise((r) => setTimeout(r, 30));
let seq = 0;
const nowMs = () => Date.now() + ++seq; // her olay ayrı zaman damgası (tekrar eden webhook ayrımı)
const messaging = (m: Record<string, unknown>) => ({
  object: "instagram",
  entry: [{ id: "ig-acc", time: Math.floor(Date.now() / 1000), messaging: [{ recipient: { id: "ig-acc" }, timestamp: nowMs(), ...m }] }],
});
const storyMention = (from: string) =>
  messaging({ sender: { id: from }, message: { mid: `sm-${++seq}`, attachments: [{ type: "story_mention", payload: { url: "https://cdn.example/story.jpg" } }] } });
const storyReply = (from: string, text: string) =>
  messaging({ sender: { id: from }, message: { mid: `sr-${++seq}`, text, reply_to: { story: { id: "story-9", url: "https://cdn.example/s9.jpg" } } } });
const refClick = (from: string, ref: string, timestamp?: number) => ({
  object: "instagram",
  entry: [{ id: "ig-acc", time: Math.floor(Date.now() / 1000), messaging: [{ sender: { id: from }, recipient: { id: "ig-acc" }, timestamp: timestamp ?? nowMs(), referral: { ref, source: "IGME", type: "OPEN_THREAD" } }] }],
});
const dm = (from: string, text: string, extra: Record<string, unknown> = {}) => messaging({ sender: { id: from }, message: { mid: `in-${++seq}`, text, ...extra } });

async function deliver(body: unknown): Promise<void> {
  for (const ev of parseMetaWebhook(body as never)) await handleInbound(ev.provider, ev);
  await tick();
}
const baseRule = {
  enabled: 1,
  channelId: null,
  provider: null,
  pattern: null as string | null,
  replyMode: "template" as const,
  aiInstructions: null,
  priority: 100,
  cooldownMinutes: 0,
  onlyBusinessHours: 0,
  handoffToHuman: 0,
};
const reset = () => {
  getDb().prepare("DELETE FROM auto_reply_rules").run();
  calls.length = 0;
};

/* ---------------- Ayrıştırma ---------------- */

test("ayrıştırma: hikâyede bahsetme, hikâyeye cevap ve bağlantı tıklaması", () => {
  const [mention] = parseMetaWebhook(storyMention("u-1") as never);
  assert.deepEqual(mention.story, { kind: "mention", id: null, url: "https://cdn.example/story.jpg" });
  assert.equal(mention.text, "[hikâyede bahsetti]");

  const [reply] = parseMetaWebhook(storyReply("u-1", "Bu ne zaman?") as never);
  assert.deepEqual(reply.story, { kind: "reply", id: "story-9", url: "https://cdn.example/s9.jpg" });
  assert.equal(reply.text, "Bu ne zaman?");

  const [click] = parseMetaWebhook(refClick("u-1", " yds2026 ", 1700000000000) as never);
  assert.deepEqual(click.referral, { ref: "yds2026", source: "IGME", clickOnly: true });
  assert.equal(click.externalMessageId, "ref:u-1:1700000000000", "tekrar eden webhook aynı kimliği alır");
  assert.equal(click.text, "[bağlantı: yds2026]");

  // Yeni konuşmada ref ilk mesajla birlikte gelir: kişi yazdığı için clickOnly değil
  const [first] = parseMetaWebhook(dm("u-1", "Merhaba", { referral: { ref: "yds2026", source: "IGME" } }) as never);
  assert.deepEqual(first.referral, { ref: "yds2026", source: "IGME" });
  // "Başlarken" düğmesi (Messenger) ref'i postback içinde getirir
  const [start] = parseMetaWebhook(messaging({ sender: { id: "u-1" }, postback: { mid: "pb", title: "Başlarken", payload: "GET_STARTED", referral: { ref: "ilan" } } }) as never);
  assert.equal(start.referral?.ref, "ilan");
  // Boş ref yok sayılır
  assert.equal(parseMetaWebhook(refClick("u-1", "  ") as never).length, 0);
});

/* ---------------- Eşleştirme ---------------- */

test("eşleştirme: tetikleyici türleri ve metin kurallarının sinyal olaylarında çalışmaması", () => {
  const mention = { story: { kind: "mention" as const } };
  const reply = { story: { kind: "reply" as const } };
  const click = { referral: { ref: "yds", clickOnly: true } };
  assert.equal(ruleMatches({ matchType: "story_mention", pattern: null }, "", false, mention), true);
  assert.equal(ruleMatches({ matchType: "story_mention", pattern: null }, "", false, reply), false);
  assert.equal(ruleMatches({ matchType: "story_reply", pattern: null }, "harika", false, reply), true);
  assert.equal(ruleMatches({ matchType: "story_reply", pattern: "fiyat*" }, "fiyatı ne?", false, reply), true);
  assert.equal(ruleMatches({ matchType: "story_reply", pattern: "fiyat*" }, "harika", false, reply), false);
  assert.equal(ruleMatches({ matchType: "story_reply", pattern: null }, "harika", false, {}), false, "düz DM hikâye cevabı değildir");
  assert.equal(ruleMatches({ matchType: "ref", pattern: "yds" }, "", false, click), true);
  assert.equal(ruleMatches({ matchType: "ref", pattern: "ales" }, "", false, click), false);
  assert.equal(ruleMatches({ matchType: "ref", pattern: null }, "fiyat", false, {}), false, "ref'siz mesaj ref kuralına uymaz");
  // Kişi bir şey yazmadıysa metin kuralları çalışmaz
  assert.equal(isSignalOnly(mention), true);
  assert.equal(isSignalOnly(click), true);
  assert.equal(isSignalOnly(reply), false);
  assert.equal(ruleMatches({ matchType: "any", pattern: null }, "[hikâyede bahsetti]", true, mention), false);
  assert.equal(ruleMatches({ matchType: "first_contact", pattern: null }, "[bağlantı: yds]", true, click), false);
  assert.equal(ruleMatches({ matchType: "any", pattern: null }, "Bu ne zaman?", false, reply), true, "hikâye cevabı normal mesajdır");
});

test("ref eşleştirme: liste, büyük/küçük harf, Türkçe harf ve * öneki", () => {
  assert.equal(refMatches(null, "herhangi"), true);
  assert.equal(refMatches("", "herhangi"), true);
  assert.equal(refMatches("yds, ales", "ALES"), true);
  assert.equal(refMatches("kampanya*", "kampanya_ekim"), true);
  assert.equal(refMatches("kampanya", "kampanya_ekim"), false);
  assert.equal(refMatches("öğrenci", "OGRENCI"), true);
});

/* ---------------- Uçtan uca ---------------- */

test("hikâyede bahsetme kuralı teşekkür mesajı gönderir; kural yoksa 'her mesaj' kuralı çalışmaz, ekip görür", async () => {
  reset();
  rulesRepo.create(org.id, { ...baseRule, name: "Her mesaj", matchType: "any", replyText: "Genel cevap", priority: 5 });
  await deliver(storyMention("u-10"));
  assert.equal(sends().length, 0, "bahsetme metin kuralını tetiklememeli");
  const conv = inboxRepo.findConversation(ig.id, "u-10")!;
  assert.equal(inboxRepo.getConversationById(conv.id)!.needsAttention, 1);

  rulesRepo.create(org.id, { ...baseRule, name: "Bahsetme", matchType: "story_mention", replyText: "Hikâyende bizi andığın için teşekkürler {{name}}! 💛", priority: 10 });
  await deliver(storyMention("u-10"));
  assert.deepEqual(sentTexts(), ["Hikâyende bizi andığın için teşekkürler @ogrenci! 💛"]);
  assert.deepEqual(JSON.parse(sends()[0].form.recipient), { id: "u-10" });
});

test("hikâyeye cevap kuralı kelimeye göre çalışır; uymayan cevap normal kurallara düşer", async () => {
  reset();
  rulesRepo.create(org.id, { ...baseRule, name: "Hikâye fiyat", matchType: "story_reply", pattern: "fiyat*", replyText: "Fiyat listesi DM'de 👇", priority: 10 });
  rulesRepo.create(org.id, { ...baseRule, name: "Her mesaj", matchType: "any", replyText: "Genel cevap", priority: 50 });
  await deliver(storyReply("u-11", "fiyatı ne kadar?"));
  await deliver(storyReply("u-11", "çok güzel olmuş"));
  await deliver(dm("u-11", "fiyatı ne kadar?")); // hikâye cevabı değil
  assert.deepEqual(sentTexts(), ["Fiyat listesi DM'de 👇", "Genel cevap", "Genel cevap"]);
});

test("ig.me ref bağlantısı: uyan kural cevap verir, ref kişi kartına yazılır, tekrar eden webhook tek cevap", async () => {
  reset();
  rulesRepo.create(org.id, { ...baseRule, name: "YDS kampanyası", matchType: "ref", pattern: "yds*", replyText: "YDS denemesine hoş geldin! Linkin: https://ydsmatik.com", priority: 10 });
  const click = refClick("u-12", "yds_ekim");
  await deliver(click);
  await deliver(click); // Meta aynı olayı tekrar gönderirse
  assert.deepEqual(sentTexts(), ["YDS denemesine hoş geldin! Linkin: https://ydsmatik.com"]);
  assert.equal(contactsRepo.get(ig.id, "u-12")?.fields.ref, "yds_ekim");

  // Uymayan ref: cevap yok, ekip görür; mevcut kişi alanları korunur
  contactsRepo.upsert(org.id, ig.id, "u-13", { fields: { seviye: "B1" } });
  calls.length = 0;
  await deliver(refClick("u-13", "ales"));
  assert.equal(sends().length, 0);
  assert.deepEqual(contactsRepo.get(ig.id, "u-13")?.fields, { seviye: "B1", ref: "ales" });
  assert.equal(inboxRepo.getConversationById(inboxRepo.findConversation(ig.id, "u-13")!.id)!.needsAttention, 1);
});

test("yeni konuşmada ilk mesajla gelen ref: öncelik sırasıyla ref kuralı kazanır", async () => {
  reset();
  rulesRepo.create(org.id, { ...baseRule, name: "Kelime", matchType: "keyword", pattern: "merhaba", replyText: "Kelime cevabı", priority: 50 });
  rulesRepo.create(org.id, { ...baseRule, name: "Ref", matchType: "ref", pattern: "ales", replyText: "ALES cevabı", priority: 10 });
  await deliver(dm("u-14", "Merhaba", { referral: { ref: "ales", source: "IGME" } }));
  assert.deepEqual(sentTexts(), ["ALES cevabı"]);
});

test("çıkış listesindeki kişiye hikâye ve bağlantı kuralı da mesaj göndermez", async () => {
  reset();
  rulesRepo.create(org.id, { ...baseRule, name: "Bahsetme", matchType: "story_mention", replyText: "Teşekkürler", priority: 10 });
  contactsRepo.setOptOut(org.id, ig.id, "u-15", new Date().toISOString(), "test");
  await deliver(storyMention("u-15"));
  assert.equal(sends().length, 0);
});
