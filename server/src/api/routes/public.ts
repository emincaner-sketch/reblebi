import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { config } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { publicPlans } from "../../core/plans.js";
import { channelsRepo } from "../../core/repos/channels.js";
import { postNotesRepo, previewLinksRepo } from "../../core/repos/content.js";
import { activityRepo, mediaRepo, platformSettingsRepo, webhookEventsRepo } from "../../core/repos/misc.js";
import { orgsRepo } from "../../core/repos/orgs.js";
import { postsRepo } from "../../core/repos/posts.js";
import { googleLoginEnabled } from "../../services/google-login.js";
import { facebookLoginEnabled } from "../../services/facebook-login.js";
import { parseMetaWebhook, parseSignedRequest, verifyMetaSignature } from "../../providers/index.js";
import { handleInbound } from "../../services/dm-engine.js";
import { publicMedia } from "../../services/media.js";
import { notify } from "../../services/notify.js";

const log = createLogger("public");

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({ ok: true, time: new Date().toISOString() }));

  /** Satış sayfası ve yasal sayfalar için genel bilgiler */
  app.get("/api/public/config", async () => ({
    appName: config.appName,
    signupMode: config.saas.signupMode,
    trialDays: config.saas.trialDays,
    trialPlan: config.saas.trialPlan,
    supportEmail: config.saas.supportEmail,
    companyName: config.saas.companyName,
    companyAddress: config.saas.companyAddress,
    publicUrl: config.publicUrl,
    mcpUrl: `${config.publicUrl}/mcp`,
    plans: publicPlans(),
    googleLogin: googleLoginEnabled(),
    facebookLogin: facebookLoginEnabled(),
  }));

  /* ---------------- Müşteri önizleme linki (giriş gerektirmez) ---------------- */

  app.get("/api/public/preview/:token", async (req, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.params);
    const link = previewLinksRepo.resolve(token);
    const post = link ? postsRepo.get(link.orgId, link.postId) : null;
    if (!link || !post) return reply.code(404).send({ error: "not found" });
    const org = orgsRepo.get(link.orgId);
    const media = mediaRepo.getMany(link.orgId, post.mediaIds).map(publicMedia);
    return {
      org: { name: org?.name ?? "" },
      post: {
        title: post.title,
        kind: post.kind,
        status: post.status,
        publishAt: post.publishAt,
        content: post.content,
        media: media.map((m) => ({ url: m.url, kind: m.kind })),
        targets: post.targets.map((tg) => {
          const ch = channelsRepo.get(link.orgId, tg.channelId);
          return { channel: ch?.name ?? "?", provider: ch?.provider ?? null, avatarUrl: ch?.avatarUrl ?? null, content: tg.content ?? post.content };
        }),
      },
      allowComments: Boolean(link.allowComments),
      comments: postNotesRepo.list(post.id).filter((n) => n.source === "preview").map((n) => ({ author: n.authorName, text: n.text, at: n.createdAt })),
    };
  });

  app.post("/api/public/preview/:token/comments", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.params);
    const body = z.object({ name: z.string().min(1).max(80), text: z.string().min(1).max(2000) }).parse(req.body);
    const link = previewLinksRepo.resolve(token);
    if (!link || !link.allowComments || !postsRepo.get(link.orgId, link.postId)) return reply.code(404).send({ error: "not found" });
    const note = postNotesRepo.add(link.postId, { authorUserId: null, authorName: body.name, text: body.text, source: "preview" });
    notify(link.orgId, { kind: "info", title: `💬 ${body.name}`, body: body.text.slice(0, 200), link: `/app/posts/${link.postId}` });
    return { author: note.authorName, text: note.text, at: note.createdAt };
  });

  /* ---------------- Meta webhook'ları (Instagram DM, Messenger, WhatsApp) ---------------- */

  app.get("/webhooks/meta", async (req, reply) => {
    const q = z.object({ "hub.mode": z.string().optional(), "hub.verify_token": z.string().optional(), "hub.challenge": z.string().optional() }).parse(req.query);
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === config.meta.webhookVerifyToken) {
      return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    }
    return reply.code(403).send("verification failed");
  });

  app.post("/webhooks/meta", { config: { rateLimit: false } }, async (req, reply) => {
    const raw = req.rawBody ?? JSON.stringify(req.body ?? {});
    if (!verifyMetaSignature(raw, req.headers["x-hub-signature-256"] as string | undefined)) {
      log.warn("geçersiz Meta imzası");
      return reply.code(401).send("invalid signature");
    }
    const body = req.body as Parameters<typeof parseMetaWebhook>[0];
    const evId = webhookEventsRepo.add("meta:" + (body?.object ?? "?"), body);
    // Meta 20 sn içinde 200 bekler; işleme arka planda
    reply.code(200).send("EVENT_RECEIVED");
    setImmediate(async () => {
      try {
        for (const ev of parseMetaWebhook(body)) await handleInbound(ev.provider, ev);
        webhookEventsRepo.markProcessed(evId, null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        webhookEventsRepo.markProcessed(evId, msg);
        log.error("Meta webhook işleme hatası", { msg });
      }
    });
  });

  /**
   * Meta veri silme geri çağrısı (App Review için zorunlu).
   * Kullanıcı Facebook'tan uygulamayı kaldırıp veri silme isterse bu uç nokta çağrılır;
   * o Facebook kullanıcısıyla bağlanmış tüm kanallar ve konuşmaları silinir.
   */
  app.post("/webhooks/meta/data-deletion", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const signed = ((req.body as Record<string, string>)?.signed_request ?? "") as string;
    const data = parseSignedRequest(signed);
    if (!data?.user_id) return reply.code(400).send({ error: "invalid signed_request" });
    const affected = channelsRepo.listAll().filter((c) => (c.provider === "facebook" || c.provider === "instagram") && c.metadata.fbUserId === data.user_id);
    for (const ch of affected) {
      channelsRepo.remove(ch.orgId, ch.id);
      activityRepo.add(ch.orgId, "warn", "privacy", `Meta data deletion: ${ch.name}`);
    }
    const code = crypto.randomBytes(8).toString("hex");
    platformSettingsRepo.set(`deletion:${code}`, JSON.stringify({ at: new Date().toISOString(), channels: affected.length }));
    return { url: `${config.appUrl}/data-deletion?code=${code}`, confirmation_code: code };
  });

  /** Meta yetki kaldırma: kanalları "expired" işaretle (veri silinmez) */
  app.post("/webhooks/meta/deauthorize", async (req, reply) => {
    const signed = ((req.body as Record<string, string>)?.signed_request ?? "") as string;
    const data = parseSignedRequest(signed);
    if (!data?.user_id) return reply.code(400).send({ error: "invalid signed_request" });
    for (const ch of channelsRepo.listAll().filter((c) => c.metadata.fbUserId === data.user_id)) {
      channelsRepo.setStatus(ch.id, "expired", "Meta: app deauthorized");
    }
    return { ok: true };
  });

  app.get("/api/public/data-deletion/:code", async (req, reply) => {
    const { code } = z.object({ code: z.string().regex(/^[a-f0-9]{16}$/) }).parse(req.params);
    const raw = platformSettingsRepo.get(`deletion:${code}`);
    if (!raw) return reply.code(404).send({ error: "not found" });
    return { code, status: "completed", ...JSON.parse(raw) };
  });
}
