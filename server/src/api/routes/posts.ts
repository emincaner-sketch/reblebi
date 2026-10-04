import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notFound } from "../../core/i18n.js";
import { postNotesRepo, presetsRepo, previewLinksRepo, signaturesRepo, tagsRepo } from "../../core/repos/content.js";
import { mediaRepo } from "../../core/repos/misc.js";
import { postsRepo } from "../../core/repos/posts.js";
import { TRASH_DAYS } from "../../core/repos/trash.js";
import type { PostStatus } from "../../core/types.js";
import { requireRole } from "../../services/access.js";
import { assertFeature } from "../../services/limits.js";
import { deleteMedia, importMediaFromUrl, MAX_UPLOAD_BYTES, publicMedia, saveUploadedStream } from "../../services/media.js";
import {
  approvePost,
  bulkCreatePosts,
  calendarView,
  cancelPost,
  createPost,
  deletePost,
  duplicatePost,
  getPostDetail,
  listPosts,
  listTrash,
  publishNow,
  purgeTrash,
  rejectPost,
  reschedulePost,
  restorePost,
  updatePost,
  validatePost,
} from "../../services/posts.js";
import { ctxOf, requireCtx } from "../context.js";
import { ListPostsQuery, PostInputSchema, PostPatchSchema } from "../schemas.js";

