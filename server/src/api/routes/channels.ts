import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../core/config.js";
import { channelsRepo, publicChannel } from "../../core/repos/channels.js";
import { activityRepo, oauthStatesRepo } from "../../core/repos/misc.js";
import { ALL_PROVIDERS, type ProviderId } from "../../core/types.js";
import { describeProvider, getProvider, listProviders } from "../../providers/index.js";
import { requireAuth } from "../auth.js";
import { ensureFreshToken } from "../services/publisher.js";

const ProviderParam = z.object({ provider: z.enum(ALL_PROVIDERS as [ProviderId, ...ProviderId[]]) });

/** Meta OAuth akışı 'meta' adıyla başlatılır; instagram+facebook aynı callback'te oluşur */
function resolveOAuthProvider(name: string): ProviderId {
  if (name === "meta") return "facebook";
  return ProviderParam.parse({ provider: name }).provider;
}

export function redirectUri(providerName: string): string {
  return `${config.publicUrl}/api/oauth/${providerName}/callback`;
}

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/providers", { preHandler: requireAuth }, async () => listProviders().map(describeProvider));

  app.get("/api/channels", { preHandler: requireAuth }, async () => channelsRepo.list().map(publicChannel));

  app.patch("/api/channels/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ name: z.string().min(1).optional(), status: z.enum(["active", "disabled"]).optional(), metadata: z.record(z.string(), z.unknown()).optional() })
      .parse(req.body);
    const ch = channelsRepo.get(id);
    if (!ch) return reply.code(404).send({ error: "Kanal bulunamadı" });
    if (body.name) channelsRepo.rename(id, body.name);
    if (body.status) channelsRepo.setStatus(id, body.status, null);
    if (body.metadata) channelsRepo.updateMetadata(id, body.metadata);
    return publicChannel(channelsRepo.get(id)!);
  });

  app.delete("/api/channels/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ch = channelsRepo.get(id);
    if (!ch) return reply.code(404).send({ error: "Kanal bulunamadı" });
    channelsRepo.remove(id);
    activityRepo.add("warn", "channel", `${ch.name} kanalı kaldırıldı`);
    return { ok: true };
  });

  app.post("/api/channels/:id/check", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ch = channelsRepo.get(id);
    if (!ch) return reply.code(404).send({ error: "Kanal bulunamadı" });
    const provider = getProvider(ch.provider);
    try {
      const fresh = await ensureFreshToken(ch);
      const r = provider.healthCheck ? await provider.healthCheck(fresh) : { ok: true };
      channelsRepo.setStatus(id, r.ok ? "active" : "error", r.ok ? null : (r.detail ?? "Bağlantı hatası"));
      return { ...r, channel: publicChannel(channelsRepo.get(id)!) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, detail: msg, channel: publicChannel(channelsRepo.get(id)!) };
    }
  });

  /** Form ile bağlantı (Telegram, WhatsApp) */
  app.post("/api/channels/connect/:provider", { preHandler: requireAuth }, async (req, reply) => {
    const { provider: pid } = ProviderParam.parse(req.params);
    const provider = getProvider(pid);
    if (provider.connectMode !== "form" || !provider.connectWithForm) return reply.code(400).send({ error: "Bu platform OAuth ile bağlanır" });
    const values = z.record(z.string(), z.string()).parse(req.body ?? {});
    const accounts = await provider.connectWithForm(values);
    const created = accounts.map((a) => channelsRepo.upsert({ provider: a.provider ?? pid, ...a }));
    activityRepo.add("info", "channel", `${provider.label} bağlandı: ${created.map((c) => c.name).join(", ")}`);
    return created.map(publicChannel);
  });

  /** OAuth başlat: yönlendirilecek URL döner */
  app.get("/api/oauth/:provider/start", { preHandler: requireAuth }, async (req, reply) => {
    const name = z.object({ provider: z.string() }).parse(req.params).provider;
    const pid = resolveOAuthProvider(name);
    const provider = getProvider(pid);
    if (!provider.oauthStart) return reply.code(400).send({ error: "Bu platform form ile bağlanır" });
    if (!provider.isConfigured()) return reply.code(400).send({ error: `${provider.label} için .env içinde uygulama anahtarları tanımlı değil` });
    const state = oauthStatesRepo.create(pid);
    const start = provider.oauthStart(redirectUri(name), state);
    if (start.codeVerifier) oauthStatesRepo.setVerifier(state, start.codeVerifier);
    return { url: start.url };
  });

  /** OAuth geri dönüş (herkese açık rota) */
  app.get("/api/oauth/:provider/callback", async (req, reply) => {
    const name = z.object({ provider: z.string() }).parse(req.params).provider;
    const q = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional(), error_description: z.string().optional() }).parse(req.query);
    const fail = (msg: string) => reply.redirect(`/kanallar?hata=${encodeURIComponent(msg)}`);
    if (q.error) return fail(q.error_description ?? q.error);
    if (!q.code || !q.state) return fail("Eksik OAuth parametresi");
    const st = oauthStatesRepo.consume(q.state);
    if (!st) return fail("Geçersiz ya da süresi dolmuş OAuth durumu; tekrar dene");
    const pid = resolveOAuthProvider(name);
    const provider = getProvider(pid);
    if (!provider.oauthCallback) return fail("Sağlayıcı OAuth desteklemiyor");
    try {
      const accounts = await provider.oauthCallback(q.code, redirectUri(name), st.codeVerifier);
      const created = accounts.map((a) => channelsRepo.upsert({ provider: a.provider ?? pid, ...a }));
      activityRepo.add("info", "channel", `${provider.label} bağlandı: ${created.map((c) => c.name).join(", ")}`);
      return reply.redirect(`/kanallar?baglandi=${encodeURIComponent(created.map((c) => c.name).join(", "))}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      activityRepo.add("error", "channel", `${provider.label} bağlantı hatası: ${msg}`);
      return fail(msg);
    }
  });
}
