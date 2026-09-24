import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notFound } from "../../core/i18n.js";
import { campaignsRepo } from "../../core/repos/content.js";
import { postsRepo } from "../../core/repos/posts.js";
import { requireRole } from "../../services/access.js";
import { runPlanner, scheduleCampaign } from "../../services/planner.js";
import { ctxOf, requireCtx } from "../context.js";
import { PlannerSchema } from "../schemas.js";

const Id = z.object({ id: z.string() });

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/campaigns", async (req) => campaignsRepo.list(ctxOf(req).orgId));

  app.get("/api/campaigns/:id", async (req) => {
    const ctx = ctxOf(req);
    const c = campaignsRepo.get(ctx.orgId, Id.parse(req.params).id);
    if (!c) throw notFound("campaign");
    return { ...c, posts: postsRepo.list(ctx.orgId, { campaignId: c.id, limit: 500, order: "asc" }) };
  });

  app.post("/api/campaigns", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z.object({ name: z.string().min(1).max(120), goal: z.string().max(500).nullable().optional(), brief: z.string().max(5000).nullable().optional() }).parse(req.body);
    return campaignsRepo.create(ctx.orgId, { ...body, source: ctx.via === "session" ? "panel" : "mcp", createdBy: ctx.userId });
  });

  app.patch("/api/campaigns/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        goal: z.string().max(500).nullable().optional(),
        brief: z.string().max(5000).nullable().optional(),
        status: z.enum(["draft", "active", "done", "archived"]).optional(),
      })
      .parse(req.body);
    const c = campaignsRepo.update(ctx.orgId, Id.parse(req.params).id, body);
    if (!c) throw notFound("campaign");
    return c;
  });

  app.delete("/api/campaigns/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const { deletePosts } = z.object({ deletePosts: z.stringbool().default(false) }).parse(req.query);
    campaignsRepo.remove(ctx.orgId, Id.parse(req.params).id, deletePosts);
    return { ok: true };
  });

  /** Kampanyadaki tarihli taslakların hepsini planla */
  app.post("/api/campaigns/:id/schedule", async (req) => scheduleCampaign(ctxOf(req), Id.parse(req.params).id));

  /** AI planlayıcı: brief -> kampanya + tarihli taslaklar (ya da doğrudan planlı gönderiler) */
  app.post("/api/planner", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => runPlanner(ctxOf(req), PlannerSchema.parse(req.body)));
}
