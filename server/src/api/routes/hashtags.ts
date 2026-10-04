import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addHashtag, hashtagReport, refreshHashtag, removeHashtag } from "../../services/hashtag-tracker.js";
import { ctxOf, requireCtx } from "../context.js";

const Id = z.object({ id: z.string() });

/** Hashtag takibi: /api/hashtag-tracks */
export async function hashtagRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/hashtag-tracks", async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(366).default(30) }).parse(req.query);
    return hashtagReport(ctxOf(req), days);
  });

  app.post("/api/hashtag-tracks", async (req) => {
    const { hashtag } = z.object({ hashtag: z.string().min(1).max(120) }).parse(req.body);
    return addHashtag(ctxOf(req), hashtag);
  });

  app.post("/api/hashtag-tracks/:id/refresh", async (req) => refreshHashtag(ctxOf(req), Id.parse(req.params).id));

  app.delete("/api/hashtag-tracks/:id", async (req) => {
    removeHashtag(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });
}
