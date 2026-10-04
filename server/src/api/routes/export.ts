import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dailyExport, EXPORT_FIELDS, toCsv } from "../../services/export.js";
import { ctxOf, requireCtx } from "../context.js";

/**
 * Günlük veri dışa aktarma: /api/export/daily (oturum ya da API anahtarı: Authorization: Bearer sp_…).
 * Looker Studio bağlayıcısı (integrations/looker-studio) ve Google Sheets / CSV için.
 */
export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/export/daily", async (req, reply) => {
    const q = z
      .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), format: z.enum(["json", "csv"]).default("json") })
      .parse(req.query);
    const r = dailyExport(ctxOf(req).orgId, q);
    if (q.format === "csv") {
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="reblebi-gunluk-${r.from}_${r.to}.csv"`)
        .send("﻿" + toCsv(r.rows));
    }
    return { ...r, fields: EXPORT_FIELDS };
  });
}
