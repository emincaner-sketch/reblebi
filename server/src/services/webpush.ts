import crypto from "node:crypto";
import { config } from "../core/config.js";
import { getDb, nowIso } from "../core/db.js";
import { randomId } from "../core/crypto.js";
import { createLogger } from "../core/logger.js";
import { membershipsRepo, orgsRepo } from "../core/repos/orgs.js";
import { platformSettingsRepo } from "../core/repos/misc.js";

/**
 * Anlık bildirim (Web Push: RFC 8030 + 8291 aes128gcm + 8292 VAPID), ek paket olmadan Node crypto ile.
 * Paneldeki zil bildirimleri aboneliği olan cihazlara (telefon, masaüstü; iOS'ta ana ekrana eklenmiş uygulama) gider.
 * VAPID anahtarı ilk kullanımda üretilip platform ayarlarına yazılır (ya da VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
 */

const log = createLogger("push");
const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

/** Yalnızca bilinen tarayıcı push servislerine istek atılır (SSRF önlemi) */
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
export function allowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/* ---------------- VAPID ---------------- */

interface Vapid {
  publicKey: string;
  privateKey: crypto.KeyObject;
}
let vapidCache: Vapid | null = null;

export function vapid(): Vapid {
  if (vapidCache) return vapidCache;
  let pub = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  let d = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!pub || !d) {
    const stored = platformSettingsRepo.get("vapid");
    if (stored) ({ publicKey: pub, privateKey: d } = JSON.parse(stored) as { publicKey: string; privateKey: string });
    else {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const jwk = publicKey.export({ format: "jwk" });
      pub = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x!), fromB64u(jwk.y!)]));
      d = privateKey.export({ format: "jwk" }).d!;
      platformSettingsRepo.set("vapid", JSON.stringify({ publicKey: pub, privateKey: d }));
    }
  }
  const raw = fromB64u(pub);
  const key = crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", d, x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) }, format: "jwk" });
  vapidCache = { publicKey: pub, privateKey: key };
  return vapidCache;
}

export function vapidAuthHeader(endpoint: string, now = Date.now()): string {
  const v = vapid();
  const aud = new URL(endpoint).origin;
  const sub = config.saas.supportEmail ? `mailto:${config.saas.supportEmail}` : config.publicUrl;
  const enc = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub })}`;
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key: v.privateKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${v.publicKey}`;
}

/* ---------------- aes128gcm şifreleme (RFC 8291) ---------------- */

const hmac = (key: Buffer, data: Buffer) => crypto.createHmac("sha256", key).update(data).digest();

/** İstemcinin p256dh ve auth anahtarıyla gövdeyi şifreler; test için tuz ve geçici anahtar verilebilir */
export function encryptPayload(payload: Buffer, p256dh: string, auth: string, opts: { salt?: Buffer; ecdh?: crypto.ECDH } = {}): Buffer {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  const ecdh = opts.ecdh ?? crypto.createECDH("prime256v1");
  if (!opts.ecdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const salt = opts.salt ?? crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

/* ---------------- Abonelikler ---------------- */

export interface PushSub {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  scope: "all" | "important";
}
type Row = Record<string, unknown>;
const toSub = (r: Row): PushSub => ({ id: r.id as string, userId: r.user_id as string, endpoint: r.endpoint as string, p256dh: r.p256dh as string, auth: r.auth as string, scope: (r.scope as PushSub["scope"]) ?? "all" });

export const pushRepo = {
  upsert(userId: string, s: { endpoint: string; p256dh: string; auth: string; scope: PushSub["scope"]; ua: string | null }): void {
    getDb()
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, scope, ua, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, scope = excluded.scope, ua = excluded.ua, fail_count = 0`,
      )
      .run(randomId("push"), userId, s.endpoint, s.p256dh, s.auth, s.scope, s.ua, nowIso());
  },
  remove(userId: string, endpoint: string): void {
    getDb().prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(userId, endpoint);
  },
  forUsers(userIds: string[]): PushSub[] {
    if (!userIds.length) return [];
    return (getDb().prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${userIds.map(() => "?").join(",")})`).all(...userIds) as Row[]).map(toSub);
  },
  forUser(userId: string): PushSub[] {
    return this.forUsers([userId]);
  },
  markResult(id: string, ok: boolean): void {
    if (ok) getDb().prepare("UPDATE push_subscriptions SET last_used_at = ?, fail_count = 0 WHERE id = ?").run(nowIso(), id);
    else getDb().prepare("UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?").run(id);
    // Sürekli hata veren abonelik bırakılır
    getDb().prepare("DELETE FROM push_subscriptions WHERE id = ? AND fail_count >= 5").run(id);
  },
  drop(id: string): void {
    getDb().prepare("DELETE FROM push_subscriptions WHERE id = ?").run(id);
  },
};

/* ---------------- Gönderim ---------------- */

export interface PushMessage {
  title: string;
  body?: string | null;
  url?: string | null;
  tag?: string | null;
}

export async function sendPush(sub: PushSub, msg: PushMessage): Promise<boolean> {
  if (!allowedEndpoint(sub.endpoint)) {
    pushRepo.drop(sub.id);
    return false;
  }
  const payload = Buffer.from(JSON.stringify({ title: msg.title.slice(0, 120), body: (msg.body ?? "").slice(0, 300), url: msg.url ?? "/app", tag: msg.tag ?? undefined }));
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: { Authorization: vapidAuthHeader(sub.endpoint), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal" },
      body: encryptPayload(payload, sub.p256dh, sub.auth),
      signal: AbortSignal.timeout(10_000),
    });
    // 404/410: abonelik iptal edilmiş
    if (res.status === 404 || res.status === 410) {
      pushRepo.drop(sub.id);
      return false;
    }
    pushRepo.markResult(sub.id, res.ok);
    if (!res.ok) log.debug("push reddedildi", { status: res.status });
    return res.ok;
  } catch (e) {
    pushRepo.markResult(sub.id, false);
    log.debug("push gönderilemedi", { msg: e instanceof Error ? e.message : e });
    return false;
  }
}

/** notify() sonrası: kullanıcıya özel bildirim yalnızca ona, çalışma alanı bildirimi tüm üyelerin cihazlarına */
export async function pushNotification(orgId: string, n: { kind: string; title: string; body?: string | null; link?: string | null; userId?: string | null }): Promise<number> {
  const userIds = n.userId ? [n.userId] : membershipsRepo.list(orgId).map((m) => m.userId);
  const subs = pushRepo.forUsers(userIds).filter((s) => s.scope === "all" || n.kind === "warning" || n.kind === "error");
  if (!subs.length) return 0;
  const org = orgsRepo.get(orgId);
  let ok = 0;
  for (const s of subs) if (await sendPush(s, { title: n.title, body: n.body || org?.name || null, url: n.link || "/app", tag: n.kind })) ok++;
  return ok;
}
