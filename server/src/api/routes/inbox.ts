import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, notFound } from "../../core/i18n.js";
import { channelsRepo } from "../../core/repos/channels.js";
import { privateRepliesRepo, type CommentRuleInput } from "../../core/repos/comment-automation.js";
import { inboxRepo } from "../../core/repos/inbox.js";
import { rulesRepo, type RuleInput } from "../../core/repos/misc.js";
import { membershipsRepo } from "../../core/repos/orgs.js";
import { aiAvailable, draftReply, summarizeConversations } from "../../ai/index.js";
import { requireRole } from "../../services/access.js";
import { createCommentRule, deleteCommentRule, listCommentRules, updateCommentRule } from "../../services/comment-automation.js";
import { getContact, updateContact } from "../../services/contacts.js";
import { getDmProfile, resyncDmProfile, saveDmProfile } from "../../services/dm-profile.js";
import { handleInbound, replyToConversation } from "../../services/dm-engine.js";
import { assertFeature } from "../../services/limits.js";
import { ctxOf, requireCtx } from "../context.js";
import { CommentRulePatchSchema, CommentRuleSchema, ContactPatchSchema, DmProfileSchema, RulePatchSchema, RuleSchema } from "../schemas.js";

const Id = z.object({ id: z.string() });

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCtx);

  app.get("/api/inbox/conversations", async (req) => {
    const ctx = ctxOf(req);
    const q = z
      .object({
        channelId: z.string().optional(),
        status: z.enum(["open", "closed"]).optional(),
        attention: z.stringbool().optional(),
        mine: z.stringbool().optional(),
        q: z.string().max(100).optional(),
        limit: z.coerce.number().min(1).max(500).optional(),
      })
      .parse(req.query);
    const channels = new Map(channelsRepo.list(ctx.orgId).map((c) => [c.id, c]));
    return inboxRepo
      .listConversations(ctx.orgId, { channelId: q.channelId, status: q.status, onlyAttention: q.attention, assignedTo: q.mine ? (ctx.userId ?? undefined) : undefined, q: q.q, limit: q.limit })
      .map((c) => ({ ...c, channelName: channels.get(c.channelId)?.name ?? "?", provider: channels.get(c.channelId)?.provider ?? null }));
  });

  app.get("/api/inbox/conversations/:id", async (req) => {
    const ctx = ctxOf(req);
    const conv = inboxRepo.getConversation(ctx.orgId, Id.parse(req.params).id);
    if (!conv) throw notFound("conversation");
    const ch = channelsRepo.get(ctx.orgId, conv.channelId);
    return { ...conv, channelName: ch?.name ?? "?", provider: ch?.provider ?? null, messages: inboxRepo.messages(conv.id) };
  });

  app.patch("/api/inbox/conversations/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "editor");
    const { id } = Id.parse(req.params);
    const body = z
      .object({ mode: z.enum(["auto", "manual"]).optional(), status: z.enum(["open", "closed"]).optional(), read: z.boolean().optional(), assignedTo: z.string().nullable().optional() })
      .parse(req.body ?? {});
    const conv = inboxRepo.getConversation(ctx.orgId, id);
    if (!conv) throw notFound("conversation");
    if (body.mode) inboxRepo.setMode(id, body.mode);
    if (body.status) inboxRepo.setStatus(id, body.status);
    if (body.read) inboxRepo.markRead(id);
    if (body.assignedTo !== undefined) {
      if (body.assignedTo && !membershipsRepo.get(ctx.orgId, body.assignedTo)) throw notFound("user");
      inboxRepo.assign(id, body.assignedTo);
    }
    return inboxRepo.getConversation(ctx.orgId, id);
  });

  /* Kişi kartı */
  app.get("/api/inbox/conversations/:id/contact", async (req) => getContact(ctxOf(req), Id.parse(req.params).id));

  app.put("/api/inbox/conversations/:id/contact", async (req) => updateContact(ctxOf(req), Id.parse(req.params).id, ContactPatchSchema.parse(req.body ?? {})));

  app.post("/api/inbox/conversations/:id/reply", async (req) => {
    const { text } = z.object({ text: z.string().min(1).max(4000) }).parse(req.body);
    const msg = await replyToConversation(ctxOf(req), Id.parse(req.params).id, text);
    if (msg.status === "failed") throw new AppError(502, "err.validation", { detail: msg.error ?? "send failed" }, { message: msg });
    return msg;
  });

  app.post("/api/inbox/conversations/:id/ai-draft", async (req) => {
    const ctx = ctxOf(req);
    const conv = inboxRepo.getConversation(ctx.orgId, Id.parse(req.params).id);
    if (!conv) throw notFound("conversation");
    const ch = channelsRepo.get(ctx.orgId, conv.channelId);
    const { instructions } = z.object({ instructions: z.string().max(2000).optional() }).parse(req.body ?? {});
    return draftReply(ctx.orgId, { platform: ch?.provider ?? "instagram", participantName: conv.participantName, history: inboxRepo.messages(conv.id, 40), ruleInstructions: instructions ?? null });
  });

  app.post("/api/inbox/summary", async (req) => {
    const ctx = ctxOf(req);
    if (!aiAvailable(ctx.orgId)) throw new AppError(400, "ai.disabled");
    const channels = new Map(channelsRepo.list(ctx.orgId).map((c) => [c.id, c]));
    const convs = inboxRepo.listConversations(ctx.orgId, { status: "open", limit: 40 });
    if (!convs.length) return { summary: ctx.locale === "en" ? "No open conversations." : "Açık konuşma yok." };
    const summary = await summarizeConversations(
      ctx.orgId,
      convs.map((c) => ({ name: c.participantName ?? c.participantId, platform: channels.get(c.channelId)?.provider ?? "?", lastMessage: c.lastMessagePreview ?? "", unread: c.unread })),
    );
    return { summary };
  });

  /** Test: bir kanala sahte gelen mesaj enjekte eder (kuralları denemek için) */
  app.post("/api/inbox/simulate", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const body = z.object({ channelId: z.string(), text: z.string().min(1).max(2000), participantId: z.string().max(80).default("test-user"), participantName: z.string().max(80).default("Test") }).parse(req.body);
    const ch = channelsRepo.get(ctx.orgId, body.channelId);
    if (!ch) throw notFound("channel");
    await handleInbound(
      ch.provider,
      { accountExternalId: ch.externalId, conversationExternalId: `sim:${body.participantId}`, participantId: body.participantId, participantName: body.participantName, externalMessageId: null, text: body.text },
      ch.id,
    );
    return { ok: true };
  });

  /* ---------------- Oto-yanıt kuralları ---------------- */

  app.get("/api/rules", async (req) => rulesRepo.list(ctxOf(req).orgId));

  app.post("/api/rules", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    assertFeature(ctx.orgId, "inbox");
    const body = RuleSchema.parse(req.body) as RuleInput;
    if (body.replyMode === "ai") assertFeature(ctx.orgId, "aiReplies");
    return rulesRepo.create(ctx.orgId, body);
  });

  app.put("/api/rules/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    const r = rulesRepo.update(ctx.orgId, Id.parse(req.params).id, RulePatchSchema.parse(req.body) as Partial<RuleInput>);
    if (!r) throw notFound("rule");
    return r;
  });

  app.delete("/api/rules/:id", async (req) => {
    const ctx = ctxOf(req);
    requireRole(ctx, "admin");
    rulesRepo.remove(ctx.orgId, Id.parse(req.params).id);
    return { ok: true };
  });

  /* ---------------- Yorumdan DM'e kuralları ---------------- */

  app.get("/api/comment-rules", async (req) => listCommentRules(ctxOf(req)));

  app.post("/api/comment-rules", async (req) => createCommentRule(ctxOf(req), CommentRuleSchema.parse(req.body) as CommentRuleInput));

  app.put("/api/comment-rules/:id", async (req) =>
    updateCommentRule(ctxOf(req), Id.parse(req.params).id, CommentRulePatchSchema.parse(req.body) as Partial<CommentRuleInput>),
  );

  app.delete("/api/comment-rules/:id", async (req) => {
    deleteCommentRule(ctxOf(req), Id.parse(req.params).id);
    return { ok: true };
  });

  /* ---------------- Sohbet menüsü (ice breakers + sabit menü) ---------------- */

  app.get("/api/channels/:id/dm-profile", async (req) => getDmProfile(ctxOf(req), Id.parse(req.params).id));

  /** Kaydeder ve Meta'ya gönderir; gönderim hatası syncError alanında döner */
  app.put("/api/channels/:id/dm-profile", async (req) => saveDmProfile(ctxOf(req), Id.parse(req.params).id, DmProfileSchema.parse(req.body)));

  app.post("/api/channels/:id/dm-profile/sync", async (req) => resyncDmProfile(ctxOf(req), Id.parse(req.params).id));

  /** Son özel yanıtlar (kuyruk ve gönderim geçmişi) */
  app.get("/api/private-replies", async (req) => {
    const q = z
      .object({ status: z.enum(["queued", "sending", "sent", "failed", "skipped", "expired"]).optional(), ruleId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() })
      .parse(req.query);
    return privateRepliesRepo.list(ctxOf(req).orgId, q);
  });
}
