import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, notFound } from "../../core/i18n.js";
import { adsRepo } from "../../core/repos/ads.js";
import { requireRole } from "../../services/access.js";
import { META_CTAS } from "../../services/ads-providers.js";
import { adsConnectUrl, adsReport, boostPost, createMetaAd, finishAdsConnect, isAdsProvider, listRecommendations, recommendationAction, setCampaignStatus, syncNow } from "../../services/ads.js";
import { ctxOf, requireCtx } from "../context.js";

const Id = z.object({ id: z.string() });

/** Reklamlar: metrikler ve yönetim (/api/ads) */
export async function adsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/ads/report", async (req) => {
    const q = z.object({ accountId: z.string().optional(), days: z.coerce.number().int().min(7).max(366).default(30) }).parse(req.query);
    return adsReport(ctxOf(req), q);
  });

  /** Tarayıcı yönlendirmesi: platformun izin ekranı (yalnızca okuma izni) · :provider = meta | google | tiktok */
  app.get("/api/ads/:provider/connect", async (req, reply) => {
    const { provider } = z.object({ provider: z.string() }).parse(req.params);
    if (!isAdsProvider(provider)) return reply.redirect("/app/analytics/ads?error=ads.failed", 302);
    try {
      return reply.redirect(adsConnectUrl(ctxOf(req), provider), 302);
    } catch (e) {
      return reply.redirect(`/app/analytics/ads?error=${e instanceof AppError ? e.key : "ads.failed"}`, 302);
    }
  });

  app.get("/api/ads/:provider/callback", async (req, reply) => {
    const { provider } = z.object({ provider: z.string() }).parse(req.params);
    // TikTok kodu auth_code olarak döner; Meta ve Google code
    const q = z
      .object({ code: z.string().max(2000).optional(), auth_code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() })
      .parse(req.query);
    const code = q.code ?? q.auth_code;
    if (!isAdsProvider(provider) || q.error || !code || !q.state) return reply.redirect(`/app/analytics/ads${q.error === "access_denied" ? "" : "?error=ads.failed"}`, 302);
    try {
      const r = await finishAdsConnect(provider, { code, auth_code: q.auth_code, state: q.state }, ctxOf(req).userId);
      return reply.redirect(`/app/analytics/ads?connected=${r.accounts.length}`, 302);
    } catch (e) {
      return reply.redirect(`/app/analytics/ads?error=${e instanceof AppError ? e.key : "ads.failed"}`, 302);
    }
  });

  app.post("/api/ads/:id/sync", async (req) => syncNow(ctxOf(req), Id.parse(req.params).id));

  /* ---- Yönetim (yönetici rolü; platformda yazma izni gerekir) ---- */

  app.post("/api/ads/:id/campaigns/:campaignId/status", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { id, campaignId } = z.object({ id: z.string(), campaignId: z.string().regex(/^[\w.-]{1,64}$/) }).parse(req.params);
    const { status } = z.object({ status: z.enum(["active", "paused"]) }).parse(req.body);
    return setCampaignStatus(ctxOf(req), id, campaignId, status);
  });

  /** Meta: gönderi öne çıkarma — kampanya, reklam seti ve reklam DURAKLATILMIŞ oluşturulur */
  app.post("/api/ads/:id/boost", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const body = z
      .object({
        postId: z.string().max(64),
        targetId: z.string().max(64),
        name: z.string().max(120).optional(),
        dailyBudget: z.number().positive().max(1_000_000),
        days: z.number().int().min(1).max(30),
        countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(25),
        ageMin: z.number().int().min(18).max(65).default(18),
        ageMax: z.number().int().min(18).max(65).default(65),
      })
      .refine((b) => b.ageMin <= b.ageMax, { message: "ageMin <= ageMax", path: ["ageMax"] })
      .parse(req.body);
    return boostPost(ctxOf(req), Id.parse(req.params).id, body);
  });

  /** Meta: sıfırdan bağlantı reklamı (kütüphaneden görsel) — her şey DURAKLATILMIŞ oluşturulur */
  app.post("/api/ads/:id/create", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const body = z
      .object({
        objective: z.enum(["traffic", "awareness"]),
        name: z.string().max(120).optional(),
        pageChannelId: z.string().max(64),
        facebook: z.boolean().default(true),
        instagram: z.boolean().default(false),
        mediaId: z.string().max(64),
        message: z.string().trim().min(1).max(2000),
        headline: z.string().trim().min(1).max(100),
        description: z.string().max(200).optional(),
        link: z.string().url().max(1000).refine((u) => /^https:\/\//i.test(u), "https"),
        cta: z.enum(META_CTAS),
        dailyBudget: z.number().positive().max(1_000_000),
        days: z.number().int().min(1).max(90),
        countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(25),
        ageMin: z.number().int().min(18).max(65).default(18),
        ageMax: z.number().int().min(18).max(65).default(65),
      })
      .refine((b) => b.ageMin <= b.ageMax, { message: "ageMin <= ageMax", path: ["ageMax"] })
      .parse(req.body);
    return createMetaAd(ctxOf(req), Id.parse(req.params).id, body);
  });

  /** Google Ads önerileri */
  app.get("/api/ads/:id/recommendations", async (req) => ({ items: await listRecommendations(ctxOf(req), Id.parse(req.params).id) }));
  app.post("/api/ads/:id/recommendations", async (req) => {
    const { resourceName, action } = z.object({ resourceName: z.string().max(300), action: z.enum(["apply", "dismiss"]) }).parse(req.body);
    return recommendationAction(ctxOf(req), Id.parse(req.params).id, resourceName, action);
  });

  app.patch("/api/ads/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const id = Id.parse(req.params).id;
    if (!adsRepo.get(ctx.orgId, id)) throw notFound("ad_account");
    adsRepo.setEnabled(ctx.orgId, id, enabled);
    return adsRepo.get(ctx.orgId, id);
  });

  app.delete("/api/ads/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    adsRepo.remove(ctx.orgId, Id.parse(req.params).id);
    return { ok: true };
  });
}
