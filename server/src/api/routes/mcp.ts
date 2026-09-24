import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { config } from "../../core/config.js";
import { randomToken } from "../../core/crypto.js";
import { AppError } from "../../core/i18n.js";
import { createLogger } from "../../core/logger.js";
import { activityRepo } from "../../core/repos/misc.js";
import { oauthClientsRepo, oauthCodesRepo, oauthTokensRepo } from "../../core/repos/oauth.js";
import { membershipsRepo, orgsRepo } from "../../core/repos/orgs.js";
import { buildMcpServer } from "../../mcp/tools.js";
import { hasFeature } from "../../services/limits.js";
import { requireSession } from "../context.js";

const log = createLogger("mcp");

const RESOURCE = () => `${config.publicUrl}/mcp`;
const PRM_URL = () => `${config.publicUrl}/.well-known/oauth-protected-resource/mcp`;

/* ---------------- Bekleyen yetkilendirme istekleri (onay ekranı için) ---------------- */

interface PendingAuth {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string | null;
  resource: string | null;
  createdAt: number;
}

const pending = new Map<string, PendingAuth>();

function cleanupPending(): void {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [k, v] of pending) if (v.createdAt < cutoff) pending.delete(k);
}

/** Loopback adresleri için port bağımsız eşleşme (RFC 8252), diğerleri birebir */
function redirectAllowed(registered: string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true;
  try {
    const c = new URL(candidate);
    if (c.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(c.hostname)) return false;
    return registered.some((r) => {
      const u = new URL(r);
      return u.protocol === "http:" && u.hostname === c.hostname && u.pathname === c.pathname;
    });
  } catch {
    return false;
  }
}

function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (["javascript:", "data:", "file:", "vbscript:"].includes(u.protocol)) return false;
    if (u.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return false;
    return !u.hash;
  } catch {
    return false;
  }
}

function oauthError(reply: FastifyReply, status: number, error: string, description?: string) {
  return reply.code(status).header("Cache-Control", "no-store").send({ error, error_description: description });
}

function clientAuth(req: FastifyRequest, body: Record<string, string | undefined>): { clientId: string | null; secret: string | null } {
  const h = req.headers.authorization;
  if (h?.startsWith("Basic ")) {
    const [id, secret] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
    return { clientId: decodeURIComponent(id ?? ""), secret: decodeURIComponent(secret ?? "") };
  }
  return { clientId: body.client_id ?? null, secret: body.client_secret ?? null };
}

