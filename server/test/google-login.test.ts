import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-google-"));
process.env.DATA_DIR = dir;
process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.META_APP_ID = "fb-app";
process.env.META_APP_SECRET = "fb-secret";

const Fastify = (await import("fastify")).default;
const cookie = (await import("@fastify/cookie")).default;
const { usersRepo, orgsRepo } = await import("../src/core/repos/orgs.js");
const { googleAuthRoutes } = await import("../src/api/routes/auth-google.js");

// Önce platform sahibi (ilk kullanıcı) var: Google ile gelenler normal kayıt kurallarına tabi
const owner = usersRepo.create({ email: "sahip@ornek.com", password: "Password123!", name: "Sahip", locale: "tr", verified: true });
orgsRepo.create({ name: "Sahip Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: owner.id });

let profile: Record<string, unknown> = {};
let fbProfile: Record<string, unknown> = {};
let lastTokenBody = "";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = String(input);
  if (u.startsWith("https://oauth2.googleapis.com/token")) {
    lastTokenBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ access_token: "at-1", id_token: "x" }), { status: 200 });
  }
  if (u.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return new Response(JSON.stringify(profile), { status: 200 });
  if (u.includes("graph.facebook.com") && u.includes("/oauth/access_token")) return new Response(JSON.stringify({ access_token: "fb-at" }), { status: 200 });
  if (u.includes("graph.facebook.com") && u.includes("/me?")) return new Response(JSON.stringify(fbProfile), { status: 200 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const app = Fastify();
await app.register(cookie);
await app.register(googleAuthRoutes);

async function startState(next = "/app/analytics") {
  const r = await app.inject({ method: "GET", url: `/api/auth/google/start?next=${encodeURIComponent(next)}&locale=tr&tz=Europe/Istanbul` });
  assert.equal(r.statusCode, 302);
  const loc = new URL(String(r.headers.location));
  assert.equal(loc.origin, "https://accounts.google.com");
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  assert.equal(loc.searchParams.get("scope"), "openid email profile");
  return loc.searchParams.get("state")!;
}

test("yeni kullanıcı: hesap + çalışma alanı açılır, oturum çerezi, güvenli yönlendirme", async () => {
  profile = { sub: "g-1", email: "Yeni@Ornek.com", email_verified: true, name: "Yeni Kişi" };
  const state = await startState("/app/analytics");
  const r = await app.inject({ method: "GET", url: `/api/auth/google/callback?code=abc&state=${state}` });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "/app/analytics");
  assert.match(String(r.headers["set-cookie"]), /sp_session|session/i);
  assert.match(lastTokenBody, /code_verifier=/, "PKCE doğrulayıcı gönderilir");
  const u = usersRepo.findByEmail("yeni@ornek.com");
  assert.ok(u?.emailVerifiedAt, "Google e-postası doğrulanmış sayılır");
  assert.equal(orgsRepo.listForUser(u!.id).length, 1);
  assert.equal(u?.isSuperadmin, 0);
});

test("var olan kullanıcı: aynı hesaba girer, yeni alan açılmaz", async () => {
  profile = { sub: "g-2", email: "sahip@ornek.com", email_verified: true, name: "Sahip" };
  const state = await startState("/app");
  const r = await app.inject({ method: "GET", url: `/api/auth/google/callback?code=abc&state=${state}` });
  assert.equal(r.headers.location, "/app");
  assert.equal(orgsRepo.listForUser(owner.id).length, 1);
});

test("güvenlik: doğrulanmamış e-posta, yeniden kullanılan state, dış yönlendirme", async () => {
  profile = { sub: "g-3", email: "dogrusuz@ornek.com", email_verified: false };
  const state = await startState();
  const r = await app.inject({ method: "GET", url: `/api/auth/google/callback?code=abc&state=${state}` });
  assert.equal(r.headers.location, "/login?error=auth.google_unverified");
  assert.equal(usersRepo.findByEmail("dogrusuz@ornek.com"), null);

  const replay = await app.inject({ method: "GET", url: `/api/auth/google/callback?code=abc&state=${state}` });
  assert.equal(replay.headers.location, "/login?error=auth.google_state", "state bir kez kullanılır");

  profile = { sub: "g-4", email: "dis@ornek.com", email_verified: true };
  const evil = await startState("//kotu.example.com");
  const r2 = await app.inject({ method: "GET", url: `/api/auth/google/callback?code=abc&state=${evil}` });
  assert.equal(r2.headers.location, "/app", "açık yönlendirme yok");

  const cancelled = await app.inject({ method: "GET", url: "/api/auth/google/callback?error=access_denied" });
  assert.equal(cancelled.headers.location, "/login");
});

test("Facebook: e-postalı hesap açılır ya da var olana girilir; e-postasız hesap reddedilir", async () => {
  const start = await app.inject({ method: "GET", url: "/api/auth/facebook/start?next=/app/posts&locale=tr" });
  const loc = new URL(String(start.headers.location));
  assert.equal(loc.hostname, "www.facebook.com");
  assert.equal(loc.searchParams.get("scope"), "email,public_profile");
  fbProfile = { id: "fb-1", name: "Face Kişi", email: "face@ornek.com" };
  const r = await app.inject({ method: "GET", url: `/api/auth/facebook/callback?code=abc&state=${loc.searchParams.get("state")}` });
  assert.equal(r.headers.location, "/app/posts");
  assert.ok(usersRepo.findByEmail("face@ornek.com")?.emailVerifiedAt);

  fbProfile = { id: "fb-2", name: "Telefonlu" };
  const s2 = new URL(String((await app.inject({ method: "GET", url: "/api/auth/facebook/start" })).headers.location)).searchParams.get("state");
  const r2 = await app.inject({ method: "GET", url: `/api/auth/facebook/callback?code=abc&state=${s2}` });
  assert.equal(r2.headers.location, "/login?error=auth.facebook_no_email");
  const bad = await app.inject({ method: "GET", url: "/api/auth/twitter/start" });
  assert.equal(bad.headers.location, "/login", "bilinmeyen sağlayıcı girişe döner");
});
