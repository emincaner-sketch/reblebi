import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-push-"));
process.env.DATA_DIR = dir;

const { encryptPayload, vapid, vapidAuthHeader, allowedEndpoint, pushNotification, pushRepo } = await import("../src/services/webpush.js");
const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { notify } = await import("../src/services/notify.js");

test("aes128gcm şifreleme RFC 8291 Ek A örneğiyle birebir aynı", () => {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"));
  assert.equal(ecdh.getPublicKey().toString("base64url"), "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const out = encryptPayload(Buffer.from("When I grow up, I want to be a watermelon"), "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", "BTBZMqHH6r4Tts7J_aSIgg", {
    salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"),
    ecdh,
  });
  assert.equal(
    out.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

test("VAPID: anahtar bir kez üretilir, JWT imzası açık anahtarla doğrulanır, aud uç noktanın kökü", () => {
  const v = vapid();
  assert.equal(Buffer.from(v.publicKey, "base64url").length, 65);
  assert.equal(vapid().publicKey, v.publicKey);
  const h = vapidAuthHeader("https://fcm.googleapis.com/fcm/send/abc", Date.parse("2026-10-04T10:00:00Z"));
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
  assert.ok(m);
  const payload = JSON.parse(Buffer.from(m[2], "base64url").toString());
  assert.equal(payload.aud, "https://fcm.googleapis.com");
  assert.equal(m[4], v.publicKey);
  const raw = Buffer.from(v.publicKey, "base64url");
  const pub = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(crypto.verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3], "base64url")));
});

test("uç nokta yalnızca bilinen push servisleri; bildirim aboneye gider, iptal edilen abonelik silinir", async () => {
  assert.equal(allowedEndpoint("https://fcm.googleapis.com/fcm/send/x"), true);
  assert.equal(allowedEndpoint("https://web.push.apple.com/abc"), true);
  assert.equal(allowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"), true);
  assert.equal(allowedEndpoint("http://fcm.googleapis.com/x"), false);
  assert.equal(allowedEndpoint("https://evil.example/fcm.googleapis.com"), false);
  assert.equal(allowedEndpoint("https://127.0.0.1/x"), false);

  const user = usersRepo.create({ email: "push@ornek.com", password: "Password123!", name: "P", locale: "tr" });
  const org = orgsRepo.create({ name: "Push Org", plan: "unlimited", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const keys = { p256dh: ua.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
  pushRepo.upsert(user.id, { endpoint: "https://fcm.googleapis.com/fcm/send/ok", ...keys, scope: "all", ua: null });
  pushRepo.upsert(user.id, { endpoint: "https://fcm.googleapis.com/fcm/send/gone", ...keys, scope: "all", ua: null });
  pushRepo.upsert(user.id, { endpoint: "https://fcm.googleapis.com/fcm/send/onlyimportant", ...keys, scope: "important", ua: null });

  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: init?.headers as Record<string, string> });
    return new Response(null, { status: String(input).endsWith("/gone") ? 410 : 201 });
  }) as typeof fetch;
  try {
    assert.equal(await pushNotification(org.id, { kind: "info", title: "Gönderi yayınlandı", link: "/app/posts" }), 1, "bilgi bildirimi 'yalnızca önemli' aboneye gitmez; iptal edilen sayılmaz");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers["Content-Encoding"], "aes128gcm");
    assert.match(calls[0].headers.Authorization, /^vapid t=/);
    assert.equal(pushRepo.forUser(user.id).length, 2, "410 dönen abonelik silindi");
    calls.length = 0;
    assert.equal(await pushNotification(org.id, { kind: "error", title: "Gönderi yayınlanamadı" }), 2, "hata bildirimi iki aboneye de gider");
    // notify() da push'u tetikler
    calls.length = 0;
    notify(org.id, { kind: "warning", title: "Onay bekleyen gönderi" });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = real;
  }
});