function metadata() {
  const base = config.publicUrl;
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["mcp"],
    service_documentation: `${config.appUrl}/docs/mcp`,
  };
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------- Keşif belgeleri ---------------- */

  const prm = async () => ({
    resource: RESOURCE(),
    authorization_servers: [config.publicUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
    resource_name: config.appName,
    resource_documentation: `${config.appUrl}/docs/mcp`,
  });
  app.get("/.well-known/oauth-protected-resource", prm);
  app.get("/.well-known/oauth-protected-resource/mcp", prm);
  app.get("/.well-known/oauth-authorization-server", async () => metadata());
  app.get("/.well-known/oauth-authorization-server/mcp", async () => metadata());
  app.get("/.well-known/openid-configuration", async () => metadata());

  /* ---------------- Dinamik istemci kaydı (RFC 7591) ---------------- */

  app.post("/oauth/register", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = z
      .object({
        client_name: z.string().max(120).optional(),
        redirect_uris: z.array(z.string().max(500)).min(1).max(10),
        token_endpoint_auth_method: z.enum(["none", "client_secret_post", "client_secret_basic"]).optional(),
        grant_types: z.array(z.string()).optional(),
        response_types: z.array(z.string()).optional(),
        client_uri: z.string().max(300).optional(),
        logo_uri: z.string().max(300).optional(),
        scope: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return oauthError(reply, 400, "invalid_client_metadata", parsed.error.issues[0]?.message);
    const b = parsed.data;
    if (!b.redirect_uris.every(validRedirectUri)) return oauthError(reply, 400, "invalid_redirect_uri", "redirect_uris must be https, loopback http or an app scheme");
    const method = b.token_endpoint_auth_method ?? "none";
    const { client, secret } = oauthClientsRepo.register({
      name: b.client_name || "MCP client",
      redirectUris: b.redirect_uris,
      clientUri: b.client_uri ?? null,
      logoUri: b.logo_uri ?? null,
      confidential: method !== "none",
    });
    log.info("MCP istemcisi kaydedildi", { client: client.id, name: client.name });
    return reply.code(201).send({
      client_id: client.id,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp",
    });
  });

  /* ---------------- Yetkilendirme: panelin onay ekranına yönlendir ---------------- */

  app.get("/oauth/authorize", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const client = q.client_id ? oauthClientsRepo.get(q.client_id) : null;
    if (!client) return reply.code(400).type("text/plain").send("Unknown client_id. Register the client first (dynamic client registration).");
    if (!q.redirect_uri || !redirectAllowed(client.redirectUris, q.redirect_uri)) return reply.code(400).type("text/plain").send("redirect_uri is not registered for this client.");
    const back = (params: Record<string, string>) => {
      const u = new URL(q.redirect_uri!);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (q.state) u.searchParams.set("state", q.state);
      return reply.redirect(u.toString());
    };
    if (q.response_type !== "code") return back({ error: "unsupported_response_type" });
    if (!q.code_challenge || (q.code_challenge_method ?? "plain") !== "S256") return back({ error: "invalid_request", error_description: "PKCE S256 required" });
    if (q.resource && q.resource.replace(/\/$/, "") !== RESOURCE() && q.resource.replace(/\/$/, "") !== config.publicUrl) {
      return back({ error: "invalid_target", error_description: "unknown resource" });
    }
    cleanupPending();
    const id = randomToken(18);
    pending.set(id, {
      clientId: client.id,
      redirectUri: q.redirect_uri,
      state: q.state ?? null,
      codeChallenge: q.code_challenge,
      scope: q.scope ?? "mcp",
      resource: q.resource ?? RESOURCE(),
      createdAt: Date.now(),
    });
    return reply.redirect(`${config.appUrl}/consent?request=${encodeURIComponent(id)}`);
  });

  /** Onay ekranı: istek bilgisi + kullanıcının çalışma alanları */
  app.get("/api/oauth2/requests/:id", { preHandler: requireSession }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const p = pending.get(id);
    const client = p ? oauthClientsRepo.get(p.clientId) : null;
    if (!p || !client) return reply.code(404).send({ error: "expired" });
    const redirectHost = (() => {
      try {
        return new URL(p.redirectUri).host || new URL(p.redirectUri).protocol;
      } catch {
        return p.redirectUri;
      }
    })();
    return {
      client: { id: client.id, name: client.name, uri: client.clientUri, logo: client.logoUri, redirectHost },
      scope: p.scope,
      orgs: orgsRepo
        .listForUser(req.user!.id)
        .filter((o) => !o.disabled)
        .map((o) => ({ id: o.id, name: o.name, role: o.role, mcpAllowed: hasFeature(o.id, "mcp") })),
      currentOrgId: req.ctx?.orgId ?? null,
    };
  });

  app.post("/api/oauth2/requests/:id/decision", { preHandler: requireSession }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ allow: z.boolean(), orgId: z.string().optional() }).parse(req.body);
    const p = pending.get(id);
    if (!p) return reply.code(404).send({ error: "expired" });
    pending.delete(id);
    const u = new URL(p.redirectUri);
    if (p.state) u.searchParams.set("state", p.state);
    if (!body.allow) {
      u.searchParams.set("error", "access_denied");
      return { redirect: u.toString() };
    }
    const orgId = body.orgId ?? req.ctx?.orgId;
    if (!orgId || !membershipsRepo.get(orgId, req.user!.id)) throw new AppError(403, "auth.not_member");
    if (!hasFeature(orgId, "mcp")) throw new AppError(402, "limit.feature", { feature: "mcp" });
    const code = oauthCodesRepo.create({ clientId: p.clientId, userId: req.user!.id, orgId, redirectUri: p.redirectUri, codeChallenge: p.codeChallenge, scope: p.scope, resource: p.resource });
    const client = oauthClientsRepo.get(p.clientId);
    activityRepo.add(orgId, "info", "security", `AI connected: ${client?.name ?? p.clientId} (${req.user!.email})`);
    u.searchParams.set("code", code);
    u.searchParams.set("iss", config.publicUrl);
    return { redirect: u.toString() };
  });

  /* ---------------- Token uç noktası ---------------- */

  app.post("/oauth/token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const { clientId, secret } = clientAuth(req, body);
    if (!clientId) return oauthError(reply, 401, "invalid_client");
    const client = oauthClientsRepo.get(clientId);
    if (!client || !oauthClientsRepo.verifySecret(clientId, secret)) return oauthError(reply, 401, "invalid_client");

    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.code_verifier) return oauthError(reply, 400, "invalid_request", "code and code_verifier required");
      const code = oauthCodesRepo.consume(body.code);
      if (!code || code.clientId !== clientId) return oauthError(reply, 400, "invalid_grant", "code invalid or expired");
      if (body.redirect_uri && body.redirect_uri !== code.redirectUri) return oauthError(reply, 400, "invalid_grant", "redirect_uri mismatch");
      const challenge = crypto.createHash("sha256").update(body.code_verifier).digest("base64url");
      if (challenge !== code.codeChallenge) return oauthError(reply, 400, "invalid_grant", "PKCE verification failed");
      if (!membershipsRepo.get(code.orgId, code.userId)) return oauthError(reply, 400, "invalid_grant", "membership revoked");
      const t = oauthTokensRepo.issue({ clientId, userId: code.userId, orgId: code.orgId, scope: code.scope, resource: code.resource });
      oauthClientsRepo.touch(clientId);
      return reply.header("Cache-Control", "no-store").send({ access_token: t.accessToken, token_type: "Bearer", expires_in: t.expiresIn, refresh_token: t.refreshToken, scope: code.scope ?? "mcp" });
    }

    if (body.grant_type === "refresh_token") {
      if (!body.refresh_token) return oauthError(reply, 400, "invalid_request", "refresh_token required");
      const t = oauthTokensRepo.rotate(body.refresh_token, clientId);
      if (!t) return oauthError(reply, 400, "invalid_grant", "refresh token invalid, expired or revoked");
      return reply.header("Cache-Control", "no-store").send({ access_token: t.accessToken, token_type: "Bearer", expires_in: t.expiresIn, refresh_token: t.refreshToken, scope: t.scope ?? "mcp" });
    }

    return oauthError(reply, 400, "unsupported_grant_type");
  });

  app.post("/oauth/revoke", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    if (body.token) oauthTokensRepo.revoke(body.token);
    return reply.code(200).send({});
  });

  /* ---------------- MCP (Streamable HTTP, durumsuz) ---------------- */

  const unauthorized = (reply: FastifyReply, description = "Authentication required") =>
    reply
      .code(401)
      .header("WWW-Authenticate", `Bearer resource_metadata="${PRM_URL()}", error="invalid_token", error_description="${description}"`)
      .send({ jsonrpc: "2.0", error: { code: -32001, message: description }, id: null });

  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.ctx || (req.ctx.via !== "oauth" && req.ctx.via !== "apikey")) return unauthorized(reply);
    const org = orgsRepo.get(req.ctx.orgId);
    if (!org || org.disabled) return unauthorized(reply, "Workspace unavailable");
    if (!hasFeature(req.ctx.orgId, "mcp")) {
      return reply.code(402).send({ jsonrpc: "2.0", error: { code: -32002, message: "MCP is not included in this plan" }, id: null });
    }
    if (req.method !== "POST") {
      // Durumsuz sunucu: SSE akışı ve oturum silme desteklenmez
      return reply.code(405).header("Allow", "POST").send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
    }
    const server = buildMcpServer(req.ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (e) {
      log.error("MCP isteği işlenemedi", { e: e instanceof Error ? e.message : e });
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "Content-Type": "application/json" });
        reply.raw.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
      }
    }
  };

  app.route({ method: ["GET", "POST", "DELETE"], url: "/mcp", config: { rateLimit: { max: 240, timeWindow: "1 minute" } }, handler: handle });
}
