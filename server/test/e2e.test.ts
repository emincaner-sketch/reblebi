import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";

/**
 * Uçtan uca: HTTP API + uzaktan MCP + OAuth 2.1 + çok kiracılı izolasyon.
 * Gerçek platform API'lerine gidilmez; kanallar test verisi olarak eklenir.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-e2e-"));
process.env.DATA_DIR = dir;
process.env.PUBLIC_URL = "http://localhost:4100";
process.env.APP_URL = "http://localhost:5173";
process.env.SIGNUP_MODE = "open";
process.env.TRIAL_DAYS = "14";
process.env.RATE_LIMIT_PER_MINUTE = "10000";
process.env.DISABLE_SCHEDULER = "1";
process.env.ANTHROPIC_API_KEY = "";

const ORIGIN = "http://localhost:5173";
let app: FastifyInstance;
let channelsRepo: typeof import("../src/core/repos/channels.js").channelsRepo;
let usageRepo: typeof import("../src/core/repos/misc.js").usageRepo;
let devOutbox: typeof import("../src/services/mailer.js").devOutbox;

type Json = Record<string, any>;

function cookieOf(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

async function call(method: string, url: string, opts: { cookie?: string; bearer?: string; body?: unknown; origin?: string | null; headers?: Record<string, string>; form?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.origin !== null && method !== "GET") headers.origin = opts.origin ?? ORIGIN;
  let payload: string | undefined;
  if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(opts.form).toString();
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(opts.body);
  }
  const res = await app.inject({ method: method as "GET", url, headers, payload });
  let json: Json = {};
  try {
    json = res.body ? JSON.parse(res.body) : {};
  } catch {
    json = { raw: res.body };
  }
  return { status: res.statusCode, json, res };
}

async function mcp(token: string, method: string, params: Json = {}, id = 1) {
  const res = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    payload: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as Json) : {}, headers: res.headers };
}

async function mcpInit(token: string) {
  const r = await mcp(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

function toolJson(r: { json: Json }): Json {
  const text = r.json.result?.content?.[0]?.text ?? "{}";
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

let owner = "";
let orgId = "";
let tg = "";
let ig = "";
let xch = "";
let apiKey = "";

before(async () => {
  const { buildServer } = await import("../src/api/server.js");
  ({ channelsRepo } = await import("../src/core/repos/channels.js"));
  ({ usageRepo } = await import("../src/core/repos/misc.js"));
  ({ devOutbox } = await import("../src/services/mailer.js"));
  app = await buildServer();
  await app.ready();
});

after(async () => {
  await app?.close();
});

describe("hesap ve çalışma alanı", () => {
  test("ilk kullanıcı kaydı: süper admin + sınırsız plan", async () => {
    const r = await call("POST", "/api/auth/signup", { body: { email: "sahip@ornek.com", password: "Guclu-Sifre-123", name: "Sahip", orgName: "Ajans A", locale: "tr" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    owner = cookieOf(r.res);
    assert.ok(owner.includes("sp_session="));
    const me = await call("GET", "/api/auth/me", { cookie: owner });
    assert.equal(me.json.user.isSuperadmin, true);
    assert.equal(me.json.org.plan, "unlimited");
    assert.equal(me.json.role, "owner");
    orgId = me.json.org.id;
  });

  test("CSRF: başka kökenden çerezli istek reddedilir", async () => {
    const r = await call("PATCH", "/api/org", { cookie: owner, body: { name: "x" }, origin: "https://kotu-site.com" });
    assert.equal(r.status, 403);
  });

  test("hatalı şifre -> 401, doğru şifre -> oturum", async () => {
    assert.equal((await call("POST", "/api/auth/login", { body: { email: "sahip@ornek.com", password: "yanlis-sifre" } })).status, 401);
    assert.equal((await call("POST", "/api/auth/login", { body: { email: "sahip@ornek.com", password: "Guclu-Sifre-123" } })).status, 200);
  });

  test("hata mesajları kullanıcının dilinde", async () => {
    const r = await call("GET", "/api/posts/yok", { cookie: owner, headers: { "x-locale": "en" } });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, "Post not found");
  });
});

describe("kanallar, boş saatler ve gönderiler", () => {
  test("test kanalları ve paylaşım saatleri", async () => {
    tg = channelsRepo.upsert({ orgId, provider: "telegram", externalId: "tg1", name: "Kanal TG", accessToken: "x", metadata: { chatId: "-1" } }).channel.id;
    ig = channelsRepo.upsert({ orgId, provider: "instagram", externalId: "ig1", name: "Marka IG", accessToken: "x" }).channel.id;
    xch = channelsRepo.upsert({ orgId, provider: "x", externalId: "x1", name: "Marka X", accessToken: "x" }).channel.id;
    const r = await call("PATCH", `/api/channels/${tg}`, { cookie: owner, body: { postingTimes: ["09:00", "18:30", "12:00"] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.postingTimes, ["09:00", "12:00", "18:30"]);
  });

  test("boş saatler kanal saatlerine oturur ve çakışmaz", async () => {
    const r = await call("GET", `/api/slots?channelIds=${tg}&count=4`, { cookie: owner });
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 4);
    const times = r.json.map((s: Json) => s.at);
    assert.equal(new Set(times).size, 4);
    for (const s of r.json) assert.match(s.local, /(09:00|12:00|18:30)/);
  });

  test("doğrulama: Instagram medyasız planlanamaz, taslakta uyarı olur", async () => {
    const scheduled = await call("POST", "/api/posts/validate", { cookie: owner, body: { content: "merhaba", targets: [{ channelId: ig }], publishAt: "next_slot" } });
    assert.equal(scheduled.json.ok, false);
    assert.ok(scheduled.json.errors.some((e: string) => /görsel|video/i.test(e)));
    const draft = await call("POST", "/api/posts/validate", { cookie: owner, body: { content: "merhaba", targets: [{ channelId: ig }], publishAt: "next_slot", draft: true } });
    assert.equal(draft.json.ok, true);
    assert.equal(draft.json.status, "draft");
    assert.ok(draft.json.warnings.length > 0);
  });

  test("X karakter sınırı ve zincir bölme", async () => {
    const long = "a".repeat(300);
    const bad = await call("POST", "/api/posts/validate", { cookie: owner, body: { content: long, targets: [{ channelId: xch }], publishAt: "next_slot" } });
    assert.equal(bad.json.ok, false);
    const thread = await call("POST", "/api/posts/validate", {
      cookie: owner,
      body: { kind: "thread", content: "birinci\n---\nikinci", targets: [{ channelId: xch }], publishAt: "next_slot" },
    });
    assert.equal(thread.json.ok, true, JSON.stringify(thread.json));
  });

  test("next_slot ile planlı gönderi + ilk yorum + etiket", async () => {
    const r = await call("POST", "/api/posts", {
      cookie: owner,
      body: { content: "Yeni sezon başladı", targets: [{ channelId: tg }], publishAt: "next_slot", firstComment: "Detaylar: örnek.com", tags: ["lansman"] },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.status, "scheduled");
    assert.ok(r.json.publishAt);
    assert.equal(r.json.comments[0].text, "Detaylar: örnek.com");
    assert.equal(r.json.tags.length, 1);
  });

  test("toplu plan: dryRun her şeyi doğrular, sonra kampanya olarak kaydeder", async () => {
    const posts = [1, 2, 3].map((i) => ({ content: `Plan gönderisi ${i}`, targets: [{ channelId: tg }], publishAt: "next_slot" }));
    const dry = await call("POST", "/api/posts/bulk", { cookie: owner, body: { posts, dryRun: true } });
    assert.equal(dry.json.ok, true, JSON.stringify(dry.json));
    assert.equal(dry.json.created, 0);
    const times = dry.json.items.map((i: Json) => i.publishAt);
    assert.equal(new Set(times).size, 3, "aynı istekte saatler çakışmamalı");
    const real = await call("POST", "/api/posts/bulk", { cookie: owner, body: { posts, campaign: { name: "Ekim kampanyası" } } });
    assert.equal(real.json.created, 3);
    assert.ok(real.json.campaignId);
    const camp = await call("GET", `/api/campaigns/${real.json.campaignId}`, { cookie: owner });
    assert.equal(camp.json.posts.length, 3);
  });

  test("atomik toplu plan: bir hata varsa hiçbiri kaydedilmez", async () => {
    const before = await call("GET", "/api/posts?limit=500", { cookie: owner });
    const r = await call("POST", "/api/posts/bulk", {
      cookie: owner,
      body: { posts: [{ content: "iyi", targets: [{ channelId: tg }], publishAt: "next_slot" }, { content: "kötü", targets: [{ channelId: ig }], publishAt: "next_slot" }] },
    });
    assert.equal(r.json.ok, false);
    assert.equal(r.json.created, 0);
    const afterList = await call("GET", "/api/posts?limit=500", { cookie: owner });
    assert.equal(afterList.json.length, before.json.length);
  });

  test("takvimde sürükle-bırak: yeniden zamanlama", async () => {
    const list = await call("GET", "/api/posts?status=scheduled", { cookie: owner });
    const id = list.json[0].id;
    const r = await call("POST", `/api/posts/${id}/reschedule`, { cookie: owner, body: { publishAt: "2031-01-15 14:45" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.publishAt, "2031-01-15T11:45:00.000Z");
  });

  test("gönderi kotası dolunca 402", async () => {
    const period = new Date().toISOString().slice(0, 7);
    // Sınırsız planda kota yok; ikinci bir ücretsiz çalışma alanında test edilir (aşağıda)
    assert.ok(usageRepo.get(orgId, period, "posts") >= 4);
  });
});

describe("onay akışı ve API anahtarı", () => {
  test("API anahtarı oluştur", async () => {
    const r = await call("POST", "/api/org/api-keys", { cookie: owner, body: { name: "test" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    apiKey = r.json.key;
    assert.match(apiKey, /^sp_/);
  });

  test("approvalMode=ai: API/MCP gönderisi onay bekler, panelden onaylanır", async () => {
    await call("PUT", "/api/settings", { cookie: owner, body: { approvalMode: "ai" } });
    const r = await call("POST", "/api/posts", { bearer: apiKey, origin: null, body: { content: "AI yazdı", targets: [{ channelId: tg }], publishAt: "next_slot" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.status, "pending_approval");
    assert.equal(r.json.source, "mcp");
    // API anahtarı kendi gönderisini onaylayamaz
    assert.equal((await call("POST", `/api/posts/${r.json.id}/approve`, { bearer: apiKey, origin: null })).status, 403);
    const ok = await call("POST", `/api/posts/${r.json.id}/approve`, { cookie: owner });
    assert.equal(ok.json.status, "scheduled");
    await call("PUT", "/api/settings", { cookie: owner, body: { approvalMode: "none" } });
  });

  test("reddetme gönderiyi taslağa çevirir ve not bırakır", async () => {
    await call("PUT", "/api/settings", { cookie: owner, body: { approvalMode: "ai" } });
    const r = await call("POST", "/api/posts", { bearer: apiKey, origin: null, body: { content: "tekrar", targets: [{ channelId: tg }], publishAt: "next_slot" } });
    const rej = await call("POST", `/api/posts/${r.json.id}/reject`, { cookie: owner, body: { reason: "Görsel ekle" } });
    assert.equal(rej.json.status, "draft");
    assert.equal(rej.json.rejectionReason, "Görsel ekle");
    await call("PUT", "/api/settings", { cookie: owner, body: { approvalMode: "none" } });
  });
});

describe("uzaktan MCP (API anahtarı)", () => {
  test("kimliksiz istek 401 + keşif başlığı", async () => {
    const res = await app.inject({ method: "POST", url: "/mcp", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, payload: "{}" });
    assert.equal(res.statusCode, 401);
    assert.match(String(res.headers["www-authenticate"]), /resource_metadata="http:\/\/localhost:4100\/\.well-known\/oauth-protected-resource\/mcp"/);
  });

  test("initialize + araç listesi + talimatlar", async () => {
    const init = await mcpInit(apiKey);
    assert.match(init.result.instructions, /get_workspace_context/);
    const tools = await mcp(apiKey, "tools/list", {}, 2);
    const names = tools.json.result.tools.map((t: Json) => t.name);
    for (const n of ["get_workspace_context", "find_free_slots", "schedule_post", "schedule_posts_batch", "get_calendar", "reply_conversation", "get_analytics"]) {
      assert.ok(names.includes(n), `${n} eksik`);
    }
    assert.ok(names.length >= 30, `araç sayısı ${names.length}`);
  });

  test("get_workspace_context kanalları ve saat dilimini döndürür", async () => {
    const r = toolJson(await mcp(apiKey, "tools/call", { name: "get_workspace_context", arguments: {} }, 3));
    assert.equal(r.workspace.timezone, "Europe/Istanbul");
    assert.equal(r.channels.length, 3);
    const igc = r.channels.find((c: Json) => c.platform === "instagram");
    assert.equal(igc.requiresMedia, true);
  });

  test("AI akışı: boş saat bul -> toplu plan (dryRun) -> kaydet", async () => {
    const slots = toolJson(await mcp(apiKey, "tools/call", { name: "find_free_slots", arguments: { channelIds: [tg], count: 2 } }, 4));
    assert.equal(slots.length, 2);
    const posts = slots.map((s: Json, i: number) => ({ channelIds: [tg], content: `MCP plan ${i}`, publishAt: s.at }));
    const dry = toolJson(await mcp(apiKey, "tools/call", { name: "schedule_posts_batch", arguments: { posts, dryRun: true } }, 5));
    assert.equal(dry.ok, true, JSON.stringify(dry));
    assert.match(dry.hint, /dryRun=false/);
    const real = toolJson(await mcp(apiKey, "tools/call", { name: "schedule_posts_batch", arguments: { posts, campaignName: "MCP haftası" } }, 6));
    assert.equal(real.created, 2);
    const cal = toolJson(
      await mcp(apiKey, "tools/call", { name: "get_calendar", arguments: { from: new Date().toISOString(), to: new Date(Date.now() + 60 * 86400_000).toISOString() } }, 7),
    );
    assert.ok(cal.some((p: Json) => p.preview === "MCP plan 0"));
  });

  test("araç hatası isError ile ve anlaşılır mesajla döner", async () => {
    const r = await mcp(apiKey, "tools/call", { name: "schedule_post", arguments: { channelIds: [ig], content: "görselsiz", publishAt: "next_slot" } }, 8);
    assert.equal(r.json.result.isError, true);
    assert.match(r.json.result.content[0].text, /görsel|video/i);
  });

  test("yorumdan DM'e: MCP'den oluşan kural her zaman kapalıdır; doğrulama ve sayılar", async () => {
    const created = toolJson(
      await mcp(apiKey, "tools/call", { name: "create_comment_rule", arguments: { name: "Link DM", channelId: ig, pattern: "link*", dmText: "Merhaba {{name}}", enabled: 1 } }, 20),
    );
    assert.ok(created.id, JSON.stringify(created));
    assert.equal(created.enabled, 0, "MCP kuralı açamaz");
    assert.equal(created.botNotice, 1);

    const bad = await mcp(apiKey, "tools/call", { name: "create_comment_rule", arguments: { name: "Boş", matchType: "keyword", pattern: " , ", dmText: "x" } }, 21);
    assert.equal(bad.json.result.isError, true);
    const tgRule = await mcp(apiKey, "tools/call", { name: "create_comment_rule", arguments: { name: "TG", channelId: tg, matchType: "any", dmText: "x" } }, 22);
    assert.equal(tgRule.json.result.isError, true);
    assert.match(tgRule.json.result.content[0].text, /Instagram ve Facebook/);

    const upd = toolJson(await mcp(apiKey, "tools/call", { name: "update_comment_rule", arguments: { ruleId: created.id, publicReplies: ["DM'den yazdım"] } }, 23));
    assert.deepEqual(upd.publicReplies, ["DM'den yazdım"]);
    const list = toolJson(await mcp(apiKey, "tools/call", { name: "list_comment_rules", arguments: {} }, 24));
    const row = list.find((r: Json) => r.id === created.id);
    assert.deepEqual(row.stats, { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, expired: 0 });
    assert.deepEqual(toolJson(await mcp(apiKey, "tools/call", { name: "list_private_replies", arguments: {} }, 25)), []);

    // Panelden (oturum) açılabilir
    const viaPanel = await call("POST", "/api/comment-rules", { cookie: owner, body: { name: "Panel", matchType: "any", dmText: "Selam", enabled: 1 } });
    assert.equal(viaPanel.status, 200, JSON.stringify(viaPanel.json));
    assert.equal(viaPanel.json.enabled, 1);
    const off = await call("PUT", `/api/comment-rules/${viaPanel.json.id}`, { cookie: owner, body: { enabled: 0 } });
    assert.equal(off.json.enabled, 0);
    assert.equal((await call("DELETE", `/api/comment-rules/${viaPanel.json.id}`, { cookie: owner })).status, 200);
    await mcp(apiKey, "tools/call", { name: "delete_comment_rule", arguments: { ruleId: created.id } }, 26);
    assert.equal((await call("GET", "/api/comment-rules", { cookie: owner })).json.length, 0);
  });
});

describe("OAuth 2.1 (claude.ai / ChatGPT / Gemini tarzı bağlantı)", () => {
  let clientId = "";
  let access = "";
  let refresh = "";
  const verifier = crypto.randomBytes(40).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const redirect = "https://claude.ai/api/mcp/auth_callback";

  test("keşif belgeleri", async () => {
    const prm = await call("GET", "/.well-known/oauth-protected-resource/mcp");
    assert.equal(prm.json.resource, "http://localhost:4100/mcp");
    const as = await call("GET", "/.well-known/oauth-authorization-server");
    assert.deepEqual(as.json.code_challenge_methods_supported, ["S256"]);
    assert.ok(as.json.registration_endpoint);
  });

  test("dinamik istemci kaydı", async () => {
    const r = await call("POST", "/oauth/register", { origin: null, body: { client_name: "Claude", redirect_uris: [redirect], token_endpoint_auth_method: "none" } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    clientId = r.json.client_id;
    assert.equal(r.json.client_secret, undefined);
    const bad = await call("POST", "/oauth/register", { origin: null, body: { redirect_uris: ["http://evil.com/cb"] } });
    assert.equal(bad.status, 400);
  });

  test("authorize -> onay ekranı -> kod -> token", async () => {
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "mcp", resource: "http://localhost:4100/mcp" });
    const auth = await app.inject({ method: "GET", url: `/oauth/authorize?${q}` });
    assert.equal(auth.statusCode, 302);
    const loc = String(auth.headers.location);
    assert.match(loc, /^http:\/\/localhost:5173\/consent\?request=/);
    const reqId = new URL(loc).searchParams.get("request")!;

    // Oturumsuz onay isteği okunamaz
    assert.equal((await call("GET", `/api/oauth2/requests/${reqId}`)).status, 401);
    const info = await call("GET", `/api/oauth2/requests/${reqId}`, { cookie: owner });
    assert.equal(info.json.client.name, "Claude");
    assert.equal(info.json.orgs[0].id, orgId);

    const dec = await call("POST", `/api/oauth2/requests/${reqId}/decision`, { cookie: owner, body: { allow: true, orgId } });
    const back = new URL(dec.json.redirect);
    assert.equal(back.origin + back.pathname, redirect);
    assert.equal(back.searchParams.get("state"), "xyz");
    const code = back.searchParams.get("code")!;

    // Yanlış doğrulayıcı reddedilir
    const wrong = await call("POST", "/oauth/token", { origin: null, form: { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirect, code_verifier: "yanlis".repeat(8) } });
    assert.equal(wrong.json.error, "invalid_grant");
  });

  test("tam akış ve yenileme token'ı rotasyonu", async () => {
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256" });
    const loc = String((await app.inject({ method: "GET", url: `/oauth/authorize?${q}` })).headers.location);
    const reqId = new URL(loc).searchParams.get("request")!;
    const dec = await call("POST", `/api/oauth2/requests/${reqId}/decision`, { cookie: owner, body: { allow: true, orgId } });
    const code = new URL(dec.json.redirect).searchParams.get("code")!;
    const tok = await call("POST", "/oauth/token", { origin: null, form: { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier } });
    assert.equal(tok.status, 200, JSON.stringify(tok.json));
    access = tok.json.access_token;
    refresh = tok.json.refresh_token;
    assert.match(access, /^spat_/);

    // Kod tek kullanımlık
    const again = await call("POST", "/oauth/token", { origin: null, form: { grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier } });
    assert.equal(again.json.error, "invalid_grant");

    await mcpInit(access);
    const ctx = toolJson(await mcp(access, "tools/call", { name: "get_workspace_context", arguments: {} }, 9));
    assert.equal(ctx.you.connectedAs, "Claude");

    const rot = await call("POST", "/oauth/token", { origin: null, form: { grant_type: "refresh_token", refresh_token: refresh, client_id: clientId } });
    assert.equal(rot.status, 200);
    // Eski yenileme token'ı tekrar kullanılırsa tüm zincir iptal edilir
    const reuse = await call("POST", "/oauth/token", { origin: null, form: { grant_type: "refresh_token", refresh_token: refresh, client_id: clientId } });
    assert.equal(reuse.json.error, "invalid_grant");
    assert.equal((await mcp(rot.json.access_token, "tools/list", {}, 10)).status, 401);
  });

  test("bağlı AI uygulamaları listesi ve iptal", async () => {
    const list = await call("GET", "/api/org/connections", { cookie: owner });
    assert.ok(Array.isArray(list.json));
  });
});

describe("çok kiracılı izolasyon, ekip ve planlar", () => {
  let other = "";
  let otherOrg = "";

  test("ikinci kullanıcı kendi deneme çalışma alanını alır", async () => {
    const r = await call("POST", "/api/auth/signup", { body: { email: "musteri@ornek.com", password: "Musteri-Sifre-1", orgName: "Müşteri B" } });
    other = cookieOf(r.res);
    const me = await call("GET", "/api/auth/me", { cookie: other });
    assert.equal(me.json.user.isSuperadmin, false);
    assert.equal(me.json.org.plan, "pro");
    assert.ok(me.json.org.planExpiresAt);
    otherOrg = me.json.org.id;
  });

  test("başka çalışma alanının verisine erişilemez", async () => {
    const mine = await call("GET", "/api/posts?limit=1", { cookie: owner });
    const id = mine.json[0].id;
    assert.equal((await call("GET", `/api/posts/${id}`, { cookie: other })).status, 404);
    assert.equal((await call("PATCH", `/api/channels/${tg}`, { cookie: other, body: { name: "ele geçir" } })).status, 404);
    assert.equal((await call("GET", "/api/channels", { cookie: other })).json.length, 0);
    // Başka org'u X-Org-Id ile seçmek de işe yaramaz
    const forced = await call("GET", "/api/channels", { cookie: other, headers: { "x-org-id": orgId } });
    assert.equal(forced.json.length, 0);
  });

  test("süper admin plan atar; ücretsiz planda kota ve özellik sınırı", async () => {
    const r = await call("PATCH", `/api/admin/orgs/${otherOrg}`, { cookie: owner, body: { plan: "free", planExpiresAt: null } });
    assert.equal(r.json.effectivePlan, "free");
    assert.equal((await call("GET", "/api/admin/stats", { cookie: other })).status, 403);
    // Ücretsiz planda onay akışı yok
    const s = await call("PUT", "/api/settings", { cookie: other, body: { approvalMode: "ai" } });
    assert.equal(s.status, 402);
    // Gönderi kotası
    const ch = channelsRepo.upsert({ orgId: otherOrg, provider: "telegram", externalId: "b1", name: "B TG", accessToken: "x", metadata: { chatId: "-2" } }).channel.id;
    usageRepo.increment(otherOrg, new Date().toISOString().slice(0, 7), "posts", 30);
    const p = await call("POST", "/api/posts", { cookie: other, body: { content: "x", targets: [{ channelId: ch }], publishAt: "next_slot" } });
    assert.equal(p.status, 402);
    // Taslak kotaya takılmaz
    const d = await call("POST", "/api/posts", { cookie: other, body: { content: "x", targets: [{ channelId: ch }] } });
    assert.equal(d.status, 200);
  });

  test("davet: e-posta ile gelen link, doğru rolle katılım", async () => {
    const inv = await call("POST", "/api/org/invitations", { cookie: owner, body: { email: "editor@ornek.com", role: "viewer" } });
    assert.equal(inv.status, 200, JSON.stringify(inv.json));
    const mail = devOutbox().find((m) => m.to === "editor@ornek.com");
    assert.ok(mail, "davet e-postası kuyrukta olmalı");
    const token = new URL(mail!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    const info = await call("GET", `/api/auth/invite?token=${encodeURIComponent(token)}`);
    assert.equal(info.json.orgName, "Ajans A");
    const su = await call("POST", "/api/auth/signup", { body: { email: "editor@ornek.com", password: "Editor-Sifre-1", inviteToken: token } });
    const viewer = cookieOf(su.res);
    const me = await call("GET", "/api/auth/me", { cookie: viewer });
    assert.equal(me.json.org.id, orgId);
    assert.equal(me.json.role, "viewer");
    // İzleyici gönderi oluşturamaz
    const p = await call("POST", "/api/posts", { cookie: viewer, body: { content: "x", targets: [{ channelId: tg }] } });
    assert.equal(p.status, 403);
  });

  test("son sahip rolünden düşürülemez", async () => {
    const members = await call("GET", "/api/org/members", { cookie: owner });
    const me = members.json.members.find((m: Json) => m.email === "sahip@ornek.com");
    const r = await call("PATCH", `/api/org/members/${me.userId}`, { cookie: owner, body: { role: "admin" } });
    assert.equal(r.status, 400);
  });
});

describe("müşteri önizleme linki ve Meta", () => {
  test("önizleme linki giriş gerektirmez, yorum ekip notuna düşer", async () => {
    const list = await call("GET", "/api/posts?limit=1", { cookie: owner });
    const id = list.json[0].id;
    const link = await call("POST", `/api/posts/${id}/preview-links`, { cookie: owner, body: {} });
    assert.equal(link.status, 200, JSON.stringify(link.json));
    const pub = await call("GET", `/api/public/preview/${link.json.token}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.json.org.name, "Ajans A");
    const c = await call("POST", `/api/public/preview/${link.json.token}/comments`, { origin: null, body: { name: "Müşteri", text: "Onaylıyorum" } });
    assert.equal(c.status, 200);
    const detail = await call("GET", `/api/posts/${id}`, { cookie: owner });
    assert.ok(detail.json.notesList.some((n: Json) => n.text === "Onaylıyorum" && n.source === "preview"));
  });

  test("Meta webhook doğrulaması", async () => {
    const r = await app.inject({ method: "GET", url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=sosyalpilot-verify&hub.challenge=42" });
    assert.equal(r.body, "42");
    const bad = await app.inject({ method: "GET", url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=yanlis&hub.challenge=42" });
    assert.equal(bad.statusCode, 403);
  });
});
