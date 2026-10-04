import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appConnectionsRepo, publicAppConnection } from "../../core/repos/app-connections.js";
import type { AppConnectorId } from "../../core/types.js";
import { requireRole } from "../../services/access.js";
import { ctxOf } from "../context.js";
import { notFound } from "../../core/i18n.js";
import { http } from "../../providers/http.js";

const IdParam = z.object({ id: z.string() });

const AppConnectionCreateSchema = z.object({
  appId: z.enum([
    "shopify",
    "slack",
    "discord",
    "stripe",
    "google",
    "notion",
    "airtable",
    "reddit",
    "pinterest",
    "wordpress",
  ]),
  name: z.string().min(1).max(100),
  credentials: z.record(z.string(), z.any()),
  metadata: z.record(z.string(), z.any()).optional(),
});

const AppConnectionPatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  credentials: z.record(z.string(), z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  status: z.enum(["active", "error", "revoked"]).optional(),
});

export async function appConnectionRoutes(app: FastifyInstance) {
  // Liste
  app.get<{ Querystring: { appId?: AppConnectorId } }>("/api/app-connections", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const list = appConnectionsRepo.list(ctx.orgId, req.query.appId);
    return list.map(publicAppConnection);
  });

  // Oluştur
  app.post("/api/app-connections", async (req, reply) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const body = AppConnectionCreateSchema.parse(req.body);

    const created = appConnectionsRepo.create(ctx.orgId, {
      appId: body.appId,
      name: body.name,
      credentials: body.credentials,
      metadata: body.metadata,
    });

    reply.code(201);
    return publicAppConnection(created);
  });

  // Detay
  app.get<{ Params: { id: string } }>("/api/app-connections/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const { id } = IdParam.parse(req.params);
    const conn = appConnectionsRepo.getById(id, ctx.orgId);
    if (!conn) throw notFound("app_connection");
    return publicAppConnection(conn);
  });

  // Güncelle
  app.patch<{ Params: { id: string } }>("/api/app-connections/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const { id } = IdParam.parse(req.params);
    const patch = AppConnectionPatchSchema.parse(req.body);

    const updated = appConnectionsRepo.update(id, ctx.orgId, patch);
    if (!updated) throw notFound("app_connection");
    return publicAppConnection(updated);
  });

  // Sil
  app.delete<{ Params: { id: string } }>("/api/app-connections/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const { id } = IdParam.parse(req.params);
    const ok = appConnectionsRepo.delete(id, ctx.orgId);
    if (!ok) throw notFound("app_connection");
    return { ok: true };
  });

  // Test
  app.post<{ Params: { id: string } }>("/api/app-connections/:id/test", async (req, reply) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const { id } = IdParam.parse(req.params);
    const conn = appConnectionsRepo.getById(id, ctx.orgId);
    if (!conn) throw notFound("app_connection");

    try {
      if (conn.appId === "slack" && conn.credentials.webhookUrl) {
        await http(conn.credentials.webhookUrl, {
          method: "POST",
          json: { text: "Reblebi otomasyon bağlantı testi başarılı! :white_check_mark:" },
        });
      } else if (conn.appId === "discord" && conn.credentials.webhookUrl) {
        await http(conn.credentials.webhookUrl, {
          method: "POST",
          json: { content: "Reblebi otomasyon bağlantı testi başarılı! ✅" },
        });
      }
      return { ok: true, message: "Bağlantı başarıyla doğrulandı" };
    } catch (e: any) {
      reply.code(400);
      return { ok: false, error: e.message || "Bağlantı testi başarısız" };
    }
  });
}
