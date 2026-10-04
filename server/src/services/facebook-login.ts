import crypto from "node:crypto";
import { config } from "../core/config.js";
import { AppError } from "../core/i18n.js";
import type { Locale, User } from "../core/types.js";
import { http } from "../providers/http.js";
import { GRAPH, graph } from "../providers/meta/common.js";
import { loginOrSignupVerified } from "./google-login.js";

/**
 * Facebook ile giriş / kayıt (yalnızca email + public_profile izinleri). Kanal bağlamak için kullanılan
 * Meta uygulamasıyla aynı uygulama; sayfa/Instagram izinleri bu akışta istenmez.
 * Facebook yalnızca onaylanmış birincil e-postayı döndürür; e-postası olmayan hesap (telefonla açılmış) giriş yapamaz.
 */

const STATE_TTL_MS = 10 * 60_000;
const pending = new Map<string, { next: string; locale: Locale; tz: string | null; exp: number }>();

export function facebookLoginEnabled(): boolean {
  return Boolean(config.meta.appId && config.meta.appSecret);
}

/** Meta uygulamasında Facebook Login > Geçerli OAuth yönlendirme URI'leri listesine eklenmeli */
export function facebookRedirectUri(): string {
  return `${config.appUrl}/api/auth/facebook/callback`;
}

const safeNext = (v: string | undefined | null) => (v && v.startsWith("/") && !v.startsWith("//") ? v : "/app");

export function startFacebookLogin(opts: { next?: string; locale?: Locale; tz?: string }): string {
  if (!facebookLoginEnabled()) throw new AppError(404, "auth.facebook_disabled");
  const now = Date.now();
  for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
  const state = crypto.randomBytes(24).toString("base64url");
  pending.set(state, { next: safeNext(opts.next), locale: opts.locale === "en" ? "en" : "tr", tz: opts.tz ?? null, exp: now + STATE_TTL_MS });
  const u = new URL(`https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth`);
  u.searchParams.set("client_id", config.meta.appId);
  u.searchParams.set("redirect_uri", facebookRedirectUri());
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "email,public_profile");
  return u.toString();
}

export async function finishFacebookLogin(code: string, state: string): Promise<{ user: User; orgId: string | null; next: string; created: boolean }> {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.exp < Date.now()) throw new AppError(400, "auth.google_state");
  const token = await http<{ access_token?: string }>(`${GRAPH()}/oauth/access_token`, {
    query: { client_id: config.meta.appId, client_secret: config.meta.appSecret, redirect_uri: facebookRedirectUri(), code },
    retries: 0,
  });
  if (!token.access_token) throw new AppError(400, "auth.facebook_failed");
  const me = await graph<{ id: string; name?: string; email?: string }>("/me", token.access_token, { params: { fields: "id,name,email" } });
  if (!me.email) throw new AppError(400, "auth.facebook_no_email");
  return { ...loginOrSignupVerified({ email: me.email, name: me.name ?? null, locale: p.locale, tz: p.tz, via: "facebook" }), next: p.next };
}
