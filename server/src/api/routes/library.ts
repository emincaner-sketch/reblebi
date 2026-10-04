import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, notFound } from "../../core/i18n.js";
import { libraryRepo } from "../../core/repos/library.js";
import { mediaRepo } from "../../core/repos/misc.js";
import { requireRole } from "../../services/access.js";
import { ctxOf, requireCtx } from "../context.js";

const Id = z.object({ id: z.string() });
const Kind = z.enum(["post", "story", "reel", "video", "thread"]);
const MAX_ITEMS = 500;

/** Hashtag grubu metnini temizler: "#a #b, c" → "#a #b #c" (tekrarsız, en fazla 60) */
export function normalizeHashtags(raw: string): string {
  const tags = raw
    .split(/[\s,;]+/)
    .map((x) => x.trim().replace(/^#*/, ""))
    .filter((x) => /^[\p{L}\p{N}_]{1,100}$/u.test(x))
    .map((x) => `#${x}`);
  return [...new Map(tags.map((x) => [x.toLocaleLowerCase("tr"), x])).values()].slice(0, 60).join(" ");
}

/** Gönderi kütüphanesi: /api/library */
export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/library", async (req) => {
    const { type } = z.object({ type: z.enum(["post", "hashtags"]).optional() }).parse(req.query);
    return libraryRepo.list(ctxOf(req).orgId, type);
  });

  app.post("/api/library", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z
      .object({ type: z.enum(["post", "hashtags"]), name: z.string().min(1).max(120), kind: Kind.optional(), content: z.string().max(20000), mediaIds: z.array(z.string()).max(20).optional() })
      .parse(req.body);
    if (libraryRepo.list(ctx.orgId).length >= MAX_ITEMS) throw new AppError(400, "library.too_many", { max: MAX_ITEMS });
    const content = body.type === "hashtags" ? normalizeHashtags(body.content) : body.content;
    if (!content.trim() && !(body.mediaIds?.length ?? 0)) throw new AppError(400, "library.empty");
    // Yalnızca bu çalışma alanının medyası
    const mediaIds = body.type === "post" ? mediaRepo.getMany(ctx.orgId, body.mediaIds ?? []).map((m) => m.id) : [];
    return libraryRepo.create(ctx.orgId, { type: body.type, name: body.name.trim(), kind: body.kind, content, mediaIds, createdBy: ctx.userId });
  });

  app.patch("/api/library/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const id = Id.parse(req.params).id;
    const cur = libraryRepo.get(ctx.orgId, id);
    if (!cur) throw notFound("library");
    const body = z.object({ name: z.string().min(1).max(120).optional(), kind: Kind.optional(), content: z.string().max(20000).optional(), mediaIds: z.array(z.string()).max(20).optional() }).parse(req.body);
    return libraryRepo.update(ctx.orgId, id, {
      ...body,
      content: body.content === undefined ? undefined : cur.type === "hashtags" ? normalizeHashtags(body.content) : body.content,
      mediaIds: body.mediaIds ? mediaRepo.getMany(ctx.orgId, body.mediaIds).map((m) => m.id) : undefined,
    });
  });

  /** Düzenleyicide kullanıldı: sayaç artar (sık kullanılanlar öne çıkar) */
  app.post("/api/library/:id/use", async (req) => {
    const ctx = ctxOf(req);
    const item = libraryRepo.get(ctx.orgId, Id.parse(req.params).id);
    if (!item) throw notFound("library");
    libraryRepo.touch(ctx.orgId, item.id);
    return item;
  });

  app.delete("/api/library/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    libraryRepo.remove(ctx.orgId, Id.parse(req.params).id);
    return { ok: true };
  });
}
