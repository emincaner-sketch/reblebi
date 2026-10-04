import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../core/config.js";
import { addSite, listSites, recordHit, removeSite, siteReport, trackerJs } from "../../services/site-analytics.js";
import { ctxOf, requireCtx } from "../context.js";

const Id = z.object({ id: z.string() });

/** Web sitesi analitiği (panel): /api/sites */
export async function websiteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/sites", async (req) => ({ items: listSites(ctxOf(req)), scriptUrl: `${config.publicUrl}/api/public/t.js` }));
  app.post("/api/sites", async (req) => {
    const { domain } = z.object({ domain: z.string().min(3).max(255) }).parse(req.body);
    return addSite(ctxOf(req), domain);
  });
  app.delete("/api/sites/:id", async (req) => {
    removeSite(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });
  app.get("/api/sites/:id/report", async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(366).default(30) }).parse(req.query);
    return siteReport(ctxOf(req), Id.parse(req.params).id, days);
  });
}

/** Herkese açık: izleme kodu ve toplama ucu (müşterinin sitesinden çağrılır; CORS "*") */
export async function websitePublicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/public/t.js", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=3600").type("application/javascript; charset=utf-8");
    return trackerJs();
  });

  app.post("/api/public/collect", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    try {
      const raw = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const b = z.object({ k: z.string().max(64), u: z.string().max(2000), r: z.string().max(2000).nullish(), w: z.number().int().min(0).max(20000).nullish() }).parse(raw);
      const h = req.headers;
      recordHit(
        { token: b.k, url: b.u, referrer: b.r ?? null, width: b.w ?? null },
        {
          ip: req.ip,
          ua: String(h["user-agent"] ?? ""),
          lang: (h["accept-language"] as string | undefined) ?? null,
          country: ((h["cf-ipcountry"] ?? h["x-vercel-ip-country"] ?? h["x-country-code"]) as string | undefined)?.toUpperCase() ?? null,
          origin: (h.origin as string | undefined) ?? null,
        },
      );
    } catch {
      /* geçersiz istek sessizce yok sayılır */
    }
    return reply.code(204).send();
  });
}
