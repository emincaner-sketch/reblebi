import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config, isSecure } from "../../core/config.js";
import { loadBrandContext } from "../../core/brand.js";
import { channelsRepo } from "../../core/repos/channels.js";
import { postsRepo } from "../../core/repos/posts.js";
import { inboxRepo } from "../../core/repos/inbox.js";
import { activityRepo, analyticsRepo, apiKeysRepo, settingsRepo, webhookEventsRepo } from "../../core/repos/misc.js";
import { generateContent, improveText, isAiEnabled } from "../../ai/index.js";
import { describeProvider, getProvider, listProviders } from "../../providers/index.js";
import { ALL_PROVIDERS, type ProviderId } from "../../core/types.js";
import { requireAuth } from "../auth.js";
import { snapshotAnalytics } from "../services/scheduler.js";

const SettingsSchema = z.object({
  brandName: z.string().optional(),
  brandVoice: z.string().optional(),
  brandAudience: z.string().optional(),
  brandOffers: z.string().optional(),
  brandBannedWords: z.string().optional(),
  brandExamples: z.string().optional(),
  aiAutoReplyFallback: z.boolean().optional(),
  aiReplyInstructions: z.string().optional(),
  businessHoursEnabled: z.boolean().optional(),
  businessHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  businessHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  businessDays: z.array(z.number().min(0).max(6)).optional(),
  outsideHoursMessage: z.string().optional(),
  handoffKeywords: z.string().optional(),
  replyDelaySeconds: z.number().min(0).max(60).optional(),
  welcomeMessage: z.string().optional(),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", { preHandler: requireAuth }, async () => settingsRepo.get());
  app.put("/api/settings", { preHandler: requireAuth }, async (req) => settingsRepo.set(SettingsSchema.parse(req.body)));

  /** Sistem bilgisi: webhook adresleri, yapılandırılmış sağlayıcılar, AI durumu */
  app.get("/api/system", { preHandler: requireAuth }, async () => {
    const brand = loadBrandContext();
    return {
      publicUrl: config.publicUrl,
      secure: isSecure(),
      timezone: config.timezone,
      ai: { enabled: isAiEnabled(), model: config.ai.model, brandSources: brand.sources, brandMemoryDir: config.ai.brandMemoryDir || null },
      webhooks: {
        meta: { url: `${config.publicUrl}/webhooks/meta`, verifyToken: config.meta.webhookVerifyToken },
      },
      oauthRedirects: {
        meta: `${config.publicUrl}/api/oauth/meta/callback`,
        threads: `${config.publicUrl}/api/oauth/threads/callback`,
        x: `${config.publicUrl}/api/oauth/x/callback`,
        linkedin: `${config.publicUrl}/api/oauth/linkedin/callback`,
        tiktok: `${config.publicUrl}/api/oauth/tiktok/callback`,
        youtube: `${config.publicUrl}/api/oauth/youtube/callback`,
      },
      providers: listProviders().map(describeProvider),
      recentWebhooks: webhookEventsRepo.recent(20),
    };
  });

  /* ---------------- API anahtarları (MCP / dış entegrasyon) ---------------- */

  app.get("/api/keys", { preHandler: requireAuth }, async () => apiKeysRepo.list());
  app.post("/api/keys", { preHandler: requireAuth }, async (req, reply) => {
    if (req.authVia !== "session") return reply.code(403).send({ error: "API anahtarı sadece panelden oluşturulur" });
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return apiKeysRepo.create(name);
  });
  app.delete("/api/keys/:id", { preHandler: requireAuth }, async (req) => {
    apiKeysRepo.remove(z.object({ id: z.string() }).parse(req.params).id);
    return { ok: true };
  });

  /* ---------------- AI ---------------- */

  app.post("/api/ai/generate", { preHandler: requireAuth }, async (req, reply) => {
    if (!isAiEnabled()) return reply.code(400).send({ error: "ANTHROPIC_API_KEY tanımlı değil (.env)" });
    const body = z
      .object({
        topic: z.string().min(3),
        kind: z.enum(["post", "story", "reel", "video", "thread"]).default("post"),
        platforms: z.array(z.enum(ALL_PROVIDERS as [ProviderId, ...ProviderId[]])).min(1),
        tone: z.string().optional(),
        goal: z.string().optional(),
        language: z.string().optional(),
        extraInstructions: z.string().optional(),
      })
      .parse(req.body);
    return generateContent(body);
  });

  app.post("/api/ai/improve", { preHandler: requireAuth }, async (req, reply) => {
    if (!isAiEnabled()) return reply.code(400).send({ error: "ANTHROPIC_API_KEY tanımlı değil (.env)" });
    const body = z.object({ text: z.string().min(1), instruction: z.string().min(1), platform: z.enum(ALL_PROVIDERS as [ProviderId, ...ProviderId[]]).optional() }).parse(req.body);
    return { text: await improveText(body.text, body.instruction, body.platform) };
  });

  /* ---------------- Panel özeti / analitik / aktivite ---------------- */

  app.get("/api/dashboard", { preHandler: requireAuth }, async () => {
    const channels = channelsRepo.list();
    const now = new Date();
    const dayEnd = new Date(now.getTime() + 24 * 3600_000).toISOString();
    return {
      channels: { total: channels.length, active: channels.filter((c) => c.status === "active").length, problem: channels.filter((c) => c.status === "error" || c.status === "expired").length },
      posts: postsRepo.stats(),
      inbox: inboxRepo.stats(),
      upcoming: postsRepo.list({ status: ["scheduled"], to: dayEnd, limit: 10 }).reverse(),
      recent: postsRepo.list({ status: ["published", "partial", "failed"], limit: 6 }),
      activity: activityRepo.list(15),
      ai: isAiEnabled(),
    };
  });

  app.get("/api/analytics/overview", { preHandler: requireAuth }, async (req) => {
    const days = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(req.query).days;
    const channels = channelsRepo.list();
    const perChannel = channels.map((c) => {
      const series = analyticsRepo.series(c.id, days);
      const latest = series[series.length - 1]?.metrics ?? {};
      const first = series[0]?.metrics ?? {};
      return {
        channelId: c.id,
        name: c.name,
        provider: c.provider,
        avatarUrl: c.avatarUrl,
        latest,
        followersDelta: (latest.followers ?? 0) - (first.followers ?? 0),
        series: series.map((s) => ({ date: s.date, ...s.metrics })),
        supported: Boolean(getProvider(c.provider).fetchMetrics),
      };
    });
    const posts = postsRepo.list({ from: new Date(Date.now() - days * 86400_000).toISOString(), limit: 1000 });
    const byProvider: Record<string, { published: number; failed: number }> = {};
    for (const p of posts) {
      for (const t of p.targets) {
        const ch = channels.find((c) => c.id === t.channelId);
        const key = ch?.provider ?? "bilinmiyor";
        byProvider[key] ??= { published: 0, failed: 0 };
        if (t.status === "published") byProvider[key].published++;
        if (t.status === "failed") byProvider[key].failed++;
      }
    }
    return { days, channels: perChannel, postsByProvider: byProvider, posts: postsRepo.stats(), inbox: inboxRepo.stats() };
  });

  app.post("/api/analytics/refresh", { preHandler: requireAuth }, async () => {
    await snapshotAnalytics(true);
    return { ok: true };
  });

  app.get("/api/activity", { preHandler: requireAuth }, async (req) => activityRepo.list(z.object({ limit: z.coerce.number().default(50) }).parse(req.query).limit));
}
