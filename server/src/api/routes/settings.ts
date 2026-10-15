import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config, isSecure } from "../../core/config.js";
import { encrypt } from "../../core/crypto.js";
import { AppError, notFound } from "../../core/i18n.js";
import { loadBrandContext } from "../../core/brand.js";
import { webhooksRepo } from "../../core/repos/content.js";
import { webhookEventsRepo } from "../../core/repos/misc.js";
import { orgSettingsRepo, orgsRepo } from "../../core/repos/orgs.js";
import { parseRecipients, REPORT_SECTIONS, sendTestReport } from "../../services/report-email.js";
import { ALL_PROVIDERS, WEBHOOK_EVENTS, type OrgSettings, type ProviderId, type WebhookEvent } from "../../core/types.js";
import { DEFAULT_MODELS, generateContent, improveText, platformAiAvailable, resolveAiConfig, testAi } from "../../ai/index.js";
import { describeProvider, listProviders } from "../../providers/index.js";
import { requireRole } from "../../services/access.js";
import { assertFeature, hasFeature, usageSummary } from "../../services/limits.js";
import { testWebhook } from "../../services/notify.js";
import { snapshotAnalytics } from "../../services/scheduler.js";
import { analyticsOverview, dashboard } from "../../services/analytics.js";
import { analyticsReport, bestTimes } from "../../services/analytics-report.js";
import { describeSlots } from "../../services/slots.js";
import { hhmmToMinutes } from "../../services/time.js";
import { ctxOf, requireCtx } from "../context.js";
import { PostKindSchema } from "../schemas.js";

const ProviderEnum = z.enum(ALL_PROVIDERS as [ProviderId, ...ProviderId[]]);

/** Panele dönen ayarlar: şifreli AI anahtarı yerine sadece "var mı" bilgisi */
function publicSettings(s: OrgSettings) {
  const { aiApiKeyEnc, defaultTimeSlots, ...rest } = s;
  return { ...rest, aiApiKeySet: Boolean(aiApiKeyEnc), defaultPostingTimes: describeSlots(defaultTimeSlots) };
}

