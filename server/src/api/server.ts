import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { PROJECT_ROOT, config } from "../core/config.js";
import { AppError, t } from "../core/i18n.js";
import { createLogger } from "../core/logger.js";
import { ProviderError } from "../providers/index.js";
import { MAX_UPLOAD_BYTES } from "../services/media.js";
import { allowedOrigins, csrfGuard, resolveRequest } from "./context.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { channelRoutes, oauthCallbackRoutes } from "./routes/channels.js";
import { inboxRoutes } from "./routes/inbox.js";
import { mcpRoutes } from "./routes/mcp.js";
import { orgRoutes } from "./routes/org.js";
import { postRoutes } from "./routes/posts.js";
import { publicRoutes } from "./routes/public.js";
import { settingsRoutes } from "./routes/settings.js";

const log = createLogger("http");

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/** Herkese açık CORS gereken yollar (MCP istemcileri, OAuth, önizleme) — çerezsiz */
function isPublicCorsPath(url: string): boolean {
  return url.startsWith("/mcp") || url.startsWith("/.well-known/") || url.startsWith("/oauth/token") || url.startsWith("/oauth/register") || url.startsWith("/oauth/revoke") || url.startsWith("/api/public/");
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024, trustProxy: true });

  // JSON gövdeyi ham haliyle de sakla (Meta webhook imzası için)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      (e as { statusCode?: number }).statusCode = 400;
      done(e as Error, undefined);
    }
  });
  // OAuth token uç noktası ve Meta signed_request form ile gelir
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        mediaSrc: ["'self'", "blob:", "https:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }, // platformlar medyayı çekebilsin
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    delegator: (req, cb) => {
      const origin = req.headers.origin;
      const trusted = Boolean(origin && allowedOrigins().includes(origin.replace(/\/$/, "")));
      const publicPath = isPublicCorsPath(req.url ?? "");
      cb(null, {
        origin: trusted ? origin : publicPath ? "*" : false,
        credentials: trusted,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        exposedHeaders: ["Mcp-Session-Id", "WWW-Authenticate"],
        maxAge: 600,
      });
    },
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } });
  await app.register(rateLimit, {
    global: true,
    max: config.security.rateLimitPerMinute,
    timeWindow: "1 minute",
    // Medya dosyaları ve statik panel sınırlandırılmaz
    allowList: (req: FastifyRequest) => req.url.startsWith("/media/") || req.url.startsWith("/assets/"),
    keyGenerator: (req: FastifyRequest) => req.ip,
    errorResponseBuilder: (req, ctx) => {
      const e = new AppError(429, "err.rate_limited") as AppError & { statusCode: number; retryAfter: string };
      e.statusCode = 429;
      e.retryAfter = ctx.after;
      return e;
    },
  });

  app.addHook("onRequest", resolveRequest);
  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/")) await csrfGuard(req);
  });

  app.setErrorHandler((error, req, reply) => {
    const locale = req.locale ?? config.defaultLocale;
    if (error instanceof AppError) {
      return reply.code(error.status).send({ error: error.localized(locale), code: error.key, details: error.details ?? undefined });
    }
    if (error instanceof ZodError) {
      const detail = error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      return reply.code(400).send({ error: t(locale, "err.validation", { detail }), code: "err.validation", details: error.issues });
    }
    if (error instanceof ProviderError) {
      return reply.code(502).send({ error: error.message, code: "provider", status: error.status ?? null });
    }
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode ?? 500;
    if (status >= 500) log.error(`${req.method} ${req.url}: ${err.message}`, { stack: err.stack });
    return reply.code(status).send({ error: status >= 500 ? t(locale, "err.server") : err.message, code: status >= 500 ? "server" : "http" });
  });

  await app.register(publicRoutes);
  await app.register(mcpRoutes);
  await app.register(oauthCallbackRoutes);
  await app.register(authRoutes);
  await app.register(orgRoutes);
  await app.register(channelRoutes);
  await app.register(postRoutes);
  await app.register(campaignRoutes);
  await app.register(inboxRoutes);
  await app.register(settingsRoutes);
  await app.register(adminRoutes);

  // Yüklenen medya (platformlar bu herkese açık URL'den çeker)
  await app.register(fastifyStatic, { root: config.mediaDir, prefix: "/media/", decorateReply: false, cacheControl: true, maxAge: "7d", immutable: true });

  // Derlenmiş panel (web/dist) varsa aynı porttan sun; SPA fallback
  const webDist = path.join(PROJECT_ROOT, "web", "dist");
  const hasWeb = fs.existsSync(path.join(webDist, "index.html"));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/", decorateReply: true, wildcard: false, index: false });
  }
  app.setNotFoundHandler((req, reply) => {
    const apiLike = ["/api/", "/webhooks/", "/media/", "/oauth/", "/.well-known/", "/mcp"].some((p) => req.url.startsWith(p));
    if (req.method === "GET" && !apiLike) {
      if (hasWeb) return reply.header("Cache-Control", "no-cache").sendFile("index.html");
      return reply
        .type("text/html")
        .send(`<html><body style="font-family:sans-serif;padding:40px"><h2>${config.appName} API</h2><p>Panel is not built. Dev: <code>npm run dev</code> (panel http://localhost:5173) · Prod: <code>npm run build</code></p></body></html>`);
    }
    return reply.code(404).send({ error: t(req.locale ?? "tr", "err.not_found", { what: req.url }), code: "err.not_found" });
  });

  return app;
}
