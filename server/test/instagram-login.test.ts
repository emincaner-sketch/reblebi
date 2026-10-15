import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-iglogin-"));
process.env.DATA_DIR = dir;
process.env.PUBLIC_URL = "https://reblebi.test";
process.env.INSTAGRAM_APP_ID = "";
process.env.INSTAGRAM_APP_SECRET = "";
process.env.X_CLIENT_ID = "";
process.env.X_CLIENT_SECRET = "";

const { config } = await import("../src/core/config.js");
const { instagramLoginFlow, instagramProvider } = await import("../src/providers/meta/instagram.js");
const { describePlatformKeys, savePlatformKeys, applyStoredKeys } = await import("../src/services/platform-keys.js");
const { describeProvider } = await import("../src/providers/index.js");
const { xProvider } = await import("../src/providers/x.js");

const seen: URL[] = [];
let failSubscribe = false;
const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = new URL(String(input));
  seen.push(u);
  if (u.hostname === "api.instagram.com") return j({ access_token: "short", user_id: 111 });
  if (u.hostname === "graph.instagram.com") {
    if (u.pathname === "/access_token") return j({ access_token: "long", expires_in: 5_184_000 });
    if (u.pathname.endsWith("/me")) return j({ id: "app-scoped", user_id: "17841400", username: "leblebi", name: "Leblebi", profile_picture_url: "https://x/p.jpg", account_type: "BUSINESS" });
    if (u.pathname.endsWith("/subscribed_apps"))
      return failSubscribe ? j({ error: { message: "(#200) Application does not have permission for this action", code: 200 } }, 403) : j({ success: true });
    if (u.pathname === "/refresh_access_token") return j({ access_token: "refreshed", expires_in: 5_184_000 });
    if (u.pathname.endsWith("/media")) return j({ id: "container-1" });
    if (u.pathname.endsWith("/container-1")) return j({ status_code: "FINISHED" });
    if (u.pathname.endsWith("/media_publish")) return j({ id: "media-9" });
    if (u.pathname.endsWith("/media-9")) return j({ permalink: "https://instagram.com/p/abc" });
  }
  throw new Error("beklenmeyen istek: " + u.toString());
}) as typeof fetch;

test("Instagram Login: anahtarsızken yapılandırılmamış görünür", () => {
  assert.equal(instagramLoginFlow.isConfigured(), false);
  const info = describeProvider(instagramProvider) as { directLogin?: { configured: boolean; oauthGroup: string } };
  assert.equal(info.directLogin?.configured, false);
  assert.equal(info.directLogin?.oauthGroup, "instagram-login");
});

test("Panelden girilen anahtarlar config'e uygulanır, maskelenir ve silinebilir", () => {
  savePlatformKeys("instagram", { appId: "ig-app", appSecret: "ig-secret-123456" });
  assert.equal(config.instagram.appId, "ig-app");
  assert.equal(instagramLoginFlow.isConfigured(), true);
  const g = describePlatformKeys().find((x) => x.id === "instagram")!;
  assert.equal(g.configured, true);
  const secret = g.fields.find((f) => f.id === "appSecret")!;
  assert.equal(secret.source, "panel");
  assert.ok(!secret.preview.includes("ig-secret-123456"), "gizli değer maskelenmeli");
  assert.equal(g.redirects[0], "https://reblebi.test/api/oauth/instagram-login/callback");

  // yeniden başlatma simülasyonu
  config.instagram.appId = "";
  applyStoredKeys();
  assert.equal(config.instagram.appId, "ig-app");

  savePlatformKeys("instagram", { appId: null, appSecret: null });
  assert.equal(config.instagram.appId, "");
  assert.equal(instagramLoginFlow.isConfigured(), false);
});

test("X anahtarı panelden girilince X sağlayıcısı yapılandırılmış olur", () => {
  assert.equal(xProvider.isConfigured(), false);
  savePlatformKeys("x", { clientId: "x-id", clientSecret: "x-secret" });
  assert.equal(xProvider.isConfigured(), true);
  assert.throws(() => savePlatformKeys("yok", {}));
});

test("Instagram Login: yetkilendirme adresi ve hesap bağlama", async () => {
  savePlatformKeys("instagram", { appId: "ig-app", appSecret: "ig-secret-123456" });
  const start = instagramLoginFlow.oauthStart("https://reblebi.test/api/oauth/instagram-login/callback", "st1");
  const u = new URL(start.url);
  assert.equal(u.hostname, "www.instagram.com");
  assert.equal(u.searchParams.get("client_id"), "ig-app");
  assert.match(u.searchParams.get("scope") ?? "", /instagram_business_content_publish/);

  const accounts = await instagramLoginFlow.oauthCallback("code1", "https://reblebi.test/api/oauth/instagram-login/callback");
  assert.equal(accounts.length, 1);
  const a = accounts[0];
  assert.equal(a.provider, "instagram");
  assert.equal(a.externalId, "17841400");
  assert.equal(a.accessToken, "long");
  assert.equal(a.metadata?.igLogin, true);
  assert.ok(a.tokenExpiresAt);
  assert.ok(seen.some((s) => s.pathname.endsWith("/subscribed_apps")), "webhook aboneliği denenmeli");
  assert.equal(a.metadata?.webhookSubscribeError, null);
});

test("Instagram Login: webhook aboneliği başarısızsa hesap yine bağlanır, hata kanala yazılır", async () => {
  failSubscribe = true;
  try {
    const [a] = await instagramLoginFlow.oauthCallback("code2", "https://reblebi.test/api/oauth/instagram-login/callback");
    assert.equal(a.externalId, "17841400");
    assert.match(String(a.metadata?.webhookSubscribeError), /permission/);
    assert.ok(!String(a.metadata?.webhookSubscribeError).includes("long"), "hata metninde jeton olmamalı");
  } finally {
    failSubscribe = false;
  }
});

test("Instagram Login kanalı graph.instagram.com üzerinden yayınlar ve jetonu yeniler", async () => {
  seen.length = 0;
  const ch = { id: "c1", orgId: "o", provider: "instagram", externalId: "17841400", accessToken: "long", metadata: { igLogin: true } } as never;
  const r = await instagramProvider.publish(ch, { kind: "post", text: "merhaba", media: [{ kind: "image", publicUrl: "https://reblebi.test/media/a.jpg" } as never], settings: {} } as never);
  assert.equal(r.externalId, "media-9");
  assert.ok(seen.length > 0 && seen.every((s) => s.hostname === "graph.instagram.com"), "tüm çağrılar graph.instagram.com'a gitmeli");

  const t = await instagramProvider.refreshToken!(ch);
  assert.equal(t?.accessToken, "refreshed");
  // Facebook ile bağlanan kanal yenilenmez
  assert.equal(await instagramProvider.refreshToken!({ ...(ch as object), metadata: {} } as never), null);
});

test("Profesyonel olmayan hesap anlaşılır hata verir", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    if (u.hostname === "api.instagram.com") return j({ access_token: "s", user_id: 1 });
    if (u.pathname === "/access_token") return j({ access_token: "l", expires_in: 10 });
    if (u.pathname.endsWith("/me")) return j({ user_id: "1", username: "kisisel", account_type: "PERSONAL" });
    return j({});
  }) as typeof fetch;
  await assert.rejects(() => instagramLoginFlow.oauthCallback("c", "https://reblebi.test/cb"), /Profesyonel/);
  globalThis.fetch = orig;
});

test.after(() => {
  globalThis.fetch = realFetch;
});
