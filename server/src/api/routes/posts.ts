import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { config } from "../../core/config.js";
import { randomId } from "../../core/crypto.js";
import { channelsRepo } from "../../core/repos/channels.js";
import { postsRepo } from "../../core/repos/posts.js";
import { activityRepo, mediaRepo } from "../../core/repos/misc.js";
import type { PostStatus } from "../../core/types.js";
import { getProvider } from "../../providers/index.js";
import { requireAuth } from "../auth.js";
import { mediaPublicUrl, publishPost } from "../services/publisher.js";

const TargetSchema = z.object({
  channelId: z.string(),
  content: z.string().nullable().optional(),
  mediaIds: z.array(z.string()).nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const PostSchema = z.object({
  title: z.string().nullable().optional(),
  kind: z.enum(["post", "story", "reel", "video", "thread"]).default("post"),
  content: z.string().default(""),
  mediaIds: z.array(z.string()).default([]),
  publishAt: z.string().nullable().optional(),
  status: z.enum(["draft", "scheduled"]).optional(),
  targets: z.array(TargetSchema).min(1, "En az bir kanal seç"),
});

/** Kanal yeteneklerine göre gönderi doğrulama (ör. Instagram'a medyasız gönderi) */
function validateTargets(kind: string, mediaIds: string[], targets: Array<{ channelId: string; mediaIds?: string[] | null }>): string | null {
  for (const t of targets) {
    const ch = channelsRepo.get(t.channelId);
    if (!ch) return `Kanal bulunamadı: ${t.channelId}`;
    const cap = getProvider(ch.provider).capabilities;
    const k = kind as keyof typeof cap;
    if (k in cap && cap[k] === false) return `${ch.name} (${getProvider(ch.provider).label}) '${kind}' türünü desteklemiyor`;
    const media = t.mediaIds ?? mediaIds;
    if ((ch.provider === "instagram" || ch.provider === "tiktok" || ch.provider === "youtube") && media.length === 0) {
      return `${ch.name} için en az bir medya dosyası gerekli`;
    }
    if (kind === "story" && media.length === 0) return "Hikaye için bir görsel ya da video gerekli";
  }
  return null;
}

export async function postRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/posts", { preHandler: requireAuth }, async (req) => {
    const q = z.object({ status: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.coerce.number().optional() }).parse(req.query);
    const status = q.status ? (q.status.split(",") as PostStatus[]) : undefined;
    return postsRepo.list({ status, from: q.from, to: q.to, limit: q.limit });
  });

  app.get("/api/posts/:id", { preHandler: requireAuth }, async (req, reply) => {
    const post = postsRepo.get(z.object({ id: z.string() }).parse(req.params).id);
    return post ?? reply.code(404).send({ error: "Gönderi bulunamadı" });
  });

  app.post("/api/posts", { preHandler: requireAuth }, async (req, reply) => {
    const body = PostSchema.parse(req.body);
    const err = validateTargets(body.kind, body.mediaIds, body.targets);
    if (err) return reply.code(400).send({ error: err });
    const publishNow = body.publishAt === "now";
    const post = postsRepo.create({
      ...body,
      publishAt: publishNow ? new Date().toISOString() : (body.publishAt ?? null),
      status: publishNow ? "scheduled" : body.status,
      source: req.authVia === "apikey" ? "mcp" : "panel",
    });
    activityRepo.add("info", "post", `Gönderi oluşturuldu (${post.kind}, ${post.status})`, { postId: post.id });
    if (publishNow) {
      postsRepo.setStatus(post.id, "publishing");
      return publishPost(post.id);
    }
    return post;
  });

  app.put("/api/posts/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const existing = postsRepo.get(id);
    if (!existing) return reply.code(404).send({ error: "Gönderi bulunamadı" });
    if (existing.status === "publishing") return reply.code(409).send({ error: "Yayınlanmakta olan gönderi düzenlenemez" });
    const body = PostSchema.partial().parse(req.body);
    const err = validateTargets(body.kind ?? existing.kind, body.mediaIds ?? existing.mediaIds, body.targets ?? existing.targets);
    if (err) return reply.code(400).send({ error: err });
    const status = existing.status === "published" || existing.status === "partial" || existing.status === "failed" ? body.status ?? (body.publishAt ? "scheduled" : "draft") : body.status;
    return postsRepo.update(id, { ...body, status });
  });

  app.delete("/api/posts/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    postsRepo.remove(id);
    return { ok: true };
  });

  app.post("/api/posts/:id/publish", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const post = postsRepo.get(id);
    if (!post) return reply.code(404).send({ error: "Gönderi bulunamadı" });
    if (post.status === "publishing") return reply.code(409).send({ error: "Zaten yayınlanıyor" });
    // Başarısız hedefleri sıfırla ki tekrar denensin
    for (const t of post.targets) if (t.status === "failed" || t.status === "pending") postsRepo.updateTarget(t.id, { status: "pending", nextAttemptAt: null });
    postsRepo.update(id, { publishAt: new Date().toISOString(), status: "scheduled" });
    postsRepo.setStatus(id, "publishing");
    return publishPost(id);
  });

  app.post("/api/posts/:id/cancel", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const post = postsRepo.get(id);
    if (!post) return reply.code(404).send({ error: "Gönderi bulunamadı" });
    if (post.status !== "scheduled") return reply.code(400).send({ error: "Sadece planlanmış gönderiler iptal edilir" });
    postsRepo.setStatus(id, "draft");
    return postsRepo.get(id);
  });

  app.post("/api/posts/:id/duplicate", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const post = postsRepo.get(id);
    if (!post) return reply.code(404).send({ error: "Gönderi bulunamadı" });
    return postsRepo.create({
      title: post.title ? post.title + " (kopya)" : null,
      kind: post.kind,
      content: post.content,
      mediaIds: post.mediaIds,
      publishAt: null,
      status: "draft",
      targets: post.targets.map((t) => ({ channelId: t.channelId, content: t.content, mediaIds: t.mediaIds, settings: t.settings })),
    });
  });

  /* ---------------- Medya ---------------- */

  app.get("/api/media", { preHandler: requireAuth }, async () =>
    mediaRepo.list().map((m) => ({ ...m, url: `/media/${encodeURIComponent(m.filename)}`, publicUrl: mediaPublicUrl(m.filename) })),
  );

  app.post("/api/media", { preHandler: requireAuth }, async (req, reply) => {
    const files = req.files({ limits: { fileSize: 1024 * 1024 * 1024 } });
    const out = [];
    for await (const part of files) {
      const ext = path.extname(part.filename || "").toLowerCase() || mimeExt(part.mimetype);
      const id = randomId("med");
      const filename = `${id}${ext}`;
      const dest = path.join(config.mediaDir, filename);
      await pipeline(part.file, fs.createWriteStream(dest));
      const size = fs.statSync(dest).size;
      const kind = part.mimetype.startsWith("image/") ? "image" : part.mimetype.startsWith("video/") ? "video" : "other";
      const m = mediaRepo.create({ id, filename, originalName: part.filename || filename, mime: part.mimetype, size, kind });
      out.push({ ...m, url: `/media/${encodeURIComponent(m.filename)}`, publicUrl: mediaPublicUrl(m.filename) });
    }
    if (!out.length) return reply.code(400).send({ error: "Dosya gelmedi" });
    return out;
  });

  /** URL'den medya içe aktar (AI görsel üreticileri, Canva dışa aktarımı vb.) */
  app.post("/api/media/import", { preHandler: requireAuth }, async (req, reply) => {
    const { url, name } = z.object({ url: z.url(), name: z.string().optional() }).parse(req.body);
    const res = await fetch(url);
    if (!res.ok) return reply.code(400).send({ error: `İndirilemedi (${res.status})` });
    const mime = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    const id = randomId("med");
    const ext = path.extname(new URL(url).pathname) || mimeExt(mime);
    const filename = `${id}${ext}`;
    fs.writeFileSync(path.join(config.mediaDir, filename), buf);
    const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "other";
    const m = mediaRepo.create({ id, filename, originalName: name ?? path.basename(new URL(url).pathname) ?? filename, mime, size: buf.length, kind });
    return { ...m, url: `/media/${encodeURIComponent(m.filename)}`, publicUrl: mediaPublicUrl(m.filename) };
  });

  app.delete("/api/media/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const m = mediaRepo.get(id);
    if (m) {
      try {
        fs.unlinkSync(path.join(config.mediaDir, m.filename));
      } catch {
        /* dosya zaten yok */
      }
      mediaRepo.remove(id);
    }
    return { ok: true };
  });
}

function mimeExt(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
  };
  return map[mime] ?? "";
}