const Id = z.object({ id: z.string() });
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export async function postRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/posts", async (req) => {
    const q = ListPostsQuery.parse(req.query);
    const posts = listPosts(ctxOf(req), { ...q, status: q.status ? (q.status.split(",") as PostStatus[]) : undefined });
    const noteCounts = postNotesRepo.counts(posts.map((p) => p.id));
    return posts.map((p) => ({ ...p, noteCount: noteCounts.get(p.id) ?? 0 }));
  });

  app.get("/api/calendar", async (req) => {
    const q = z.object({ from: z.string(), to: z.string() }).parse(req.query);
    return calendarView(ctxOf(req), q.from, q.to);
  });

  app.get("/api/posts/:id", async (req) => getPostDetail(ctxOf(req), Id.parse(req.params).id));

  app.post("/api/posts/validate", async (req) => validatePost(ctxOf(req), PostInputSchema.parse(req.body)));

  app.post("/api/posts", async (req) => createPost(ctxOf(req), PostInputSchema.parse(req.body)));

  app.post("/api/posts/bulk", async (req) => {
    const body = z
      .object({
        posts: z.array(PostInputSchema).min(1).max(100),
        dryRun: z.boolean().optional(),
        atomic: z.boolean().optional(),
        campaignId: z.string().nullable().optional(),
        campaign: z.object({ name: z.string().min(1).max(120), goal: z.string().max(500).nullable().optional(), brief: z.string().max(5000).nullable().optional() }).nullable().optional(),
      })
      .parse(req.body);
    return bulkCreatePosts(ctxOf(req), body.posts, body);
  });

  app.put("/api/posts/:id", async (req) => updatePost(ctxOf(req), Id.parse(req.params).id, PostPatchSchema.parse(req.body)));

  app.post("/api/posts/:id/reschedule", async (req) => {
    const { publishAt } = z.object({ publishAt: z.string().min(1).max(60) }).parse(req.body);
    return reschedulePost(ctxOf(req), Id.parse(req.params).id, publishAt);
  });

  app.post("/api/posts/:id/publish", async (req) => publishNow(ctxOf(req), Id.parse(req.params).id));
  app.post("/api/posts/:id/cancel", async (req) => cancelPost(ctxOf(req), Id.parse(req.params).id));
  app.post("/api/posts/:id/approve", async (req) => approvePost(ctxOf(req), Id.parse(req.params).id));
  app.post("/api/posts/:id/reject", async (req) => {
    const { reason } = z.object({ reason: z.string().max(2000).nullable().optional() }).parse(req.body ?? {});
    return rejectPost(ctxOf(req), Id.parse(req.params).id, reason ?? null);
  });
  app.post("/api/posts/:id/duplicate", async (req) => duplicatePost(ctxOf(req), Id.parse(req.params).id));
  app.delete("/api/posts/:id", async (req) => {
    deletePost(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });

  /* ---------------- Çöp kutusu (silinen gönderiler, 30 gün) ---------------- */

  app.get("/api/posts/trash", async (req) => ({ items: listTrash(ctxOf(req)), days: TRASH_DAYS }));
  app.post("/api/posts/trash/:id/restore", async (req) => restorePost(ctxOf(req), Id.parse(req.params).id));
  app.delete("/api/posts/trash/:id", async (req) => purgeTrash(ctxOf(req), Id.parse(req.params).id));
  app.delete("/api/posts/trash", async (req) => purgeTrash(ctxOf(req), null));

  /* ---------------- Ekip notları ---------------- */

  app.post("/api/posts/:id/notes", async (req) => {
    const ctx = ctxOf(req);
    const { id } = Id.parse(req.params);
    if (!postsRepo.get(ctx.orgId, id)) throw notFound("post");
    const { text } = z.object({ text: z.string().min(1).max(4000) }).parse(req.body);
    return postNotesRepo.add(id, { authorUserId: ctx.userId, authorName: req.user?.name || req.user?.email || ctx.clientName || "API", text, source: "team" });
  });

  app.delete("/api/posts/:id/notes/:noteId", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const { id, noteId } = z.object({ id: z.string(), noteId: z.string() }).parse(req.params);
    if (!postsRepo.get(ctx.orgId, id)) throw notFound("post");
    postNotesRepo.remove(id, noteId);
    return { ok: true };
  });

  /* ---------------- Müşteri önizleme linkleri ---------------- */

  app.post("/api/posts/:id/preview-links", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    assertFeature(ctx.orgId, "previewLinks");
    const { id } = Id.parse(req.params);
    if (!postsRepo.get(ctx.orgId, id)) throw notFound("post");
    const { days } = z.object({ days: z.number().int().min(1).max(90).default(14) }).parse(req.body ?? {});
    return previewLinksRepo.create(ctx.orgId, id, ctx.userId, days);
  });

  app.delete("/api/preview-links/:token", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    previewLinksRepo.revoke(ctx.orgId, z.object({ token: z.string() }).parse(req.params).token);
    return { ok: true };
  });

  /* ---------------- Medya ---------------- */

  app.get("/api/media", async (req) => {
    const q = z.object({ limit: z.coerce.number().min(1).max(500).default(200), offset: z.coerce.number().min(0).default(0), kind: z.enum(["image", "video", "other"]).optional() }).parse(req.query);
    return mediaRepo.list(ctxOf(req).orgId, q).map(publicMedia);
  });

  app.post("/api/media", async (req, reply) => {
    const ctx = ctxOf(req);
    const out = [];
    for await (const part of req.files({ limits: { fileSize: MAX_UPLOAD_BYTES } })) {
      out.push(publicMedia(await saveUploadedStream(ctx, part.file, part.filename || "file", part.mimetype)));
    }
    if (!out.length) return reply.code(400).send({ error: "no file" });
    return out;
  });

  app.post("/api/media/import", async (req) => {
    const { url, name } = z.object({ url: z.url(), name: z.string().max(200).optional() }).parse(req.body);
    return publicMedia(await importMediaFromUrl(ctxOf(req), url, name));
  });

  app.patch("/api/media/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const { id } = Id.parse(req.params);
    const { altText } = z.object({ altText: z.string().max(1000).nullable() }).parse(req.body);
    mediaRepo.setAlt(ctx.orgId, id, altText);
    const m = mediaRepo.get(ctx.orgId, id);
    if (!m) throw notFound("media");
    return publicMedia(m);
  });

  app.delete("/api/media/:id", async (req) => {
    deleteMedia(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });

  /* ---------------- Etiketler ---------------- */

  app.get("/api/tags", async (req) => tagsRepo.list(ctxOf(req).orgId));
  app.post("/api/tags", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z.object({ name: z.string().min(1).max(40), color: Color.optional() }).parse(req.body);
    return tagsRepo.ensure(ctx.orgId, body.name, body.color);
  });
  app.patch("/api/tags/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z.object({ name: z.string().min(1).max(40).optional(), color: Color.optional() }).parse(req.body);
    const tag = tagsRepo.update(ctx.orgId, Id.parse(req.params).id, body);
    if (!tag) throw notFound("tag");
    return tag;
  });
  app.delete("/api/tags/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    tagsRepo.remove(ctx.orgId, Id.parse(req.params).id);
    return { ok: true };
  });

  /* ---------------- İmzalar ---------------- */

  app.get("/api/signatures", async (req) => signaturesRepo.list(ctxOf(req).orgId));
  app.post("/api/signatures", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z.object({ name: z.string().min(1).max(60), content: z.string().min(1).max(3000), autoAdd: z.boolean().optional() }).parse(req.body);
    return signaturesRepo.create(ctx.orgId, body);
  });
  app.patch("/api/signatures/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z.object({ name: z.string().min(1).max(60).optional(), content: z.string().min(1).max(3000).optional(), autoAdd: z.boolean().optional() }).parse(req.body);
    const s = signaturesRepo.update(ctx.orgId, Id.parse(req.params).id, body);
    if (!s) throw notFound("signature");
    return s;
  });
  app.delete("/api/signatures/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    signaturesRepo.remove(ctx.orgId, Id.parse(req.params).id);
    return { ok: true };
  });

  /* ---------------- Hazır ayarlar (kanal setleri) ---------------- */

  app.get("/api/presets", async (req) => presetsRepo.list(ctxOf(req).orgId));
  app.post("/api/presets", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z
      .object({ name: z.string().min(1).max(60), channelIds: z.array(z.string()).min(1).max(50), settings: z.record(z.string(), z.record(z.string(), z.unknown())).optional() })
      .parse(req.body);
    return presetsRepo.create(ctx.orgId, body);
  });
  app.patch("/api/presets/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const body = z
      .object({ name: z.string().min(1).max(60).optional(), channelIds: z.array(z.string()).min(1).max(50).optional(), settings: z.record(z.string(), z.record(z.string(), z.unknown())).optional() })
      .parse(req.body);
    const p = presetsRepo.update(ctx.orgId, Id.parse(req.params).id, body);
    if (!p) throw notFound("preset");
    return p;
  });
  app.delete("/api/presets/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    presetsRepo.remove(ctx.orgId, Id.parse(req.params).id);
    return { ok: true };
  });
}
