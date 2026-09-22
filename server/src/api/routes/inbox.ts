import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { channelsRepo } from "../../core/repos/channels.js";
import { inboxRepo } from "../../core/repos/inbox.js";
import { rulesRepo, type RuleInput } from "../../core/repos/misc.js";
import { ALL_PROVIDERS, type ProviderId } from "../../core/types.js";
import { draftReply, isAiEnabled, summarizeConversations } from "../../ai/index.js";
import { requireAuth } from "../auth.js";
import { handleInbound, sendReply } from "../services/dm-engine.js";

const RuleSchema = z.object({
  name: z.string().min(1),
  enabled: z.coerce.number().default(1),
  channelId: z.string().nullable().optional(),
  provider: z.enum(ALL_PROVIDERS as [ProviderId, ...ProviderId[]]).nullable().optional(),
  matchType: z.enum(["any", "first_contact", "keyword", "regex"]).default("keyword"),
  pattern: z.string().nullable().optional(),
  replyMode: z.enum(["template", "ai"]).default("template"),
  replyText: z.string().nullable().optional(),
  aiInstructions: z.string().nullable().optional(),
  priority: z.coerce.number().default(100),
  cooldownMinutes: z.coerce.number().default(60),
  onlyBusinessHours: z.coerce.number().default(0),
  handoffToHuman: z.coerce.number().default(0),
});

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/inbox/conversations", { preHandler: requireAuth }, async (req) => {
    const q = z.object({ channelId: z.string().optional(), status: z.enum(["open", "closed"]).optional(), attention: z.coerce.boolean().optional(), limit: z.coerce.number().optional() }).parse(req.query);
    const channels = new Map(channelsRepo.list().map((c) => [c.id, c]));
    return inboxRepo.listConversations({ channelId: q.channelId, status: q.status, onlyAttention: q.attention, limit: q.limit }).map((c) => ({
      ...c,
      channelName: channels.get(c.channelId)?.name ?? "?",
      provider: channels.get(c.channelId)?.provider ?? null,
    }));
  });

  app.get("/api/inbox/conversations/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const conv = inboxRepo.getConversation(id);
    if (!conv) return reply.code(404).send({ error: "Konuşma bulunamadı" });
    const ch = channelsRepo.get(conv.channelId);
    return { ...conv, channelName: ch?.name ?? "?", provider: ch?.provider ?? null, messages: inboxRepo.messages(id) };
  });

  app.patch("/api/inbox/conversations/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ mode: z.enum(["auto", "manual"]).optional(), status: z.enum(["open", "closed"]).optional(), read: z.boolean().optional() }).parse(req.body ?? {});
    if (!inboxRepo.getConversation(id)) return reply.code(404).send({ error: "Konuşma bulunamadı" });
    if (body.mode) inboxRepo.setMode(id, body.mode);
    if (body.status) inboxRepo.setStatus(id, body.status);
    if (body.read) inboxRepo.markRead(id);
    return inboxRepo.getConversation(id);
  });

  app.post("/api/inbox/conversations/:id/reply", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { text } = z.object({ text: z.string().min(1) }).parse(req.body);
    const conv = inboxRepo.getConversation(id);
    if (!conv) return reply.code(404).send({ error: "Konuşma bulunamadı" });
    const ch = channelsRepo.get(conv.channelId);
    if (!ch) return reply.code(404).send({ error: "Kanal bulunamadı" });
    const msg = await sendReply(ch, conv, text, req.authVia === "apikey" ? "ai" : "user");
    inboxRepo.markRead(id);
    if (msg.status === "failed") return reply.code(502).send({ error: msg.error ?? "Gönderilemedi", message: msg });
    return msg;
  });

  app.post("/api/inbox/conversations/:id/ai-draft", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!isAiEnabled()) return reply.code(400).send({ error: "ANTHROPIC_API_KEY tanımlı değil" });
    const conv = inboxRepo.getConversation(id);
    if (!conv) return reply.code(404).send({ error: "Konuşma bulunamadı" });
    const ch = channelsRepo.get(conv.channelId);
    const body = z.object({ instructions: z.string().optional() }).parse(req.body ?? {});
    return draftReply({ platform: ch?.provider ?? "instagram", participantName: conv.participantName, history: inboxRepo.messages(id), ruleInstructions: body.instructions ?? null });
  });

  app.post("/api/inbox/summary", { preHandler: requireAuth }, async (_req, reply) => {
    if (!isAiEnabled()) return reply.code(400).send({ error: "ANTHROPIC_API_KEY tanımlı değil" });
    const channels = new Map(channelsRepo.list().map((c) => [c.id, c]));
    const convs = inboxRepo.listConversations({ status: "open", limit: 40 });
    if (!convs.length) return { summary: "Açık konuşma yok." };
    const summary = await summarizeConversations(
      convs.map((c) => ({ name: c.participantName ?? c.participantId, platform: channels.get(c.channelId)?.provider ?? "?", lastMessage: c.lastMessagePreview ?? "", unread: c.unread })),
    );
    return { summary };
  });

  /** Test amaçlı: bir kanala sahte gelen mesaj enjekte eder (kuralları denemek için) */
  app.post("/api/inbox/simulate", { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({ channelId: z.string(), text: z.string().min(1), participantId: z.string().default("test-user"), participantName: z.string().default("Test Kullanıcı") }).parse(req.body);
    const ch = channelsRepo.get(body.channelId);
    if (!ch) return reply.code(404).send({ error: "Kanal bulunamadı" });
    await handleInbound(ch.provider, {
      accountExternalId: ch.externalId,
      conversationExternalId: `sim:${body.participantId}`,
      participantId: body.participantId,
      participantName: body.participantName,
      externalMessageId: null,
      text: body.text,
    });
    return { ok: true, note: "Mesaj kaydedildi; oto-yanıt kuralları arka planda çalışıyor (gerçek gönderim kanal API'sine gider)." };
  });

  /* ---------------- Kurallar ---------------- */

  app.get("/api/rules", { preHandler: requireAuth }, async () => rulesRepo.list());
  app.post("/api/rules", { preHandler: requireAuth }, async (req) => rulesRepo.create(RuleSchema.parse(req.body) as RuleInput));
  app.put("/api/rules/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = rulesRepo.update(id, RuleSchema.partial().parse(req.body) as Partial<RuleInput>);
    return r ?? reply.code(404).send({ error: "Kural bulunamadı" });
  });
  app.delete("/api/rules/:id", { preHandler: requireAuth }, async (req) => {
    rulesRepo.remove(z.object({ id: z.string() }).parse(req.params).id);
    return { ok: true };
  });
}
