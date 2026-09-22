import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { config } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { webhookEventsRepo } from "../../core/repos/misc.js";
import { parseMetaWebhook } from "../../providers/index.js";
import { handleInbound } from "../services/dm-engine.js";

const log = createLogger("webhook");

function verifyMetaSignature(rawBody: string, header: string | undefined): boolean {
  if (!config.meta.appSecret) return true; // geliştirme: secret yoksa doğrulama atlanır
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", config.meta.appSecret).update(rawBody).digest("hex");
  const given = header.slice(7);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /** Meta doğrulama (Instagram, Messenger, WhatsApp aynı uç noktayı kullanır) */
  app.get("/webhooks/meta", async (req, reply) => {
    const q = z.object({ "hub.mode": z.string().optional(), "hub.verify_token": z.string().optional(), "hub.challenge": z.string().optional() }).parse(req.query);
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === config.meta.webhookVerifyToken) {
      return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    }
    return reply.code(403).send("Doğrulama başarısız");
  });

  app.post("/webhooks/meta", { config: { rawBody: true } }, async (req, reply) => {
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    if (!verifyMetaSignature(raw, req.headers["x-hub-signature-256"] as string | undefined)) {
      log.warn("geçersiz Meta imzası");
      return reply.code(401).send("Geçersiz imza");
    }
    const body = req.body as Parameters<typeof parseMetaWebhook>[0];
    const evId = webhookEventsRepo.add("meta:" + (body?.object ?? "?"), body);
    // Meta 20 sn içinde 200 bekler; işleme arka planda
    reply.code(200).send("EVENT_RECEIVED");
    setImmediate(async () => {
      try {
        const events = parseMetaWebhook(body);
        for (const ev of events) await handleInbound(ev.provider, ev);
        webhookEventsRepo.markProcessed(evId, null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        webhookEventsRepo.markProcessed(evId, msg);
        log.error("Meta webhook işleme hatası", { msg });
      }
    });
  });
}
