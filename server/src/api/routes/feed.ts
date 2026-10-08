import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, notFound } from "../../core/i18n.js";
import { channelsRepo } from "../../core/repos/channels.js";
import { instagramRecentMedia } from "../../providers/meta/instagram.js";
import { channelBase } from "../../providers/meta/common.js";
import { ensureFreshToken } from "../../services/publisher.js";
import { ctxOf, requireCtx } from "../context.js";

/** Instagram profil ızgarası önizlemesi: kanalın canlı son gönderileri (ızgara planlayıcı) */
export async function feedRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/channels/:id/feed", async (req) => {
    const ctx = ctxOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ch = channelsRepo.get(ctx.orgId, id);
    if (!ch) throw notFound("channel");
    if (ch.provider !== "instagram") throw new AppError(400, "feed.unsupported");
    try {
      const fresh = await ensureFreshToken(ch);
      return { items: await instagramRecentMedia(fresh.externalId, fresh.accessToken, 30, channelBase(fresh)), live: true };
    } catch (e) {
      // Jeton/izin sorunu: panel yalnızca kendi yayınladığı gönderilerle devam eder
      return { items: [], live: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
    }
  });
}
