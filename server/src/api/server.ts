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
import { workflowRoutes } from "./routes/workflows.js";
import { appConnectionRoutes } from "./routes/app-connections.js";
import { bioPublicRoutes, bioRoutes } from "./routes/bio.js";
import { competitorRoutes } from "./routes/competitors.js";
import { googleAuthRoutes } from "./routes/auth-google.js";
import { adsRoutes } from "./routes/ads.js";
import { libraryRoutes } from "./routes/library.js";
import { dashboardRoutes } from "./routes/dashboards.js";
import { autolistRoutes } from "./routes/autolists.js";
import { websitePublicRoutes, websiteRoutes } from "./routes/website.js";
import { feedRoutes } from "./routes/feed.js";
import { pushRoutes } from "./routes/push.js";
import { hashtagRoutes } from "./routes/hashtags.js";
import { exportRoutes } from "./routes/export.js";

const log = createLogger("http");

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/**
 * İstemci tarafında çizilen (ön-render edilmeyen) panel yolları. web/src/App.tsx'teki özel yollarla aynı tutulmalı.
 * Bu yollar noindex'li boş kabuğu (app.html) alır; listede olmayan ve ön-render sayfası da olmayan her yol 404'tür.
 */
const SPA_PATHS = ["/app", "/login", "/signup", "/forgot", "/reset-password", "/verify", "/invite", "/consent", "/preview", "/kanallar", "/gonderiler", "/gelen-kutusu", "/otomasyon", "/analitik", "/ayarlar"];

function isSpaPath(p: string): boolean {
  return SPA_PATHS.some((s) => p === s || p.startsWith(s + "/"));
}

/** Kalıcı yönlendirmeler (eski ya da yinelenen adresler) */
const LEGACY_REDIRECTS: Record<string, string> = { "/index.html": "/", "/pricing": "/fiyatlar", "/en/fiyatlar": "/en/pricing", "/tr": "/" };

/** web/dist içindeki ön-render sayfaları: "/" -> index.html, "/en/pricing" -> en/pricing/index.html */
function webPages(root: string): { pages: Map<string, string>; shell: string; notFound: string | null; notFoundEn: string | null } {
  const pages = new Map<string, string>();
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (ent.name !== "assets" && ent.name !== "fonts") walk(path.join(dir, ent.name));
      } else if (ent.name === "index.html") {
        const rel = path.relative(root, dir).replace(/\\/g, "/");
        pages.set(rel ? `/${rel}` : "/", rel ? `${rel}/index.html` : "index.html");
      }
    }
  };
  walk(root);
  const shell = fs.existsSync(path.join(root, "app.html")) ? "app.html" : "index.html";
  const notFound = fs.existsSync(path.join(root, "404.html")) ? "404.html" : null;
  const notFoundEn = fs.existsSync(path.join(root, "404-en.html")) ? "404-en.html" : null;
  return { pages, shell, notFound, notFoundEn };
}

