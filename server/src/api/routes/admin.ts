import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../core/config.js";
import { getDb } from "../../core/db.js";
import { notFound } from "../../core/i18n.js";
import { PLANS, effectivePlan } from "../../core/plans.js";
import { activityRepo, webhookEventsRepo } from "../../core/repos/misc.js";
import { membershipsRepo, orgsRepo, sessionsRepo, usersRepo } from "../../core/repos/orgs.js";
import { mailConfigured, devOutbox } from "../../services/mailer.js";
import { dailyMaintenance } from "../../services/scheduler.js";
import { usageSummary } from "../../services/limits.js";
import { requireSuperadmin } from "../context.js";

type Row = Record<string, unknown>;

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSuperadmin);

  app.get("/api/admin/stats", async () => {
    const db = getDb();
    const n = (sql: string, ...p: string[]) => Number((db.prepare(sql).get(...p) as Row).c ?? 0);
    const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const byPlan = db.prepare("SELECT plan, COUNT(*) c FROM organizations GROUP BY plan").all() as Row[];
    const byProvider = db.prepare("SELECT provider, COUNT(*) c FROM channels GROUP BY provider").all() as Row[];
    return {
      users: n("SELECT COUNT(*) c FROM users"),
      usersLast30: n("SELECT COUNT(*) c FROM users WHERE created_at >= ?", monthAgo),
      activeLast7: n("SELECT COUNT(*) c FROM users WHERE last_login_at >= ?", weekAgo),
      orgs: n("SELECT COUNT(*) c FROM organizations"),
      channels: n("SELECT COUNT(*) c FROM channels"),
      postsLast30: n("SELECT COUNT(*) c FROM posts WHERE created_at >= ?", monthAgo),
      publishedLast30: n("SELECT COUNT(*) c FROM posts WHERE status='published' AND published_at >= ?", monthAgo),
      failedLast30: n("SELECT COUNT(*) c FROM posts WHERE status IN ('failed','partial') AND updated_at >= ?", monthAgo),
      mcpConnections: n("SELECT COUNT(DISTINCT client_id || user_id) c FROM oauth_tokens WHERE revoked_at IS NULL"),
      byPlan: Object.fromEntries(byPlan.map((r) => [r.plan as string, Number(r.c)])),
      byProvider: Object.fromEntries(byProvider.map((r) => [r.provider as string, Number(r.c)])),
      mailConfigured: mailConfigured(),
      signupMode: config.saas.signupMode,
      trial: { days: config.saas.trialDays, plan: config.saas.trialPlan },
    };
  });

  app.get("/api/admin/plans", async () => Object.values(PLANS));

  app.get("/api/admin/orgs", async (req) => {
    const q = z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().min(1).max(500).default(100), offset: z.coerce.number().min(0).default(0) }).parse(req.query);
    return orgsRepo.listAll(q).map((o) => {
      const owner = membershipsRepo.list(o.id).find((m) => m.role === "owner");
      return { ...o, effectivePlan: effectivePlan(o).id, ownerEmail: owner?.email ?? null };
    });
  });

  app.get("/api/admin/orgs/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const org = orgsRepo.get(id);
    if (!org) throw notFound("org");
    return { ...org, members: membershipsRepo.list(id), usage: usageSummary(id), activity: activityRepo.list(id, 30) };
  });

  /** Manuel plan atama (ödeme sağlayıcısı bağlanana kadar) */
  app.patch("/api/admin/orgs/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        plan: z.string().refine((p) => p in PLANS, "unknown plan").optional(),
        planExpiresAt: z.string().nullable().optional(),
        extendDays: z.number().int().min(1).max(3650).optional(),
        disabled: z.boolean().optional(),
        name: z.string().min(1).max(80).optional(),
        billingRef: z.string().max(200).nullable().optional(),
      })
      .parse(req.body);
    const org = orgsRepo.get(id);
    if (!org) throw notFound("org");
    let planExpiresAt = body.planExpiresAt;
    if (body.extendDays) {
      const base = org.planExpiresAt && new Date(org.planExpiresAt).getTime() > Date.now() ? new Date(org.planExpiresAt).getTime() : Date.now();
      planExpiresAt = new Date(base + body.extendDays * 86400_000).toISOString();
    }
    const updated = orgsRepo.update(id, {
      plan: body.plan,
      planExpiresAt,
      disabled: body.disabled === undefined ? undefined : body.disabled ? 1 : 0,
      name: body.name,
      billingRef: body.billingRef,
    });
    activityRepo.add(id, "info", "admin", `plan: ${updated?.plan} → ${updated?.planExpiresAt ?? "∞"}${body.disabled !== undefined ? ` · disabled=${body.disabled}` : ""}`, { by: req.user!.email });
    return { ...updated, effectivePlan: updated ? effectivePlan(updated).id : null };
  });

  app.delete("/api/admin/orgs/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body ?? {});
    const org = orgsRepo.get(id);
    if (!org) throw notFound("org");
    if (confirm !== org.slug) return { ok: false, error: "confirm must equal slug" };
    orgsRepo.remove(id);
    return { ok: true };
  });

  app.get("/api/admin/users", async (req) => {
    const q = z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().min(1).max(500).default(100), offset: z.coerce.number().min(0).default(0) }).parse(req.query);
    return usersRepo.listAll(q).map((u) => ({ ...u, orgs: orgsRepo.listForUser(u.id).map((o) => ({ id: o.id, name: o.name, role: o.role })) }));
  });

  app.patch("/api/admin/users/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ disabled: z.boolean().optional(), isSuperadmin: z.boolean().optional(), verify: z.boolean().optional() }).parse(req.body);
    if (id === req.user!.id && (body.disabled || body.isSuperadmin === false)) return { ok: false, error: "self" };
    const u = usersRepo.update(id, { disabled: body.disabled, isSuperadmin: body.isSuperadmin });
    if (!u) throw notFound("user");
    if (body.verify) usersRepo.markVerified(id);
    if (body.disabled) sessionsRepo.removeAllForUser(id);
    return usersRepo.get(id);
  });

  /** SMTP kurulmadan önce gönderilen e-postaları görmek için (doğrulama/davet linkleri) */
  app.get("/api/admin/outbox", async () => devOutbox());

  app.get("/api/admin/webhook-events", async () => webhookEventsRepo.recent(50));

  app.post("/api/admin/backup", async () => ({ file: await dailyMaintenance(true) }));
}
