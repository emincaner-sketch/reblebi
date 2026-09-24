import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../core/config.js";
import { effectivePlan } from "../../core/plans.js";
import { membershipsRepo, orgsRepo, sessionsRepo, usersRepo } from "../../core/repos/orgs.js";
import { notificationsRepo } from "../../core/repos/content.js";
import {
  acceptInvite,
  changePassword,
  createWorkspace,
  inviteInfo,
  login,
  requestPasswordReset,
  resetPassword,
  sendVerification,
  signup,
  verifyEmail,
} from "../../services/accounts.js";
import { clearSessionCookie, requireSession, setSessionCookie } from "../context.js";

const Email = z.email().max(200);
const Password = z.string().min(8).max(200);
const Locale = z.enum(["tr", "en"]);

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  /** Panelin açılışta çağırdığı durum: kullanıcı, çalışma alanları, seçili alan, kurulum gerekli mi */
  app.get("/api/auth/me", async (req) => {
    const needsSetup = usersRepo.count() === 0;
    if (!req.user) return { needsSetup, signupMode: config.saas.signupMode, user: null, orgs: [], org: null, role: null };
    const orgs = orgsRepo.listForUser(req.user.id).map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: o.role, plan: effectivePlan(o).id }));
    const org = req.ctx ? orgsRepo.get(req.ctx.orgId) : null;
    return {
      needsSetup,
      signupMode: config.saas.signupMode,
      user: { id: req.user.id, email: req.user.email, name: req.user.name, locale: req.user.locale, isSuperadmin: Boolean(req.user.isSuperadmin), emailVerified: Boolean(req.user.emailVerifiedAt) },
      orgs,
      org: org
        ? { id: org.id, name: org.name, slug: org.slug, timezone: org.timezone, locale: org.locale, plan: effectivePlan(org).id, planExpiresAt: org.planExpiresAt, disabled: Boolean(org.disabled) }
        : null,
      role: req.ctx?.role ?? null,
      unreadNotifications: req.ctx ? notificationsRepo.unreadCount(req.ctx.orgId, req.user.id) : 0,
    };
  });

  app.post("/api/auth/signup", strict, async (req, reply) => {
    const body = z
      .object({
        email: Email,
        password: Password,
        name: z.string().max(80).optional(),
        orgName: z.string().max(80).optional(),
        locale: Locale.optional(),
        timezone: z.string().max(60).optional(),
        inviteToken: z.string().max(200).optional(),
      })
      .parse(req.body);
    const { user, orgId } = await signup({ ...body, locale: body.locale ?? req.locale });
    if (user.emailVerifiedAt || !config.saas.requireEmailVerification) {
      setSessionCookie(reply, sessionsRepo.create(user.id, orgId));
      usersRepo.touchLogin(user.id);
    }
    return { ok: true, verified: Boolean(user.emailVerifiedAt), loggedIn: Boolean(user.emailVerifiedAt || !config.saas.requireEmailVerification) };
  });

  app.post("/api/auth/login", strict, async (req, reply) => {
    const body = z.object({ email: Email, password: z.string().min(1).max(200) }).parse(req.body);
    const { user, orgId } = login(body.email, body.password);
    setSessionCookie(reply, sessionsRepo.create(user.id, orgId));
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.sessionId) sessionsRepo.remove(req.sessionId);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post("/api/auth/verify", strict, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
    const user = verifyEmail(token);
    const orgId = orgsRepo.listForUser(user.id)[0]?.id ?? null;
    if (!req.user) setSessionCookie(reply, sessionsRepo.create(user.id, orgId));
    return { ok: true };
  });

  app.post("/api/auth/resend-verification", { ...strict, preHandler: requireSession }, async (req) => {
    if (req.user && !req.user.emailVerifiedAt) await sendVerification(req.user);
    return { ok: true };
  });

  app.post("/api/auth/forgot", strict, async (req) => {
    const { email } = z.object({ email: Email }).parse(req.body);
    await requestPasswordReset(email);
    return { ok: true };
  });

  app.post("/api/auth/reset", strict, async (req, reply) => {
    const body = z.object({ token: z.string().min(10).max(200), password: Password }).parse(req.body);
    const user = resetPassword(body.token, body.password);
    const orgId = orgsRepo.listForUser(user.id)[0]?.id ?? null;
    setSessionCookie(reply, sessionsRepo.create(user.id, orgId));
    return { ok: true };
  });

  app.post("/api/auth/password", { ...strict, preHandler: requireSession }, async (req) => {
    const body = z.object({ current: z.string().min(1), next: Password }).parse(req.body);
    changePassword(req.user!.id, body.current, body.next, req.sessionId ?? undefined);
    return { ok: true };
  });

  app.patch("/api/auth/profile", { preHandler: requireSession }, async (req) => {
    const body = z.object({ name: z.string().max(80).nullable().optional(), locale: Locale.optional() }).parse(req.body);
    const u = usersRepo.update(req.user!.id, body)!;
    return { id: u.id, email: u.email, name: u.name, locale: u.locale };
  });

  /* ---------------- Çalışma alanı seçimi ---------------- */

  app.post("/api/auth/switch-org", { preHandler: requireSession }, async (req) => {
    const { orgId } = z.object({ orgId: z.string() }).parse(req.body);
    const m = membershipsRepo.get(orgId, req.user!.id);
    if (!m && !(req.user!.isSuperadmin && orgsRepo.get(orgId))) return { ok: false };
    sessionsRepo.setOrg(req.sessionId!, orgId);
    return { ok: true };
  });

  app.post("/api/auth/orgs", { preHandler: requireSession }, async (req) => {
    const body = z.object({ name: z.string().min(1).max(80), timezone: z.string().max(60).optional(), locale: Locale.optional() }).parse(req.body);
    const org = createWorkspace(req.user!.id, body.name, body.locale ?? req.locale, body.timezone);
    sessionsRepo.setOrg(req.sessionId!, org.id);
    return { id: org.id, name: org.name };
  });

  /* ---------------- Davet ---------------- */

  app.get("/api/auth/invite", async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.query);
    return inviteInfo(token) ?? { invalid: true };
  });

  app.post("/api/auth/invite/accept", { preHandler: requireSession }, async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
    const orgId = acceptInvite(req.user!.id, token);
    sessionsRepo.setOrg(req.sessionId!, orgId);
    return { ok: true, orgId };
  });
}
