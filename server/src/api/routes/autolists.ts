import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addItem,
  createAutolist,
  getAutolist,
  importFromLibrary,
  listAutolists,
  removeAutolist,
  removeItem,
  reorderItems,
  updateAutolist,
  updateItem,
} from "../../services/autolists.js";
import { ctxOf, requireCtx } from "../context.js";

const Id = z.object({ id: z.string() });
const ItemId = z.object({ id: z.string(), itemId: z.string() });
const Kind = z.enum(["post", "story", "reel", "video", "thread"]);
const Slot = z.object({ day: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) });
const Slots = z
  .array(Slot)
  .max(50)
  .transform((list) => [...new Map(list.map((s) => [`${s.day}-${s.time}`, s])).values()].sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)));

/** Otomatik listeler: /api/autolists */
export async function autolistRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/autolists", async (req) => listAutolists(ctxOf(req)));
  app.get("/api/autolists/:id", async (req) => getAutolist(ctxOf(req), Id.parse(req.params).id));

  app.post("/api/autolists", async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(80), channelIds: z.array(z.string().max(64)).max(30).default([]), slots: Slots.default([]), repeat: z.boolean().default(true) }).parse(req.body);
    return createAutolist(ctxOf(req), b);
  });

  app.patch("/api/autolists/:id", async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        channelIds: z.array(z.string().max(64)).max(30).optional(),
        slots: Slots.optional(),
        repeat: z.boolean().optional(),
        enabled: z.boolean().optional(),
        position: z.number().int().min(0).optional(),
      })
      .parse(req.body);
    return updateAutolist(ctxOf(req), Id.parse(req.params).id, b);
  });

  app.delete("/api/autolists/:id", async (req) => {
    removeAutolist(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });

  app.post("/api/autolists/:id/items", async (req) => {
    const b = z.object({ kind: Kind.default("post"), content: z.string().max(20000).default(""), mediaIds: z.array(z.string()).max(20).default([]) }).parse(req.body);
    return addItem(ctxOf(req), Id.parse(req.params).id, b);
  });

  app.post("/api/autolists/:id/items/import", async (req) => {
    const { libraryIds } = z.object({ libraryIds: z.array(z.string().max(64)).min(1).max(200) }).parse(req.body);
    return importFromLibrary(ctxOf(req), Id.parse(req.params).id, libraryIds);
  });

  app.patch("/api/autolists/:id/items/:itemId", async (req) => {
    const p = ItemId.parse(req.params);
    const b = z.object({ kind: Kind.optional(), content: z.string().max(20000).optional(), mediaIds: z.array(z.string()).max(20).optional() }).parse(req.body);
    return updateItem(ctxOf(req), p.id, p.itemId, b);
  });

  app.delete("/api/autolists/:id/items/:itemId", async (req) => {
    const p = ItemId.parse(req.params);
    removeItem(ctxOf(req), p.id, p.itemId);
    return { ok: true };
  });

  app.post("/api/autolists/:id/reorder", async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().max(64)).max(1000) }).parse(req.body);
    return reorderItems(ctxOf(req), Id.parse(req.params).id, ids);
  });
}
