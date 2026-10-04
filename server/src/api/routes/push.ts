import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../core/i18n.js";
import { allowedEndpoint, pushRepo, sendPush, vapid } from "../../services/webpush.js";
import { ctxOf, requireCtx } from "../context.js";

/** Anlık bildirim abonelikleri: /api/push */
export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/push/key", async (req) => {
    const userId = ctxOf(req).userId;
    return { publicKey: vapid().publicKey, subscriptions: userId ? pushRepo.forUser(userId).length : 0 };
  });

  app.post("/api/push/subscriptions", async (req) => {
    const ctx = ctxOf(req);
    if (!ctx.userId) throw new AppError(403, "err.forbidden");
    const b = z
      .object({
        endpoint: z.string().url().max(1000),
        keys: z.object({ p256dh: z.string().min(80).max(120), auth: z.string().min(16).max(40) }),
        scope: z.enum(["all", "important"]).default("all"),
      })
      .parse(req.body);
    if (!allowedEndpoint(b.endpoint)) throw new AppError(400, "push.bad_endpoint");
    pushRepo.upsert(ctx.userId, { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, scope: b.scope, ua: String(req.headers["user-agent"] ?? "").slice(0, 200) || null });
    return { ok: true };
  });

  app.delete("/api/push/subscriptions", async (req) => {
    const ctx = ctxOf(req);
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body ?? {});
    if (ctx.userId) pushRepo.remove(ctx.userId, endpoint);
    return { ok: true };
  });

  app.post("/api/push/test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const ctx = ctxOf(req);
    if (!ctx.userId) throw new AppError(403, "err.forbidden");
    const subs = pushRepo.forUser(ctx.userId);
    let sent = 0;
    for (const s of subs) if (await sendPush(s, { title: ctx.locale === "en" ? "Notifications are on" : "Bildirimler açık", body: ctx.locale === "en" ? "You'll get Reblebi alerts on this device." : "Reblebi uyarıları bu cihaza gelecek.", url: "/app" })) sent++;
    return { sent, devices: subs.length };
  });
}
