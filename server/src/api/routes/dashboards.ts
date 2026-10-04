import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, notFound } from "../../core/i18n.js";
import { channelsRepo } from "../../core/repos/channels.js";
import { dashboardsRepo, WIDGET_TYPES, type DashboardWidget } from "../../core/repos/dashboards.js";
import { ALL_PROVIDERS, type ProviderId } from "../../core/types.js";
import { requireRole } from "../../services/access.js";
import { sendTestDashboard } from "../../services/dashboard-email.js";
import { parseRecipients } from "../../services/report-email.js";
import { ctxOf, requireCtx } from "../context.js";

const Id = z.object({ id: z.string() });
export const MAX_DASHBOARDS = 20;
export const MAX_WIDGETS = 30;

/** Kart ölçüleri: rapor KPI'ları ve "ins." önekli hesap insights değerleri */
export const DASHBOARD_METRICS = [
  "followers",
  "followersDelta",
  "posts",
  "interactions",
  "likes",
  "comments",
  "shares",
  "views",
  "engagementRate",
  "incomingMessages",
  "ins.reach",
  "ins.views",
  "ins.profileViews",
  "ins.websiteClicks",
  "ins.follows",
  "ins.unfollows",
  "ins.clicks",
  "ins.saves",
  "ins.calls",
  "ins.directions",
  "ins.watchMinutes",
] as const;

const Widget = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  type: z.enum(WIDGET_TYPES),
  size: z.enum(["s", "m", "l"]),
  title: z.string().trim().max(80).nullish(),
  provider: z.enum(ALL_PROVIDERS as [ProviderId, ...ProviderId[]]).nullish(),
  channelId: z.string().max(64).nullish(),
  metric: z.enum(DASHBOARD_METRICS).nullish(),
  text: z.string().max(2000).nullish(),
});
const Days = z.union([z.literal(7), z.literal(30), z.literal(90)]);

/** Yinelenen kimlikleri ve başka çalışma alanının kanallarını ayıklar */
function cleanWidgets(orgId: string, list: Array<z.infer<typeof Widget>>): DashboardWidget[] {
  const seen = new Set<string>();
  const out: DashboardWidget[] = [];
  for (const w of list) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    const channelId = w.channelId && channelsRepo.get(orgId, w.channelId) ? w.channelId : null;
    out.push({
      id: w.id,
      type: w.type,
      size: w.size,
      title: w.title || null,
      provider: channelId ? null : (w.provider ?? null),
      channelId,
      metric: w.type === "kpi" || w.type === "trend" ? (w.metric ?? "followers") : null,
      text: w.type === "note" ? (w.text ?? "") : null,
    });
  }
  return out;
}

/** Hazır başlangıç düzeni: Metricool'daki varsayılan özet panosuna yakın */
export function overviewTemplate(): DashboardWidget[] {
  return [
    { id: "w1", type: "kpi", size: "s", metric: "followers" },
    { id: "w2", type: "kpi", size: "s", metric: "interactions" },
    { id: "w3", type: "kpi", size: "s", metric: "views" },
    { id: "w4", type: "kpi", size: "s", metric: "engagementRate" },
    { id: "w5", type: "trend", size: "l", metric: "followers" },
    { id: "w6", type: "networks", size: "m" },
    { id: "w7", type: "topPosts", size: "m" },
  ];
}

/** Studio (özel panolar): /api/dashboards */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/dashboards", async (req) => ({ items: dashboardsRepo.list(ctxOf(req).orgId), max: MAX_DASHBOARDS, maxWidgets: MAX_WIDGETS }));

  app.post("/api/dashboards", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z
      .object({ name: z.string().trim().min(1).max(80), days: Days.optional(), template: z.enum(["overview", "blank"]).default("overview"), widgets: z.array(Widget).max(MAX_WIDGETS).optional() })
      .parse(req.body);
    if (dashboardsRepo.list(ctx.orgId).length >= MAX_DASHBOARDS) throw new AppError(400, "dashboard.too_many", { max: MAX_DASHBOARDS });
    const widgets = body.widgets ? cleanWidgets(ctx.orgId, body.widgets) : body.template === "overview" ? overviewTemplate() : [];
    return dashboardsRepo.create(ctx.orgId, { name: body.name, days: body.days, widgets, createdBy: ctx.userId });
  });

  app.patch("/api/dashboards/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const id = Id.parse(req.params).id;
    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        days: Days.optional(),
        widgets: z.array(Widget).max(MAX_WIDGETS).optional(),
        email: z.object({ freq: z.enum(["off", "weekly", "monthly"]), recipients: z.string().max(1000).refine((v) => parseRecipients(v) !== null, "email list") }).optional(),
      })
      .parse(req.body);
    const d = dashboardsRepo.update(ctx.orgId, id, { name: body.name, days: body.days, widgets: body.widgets ? cleanWidgets(ctx.orgId, body.widgets) : undefined });
    if (!d) throw notFound("dashboard");
    if (body.email) {
      // Sıklık değişince "son gönderilen" sıfırlanmaz: aynı dönem iki kez gitmesin
      dashboardsRepo.setEmail(ctx.orgId, id, { freq: body.email.freq, recipients: (parseRecipients(body.email.recipients) ?? []).join(", "), lastSent: d.email.lastSent });
      return dashboardsRepo.get(ctx.orgId, id);
    }
    return d;
  });

  /** Panoyu yalnızca isteyen kişiye örnek e-posta olarak gönderir (son 7 tam gün) */
  app.post("/api/dashboards/:id/test-email", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const d = dashboardsRepo.get(ctx.orgId, Id.parse(req.params).id);
    if (!d) throw notFound("dashboard");
    if (!req.user?.email) throw notFound("user");
    return sendTestDashboard(ctx.orgId, d, req.user.email);
  });

  app.delete("/api/dashboards/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    dashboardsRepo.remove(ctx.orgId, Id.parse(req.params).id);
    return { ok: true };
  });
}
