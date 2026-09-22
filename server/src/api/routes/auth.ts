import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sessionsRepo, usersRepo } from "../../core/repos/misc.js";
import { unsign } from "../../core/crypto.js";
import { SESSION_COOKIE, clearSessionCookie, requireAuth, setSessionCookie } from "../auth.js";

const Credentials = z.object({ email: z.email("Geçerli bir e-posta gir"), password: z.string().min(8, "Şifre en az 8 karakter olmalı") });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/status", async (req) => ({
    needsSetup: usersRepo.count() === 0,
    user: req.user,
    authVia: req.authVia,
  }));

  app.post("/api/auth/setup", async (req, reply) => {
    if (usersRepo.count() > 0) return reply.code(400).send({ error: "Kurulum zaten yapılmış" });
    const body = Credentials.parse(req.body);
    const user = usersRepo.create(body.email, body.password);
    setSessionCookie(reply, sessionsRepo.create(user.id));
    return { user };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = Credentials.parse(req.body);
    const user = usersRepo.verify(body.email, body.password);
    if (!user) return reply.code(401).send({ error: "E-posta ya da şifre hatalı" });
    setSessionCookie(reply, sessionsRepo.create(user.id));
    return { user };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const raw = req.cookies?.[SESSION_COOKIE];
    const sid = raw ? unsign(raw) : null;
    if (sid) sessionsRepo.remove(sid);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post("/api/auth/password", { preHandler: requireAuth }, async (req, reply) => {
    if (req.authVia !== "session" || !req.user) return reply.code(403).send({ error: "Sadece panel oturumu şifre değiştirebilir" });
    const body = z.object({ current: z.string(), next: z.string().min(8) }).parse(req.body);
    if (!usersRepo.verify(req.user.email, body.current)) return reply.code(400).send({ error: "Mevcut şifre hatalı" });
    usersRepo.changePassword(req.user.id, body.next);
    return { ok: true };
  });
}
