import type { FastifyReply, FastifyRequest } from "fastify";
import { config, isSecure } from "../core/config.js";
import { sign, unsign } from "../core/crypto.js";
import { AppError, pickLocale } from "../core/i18n.js";
import { apiKeysRepo } from "../core/repos/misc.js";
import { oauthTokensRepo } from "../core/repos/oauth.js";
import { membershipsRepo, orgsRepo, sessionsRepo, usersRepo } from "../core/repos/orgs.js";
import type { Ctx, Locale, User } from "../core/types.js";

export const SESSION_COOKIE = "sp_session";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
    ctx: Ctx | null;
    locale: Locale;
    sessionId: string | null;
  }
}

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sign(sessionId), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(),
    maxAge: 30 * 86400,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/**
 * Her istekte kimlik çözümü:
 *  1) Oturum çerezi -> kullanıcı + seçili çalışma alanı (X-Org-Id başlığıyla değiştirilebilir)
 *  2) Bearer sp_... -> API anahtarı (çalışma alanına bağlı)
 *  3) Bearer spat_... -> MCP OAuth erişim token'ı (kullanıcı + çalışma alanı)
 */
export async function resolveRequest(req: FastifyRequest): Promise<void> {
  req.user = null;
  req.ctx = null;
  req.sessionId = null;
  req.locale = pickLocale((req.headers["x-locale"] as string) || req.headers["accept-language"] || config.defaultLocale);

  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) {
    const sid = unsign(raw);
    const sess = sid ? sessionsRepo.resolve(sid) : null;
    const user = sess ? usersRepo.get(sess.userId) : null;
    if (user && !user.disabled && sid) {
      req.user = user;
      req.sessionId = sid;
      if (!req.headers["x-locale"]) req.locale = user.locale;
      const wanted = (req.headers["x-org-id"] as string) || sess!.orgId;
      let membership = wanted ? membershipsRepo.get(wanted, user.id) : null;
      if (!membership) {
        const first = orgsRepo.listForUser(user.id)[0];
        membership = first ? membershipsRepo.get(first.id, user.id) : null;
        if (membership && sess!.orgId !== membership.orgId) sessionsRepo.setOrg(sid, membership.orgId);
      }
      if (membership) req.ctx = { orgId: membership.orgId, userId: user.id, role: membership.role, via: "session", locale: req.locale };
      // Süper admin, üyesi olmadığı bir çalışma alanına X-Org-Id ile bakabilir (destek amaçlı, salt yönetici rolüyle)
      else if (wanted && user.isSuperadmin && orgsRepo.get(wanted)) req.ctx = { orgId: wanted, userId: user.id, role: "admin", via: "session", locale: req.locale };
      return;
    }
  }

  const token = bearer(req);
  if (!token) return;
  if (token.startsWith("sp_")) {
    const key = apiKeysRepo.verify(token);
    if (key) req.ctx = { orgId: key.orgId, userId: key.createdBy, role: "admin", via: "apikey", locale: req.locale, clientName: `API: ${key.name}` };
    return;
  }
  if (token.startsWith("spat_")) {
    const info = oauthTokensRepo.verifyAccess(token);
    if (!info) return;
    const user = usersRepo.get(info.userId);
    const m = membershipsRepo.get(info.orgId, info.userId);
    if (!user || user.disabled || !m) return;
    req.user = user;
    req.locale = user.locale;
    req.ctx = { orgId: info.orgId, userId: user.id, role: m.role, via: "oauth", locale: user.locale, clientName: info.clientName };
  }
}

/** Çalışma alanı bağlamı zorunlu */
export async function requireCtx(req: FastifyRequest): Promise<void> {
  if (!req.ctx) throw new AppError(401, "err.unauthorized");
  const org = orgsRepo.get(req.ctx.orgId);
  if (!org) throw new AppError(401, "err.unauthorized");
  if (org.disabled && !req.user?.isSuperadmin) throw new AppError(403, "err.org_disabled");
}

/** Sadece panel oturumu (API anahtarı / OAuth ile yapılamayan işlemler) */
export async function requireSession(req: FastifyRequest): Promise<void> {
  if (!req.user || !req.sessionId) throw new AppError(401, "err.unauthorized");
}

export async function requireSuperadmin(req: FastifyRequest): Promise<void> {
  if (!req.user || !req.sessionId || !req.user.isSuperadmin) throw new AppError(403, "err.forbidden");
}

export function ctxOf(req: FastifyRequest): Ctx {
  if (!req.ctx) throw new AppError(401, "err.unauthorized");
  return req.ctx;
}

/**
 * CSRF koruması: çerezle kimliği doğrulanmış, durum değiştiren istekler
 * yalnızca panelin kendi kökeninden gelebilir. Bearer ile gelen istekler (MCP, API) muaf.
 */
export function allowedOrigins(): string[] {
  const set = new Set<string>([config.publicUrl, config.appUrl, ...config.security.extraOrigins]);
  if (!isSecure()) {
    set.add("http://localhost:5173");
    set.add("http://127.0.0.1:5173");
    set.add(`http://localhost:${config.port}`);
  }
  return [...set];
}

export async function csrfGuard(req: FastifyRequest): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  if (!req.cookies?.[SESSION_COOKIE] || bearer(req)) return;
  const origin = (req.headers.origin as string) || (req.headers.referer ? new URL(req.headers.referer as string).origin : "");
  if (!origin) throw new AppError(403, "err.csrf");
  if (!allowedOrigins().includes(origin.replace(/\/$/, ""))) throw new AppError(403, "err.csrf");
}
