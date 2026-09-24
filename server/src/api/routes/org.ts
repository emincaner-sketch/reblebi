import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notificationsRepo } from "../../core/repos/content.js";
import { activityRepo, apiKeysRepo } from "../../core/repos/misc.js";
import { oauthTokensRepo } from "../../core/repos/oauth.js";
import { invitationsRepo, membershipsRepo, orgsRepo } from "../../core/repos/orgs.js";
import { publicPlans } from "../../core/plans.js";
import { requireRole } from "../../services/access.js";
import { deleteWorkspace, inviteMember, leaveWorkspace, removeMember, setMemberRole, updateWorkspace } from "../../services/accounts.js";
import { assertFeature, usageSummary } from "../../services/limits.js";
import { clearSessionCookie, ctxOf, requireCtx, requireSession } from "../context.js";

const RoleEnum = z.enum(["owner", "admin", "editor", "viewer"]);

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/org", async (req) => {
    const ctx = ctxOf(req);
    const org = orgsRepo.get(ctx.orgId)!;
    return { ...org, role: ctx.role, usage: usageSummary(ctx.orgId), plans: publicPlans() };
  });

  app.patch("/api/org", async (req) => {
    const body = z.object({ name: z.string().min(1).max(80).optional(), timezone: z.string().max(60).optional(), locale: z.enum(["tr", "en"]).optional() }).parse(req.body);
    return updateWorkspace(ctxOf(req), body);
  });

  app.delete("/api/org", { preHandler: requireSession }, async (req, reply) => {
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body ?? {});
    const ctx = ctxOf(req);
    const org = orgsRepo.get(ctx.orgId)!;
    if (confirm !== org.name) return reply.code(400).send({ error: "confirm" });
    deleteWorkspace(ctx);
    return { ok: true };
  });

  app.get("/api/org/usage", async (req) => usageSummary(ctxOf(req).orgId));

  /* ---------------- Ekip ---------------- */

  app.get("/api/org/members", async (req) => {
    const ctx = ctxOf(req);
    return { members: membershipsRepo.list(ctx.orgId), invitations: ctx.role === "viewer" ? [] : invitationsRepo.listPending(ctx.orgId) };
  });

  app.post("/api/org/invitations", { preHandler: requireSession }, async (req) => {
    const body = z.object({ email: z.email(), role: RoleEnum.default("editor") }).parse(req.body);
    return inviteMember(ctxOf(req), body.email, body.role, req.user?.name || req.user?.email || "");
  });

  app.delete("/api/org/invitations/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    invitationsRepo.remove(ctx.orgId, z.object({ id: z.string() }).parse(req.params).id);
    return { ok: true };
  });

  app.patch("/api/org/members/:userId", { preHandler: requireSession }, async (req) => {
    const { userId } = z.object({ userId: z.string() }).parse(req.params);
    const { role } = z.object({ role: RoleEnum }).parse(req.body);
    setMemberRole(ctxOf(req), userId, role);
    return { ok: true };
  });

  app.delete("/api/org/members/:userId", { preHandler: requireSession }, async (req) => {
    removeMember(ctxOf(req), z.object({ userId: z.string() }).parse(req.params).userId);
    return { ok: true };
  });

  app.post("/api/org/leave", { preHandler: requireSession }, async (req, reply) => {
    leaveWorkspace(ctxOf(req));
    if (!orgsRepo.listForUser(req.user!.id).length) clearSessionCookie(reply);
    return { ok: true };
  });

  /* ---------------- API anahtarları ---------------- */

  app.get("/api/org/api-keys", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    return apiKeysRepo.list(ctx.orgId);
  });

  app.post("/api/org/api-keys", { preHandler: requireSession }, async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    assertFeature(ctx.orgId, "mcp");
    const { name } = z.object({ name: z.string().min(1).max(60) }).parse(req.body);
    const created = apiKeysRepo.create(ctx.orgId, name, ctx.userId);
    activityRepo.add(ctx.orgId, "info", "security", `API key created: ${name}`);
    return created;
  });

  app.delete("/api/org/api-keys/:id", { preHandler: requireSession }, async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    apiKeysRepo.remove(ctx.orgId, z.object({ id: z.string() }).parse(req.params).id);
    return { ok: true };
  });

  /* ---------------- Bağlı AI uygulamaları (MCP OAuth) ---------------- */

  app.get("/api/org/connections", async (req) => {
    const ctx = ctxOf(req);
    const all = oauthTokensRepo.listConnections(ctx.orgId);
    // Yönetici herkesinkini, diğerleri sadece kendi bağlantılarını görür
    return ctx.role === "owner" || ctx.role === "admin" ? all : all.filter((c) => c.userId === ctx.userId);
  });

  app.delete("/api/org/connections/:clientId", { preHandler: requireSession }, async (req) => {
    const ctx = ctxOf(req);
    const { clientId } = z.object({ clientId: z.string() }).parse(req.params);
    const { userId } = z.object({ userId: z.string().optional() }).parse(req.query);
    if (ctx.role === "owner" || ctx.role === "admin") oauthTokensRepo.revokeConnection(ctx.orgId, clientId, userId);
    else oauthTokensRepo.revokeConnection(ctx.orgId, clientId, ctx.userId ?? "");
    activityRepo.add(ctx.orgId, "warn", "security", `AI connection revoked: ${clientId}`);
    return { ok: true };
  });

  /* ---------------- Bildirimler ve aktivite ---------------- */

  app.get("/api/notifications", async (req) => {
    const ctx = ctxOf(req);
    return { items: notificationsRepo.list(ctx.orgId, ctx.userId, 40), unread: notificationsRepo.unreadCount(ctx.orgId, ctx.userId) };
  });

  app.post("/api/notifications/read", async (req) => {
    const ctx = ctxOf(req);
    notificationsRepo.markAllRead(ctx.orgId, ctx.userId);
    return { ok: true };
  });

  app.get("/api/activity", async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().min(1).max(500).default(50) }).parse(req.query);
    return activityRepo.list(ctxOf(req).orgId, limit);
  });
}