/** Herkese açık CORS gereken yollar (MCP istemcileri, OAuth, önizleme, inbound webhooklar) — çerezsiz */
function isPublicCorsPath(url: string): boolean {
  return (
    url.startsWith("/mcp") ||
    url.startsWith("/.well-known/") ||
    url.startsWith("/oauth/token") ||
    url.startsWith("/oauth/register") ||
    url.startsWith("/oauth/revoke") ||
    url.startsWith("/api/public/") ||
    url.startsWith("/api/webhooks/catch/") ||
    url.startsWith("/webhooks/catch/")
  );
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
    if (req.url.startsWith("/api/") && !req.url.startsWith("/api/public/collect")) await csrfGuard(req);
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
  await app.register(googleAuthRoutes);
  await app.register(orgRoutes);
  await app.register(channelRoutes);
  await app.register(postRoutes);
  await app.register(campaignRoutes);
  await app.register(inboxRoutes);
  await app.register(settingsRoutes);
  await app.register(workflowRoutes);
  await app.register(appConnectionRoutes);
  await app.register(bioRoutes);
  await app.register(bioPublicRoutes);
  await app.register(websitePublicRoutes);
  await app.register(competitorRoutes);
  await app.register(adsRoutes);
  await app.register(libraryRoutes);
  await app.register(dashboardRoutes);
  await app.register(autolistRoutes);
  await app.register(websiteRoutes);
  await app.register(feedRoutes);
  await app.register(pushRoutes);
  await app.register(hashtagRoutes);
  await app.register(exportRoutes);
  await app.register(adminRoutes);

  // Yüklenen medya (platformlar bu herkese açık URL'den çeker)
  await app.register(fastifyStatic, { root: config.mediaDir, prefix: "/media/", decorateReply: false, cacheControl: true, maxAge: "7d", immutable: true });

  // Derlenmiş panel (web/dist) varsa aynı porttan sun.
  // Herkese açık sayfalar derlemede HTML'e çevrilir (web/scripts/prerender.ts): her yolun kendi index.html'i var.
  const webDist = path.join(PROJECT_ROOT, "web", "dist");
  const hasWeb = fs.existsSync(path.join(webDist, "index.html"));
  const site = hasWeb ? webPages(webDist) : null;
  // Sayfa HTML'ini yalnızca aşağıdaki yol eşleştirmesi verir; /index.html gibi doğrudan istekler 404 olur
  const pageRequests = new WeakSet<FastifyRequest>();
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      decorateReply: true,
      wildcard: false,
      index: false,
      // Önbellek başlığı setHeaders'ta dosya türüne göre yazılır (eklentinin varsayılanı max-age=0)
      cacheControl: false,
      // Derlemede üretilen .br/.gz kopyalar (web/scripts/prerender.ts) varsa onlar verilir
      preCompressed: true,
      // offline.html: servis çalışanının çevrimdışı sayfası (web/public/sw.js önbelleğe alır; noindex)
      allowedPath: (p, _root, req) => !p.endsWith(".html") || p === "/offline.html" || pageRequests.has(req),
      setHeaders: (res, filePath) => {
        const rel = filePath.replace(/\\/g, "/").replace(/\.(br|gz)$/, "");
        if (rel.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
        // assets: adında içerik özeti var; fonts: sabit ad, içerik değişirse adı da değişir (web/src/fonts.css)
        else if (rel.includes("/assets/") || rel.includes("/fonts/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        else res.setHeader("Cache-Control", "public, max-age=3600");
      },
    });
  }
  // Sayfa ve dosyalar sıkıştırılmış/sıkıştırılmamış iki sürümle verilebilir: aradaki önbellekler (CDN) karıştırmasın
  app.addHook("onSend", async (req, reply) => {
    if (req.method !== "GET" && req.method !== "HEAD") return;
    if (["/api/", "/mcp", "/oauth/", "/webhooks/", "/.well-known/", "/media/"].some((p) => req.url.startsWith(p))) return;
    const v = reply.getHeader("vary");
    const cur = Array.isArray(v) ? v.join(", ") : v ? String(v) : "";
    if (!/accept-encoding/i.test(cur)) reply.header("vary", cur ? `${cur}, Accept-Encoding` : "Accept-Encoding");
  });
  app.setNotFoundHandler((req, reply) => {
    const apiLike = ["/api/", "/webhooks/", "/media/", "/oauth/", "/.well-known/", "/mcp"].some((p) => req.url.startsWith(p));
    if ((req.method === "GET" || req.method === "HEAD") && !apiLike) {
      if (!site) {
        return reply
          .type("text/html")
          .send(`<html><body style="font-family:sans-serif;padding:40px"><h2>${config.appName} API</h2><p>Panel is not built. Dev: <code>npm run dev</code> (panel http://localhost:5173) · Prod: <code>npm run build</code></p></body></html>`);
      }
      const q = req.url.indexOf("?");
      const pathname = decodeURIComponent(q === -1 ? req.url : req.url.slice(0, q));
      const search = q === -1 ? "" : req.url.slice(q);
      const html = (file: string, code = 200) => {
        pageRequests.add(req);
        return reply.code(code).header("Cache-Control", "no-cache").type("text/html; charset=utf-8").sendFile(file);
      };

      if (pathname.length > 1 && pathname.endsWith("/")) {
        const bare = pathname.replace(/\/+$/, "") || "/";
        if (site.pages.has(bare) || isSpaPath(bare)) return reply.redirect(bare + search, 301);
      }
      const moved = LEGACY_REDIRECTS[pathname];
      if (moved) return reply.redirect(moved + search, 301);
      const page = site.pages.get(pathname);
      if (page) return html(page);
      if (isSpaPath(pathname)) return html(site.shell);
      const notFound = pathname === "/en" || pathname.startsWith("/en/") ? (site.notFoundEn ?? site.notFound) : site.notFound;
      return notFound ? html(notFound, 404) : html(site.shell, 404);
    }
    return reply.code(404).send({ error: t(req.locale ?? "tr", "err.not_found", { what: req.url }), code: "err.not_found" });
  });

  return app;
}
