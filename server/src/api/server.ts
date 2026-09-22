import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { PROJECT_ROOT, config } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { ProviderError } from "../providers/index.js";
import { resolveUser } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { channelRoutes } from "./routes/channels.js";
import { postRoutes } from "./routes/posts.js";
import { inboxRoutes } from "./routes/inbox.js";
import { settingsRoutes } from "./routes/settings.js";
import { webhookRoutes } from "./routes/webhooks.js";

const log = createLogger("http");

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024, trustProxy: true });

  // JSON gövdeyi ham haliyle de sakla (Meta webhook imzası için)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024, files: 10 } });

  app.addHook("onRequest", resolveUser);

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number };
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join(".") || "alan"}: ${i.message}`).join("; ") });
    }
    if (err instanceof ProviderError) {
      return reply.code(502).send({ error: err.message, status: err.status ?? null, body: err.body ?? null });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) log.error(`${req.method} ${req.url}: ${err.message}`, { stack: err.stack });
    return reply.code(status).send({ error: err.message || "Sunucu hatası" });
  });

  app.get("/api/health", async () => ({ ok: true, time: new Date().toISOString(), publicUrl: config.publicUrl }));

  await app.register(authRoutes);
  await app.register(channelRoutes);
  await app.register(postRoutes);
  await app.register(inboxRoutes);
  await app.register(settingsRoutes);
  await app.register(webhookRoutes);

  // Yüklenen medya (platformlar bu URL'den çeker)
  await app.register(fastifyStatic, { root: config.mediaDir, prefix: "/media/", decorateReply: false, cacheControl: true, maxAge: "1d" });

  // Derlenmiş panel (web/dist) varsa aynı porttan sun; SPA fallback
  const webDist = path.join(PROJECT_ROOT, "web", "dist");
  if (fs.existsSync(path.join(webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/", decorateReply: true, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/webhooks/") && !req.url.startsWith("/media/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Bulunamadı" });
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) {
        return reply.type("text/html").send(
          `<html><body style="font-family:sans-serif;padding:40px"><h2>SosyalPilot API çalışıyor</h2><p>Panel derlenmemiş. Geliştirme için <code>npm run dev</code> (panel: http://localhost:5173), üretim için <code>npm run build</code>.</p></body></html>`,
        );
      }
      return reply.code(404).send({ error: "Bulunamadı" });
    });
  }

  return app;
}
