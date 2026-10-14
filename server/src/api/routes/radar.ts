import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  adaptRadarPost,
  addRadarAccounts,
  createNiche,
  dismissSuggestion,
  listNiches,
  listSaved,
  listSponsors,
  patchRadarAccount,
  putSponsor,
  radarCreator,
  radarCreators,
  radarDraft,
  radarFeed,
  radarInsights,
  radarOverview,
  radarPost,
  radarStatus,
  radarSuggestions,
  removeNiche,
  removeRadarAccount,
  removeSponsor,
  saveRadarPost,
  scanRadar,
  unsaveRadarPost,
  updateNiche,
  updateRadarSettings,
} from "../../services/radar.js";
import { ctxOf, requireCtx } from "../context.js";

const Id = z.object({ id: z.string() });
const Key = z.object({ key: z.string().min(1).max(200) });
const Scope = {
  niche: z.string().max(60).optional(),
  region: z.enum(["TR", "GLOBAL"]).optional(),
  role: z.enum(["watch", "competitor", "own"]).optional(),
};
const scopeOf = (q: { niche?: string; region?: "TR" | "GLOBAL"; role?: "watch" | "competitor" | "own" }) => ({ nicheId: q.niche || null, region: q.region ?? null, role: q.role ?? null });

/** İçerik radarı: /api/radar */
export async function radarRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/radar/overview", async (req) => radarOverview(ctxOf(req)));
  app.get("/api/radar/status", async (req) => radarStatus(ctxOf(req)));
  app.put("/api/radar/settings", async (req) => {
    const b = z.object({ apifyToken: z.string().max(300).nullable().optional(), apifyMaxUsd: z.number().min(0.1).max(100).nullable().optional() }).parse(req.body);
    return updateRadarSettings(ctxOf(req), b);
  });

  app.get("/api/radar/feed", async (req) => {
    const q = z
      .object({
        ...Scope,
        days: z.coerce.number().int().min(0).max(366).default(30),
        kind: z.enum(["REEL", "CAROUSEL", "IMAGE", "VIDEO"]).optional(),
        min: z.coerce.number().min(0).max(1000).optional(),
        sort: z.enum(["outlier", "engagement", "views", "rate", "newest"]).default("outlier"),
        q: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(48),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    return radarFeed(ctxOf(req), { ...scopeOf(q), days: q.days, kind: q.kind ?? null, minOutlier: q.min, sort: q.sort, q: q.q, limit: q.limit, offset: q.offset });
  });
  app.get("/api/radar/posts/:key", async (req) => radarPost(ctxOf(req), Key.parse(req.params).key));
  app.post("/api/radar/posts/:key/adapt", async (req) => adaptRadarPost(ctxOf(req), Key.parse(req.params).key));
  app.post("/api/radar/posts/:key/draft", async (req) => {
    const b = z.object({ content: z.string().min(1).max(70000), channelId: z.string().optional() }).parse(req.body);
    return radarDraft(ctxOf(req), Key.parse(req.params).key, b.content, b.channelId);
  });

  app.get("/api/radar/creators", async (req) => {
    const q = z.object({ ...Scope, sort: z.enum(["radar", "followers", "engagementRate", "growth", "views", "hitRate", "postsPerWeek"]).default("radar") }).parse(req.query);
    return radarCreators(ctxOf(req), { ...scopeOf(q), sort: q.sort });
  });
  app.get("/api/radar/creators/:id", async (req) => radarCreator(ctxOf(req), Id.parse(req.params).id));

  app.post("/api/radar/accounts", async (req) => {
    const b = z
      .object({
        usernames: z.array(z.string().max(200)).min(1).max(100),
        nicheId: z.string().nullable().optional(),
        nicheName: z.string().max(60).nullable().optional(),
        region: z.enum(["TR", "GLOBAL"]).optional(),
        role: z.enum(["watch", "competitor", "own"]).optional(),
        scan: z.boolean().optional(),
      })
      .parse(req.body);
    return addRadarAccounts(ctxOf(req), b);
  });
  app.patch("/api/radar/accounts/:id", async (req) => {
    const b = z
      .object({ nicheId: z.string().nullable().optional(), region: z.enum(["TR", "GLOBAL"]).optional(), role: z.enum(["watch", "competitor", "own"]).optional(), paused: z.boolean().optional() })
      .parse(req.body);
    return patchRadarAccount(ctxOf(req), Id.parse(req.params).id, b);
  });
  app.delete("/api/radar/accounts/:id", async (req) => {
    removeRadarAccount(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });
  app.post("/api/radar/scan", async (req) => {
    const b = z.object({ ids: z.array(z.string()).max(200).optional() }).parse(req.body ?? {});
    return scanRadar(ctxOf(req), b.ids);
  });

  app.get("/api/radar/niches", async (req) => listNiches(ctxOf(req)));
  app.post("/api/radar/niches", async (req) => {
    const b = z.object({ name: z.string().min(1).max(60), color: z.string().max(20).nullable().optional() }).parse(req.body);
    return createNiche(ctxOf(req), b.name, b.color ?? null);
  });
  app.patch("/api/radar/niches/:id", async (req) => {
    const b = z.object({ name: z.string().max(60).optional(), color: z.string().max(20).nullable().optional() }).parse(req.body);
    return updateNiche(ctxOf(req), Id.parse(req.params).id, b);
  });
  app.delete("/api/radar/niches/:id", async (req) => {
    removeNiche(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });

  app.get("/api/radar/suggestions", async (req) => radarSuggestions(ctxOf(req)));
  app.post("/api/radar/suggestions/:username/dismiss", async (req) => {
    dismissSuggestion(ctxOf(req), z.object({ username: z.string().max(60) }).parse(req.params).username);
    return { ok: true };
  });
  app.get("/api/radar/insights", async (req) => {
    const q = z.object({ ...Scope, days: z.coerce.number().int().min(7).max(366).default(90) }).parse(req.query);
    return radarInsights(ctxOf(req), { ...scopeOf(q), days: q.days });
  });

  app.get("/api/radar/saved", async (req) => listSaved(ctxOf(req)));
  app.post("/api/radar/saved", async (req) => {
    const b = z.object({ key: z.string().min(1).max(200), status: z.enum(["idea", "producing", "published", "dropped"]).optional(), note: z.string().max(2000).nullable().optional() }).parse(req.body);
    return saveRadarPost(ctxOf(req), b);
  });
  app.delete("/api/radar/saved/:key", async (req) => {
    unsaveRadarPost(ctxOf(req), Key.parse(req.params).key);
    return { ok: true };
  });

  app.get("/api/radar/sponsors", async (req) => listSponsors(ctxOf(req)));
  app.post("/api/radar/sponsors", async (req) => {
    const b = z
      .object({
        username: z.string().min(1).max(60),
        status: z.enum(["candidate", "contacted", "offered", "agreed", "declined"]).optional(),
        note: z.string().max(2000).nullable().optional(),
        contact: z.string().max(300).nullable().optional(),
        price: z.string().max(100).nullable().optional(),
      })
      .parse(req.body);
    return putSponsor(ctxOf(req), b);
  });
  app.delete("/api/radar/sponsors/:username", async (req) => {
    removeSponsor(ctxOf(req), z.object({ username: z.string().max(60) }).parse(req.params).username);
    return { ok: true };
  });
}