const SettingsSchema = z.object({
  brandName: z.string().max(120).optional(),
  brandVoice: z.string().max(500).optional(),
  brandAudience: z.string().max(1000).optional(),
  brandOffers: z.string().max(4000).optional(),
  brandBannedWords: z.string().max(1000).optional(),
  brandExamples: z.string().max(4000).optional(),
  aiAutoReplyFallback: z.boolean().optional(),
  aiReplyInstructions: z.string().max(4000).optional(),
  businessHoursEnabled: z.boolean().optional(),
  businessHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  businessHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  businessDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  outsideHoursMessage: z.string().max(2000).optional(),
  handoffKeywords: z.string().max(1000).optional(),
  replyDelaySeconds: z.number().int().min(0).max(60).optional(),
  welcomeMessage: z.string().max(2000).optional(),
  optOutKeywords: z.string().max(1000).optional(),
  optOutReply: z.string().max(1000).optional(),
  approvalMode: z.enum(["none", "ai", "all"]).optional(),
  defaultPostingTimes: z.array(z.string().regex(/^\d{1,2}:\d{2}$/)).max(24).optional(),
  minGapMinutes: z.number().int().min(0).max(1440).optional(),
  aiProvider: z.enum(["platform", "anthropic", "openai", "xai", "gemini", "openrouter", "custom"]).optional(),
  aiModel: z.string().max(120).optional(),
  /** Boş string: anahtarı sil; gönderilmezse değişmez */
  aiApiKey: z.string().max(500).optional(),
  aiBaseUrl: z.string().max(300).optional(),
  notifyOnFailureEmail: z.boolean().optional(),
  reportLogoUrl: z
    .string()
    .max(2000)
    .refine((v) => v === "" || /^https:\/\//i.test(v) || v.startsWith("/media/"), "https:// | /media/")
    .optional(),
  reportColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  reportSections: z.array(z.enum(REPORT_SECTIONS)).max(REPORT_SECTIONS.length).optional(),
  reportIntro: z.string().max(1500).optional(),
  reportEmail: z.enum(["off", "weekly", "monthly"]).optional(),
  reportRecipients: z
    .string()
    .max(1000)
    .refine((v) => parseRecipients(v) !== null, "email list")
    .optional(),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/settings", async (req) => {
    const ctx = ctxOf(req);
    return publicSettings(orgSettingsRepo.get(ctx.orgId));
  });

  app.put("/api/settings", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const body = SettingsSchema.parse(req.body);
    const { aiApiKey, defaultPostingTimes, ...rest } = body;
    const patch: Partial<OrgSettings> = { ...rest };
    if (defaultPostingTimes) {
      patch.defaultTimeSlots = [...new Set(defaultPostingTimes.map((s) => hhmmToMinutes(s)).filter((n): n is number => n !== null))].sort((a, b) => a - b);
    }
    if (aiApiKey !== undefined) patch.aiApiKeyEnc = aiApiKey ? encrypt(aiApiKey.trim()) : "";
    if (body.approvalMode && body.approvalMode !== "none") assertFeature(ctx.orgId, "approvals");
    if (body.aiProvider && body.aiProvider !== "platform") assertFeature(ctx.orgId, "byokAi");
    if (body.aiProvider === "custom" && body.aiBaseUrl && !req.user?.isSuperadmin) {
      // SaaS'ta iç ağa istek atılmasın: özel uç nokta https ve herkese açık olmalı
      if (!/^https:\/\//i.test(body.aiBaseUrl)) throw new AppError(400, "err.validation", { detail: "aiBaseUrl must be https" });
    }
    return publicSettings(orgSettingsRepo.set(ctx.orgId, patch));
  });

  /* ---------------- Markalı rapor: test e-postası (yalnızca isteyen kişiye) ---------------- */

  app.post("/api/reports/email/test", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    if (!req.user?.email) throw new AppError(400, "err.validation", { detail: "session user required" });
    return sendTestReport(ctx.orgId, req.user.email);
  });

  /* ---------------- AI ---------------- */

  app.get("/api/ai/status", async (req) => {
    const ctx = ctxOf(req);
    const cfg = resolveAiConfig(ctx.orgId);
    const brand = loadBrandContext(ctx.orgId);
    return {
      available: Boolean(cfg),
      provider: cfg?.provider ?? null,
      model: cfg?.model ?? null,
      usingPlatformKey: cfg?.usingPlatformKey ?? false,
      platformAvailable: platformAiAvailable(),
      defaults: DEFAULT_MODELS,
      brandSources: brand.sources,
      usage: usageSummary(ctx.orgId).ai,
    };
  });

  app.post("/api/ai/test", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const cfg = resolveAiConfig(ctx.orgId);
    if (!cfg) throw new AppError(400, "ai.disabled");
    return testAi(cfg);
  });

  app.post("/api/ai/generate", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z
      .object({
        topic: z.string().min(3).max(5000),
        kind: PostKindSchema.default("post"),
        platforms: z.array(ProviderEnum).min(1).max(9),
        tone: z.string().max(200).optional(),
        goal: z.string().max(500).optional(),
        language: z.string().max(40).optional(),
        extraInstructions: z.string().max(2000).optional(),
      })
      .parse(req.body);
    return generateContent(ctx.orgId, body);
  });

  app.post("/api/ai/improve", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z.object({ text: z.string().min(1).max(10000), instruction: z.string().min(1).max(1000), platform: ProviderEnum.optional() }).parse(req.body);
    return { text: await improveText(ctx.orgId, body.text, body.instruction, body.platform) };
  });

  /* ---------------- Panel özeti ---------------- */

  app.get("/api/dashboard", async (req) => dashboard(ctxOf(req).orgId));

  /* ---------------- Analitik ---------------- */

  app.get("/api/analytics/overview", async (req) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(req.query);
    return analyticsOverview(ctxOf(req).orgId, days);
  });

  /** Panel analitik raporu: dönem + karşılaştırma, günlük seriler, ağ dağılımı, gönderi listesi (services/analytics-report.ts) */
  app.get("/api/analytics/report", async (req) => {
    const q = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        days: z.coerce.number().int().min(1).max(366).optional(),
        provider: z.enum(ALL_PROVIDERS as [ProviderId, ...ProviderId[]]).optional(),
        channelId: z.string().max(64).optional(),
        campaignId: z.string().max(64).optional(),
      })
      .parse(req.query);
    return analyticsReport(ctxOf(req).orgId, q);
  });

  /** Takvim katmanı: gün × saat ortalama etkileşim (services/analytics-report.ts → bestTimes) */
  app.get("/api/analytics/best-times", async (req) => {
    const q = z
      .object({
        days: z.coerce.number().int().min(7).max(366).optional(),
        provider: z.enum(ALL_PROVIDERS as [ProviderId, ...ProviderId[]]).optional(),
        channelId: z.string().max(64).optional(),
      })
      .parse(req.query);
    return bestTimes(ctxOf(req).orgId, q);
  });

  app.post("/api/analytics/refresh", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req) => {
    await snapshotAnalytics(true, ctxOf(req).orgId);
    return { ok: true };
  });

  /* ---------------- Giden webhook'lar ---------------- */

  const EventEnum = z.enum(WEBHOOK_EVENTS as [WebhookEvent, ...WebhookEvent[]]);

  app.get("/api/webhooks", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    return { events: WEBHOOK_EVENTS, items: webhooksRepo.list(ctx.orgId) };
  });

  app.post("/api/webhooks", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    assertFeature(ctx.orgId, "webhooks");
    const body = z.object({ name: z.string().min(1).max(60), url: z.url().refine((u) => /^https?:\/\//.test(u)), events: z.array(EventEnum).min(1) }).parse(req.body);
    return webhooksRepo.create(ctx.orgId, body);
  });

  app.patch("/api/webhooks/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ name: z.string().min(1).max(60).optional(), url: z.url().optional(), events: z.array(EventEnum).min(1).optional(), enabled: z.boolean().optional() }).parse(req.body);
    const w = webhooksRepo.update(ctx.orgId, id, body);
    if (!w) throw notFound("webhook");
    return w;
  });

  app.delete("/api/webhooks/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    webhooksRepo.remove(ctx.orgId, z.object({ id: z.string() }).parse(req.params).id);
    return { ok: true };
  });

  app.post("/api/webhooks/:id/test", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    return testWebhook(ctx.orgId, z.object({ id: z.string() }).parse(req.params).id);
  });

  /* ---------------- Sistem bilgisi (bağlantı talimatları için) ---------------- */

  app.get("/api/system", async (req) => {
    const ctx = ctxOf(req);
    const org = orgsRepo.get(ctx.orgId)!;
    const isAdmin = ctx.role === "owner" || ctx.role === "admin";
    return {
      appName: config.appName,
      publicUrl: config.publicUrl,
      secure: isSecure(),
      timezone: org.timezone,
      mcp: { url: `${config.publicUrl}/mcp`, enabled: hasFeature(ctx.orgId, "mcp") },
      webhooks: isAdmin ? { meta: { url: `${config.publicUrl}/webhooks/meta`, verifyToken: config.meta.webhookVerifyToken } } : null,
      oauthRedirects: isAdmin
        ? Object.fromEntries(["meta", "instagram-login", "threads", "x", "linkedin", "tiktok", "youtube", "gmb"].map((p) => [p, `${config.publicUrl}/api/oauth/${p}/callback`]))
        : null,
      providers: listProviders().map(describeProvider),
      recentWebhooks: req.user?.isSuperadmin ? webhookEventsRepo.recent(20) : [],
    };
  });
}
