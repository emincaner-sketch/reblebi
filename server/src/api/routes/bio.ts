import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { notFound } from "../../core/i18n.js";
import { bioRepo, DEFAULT_THEME, type BioPage } from "../../core/repos/bio.js";
import { orgsRepo } from "../../core/repos/orgs.js";
import {
  bioStats,
  bioUrl,
  checkSlug,
  createBioPage,
  deleteBioPage,
  gridCandidates,
  isBot,
  listBioPages,
  normalizeUrl,
  renderBioNotFound,
  renderBioPage,
  resolveGrid,
  sourceOf,
  trackBio,
  updateBioPage,
} from "../../services/bio.js";
import { ctxOf, requireCtx } from "../context.js";

const Id = z.object({ id: z.string() });

const LinkSchema = z.object({ id: z.string().max(40).default(""), label: z.string().max(80), url: z.string().max(2000), enabled: z.boolean().default(true) });
const SocialSchema = z.object({ network: z.string().max(20), url: z.string().max(2000) });
const GridSchema = z.object({ id: z.string().max(40).default(""), postId: z.string().max(60), url: z.string().max(2000) });
const ThemeSchema = z.object({ accent: z.string().max(7).optional(), background: z.enum(["light", "cream", "dark"]).optional(), buttons: z.enum(["rounded", "pill", "square"]).optional() });
const PatchSchema = z.object({
  slug: z.string().max(40).optional(),
  title: z.string().min(1).max(80).optional(),
  bio: z.string().max(300).nullable().optional(),
  avatarUrl: z.string().max(2000).nullable().optional(),
  theme: ThemeSchema.optional(),
  links: z.array(LinkSchema).max(50).optional(),
  socials: z.array(SocialSchema).max(12).optional(),
  grid: z.array(GridSchema).max(60).optional(),
  published: z.boolean().optional(),
});

/** Panel API'si: /api/bio */
export async function bioRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/bio", async (req) => listBioPages(ctxOf(req)));

  app.get("/api/bio/check", async (req) => {
    const { slug, exceptId } = z.object({ slug: z.string().max(60), exceptId: z.string().optional() }).parse(req.query);
    return { status: checkSlug(slug, exceptId) };
  });

  app.get("/api/bio/grid-candidates", async (req) => gridCandidates(ctxOf(req)));

  app.post("/api/bio", async (req) => {
    const body = z.object({ slug: z.string().max(60), title: z.string().min(1).max(80), bio: z.string().max(300).nullable().optional() }).parse(req.body);
    const p = createBioPage(ctxOf(req), body);
    return { ...p, url: bioUrl(p.slug) };
  });

  app.get("/api/bio/:id", async (req) => {
    const p = bioRepo.get(ctxOf(req).orgId, Id.parse(req.params).id);
    if (!p) throw notFound("bio");
    return { ...p, url: bioUrl(p.slug) };
  });

  app.patch("/api/bio/:id", async (req) => {
    const p = updateBioPage(ctxOf(req), Id.parse(req.params).id, PatchSchema.parse(req.body));
    return { ...p, url: bioUrl(p.slug) };
  });

  app.delete("/api/bio/:id", async (req) => {
    deleteBioPage(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });

  app.get("/api/bio/:id/stats", async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(366).default(30) }).parse(req.query);
    return bioStats(ctxOf(req), Id.parse(req.params).id, days);
  });

  /** Kaydedilmemiş taslağın önizlemesi: geçersiz bağlantılar hata vermek yerine atlanır, sayaç çalışmaz */
  app.post("/api/bio/:id/preview", async (req) => {
    const ctx = ctxOf(req);
    const page = bioRepo.get(ctx.orgId, Id.parse(req.params).id);
    if (!page) throw notFound("bio");
    const d = PatchSchema.parse(req.body ?? {});
    const draft: BioPage = {
      ...page,
      title: d.title ?? page.title,
      bio: d.bio === undefined ? page.bio : d.bio,
      avatarUrl: d.avatarUrl === undefined ? page.avatarUrl : d.avatarUrl && (normalizeUrl(d.avatarUrl) ?? (d.avatarUrl.startsWith("/media/") ? d.avatarUrl : null)),
      theme: { ...DEFAULT_THEME, ...page.theme, ...Object.fromEntries(Object.entries(d.theme ?? {}).filter(([, v]) => v)) },
      links: (d.links ?? page.links).flatMap((l) => {
        const url = normalizeUrl(l.url);
        return url && l.label.trim() ? [{ ...l, id: l.id || "x", url }] : [];
      }),
      socials: (d.socials ?? page.socials).flatMap((s) => {
        const url = s.network === "email" && !/^mailto:/i.test(s.url) && s.url.includes("@") ? normalizeUrl(`mailto:${s.url.trim()}`) : normalizeUrl(s.url);
        return url ? [{ network: s.network, url }] : [];
      }),
      grid: (d.grid ?? page.grid).flatMap((g) => {
        const url = normalizeUrl(g.url) ?? "#";
        return [{ ...g, id: g.id || "x", url }];
      }),
    };
    const locale = orgsRepo.get(ctx.orgId)?.locale ?? "tr";
    return { html: renderBioPage(draft, { locale, preview: true, grid: resolveGrid(draft) }) };
  });
}

