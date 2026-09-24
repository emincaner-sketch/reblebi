import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../core/config.js";
import { AppError, notFound } from "../../core/i18n.js";
import { customersRepo } from "../../core/repos/content.js";
import { activityRepo } from "../../core/repos/misc.js";
import { ALL_PROVIDERS, type ProviderId } from "../../core/types.js";
import { describeProvider, listProviders } from "../../providers/index.js";
import { requireRole } from "../../services/access.js";
import { checkChannel, connectWithForm, finishOAuth, listChannels, removeChannel, startOAuth, updateChannel } from "../../services/channels.js";
import { assertFeature } from "../../services/limits.js";
import { findFreeSlots } from "../../services/slots.js";
import { ctxOf, requireCtx } from "../context.js";

const ProviderParam = z.object({ provider: z.enum(ALL_PROVIDERS as [ProviderId, ...ProviderId[]]) });

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/providers", async () => listProviders().map(describeProvider));

  app.get("/api/channels", async (req) => listChannels(ctxOf(req)));

  app.patch("/api/channels/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).max(100).optional(),
        status: z.enum(["active", "disabled"]).optional(),
        customerId: z.string().nullable().optional(),
        postingTimes: z.array(z.string().regex(/^\d{1,2}:\d{2}$/)).max(24).optional(),
        preferences: z.record(z.string(), z.unknown()).optional(),
        dmPolling: z.boolean().optional(),
      })
      .parse(req.body);
    return updateChannel(ctxOf(req), id, body);
  });

  app.delete("/api/channels/:id", async (req) => {
    removeChannel(ctxOf(req), z.object({ id: z.string() }).parse(req.params).id);
    return { ok: true };
  });

  app.post("/api/channels/:id/check", async (req) => checkChannel(ctxOf(req), z.object({ id: z.string() }).parse(req.params).id));

  /** Form ile bağlantı (Telegram, WhatsApp) */
  app.post("/api/channels/connect/:provider", async (req) => {
    const { provider } = ProviderParam.parse(req.params);
    const values = z.record(z.string(), z.string().max(2000)).parse(req.body ?? {});
    return connectWithForm(ctxOf(req), provider, values);
  });

  /** OAuth başlat: yönlendirilecek URL döner */
  app.get("/api/oauth/:provider/start", async (req) => {
    const { provider } = z.object({ provider: z.string() }).parse(req.params);
    return startOAuth(ctxOf(req), provider);
  });

  /** Boş paylaşım saatleri (composer "sonraki boş saat" ve AI planlama) */
  app.get("/api/slots", async (req) => {
    const q = z
      .object({ channelIds: z.string().min(1), count: z.coerce.number().min(1).max(50).default(8), days: z.coerce.number().min(1).max(60).default(14), from: z.string().optional() })
      .parse(req.query);
    return findFreeSlots({ orgId: ctxOf(req).orgId, channelIds: q.channelIds.split(","), count: q.count, days: q.days, from: q.from ? new Date(q.from) : undefined });
  });

  /* ---------------- Müşteriler (ajans modu) ---------------- */

  app.get("/api/customers", async (req) => customersRepo.list(ctxOf(req).orgId));

  app.post("/api/customers", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    assertFeature(ctx.orgId, "customers");
    const body = z.object({ name: z.string().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).parse(req.body);
    return customersRepo.create(ctx.orgId, body.name, body.color);
  });

  app.patch("/api/customers/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ name: z.string().min(1).max(80).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).parse(req.body);
    return customersRepo.update(ctx.orgId, id, body) ?? Promise.reject(notFound("customer"));
  });

  app.delete("/api/customers/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    customersRepo.remove(ctx.orgId, z.object({ id: z.string() }).parse(req.params).id);
    return { ok: true };
  });
}

/** Platformdan dönüş: kimlik gerektirmez, state ile çalışma alanı çözülür */
export async function oauthCallbackRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/oauth/:provider/callback", async (req, reply) => {
    const { provider } = z.object({ provider: z.string() }).parse(req.params);
    const q = z
      .object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional(), error_description: z.string().optional() })
      .parse(req.query);
    const back = (params: Record<string, string>) => reply.redirect(`${config.appUrl}/app/channels?${new URLSearchParams(params).toString()}`);
    if (q.error) return back({ error: q.error_description ?? q.error });
    if (!q.code || !q.state) return back({ error: "missing_code" });
    try {
      const r = await finishOAuth(provider, q.code, q.state);
      return back({ connected: r.channels.map((c) => c.name).join(", ") });
    } catch (e) {
      const msg = e instanceof AppError ? e.localized(req.locale) : e instanceof Error ? e.message : String(e);
      activityRepo.add(null, "error", "channel", `${provider} OAuth: ${msg}`);
      return back({ error: msg.slice(0, 300) });
    }
  });
}
