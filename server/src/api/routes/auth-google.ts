import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../core/i18n.js";
import { sessionsRepo } from "../../core/repos/orgs.js";
import { finishGoogleLogin, startGoogleLogin } from "../../services/google-login.js";
import { finishFacebookLogin, startFacebookLogin } from "../../services/facebook-login.js";
import { setSessionCookie } from "../context.js";

/**
 * Sosyal giriş / kayıt: /api/auth/{google|facebook}/start → sağlayıcı → /api/auth/{google|facebook}/callback.
 * Hata durumunda giriş sayfasına ?error=… ile döner (e-posta/şifre akışı aynen çalışır).
 */
export async function googleAuthRoutes(app: FastifyInstance): Promise<void> {
  const strict = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

  app.get("/api/auth/:provider/start", strict, async (req, reply) => {
    const parsed = z.object({ provider: z.enum(["google", "facebook"]) }).safeParse(req.params);
    if (!parsed.success) return reply.redirect("/login", 302);
    const { provider } = parsed.data;
    const q = z.object({ next: z.string().max(500).optional(), locale: z.enum(["tr", "en"]).optional(), tz: z.string().max(60).optional() }).parse(req.query);
    let tz: string | undefined = q.tz;
    try {
      if (tz) new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      tz = undefined;
    }
    try {
      const start = provider === "facebook" ? startFacebookLogin : startGoogleLogin;
      return reply.redirect(start({ next: q.next, locale: q.locale, tz }), 302);
    } catch (e) {
      return reply.redirect(`/login?error=${e instanceof AppError ? e.key : "auth.google_failed"}`, 302);
    }
  });

  app.get("/api/auth/:provider/callback", strict, async (req, reply) => {
    const parsed = z.object({ provider: z.enum(["google", "facebook"]) }).safeParse(req.params);
    if (!parsed.success) return reply.redirect("/login", 302);
    const { provider } = parsed.data;
    const q = z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }).parse(req.query);
    // Kullanıcı Google ekranında vazgeçtiyse sessizce girişe dön
    if (q.error || !q.code || !q.state) return reply.redirect(`/login${q.error === "access_denied" ? "" : "?error=auth.google_failed"}`, 302);
    try {
      const r = provider === "facebook" ? await finishFacebookLogin(q.code, q.state) : await finishGoogleLogin(q.code, q.state);
      setSessionCookie(reply, sessionsRepo.create(r.user.id, r.orgId));
      return reply.redirect(r.next, 302);
    } catch (e) {
      req.log.warn({ msg: e instanceof Error ? e.message : String(e) }, `${provider} login failed`);
      return reply.redirect(`/login?error=${e instanceof AppError ? e.key : "auth.google_failed"}`, 302);
    }
  });
}