/** Herkese açık sayfa ve tıklama yönlendirmesi: /l/:slug, /l/:slug/go/:linkId */
export async function bioPublicRoutes(app: FastifyInstance): Promise<void> {
  const counts = (req: FastifyRequest, page: BioPage) => {
    if (req.method !== "GET") return false;
    const ua = String(req.headers["user-agent"] ?? "");
    const purpose = String(req.headers["sec-purpose"] ?? req.headers["purpose"] ?? "");
    if (isBot(ua) || /prefetch|prerender/i.test(purpose)) return false;
    // Çalışma alanının kendi üyesinin ziyareti sayılmaz
    if (req.ctx?.orgId === page.orgId) return false;
    return true;
  };

  app.get("/l/:slug", async (req, reply) => {
    const { slug } = z.object({ slug: z.string().max(60) }).parse(req.params);
    const { src } = z.object({ src: z.string().max(30).optional() }).parse(req.query);
    if (slug !== slug.toLowerCase()) return reply.redirect(`/l/${encodeURIComponent(slug.toLowerCase())}`, 301);
    const page = bioRepo.bySlug(slug);
    const locale = page ? (orgsRepo.get(page.orgId)?.locale ?? "tr") : "tr";
    reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8");
    if (!page || !page.published) return reply.code(404).send(renderBioNotFound(locale));
    const source = sourceOf(req.headers["user-agent"], req.headers.referer, src);
    if (counts(req, page)) trackBio(page, "", source);
    return reply.send(renderBioPage(page, { locale, grid: resolveGrid(page), source }));
  });

  app.get("/l/:slug/go/:linkId", async (req, reply) => {
    const { slug, linkId } = z.object({ slug: z.string().max(60), linkId: z.string().max(60) }).parse(req.params);
    const { s } = z.object({ s: z.string().max(30).optional() }).parse(req.query);
    const page = bioRepo.bySlug(slug);
    reply.header("Cache-Control", "no-store");
    if (!page || !page.published) return reply.redirect(`/l/${encodeURIComponent(slug.toLowerCase())}`, 302);
    const link = page.links.find((l) => l.id === linkId && l.enabled);
    const grid = page.grid.find((g) => g.id === linkId);
    const m = /^s(\d+)-/.exec(linkId);
    const social = m ? page.socials[Number(m[1])] : undefined;
    const target = link?.url ?? grid?.url ?? social?.url;
    if (!target) return reply.redirect(`/l/${encodeURIComponent(page.slug)}`, 302);
    if (counts(req, page)) trackBio(page, linkId, sourceOf(req.headers["user-agent"], undefined, s));
    return reply.redirect(target, 302);
  });
}
