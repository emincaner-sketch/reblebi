import crypto from "node:crypto";
import { config } from "../core/config.js";
import { AppError } from "../core/i18n.js";
import { createLogger } from "../core/logger.js";
import { orgsRepo, usersRepo } from "../core/repos/orgs.js";
import { activityRepo } from "../core/repos/misc.js";
import type { Locale, User } from "../core/types.js";
import { http } from "../providers/http.js";
import { createWorkspace } from "./accounts.js";

/**
 * Google ile giriş / kayıt (OpenID Connect, PKCE). E-posta + şifre akışına dokunmaz; aynı e-postalı hesap varsa ona girer.
 * Google'ın doğruladığı e-posta doğrulanmış sayılır. Yeni hesaba rastgele bir şifre atanır (kullanıcı isterse
 * "Şifremi unuttum" ile kendi şifresini belirler). Kayıt modu (açık / davetli / kapalı) aynen uygulanır.
 */

const log = createLogger("google-login");
const STATE_TTL_MS = 10 * 60_000;

interface Pending {
  verifier: string;
  next: string;
  locale: Locale;
  tz: string | null;
  exp: number;
}
const pending = new Map<string, Pending>();

export function googleLoginEnabled(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

/** Google Cloud Console'da OAuth istemcisine eklenmesi gereken yönlendirme adresi */
export function googleRedirectUri(): string {
  return `${config.appUrl}/api/auth/google/callback`;
}

const safeNext = (v: string | undefined | null) => (v && v.startsWith("/") && !v.startsWith("//") ? v : "/app");

export function startGoogleLogin(opts: { next?: string; locale?: Locale; tz?: string }): string {
  if (!googleLoginEnabled()) throw new AppError(404, "auth.google_disabled");
  const now = Date.now();
  for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  pending.set(state, { verifier, next: safeNext(opts.next), locale: opts.locale === "en" ? "en" : "tr", tz: opts.tz ?? null, exp: now + STATE_TTL_MS });
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", config.google.clientId);
  u.searchParams.set("redirect_uri", googleRedirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

interface GoogleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  locale?: string;
}

/** Kod → token → profil; kullanıcıyı bulur ya da oluşturur */
export async function finishGoogleLogin(code: string, state: string): Promise<{ user: User; orgId: string | null; next: string; created: boolean }> {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.exp < Date.now()) throw new AppError(400, "auth.google_state");

  const token = await http<{ access_token?: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    form: { code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: googleRedirectUri(), grant_type: "authorization_code", code_verifier: p.verifier },
    retries: 0,
  });
  if (!token.access_token) throw new AppError(400, "auth.google_failed");
  const profile = await http<GoogleProfile>("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` }, retries: 1 });
  const email = profile.email?.toLowerCase().trim();
  if (!email || profile.email_verified !== true) throw new AppError(400, "auth.google_unverified");

  return { ...loginOrSignupVerified({ email, name: profile.name ?? null, locale: p.locale, tz: p.tz, via: "google" }), next: p.next };
}

/**
 * Sosyal girişte ortak adım (Google, Facebook): doğrulanmış e-postayla var olan hesaba girer ya da
 * kayıt moduna uyarak yeni hesap + çalışma alanı açar. Yeni hesaba rastgele şifre atanır.
 */
export function loginOrSignupVerified(input: { email: string; name: string | null; locale: Locale; tz: string | null; via: "google" | "facebook" }): { user: User; orgId: string | null; created: boolean } {
  const email = input.email.toLowerCase().trim();
  const existing = usersRepo.findByEmail(email);
  if (existing) {
    if (existing.disabled) throw new AppError(403, "auth.user_disabled");
    if (!existing.emailVerifiedAt) usersRepo.markVerified(existing.id);
    usersRepo.touchLogin(existing.id);
    return { user: usersRepo.get(existing.id)!, orgId: orgsRepo.listForUser(existing.id)[0]?.id ?? null, created: false };
  }
  // Yeni hesap: kayıt kuralları e-posta kaydıyla aynı
  const isFirstUser = usersRepo.count() === 0;
  if (!isFirstUser) {
    if (config.saas.signupMode === "closed") throw new AppError(403, "auth.signup_closed");
    if (config.saas.signupMode === "invite") throw new AppError(403, "auth.signup_invite_only");
  }
  const name = input.name?.trim().slice(0, 80) || null;
  const user = usersRepo.create({
    email,
    password: crypto.randomBytes(32).toString("base64url"),
    name,
    locale: input.locale,
    superadmin: isFirstUser || config.saas.superadminEmails.includes(email),
    verified: true,
  });
  const org = createWorkspace(user.id, name || email.split("@")[0], input.locale, input.tz ?? undefined);
  usersRepo.touchLogin(user.id);
  activityRepo.add(org.id, "info", "auth", `signup ${email} (${input.via})`);
  log.info("sosyal girişle yeni hesap", { userId: user.id, via: input.via });
  return { user: usersRepo.get(user.id)!, orgId: org.id, created: true };
}
