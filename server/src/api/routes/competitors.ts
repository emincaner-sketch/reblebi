import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addCompetitor, competitorReport, refreshCompetitor, removeCompetitor } from "../../services/competitors.js";
import { ctxOf, requireCtx } from "../context.js";

const Id = z.object({ id: z.string() });

/** Rakip takibi: /api/competitors */
export async function competitorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/competitors", async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(366).default(30) }).parse(req.query);
    return competitorReport(ctxOf(req), days);
  });

  app.post("/api/competitors", async (req) => {
    const { username, provider } = z.object({ username: z.string().min(1).max(200), provider: z.enum(["instagram", "youtube", "bluesky", "facebook", "twitch"]).default("instagram") }).parse(req.body);
    return addCompetitor(ctxOf(req), username, provider);
  });

  app.post("/api/competitors/:id/refresh", async (req) => refreshCompetitor(ctxOf(req), Id.parse(req.params).id));

  app.delete("/api/competitors/:id", async (req) => {
    removeCompetitor(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });
}
