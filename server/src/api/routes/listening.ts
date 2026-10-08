import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createQuery, listeningReport, listMentions, listQueries, markAllSeen, mentionsCsv, patchMention, removeQuery, runQueryNow, updateQuery } from "../../services/listening.js";
import { ctxOf, requireCtx } from "../context.js";

const Id = z.object({ id: z.string() });

/** Bahsetme izleme: /api/listening/... */
export async function listeningRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/listening/queries", async (req) => listQueries(ctxOf(req)));
  app.post("/api/listening/queries", async (req) => createQuery(ctxOf(req), req.body));
  app.patch("/api/listening/queries/:id", async (req) => updateQuery(ctxOf(req), Id.parse(req.params).id, req.body));
  app.delete("/api/listening/queries/:id", async (req) => {
    removeQuery(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });
  app.post("/api/listening/queries/:id/run", async (req) => runQueryNow(ctxOf(req), Id.parse(req.params).id));

  app.get("/api/listening/report", async (req) => listeningReport(ctxOf(req), req.query));

  app.get("/api/listening/mentions", async (req, reply) => {
    const { format } = z.object({ format: z.enum(["json", "csv"]).default("json") }).passthrough().parse(req.query);
    if (format === "csv") {
      const csv = mentionsCsv(ctxOf(req), req.query);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="bahsetmeler-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(csv);
    }
    return listMentions(ctxOf(req), req.query);
  });
  app.patch("/api/listening/mentions/:id", async (req) => patchMention(ctxOf(req), Id.parse(req.params).id, req.body));
  app.post("/api/listening/mentions/seen", async (req) => {
    const { query } = z.object({ query: z.string().optional() }).parse(req.body ?? {});
    return { updated: markAllSeen(ctxOf(req), query) };
  });
}
