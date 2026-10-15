import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Sohbet menüsü: hazır sorular (ice breakers) ve sabit menü (persistent menu).
 * Messenger Profile API'ye giden istekler ve kişi bir öğeye basınca gelen cevap.
 * Gerçek Meta'ya istek gitmez; fetch taklit edilir.
 */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sp-dmprofile-"));

const { orgsRepo, usersRepo, orgSettingsRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { inboxRepo } = await import("../src/core/repos/inbox.js");
const { rulesRepo } = await import("../src/core/repos/misc.js");
const { dmProfilesRepo } = await import("../src/core/repos/dm-profile.js");
const { parseMetaWebhook } = await import("../src/providers/index.js");
const { handleInbound } = await import("../src/services/dm-engine.js");
const { getDmProfile, normalizeDmProfile, resyncDmProfile, saveDmProfile, toMessengerProfile } = await import("../src/services/dm-profile.js");
import type { Ctx } from "../src/core/types.js";

const user = usersRepo.create({ email: "menu@ornek.com", password: "Password123!", name: "Menü", locale: "tr" });
const org = orgsRepo.create({ name: "Menü Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
const ig = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-acc", name: "IG", accessToken: "tok", metadata: { igLogin: true } }).channel;
const igFb = channelsRepo.upsert({ orgId: org.id, provider: "instagram", externalId: "ig-2", name: "IG (FB)", accessToken: "page-tok", metadata: { pageId: "page-9" } }).channel;
const fbPage = channelsRepo.upsert({ orgId: org.id, provider: "facebook", externalId: "page-1", name: "Sayfa", accessToken: "tok" }).channel;
const tg = channelsRepo.upsert({ orgId: org.id, provider: "telegram", externalId: "bot-1", name: "TG", accessToken: "tok" }).channel;
const ctx: Ctx = { orgId: org.id, userId: user.id, role: "owner", via: "session", locale: "tr" };
orgSettingsRepo.set(org.id, { replyDelaySeconds: 0, welcomeMessage: "", aiAutoReplyFallback: 0 });

interface Call {
  host: string;
  method: string;
  path: string;
  /** POST gövdesi ya da GET/DELETE sorgusu */
  params: Record<string, string>;
}
const calls: Call[] = [];
let midSeq = 0;
let failNext: { status: number; body: unknown } | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  const method = init?.method ?? "GET";
  const params = method === "POST" ? Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) : Object.fromEntries(u.searchParams);
  calls.push({ host: u.hostname, method, path: u.pathname.replace(/^\/v[\d.]+/, ""), params });
  if (failNext) {
    const f = failNext;
    failNext = null;
    return new Response(JSON.stringify(f.body), { status: f.status });
  }
  if (u.pathname.endsWith("/messages")) return new Response(JSON.stringify({ message_id: `mid-${++midSeq}` }), { status: 200 });
  if (u.pathname.endsWith("/messenger_profile")) return new Response(JSON.stringify({ result: "success" }), { status: 200 });
  return new Response(JSON.stringify({ username: "ogrenci" }), { status: 200 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const profileCalls = () => calls.filter((c) => c.path.endsWith("/messenger_profile"));
const sends = () => calls.filter((c) => c.path === "/ig-acc/messages");
const tick = () => new Promise((r) => setTimeout(r, 30));
let seq = 0;
const tap = (from: string, payload: string, title: string) => ({
  object: "instagram",
  entry: [{ id: "ig-acc", time: Math.floor(Date.now() / 1000), messaging: [{ sender: { id: from }, recipient: { id: "ig-acc" }, timestamp: Date.now(), postback: { mid: `pb-${++seq}`, title, payload } }] }],
});
async function deliver(body: unknown): Promise<void> {
  for (const ev of parseMetaWebhook(body as never)) await handleInbound(ev.provider, ev);
  await tick();
}

const PROFILE = {
  iceBreakers: [
    { title: "  Fiyatlar  nedir? ", replyText: "Aylık 99 TL, ilk hafta ücretsiz 🎉" },
    { title: "Nasıl başlarım?", replyText: "" },
    { title: "   " }, // boş başlık atılır
  ],
  menu: [
    { title: "Siteye git", url: "https://ydsmatik.com", replyText: "kullanılmaz" },
    { title: "Destek", replyText: "Sorunu yaz, ekip dönecek." },
  ],
};

/* ---------------- Saf fonksiyonlar ---------------- */

test("düzenleme: kırpma, boş öğeler, bağlantı yalnızca menüde; Meta payload'ları", () => {
  const n = normalizeDmProfile({ iceBreakers: [...PROFILE.iceBreakers, { title: "Link?", url: "https://x.com", replyText: "Link burada" }], menu: PROFILE.menu });
  assert.deepEqual(n.iceBreakers, [
    { title: "Fiyatlar nedir?", url: null, replyText: "Aylık 99 TL, ilk hafta ücretsiz 🎉" },
    { title: "Nasıl başlarım?", url: null, replyText: null },
    { title: "Link?", url: null, replyText: "Link burada" },
  ]);
  assert.deepEqual(n.menu, [
    { title: "Siteye git", url: "https://ydsmatik.com", replyText: null },
    { title: "Destek", url: null, replyText: "Sorunu yaz, ekip dönecek." },
  ]);
  assert.deepEqual(toMessengerProfile(n), {
    iceBreakers: [
      { question: "Fiyatlar nedir?", payload: "ib:0" },
      { question: "Nasıl başlarım?", payload: "ib:1" },
      { question: "Link?", payload: "ib:2" },
    ],
    menu: [
      { type: "web_url", title: "Siteye git", url: "https://ydsmatik.com" },
      { type: "postback", title: "Destek", payload: "pm:1" },
    ],
  });
});

test("sınırlar: 4 hazır soru, 80 karakter; 20 menü öğesi, 30 karakter, https", () => {
  const q = (title: string) => ({ title, replyText: "x" });
  assert.throws(() => normalizeDmProfile({ iceBreakers: [q("a"), q("b"), q("c"), q("d"), q("e")], menu: [] }), { key: "dm_profile.ice_breakers" });
  assert.throws(() => normalizeDmProfile({ iceBreakers: [q("a".repeat(81))], menu: [] }), { key: "dm_profile.ice_breaker_chars" });
  assert.throws(() => normalizeDmProfile({ iceBreakers: [], menu: Array.from({ length: 21 }, (_, i) => q(`m${i}`)) }), { key: "dm_profile.menu" });
  assert.throws(() => normalizeDmProfile({ iceBreakers: [], menu: [q("a".repeat(31))] }), { key: "dm_profile.menu_chars" });
  assert.throws(() => normalizeDmProfile({ iceBreakers: [], menu: [{ title: "Site", url: "http://x.com" }] }), { key: "dm_profile.url" });
});

/* ---------------- Meta'ya gönderim ---------------- */

test("Instagram Login kanalı: graph.instagram.com/me/messenger_profile, platform=instagram", async () => {
  calls.length = 0;
  const saved = await saveDmProfile(ctx, ig.id, PROFILE);
  assert.equal(saved.syncError, null);
  assert.ok(saved.syncedAt);
  const [post] = profileCalls();
  assert.equal(post.host, "graph.instagram.com");
  assert.equal(post.method, "POST");
  assert.equal(post.path, "/me/messenger_profile");
  assert.equal(post.params.platform, "instagram");
  assert.deepEqual(JSON.parse(post.params.ice_breakers), [
    {
      locale: "default",
      call_to_actions: [
        { question: "Fiyatlar nedir?", payload: "ib:0" },
        { question: "Nasıl başlarım?", payload: "ib:1" },
      ],
    },
  ]);
  assert.deepEqual(JSON.parse(post.params.persistent_menu), [
    {
      locale: "default",
      call_to_actions: [
        { type: "web_url", title: "Siteye git", url: "https://ydsmatik.com" },
        { type: "postback", title: "Destek", payload: "pm:1" },
      ],
    },
  ]);
  assert.equal(post.params.get_started, undefined, "Instagram'da Başlarken düğmesi yok");
  assert.equal(profileCalls().length, 1, "boş alan yoksa silme isteği gitmez");
  assert.equal(getDmProfile(ctx, ig.id).iceBreakers.length, 2);
});

test("menü boşaltılınca Meta'daki sabit menü DELETE ile kaldırılır", async () => {
  calls.length = 0;
  await saveDmProfile(ctx, ig.id, { iceBreakers: PROFILE.iceBreakers, menu: [] });
  const [post, del] = profileCalls();
  assert.equal(post.method, "POST");
  assert.equal(post.params.persistent_menu, undefined);
  assert.equal(del.method, "DELETE");
  assert.deepEqual(JSON.parse(del.params.fields), ["persistent_menu"]);
  assert.equal(del.params.platform, "instagram");

  calls.length = 0;
  await saveDmProfile(ctx, ig.id, { iceBreakers: [], menu: [] });
  assert.deepEqual(
    profileCalls().map((c) => c.method),
    ["DELETE"],
  );
  assert.deepEqual(JSON.parse(profileCalls()[0].params.fields), ["ice_breakers", "persistent_menu"]);
});

test("Facebook sayfası: /{sayfa}/messenger_profile, menü varsa Başlarken düğmesi de ayarlanır; FB Login Instagram bağlı sayfa üzerinden", async () => {
  calls.length = 0;
  await saveDmProfile(ctx, fbPage.id, PROFILE);
  const [post] = profileCalls();
  assert.equal(post.host, "graph.facebook.com");
  assert.equal(post.path, "/page-1/messenger_profile");
  assert.equal(post.params.platform, undefined);
  assert.deepEqual(JSON.parse(post.params.get_started), { payload: "GET_STARTED" });

  calls.length = 0;
  await saveDmProfile(ctx, igFb.id, PROFILE);
  assert.equal(profileCalls()[0].host, "graph.facebook.com");
  assert.equal(profileCalls()[0].path, "/page-9/messenger_profile");
  assert.equal(profileCalls()[0].params.platform, "instagram");
  assert.equal(profileCalls()[0].params.access_token, "page-tok");
});

test("Meta hata verirse menü yine kaydedilir, hata syncError'da görünür; yeniden gönderim düzeltir", async () => {
  failNext = { status: 400, body: { error: { message: "(#100) Invalid platform", code: 100 } } };
  const saved = await saveDmProfile(ctx, ig.id, PROFILE);
  assert.match(saved.syncError ?? "", /Invalid platform/);
  assert.equal(saved.menu.length, 2, "yerel kayıt korunur");
  const again = await resyncDmProfile(ctx, ig.id);
  assert.equal(again.syncError, null);
});

test("yetki ve kanal: editör kaydedemez; Telegram kanalında sohbet menüsü yok", async () => {
  await assert.rejects(() => saveDmProfile({ ...ctx, role: "editor" }, ig.id, PROFILE));
  await assert.rejects(() => saveDmProfile(ctx, tg.id, PROFILE), { key: "dm_profile.provider" });
  assert.throws(() => getDmProfile(ctx, "yok"));
});

/* ---------------- Kişi bir öğeye basınca ---------------- */

test("hazır soruya basınca öğenin cevabı gider; tekrar eden webhook tek cevap", async () => {
  await saveDmProfile(ctx, ig.id, PROFILE);
  calls.length = 0;
  const ev = tap("u-1", "ib:0", "Fiyatlar nedir?");
  await deliver(ev);
  await deliver(ev);
  assert.equal(sends().length, 1);
  assert.equal(JSON.parse(sends()[0].params.message).text, "Aylık 99 TL, ilk hafta ücretsiz 🎉");
  assert.deepEqual(JSON.parse(sends()[0].params.recipient), { id: "u-1" });
});

test("sabit menü öğesi cevap verir; menü değiştiyse başlıkla doğru öğe bulunur", async () => {
  calls.length = 0;
  await deliver(tap("u-2", "pm:1", "Destek"));
  assert.equal(JSON.parse(sends()[0].params.message).text, "Sorunu yaz, ekip dönecek.");
  // Sıra kaydı: Destek artık 0. sırada, eski payload pm:1 gelirse başlıkla bulunur
  dmProfilesRepo.save(org.id, ig.id, { iceBreakers: [], menu: [{ title: "Destek", replyText: "Yeni destek metni" }, { title: "Kampanya", replyText: "Kampanya metni" }] });
  calls.length = 0;
  await deliver(tap("u-2", "pm:1", "Destek"));
  assert.equal(JSON.parse(sends()[0].params.message).text, "Yeni destek metni");
});

test("cevabı boş hazır soru normal DM kurallarına düşer; konuşma insandaysa cevap gitmez", async () => {
  dmProfilesRepo.save(org.id, ig.id, normalizeDmProfile(PROFILE));
  rulesRepo.create(org.id, {
    name: "Başlangıç",
    enabled: 1,
    channelId: null,
    provider: null,
    matchType: "keyword",
    pattern: "başla*",
    replyMode: "template",
    replyText: "Önce seviye testini çöz: https://ydsmatik.com/test",
    aiInstructions: null,
    priority: 10,
    cooldownMinutes: 0,
    onlyBusinessHours: 0,
    handoffToHuman: 0,
  });
  calls.length = 0;
  await deliver(tap("u-3", "ib:1", "Nasıl başlarım?"));
  assert.equal(JSON.parse(sends()[0].params.message).text, "Önce seviye testini çöz: https://ydsmatik.com/test");

  const conv = inboxRepo.findConversation(ig.id, "u-3")!;
  inboxRepo.setMode(conv.id, "manual");
  calls.length = 0;
  await deliver(tap("u-3", "ib:0", "Fiyatlar nedir?"));
  assert.equal(sends().length, 0);
  assert.equal(inboxRepo.getConversationById(conv.id)!.needsAttention, 1);
});
