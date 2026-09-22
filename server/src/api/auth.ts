import type { FastifyReply, FastifyRequest } from "fastify";
import { apiKeysRepo, sessionsRepo, usersRepo } from "../core/repos/misc.js";
import { sign, unsign } from "../core/crypto.js";
import { isSecure } from "../core/config.js";

export const SESSION_COOKIE = "sp_session";

declare module "fastify" {
  interface FastifyRequest {
    user: { id: string; email: string } | null;
    authVia: "session" | "apikey" | null;
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

/** Her istekte kullanıcıyı çözer: önce oturum çerezi, sonra Bearer API anahtarı */
export async function resolveUser(req: FastifyRequest): Promise<void> {
  req.user = null;
  req.authVia = null;
  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) {
    const sid = unsign(raw);
    const userId = sid ? sessionsRepo.resolve(sid) : null;
    const user = userId ? usersRepo.get(userId) : null;
    if (user) {
      req.user = user;
      req.authVia = "session";
      return;
    }
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const key = auth.slice(7).trim();
    const entry = apiKeysRepo.verify(key);
    if (entry) {
      req.user = { id: "apikey:" + entry.id, email: entry.name };
      req.authVia = "apikey";
    }
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) {
    reply.code(401).send({ error: "Oturum gerekli" });
  }
}
