import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../core/config.js";
import { AppError } from "../core/i18n.js";
import { campaignsRepo, tagsRepo } from "../core/repos/content.js";
import { inboxRepo } from "../core/repos/inbox.js";
import { mediaRepo, rulesRepo, type RuleInput } from "../core/repos/misc.js";
import { orgSettingsRepo, orgsRepo } from "../core/repos/orgs.js";
import { channelsRepo } from "../core/repos/channels.js";
import { postsRepo } from "../core/repos/posts.js";
import { workflowsRepo, workflowRunsRepo } from "../core/repos/workflows.js";
import type { Ctx, PostStatus } from "../core/types.js";
import { aiAvailable, draftReply, generateContent } from "../ai/index.js";
import { RecurrenceSchema, RulePatchSchema, RuleSchema, PostKindSchema, PlannerSchema } from "../api/schemas.js";
import { requireRole } from "../services/access.js";
import { executeWorkflow } from "../services/workflow-engine.js";
import { analyticsOverview, dashboard } from "../services/analytics.js";
import { listChannels } from "../services/channels.js";
import { replyToConversation } from "../services/dm-engine.js";
import { assertFeature, usageSummary } from "../services/limits.js";
import { importMediaFromUrl, publicMedia } from "../services/media.js";
import { runPlanner, scheduleCampaign } from "../services/planner.js";
import {
  bulkCreatePosts,
  calendarView,
  cancelPost,
  createPost,
  deletePost,
  duplicatePost,
  getPostDetail,
  publishNow,
  reschedulePost,
  updatePost,
  validatePost,
  type PostInput,
} from "../services/posts.js";
import { findFreeSlots, describeSlots } from "../services/slots.js";
import { formatLocal } from "../services/time.js";

/** MCP istemcisine gösterilen genel kullanım talimatı */
export const SERVER_INSTRUCTIONS = `You are connected to a social media scheduling workspace (${config.appName}).
Typical workflow:
1. Call get_workspace_context first: it returns the timezone, current time, channels (ids, platforms, limits), posting times, approval mode and quotas.
2. To plan content, call find_free_slots for the target channels, or use publishAt="next_slot" and the server will place each post into the next free posting time.
3. Place many posts at once with schedule_posts_batch. Run it with dryRun=true first, fix every reported error, then run it again with dryRun=false.
4. Instagram, TikTok and YouTube require media. Pass public image/video URLs in mediaUrls (they are imported) or reuse mediaIds returned earlier. Never invent URLs.
5. publishAt accepts "now", "next_slot", an ISO-8601 timestamp, or "YYYY-MM-DD HH:mm" in the workspace timezone. Omit it (or set draft=true) to save a draft.
6. If the workspace approval mode requires it, posts you create wait for human approval (status pending_approval); tell the user.
Write post texts in the language of the workspace unless the user says otherwise, and respect each platform's character limit.
(TR: Önce get_workspace_context çağır; boş saatleri find_free_slots ile bul; toplu planı schedule_posts_batch ile önce dryRun=true, sonra false olarak gönder.)`;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }] };
}

function fail(ctx: Ctx, e: unknown): ToolResult {
  if (e instanceof AppError) {
    const details = e.details ? `\n${JSON.stringify(e.details)}` : "";
    return { isError: true, content: [{ type: "text", text: `${e.localized(ctx.locale)}${details}` }] };
  }
  return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
}

async function run(ctx: Ctx, fn: () => unknown | Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(ctx, e);
  }
}

/* ---------------- AI dostu gönderi girdisi ---------------- */

const PerChannelShape = z.object({
  channelId: z.string(),
  content: z.string().optional().describe("Platform-specific text overriding the main content"),
  settings: z.record(z.string(), z.unknown()).optional().describe("Platform settings, e.g. YouTube {title, privacyStatus}, TikTok {privacyLevel}"),
  mediaUrls: z.array(z.url()).optional(),
  mediaIds: z.array(z.string()).optional(),
});

const PostShape = {
  channelIds: z.array(z.string()).min(1).describe("Target channel ids from get_workspace_context / list_channels"),
  content: z.string().describe("Main text. For kind=thread separate parts with a line containing only ---"),
  kind: PostKindSchema.optional().describe("post (default) | story | reel | video | thread"),
  publishAt: z.string().optional().describe('"now" | "next_slot" | ISO-8601 | "YYYY-MM-DD HH:mm" (workspace timezone). Omit for a draft.'),
  draft: z.boolean().optional().describe("Save as draft (keeps publishAt as the intended date)"),
  title: z.string().optional().describe("Internal title shown on the calendar"),
  mediaUrls: z.array(z.url()).optional().describe("Public image/video URLs to import and attach"),
  mediaIds: z.array(z.string()).optional().describe("Media ids already in the library"),
  perChannel: z.array(PerChannelShape).optional(),
  settings: z.record(z.string(), z.unknown()).optional().describe("Settings applied to every target channel"),
  tags: z.array(z.string()).optional().describe("Tag names (created if missing)"),
  firstComment: z.string().optional().describe("Comment posted right after publishing (Instagram, Facebook, LinkedIn, X/Threads reply, YouTube)"),
  campaignId: z.string().optional(),
  recurrence: RecurrenceSchema.optional().describe("Repeat after publishing, e.g. {every:1, unit:'week'}"),
  notes: z.string().optional().describe("Internal note for the team"),
};

const PostObject = z.object(PostShape);
type McpPost = z.infer<typeof PostObject>;

async function importUrls(ctx: Ctx, urls: string[] | undefined): Promise<string[]> {
  const ids: string[] = [];
  for (const url of urls ?? []) ids.push((await importMediaFromUrl(ctx, url)).id);
  return ids;
}

async function toPostInput(ctx: Ctx, p: McpPost): Promise<PostInput> {
  const mediaIds = [...(p.mediaIds ?? []), ...(await importUrls(ctx, p.mediaUrls))];
  const targets = [];
  for (const channelId of [...new Set(p.channelIds)]) {
    const o = p.perChannel?.find((x) => x.channelId === channelId);
    const ownMedia = o && (o.mediaIds?.length || o.mediaUrls?.length) ? [...(o.mediaIds ?? []), ...(await importUrls(ctx, o.mediaUrls))] : null;
    targets.push({ channelId, content: o?.content ?? null, mediaIds: ownMedia, settings: { ...(p.settings ?? {}), ...(o?.settings ?? {}) } });
  }
  return {
    title: p.title ?? null,
    kind: p.kind ?? "post",
    content: p.content,
    mediaIds,
    publishAt: p.publishAt ?? null,
    draft: p.draft,
    targets,
    campaignId: p.campaignId ?? null,
    tags: p.tags,
    firstComment: p.firstComment ?? null,
    recurrence: p.recurrence ?? null,
    notes: p.notes ?? null,
  };
}

function compactPost(p: ReturnType<typeof postsRepo.get> & object, channelNames: Map<string, string>) {
  return {
    id: p.id,
    status: p.status,
    kind: p.kind,
    title: p.title,
    publishAt: p.publishAt,
    content: p.content.length > 400 ? p.content.slice(0, 400) + "…" : p.content,
    media: p.mediaIds.length,
    campaignId: p.campaignId,
    targets: p.targets.map((t) => ({ channelId: t.channelId, channel: channelNames.get(t.channelId) ?? "?", status: t.status, url: t.externalUrl, error: t.error })),
  };
}

/* ---------------- Kayıt ---------------- */

export function buildMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer({ name: "sosyalpilot", title: config.appName, version: "2.0.0" }, { instructions: SERVER_INSTRUCTIONS });
  const names = () => new Map(channelsRepo.list(ctx.orgId).map((c) => [c.id, c.name]));

  /* ----- Bağlam ----- */

  server.registerTool(
    "get_workspace_context",
    {
      title: "Workspace context · Çalışma alanı bilgisi",
      description:
        "Call this first. Returns workspace name, timezone, current local time, connected channels with their limits and preferred posting times, approval mode, quotas and whether the built-in AI is available. (TR: Önce bunu çağır; kanallar, saat dilimi, kotalar.)",
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(ctx, () => {
        const org = orgsRepo.get(ctx.orgId)!;
        const s = orgSettingsRepo.get(ctx.orgId);
        const usage = usageSummary(ctx.orgId);
        return {
          workspace: { id: org.id, name: org.name, timezone: org.timezone, language: org.locale },
          now: { iso: new Date().toISOString(), local: formatLocal(new Date(), org.timezone, org.locale) },
          you: { role: ctx.role, connectedAs: ctx.clientName ?? null },
          approvalMode: s.approvalMode,
          defaultPostingTimes: describeSlots(s.defaultTimeSlots),
          minGapMinutes: s.minGapMinutes,
          quotas: { plan: usage.plan.id, posts: usage.posts, ai: usage.ai, channels: usage.channels },
          builtInAi: aiAvailable(ctx.orgId),
          brand: { name: s.brandName || null, voice: s.brandVoice || null, audience: s.brandAudience || null, bannedWords: s.brandBannedWords || null },
          channels: listChannels(ctx).map((c) => ({
            id: c.id,
            name: c.name,
            platform: c.provider,
            username: c.username,
            status: c.status,
            customer: c.customerName,
            postingTimes: c.postingTimes,
            supports: Object.entries(c.capabilities)
              .filter(([k, v]) => ["post", "story", "reel", "video", "thread", "comments"].includes(k) && v === true)
              .map(([k]) => k),
            maxTextLength: c.capabilities.maxTextLength,
            maxMedia: c.capabilities.maxMedia ?? null,
            requiresMedia: Boolean(c.capabilities.requiresMedia),
            requiresVideo: Boolean(c.capabilities.requiresVideo),
          })),
        };
      }),
  );

  server.registerTool(
    "list_channels",
    {
      title: "List channels · Kanalları listele",
      description: "Full details of connected channels including platform-specific setting fields (e.g. YouTube title/privacy, TikTok privacyLevel) and media notes. (TR: Kanal detayları ve platform ayarları.)",
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(ctx, () =>
        listChannels(ctx).map((c) => ({
          id: c.id,
          name: c.name,
          platform: c.provider,
          status: c.status,
          lastError: c.lastError,
          postingTimes: c.postingTimes,
          capabilities: c.capabilities,
          settingFields: c.settingFields.map((f) => ({ key: f.key, type: f.type, options: f.options?.map((o) => o.value), appliesTo: f.appliesTo, default: f.default })),
        })),
      ),
  );

  server.registerTool(
    "find_free_slots",
    {
      title: "Find free time slots · Boş saat bul",
      description:
        "Returns upcoming free posting times for the given channels, based on each channel's preferred posting times and already scheduled posts (keeps a minimum gap). Use the returned 'at' values as publishAt. (TR: Kanalların boş paylaşım saatleri.)",
      inputSchema: {
        channelIds: z.array(z.string()).min(1),
        count: z.number().int().min(1).max(50).optional().describe("How many slots (default 10)"),
        days: z.number().int().min(1).max(60).optional().describe("How far ahead to look (default 30)"),
        from: z.string().optional().describe("ISO start (default now)"),
        weekdays: z.array(z.number().int().min(0).max(6)).optional().describe("Only these weekdays, 0=Sunday"),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => run(ctx, () => findFreeSlots({ orgId: ctx.orgId, channelIds: a.channelIds, count: a.count ?? 10, days: a.days, from: a.from ? new Date(a.from) : undefined, weekdays: a.weekdays })),
  );

  /* ----- Gönderiler ----- */

  server.registerTool(
    "validate_post",
    {
      title: "Validate post (dry run) · Gönderiyi doğrula",
      description:
        "Checks a post without saving it: character limits, required media, supported post types, date. Returns errors, warnings and the resolved publish time. Media URLs are imported and their mediaIds returned so you can reuse them. (TR: Kaydetmeden kontrol.)",
      inputSchema: PostShape,
      annotations: { readOnlyHint: false },
    },
    async (a) =>
      run(ctx, async () => {
        const input = await toPostInput(ctx, a);
        return { ...validatePost(ctx, input), mediaIds: input.mediaIds };
      }),
  );

  server.registerTool(
    "schedule_post",
    {
      title: "Schedule post · Gönderi planla",
      description:
        'Creates one post (feed post, story, reel, video or thread) for one or more channels. publishAt="now" publishes immediately, "next_slot" uses the next free posting time, an explicit time schedules it, omitted = draft. (TR: Tek gönderi oluştur/planla.)',
      inputSchema: PostShape,
    },
    async (a) =>
      run(ctx, async () => {
        const post = await createPost(ctx, await toPostInput(ctx, a));
        return { ...compactPost(post, names()), note: post.status === "pending_approval" ? "Waiting for human approval in the panel." : undefined };
      }),
  );

  server.registerTool(
    "schedule_posts_batch",
    {
      title: "Schedule many posts (content plan) · Toplu planla",
      description:
        "Places a whole content calendar in one call (up to 60 posts). Optionally groups them into a new campaign. Use dryRun=true first: it validates every item and resolves next_slot times without saving. With atomic=true (default) nothing is saved unless every item is valid. (TR: İçerik takvimini tek seferde yerleştir; önce dryRun.)",
      inputSchema: {
        posts: z.array(PostObject).min(1).max(60),
        dryRun: z.boolean().optional().describe("Validate only (default false)"),
        atomic: z.boolean().optional().describe("All-or-nothing (default true)"),
        campaignName: z.string().optional().describe("Create a campaign with this name and attach all posts"),
        campaignGoal: z.string().optional(),
        campaignId: z.string().optional().describe("Attach to an existing campaign instead"),
      },
    },
    async (a) =>
      run(ctx, async () => {
        const inputs: PostInput[] = [];
        for (const p of a.posts) inputs.push(await toPostInput(ctx, p));
        const r = await bulkCreatePosts(ctx, inputs, {
          dryRun: a.dryRun,
          atomic: a.atomic,
          campaignId: a.campaignId ?? null,
          campaign: a.campaignName ? { name: a.campaignName, goal: a.campaignGoal ?? null } : null,
        });
        return {
          ...r,
          items: r.items.map((it, i) => ({ ...it, mediaIds: inputs[i].mediaIds?.length ? inputs[i].mediaIds : undefined })),
          hint: r.dryRun && r.ok ? "All valid. Call again with dryRun=false (reuse the mediaIds instead of mediaUrls)." : undefined,
        };
      }),
  );

  server.registerTool(
    "get_calendar",
    {
      title: "Calendar · Takvim",
      description: "Compact list of posts between two dates (scheduled, drafts, published, failed) with channels and statuses. (TR: Tarih aralığındaki gönderiler.)",
      inputSchema: { from: z.string().describe("ISO date/time"), to: z.string().describe("ISO date/time") },
      annotations: { readOnlyHint: true },
    },
    async (a) => run(ctx, () => calendarView(ctx, new Date(a.from).toISOString(), new Date(a.to).toISOString())),
  );

  server.registerTool(
    "list_posts",
    {
      title: "List posts · Gönderileri listele",
      description: "Filter posts by status (draft, pending_approval, scheduled, publishing, published, partial, failed), campaign, channel, tag or text. (TR: Gönderileri filtrele.)",
      inputSchema: {
        status: z.array(z.enum(["draft", "pending_approval", "scheduled", "publishing", "published", "partial", "failed", "cancelled"])).optional(),
        campaignId: z.string().optional(),
        channelId: z.string().optional(),
        q: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      run(ctx, () => {
        const n = names();
        return postsRepo
          .list(ctx.orgId, { status: a.status as PostStatus[] | undefined, campaignId: a.campaignId, channelId: a.channelId, q: a.q, from: a.from, to: a.to, limit: a.limit ?? 50 })
          .map((p) => compactPost(p, n));
      }),
  );

  server.registerTool(
    "get_post",
    { title: "Post details · Gönderi detayı", description: "Full post with per-channel results, errors, links, metrics, comments queue and team notes.", inputSchema: { postId: z.string() }, annotations: { readOnlyHint: true } },
    async (a) => run(ctx, () => getPostDetail(ctx, a.postId)),
  );

  server.registerTool(
    "update_post",
    {
      title: "Update post · Gönderiyi güncelle",
      description: "Changes text, date, type, channels, media or tags of a draft/scheduled/failed post. Only provided fields change. (TR: Gönderiyi düzenle.)",
      inputSchema: {
        postId: z.string(),
        content: z.string().optional(),
        publishAt: z.string().optional(),
        draft: z.boolean().optional(),
        kind: PostKindSchema.optional(),
        title: z.string().optional(),
        channelIds: z.array(z.string()).optional().describe("Replaces the channel list"),
        mediaIds: z.array(z.string()).optional(),
        mediaUrls: z.array(z.url()).optional(),
        tags: z.array(z.string()).optional(),
        firstComment: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (a) =>
      run(ctx, async () => {
        const extra = await importUrls(ctx, a.mediaUrls);
        const post = await updatePost(ctx, a.postId, {
          content: a.content,
          publishAt: a.publishAt,
          draft: a.draft,
          kind: a.kind,
          title: a.title,
          targets: a.channelIds?.map((channelId) => ({ channelId })),
          mediaIds: a.mediaIds || extra.length ? [...(a.mediaIds ?? []), ...extra] : undefined,
          tags: a.tags,
          firstComment: a.firstComment,
          notes: a.notes,
        });
        return compactPost(post, names());
      }),
  );

  server.registerTool(
    "reschedule_post",
    { title: "Reschedule · Tarihi değiştir", description: 'Moves a post to a new time ("next_slot", ISO or "YYYY-MM-DD HH:mm").', inputSchema: { postId: z.string(), publishAt: z.string() } },
    async (a) => run(ctx, async () => compactPost(await reschedulePost(ctx, a.postId, a.publishAt), names())),
  );

  server.registerTool(
    "publish_now",
    { title: "Publish now · Hemen yayınla", description: "Publishes a draft/scheduled/failed post immediately and returns per-channel results. Failed channels are retried.", inputSchema: { postId: z.string() } },
    async (a) => run(ctx, async () => compactPost(await publishNow(ctx, a.postId), names())),
  );

  server.registerTool(
    "cancel_post",
    { title: "Cancel schedule · Planı iptal et", description: "Turns a scheduled or pending post back into a draft.", inputSchema: { postId: z.string() } },
    async (a) => run(ctx, () => compactPost(cancelPost(ctx, a.postId), names())),
  );

  server.registerTool(
    "duplicate_post",
    { title: "Duplicate · Kopyala", description: "Creates a draft copy of a post (useful for repurposing).", inputSchema: { postId: z.string() } },
    async (a) => run(ctx, () => compactPost(duplicatePost(ctx, a.postId), names())),
  );

  server.registerTool(
    "delete_post",
    {
      title: "Delete post · Gönderiyi sil",
      description: "Deletes a post from the workspace (it stays in the trash for 30 days and can be restored from the panel). Already published content is NOT removed from the social platform.",
      inputSchema: { postId: z.string() },
      annotations: { destructiveHint: true },
    },
    async (a) =>
      run(ctx, () => {
        deletePost(ctx, a.postId);
        return { ok: true };
      }),
  );

  /* ----- Kampanyalar ----- */

  server.registerTool(
    "list_campaigns",
    { title: "Campaigns · Kampanyalar", description: "Campaigns with post counts and next scheduled time.", annotations: { readOnlyHint: true } },
    async () => run(ctx, () => campaignsRepo.list(ctx.orgId)),
  );

  server.registerTool(
    "schedule_campaign",
    {
      title: "Schedule campaign drafts · Kampanyayı planla",
      description: "Schedules every dated draft in a campaign. Drafts without a future date go to the next free slot. Returns which posts could not be scheduled (e.g. missing media).",
      inputSchema: { campaignId: z.string() },
    },
    async (a) => run(ctx, () => scheduleCampaign(ctx, a.campaignId)),
  );

  server.registerTool(
    "ai_plan_campaign",
    {
      title: "Built-in AI planner · Yerleşik AI planlayıcı",
      description:
        "Uses the workspace's built-in AI to write a full content plan from a brief and saves it as dated drafts in a new campaign (mode=draft) or schedules it (mode=schedule). Only useful if you prefer the workspace AI to write the texts; otherwise write them yourself and use schedule_posts_batch.",
      inputSchema: {
        brief: z.string(),
        goal: z.string().optional(),
        tone: z.string().optional(),
        channelIds: z.array(z.string()).min(1),
        days: z.number().int().min(1).max(60).optional(),
        postsPerWeek: z.number().int().min(1).max(21).optional(),
        kinds: z.array(PostKindSchema).optional(),
        startDate: z.string().optional().describe("YYYY-MM-DD"),
        mode: z.enum(["draft", "schedule"]).optional(),
      },
    },
    async (a) => run(ctx, () => runPlanner(ctx, PlannerSchema.parse({ ...a, days: a.days ?? 14, postsPerWeek: a.postsPerWeek ?? 4, mode: a.mode ?? "draft" }))),
  );

  /* ----- Medya ----- */

  server.registerTool(
    "import_media",
    { title: "Import media · Medya içe aktar", description: "Imports a public image/video URL into the media library and returns its id.", inputSchema: { url: z.url(), name: z.string().optional() } },
    async (a) => run(ctx, async () => publicMedia(await importMediaFromUrl(ctx, a.url, a.name))),
  );

  server.registerTool(
    "list_media",
    {
      title: "Media library · Medya kütüphanesi",
      description: "Lists uploaded images and videos (newest first).",
      inputSchema: { kind: z.enum(["image", "video"]).optional(), limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      run(ctx, () => mediaRepo.list(ctx.orgId, { kind: a.kind, limit: a.limit ?? 50 }).map((m) => ({ id: m.id, name: m.originalName, kind: m.kind, mime: m.mime, sizeKb: Math.round(m.size / 1024), altText: m.altText, createdAt: m.createdAt }))),
  );

  server.registerTool(
    "list_tags",
    { title: "Tags · Etiketler", description: "Existing post tags.", annotations: { readOnlyHint: true } },
    async () => run(ctx, () => tagsRepo.list(ctx.orgId).map((t) => ({ id: t.id, name: t.name }))),
  );

  server.registerTool(
    "generate_content",
    {
      title: "Built-in AI copywriter · AI metin üret",
      description: "Uses the workspace's built-in AI (with brand memory) to write platform-specific texts and 3 alternative hooks. Consumes the workspace AI quota.",
      inputSchema: {
        topic: z.string(),
        kind: PostKindSchema.optional(),
        platforms: z.array(z.enum(["instagram", "facebook", "threads", "whatsapp", "x", "linkedin", "tiktok", "youtube", "telegram"])).min(1),
        tone: z.string().optional(),
        goal: z.string().optional(),
      },
    },
    async (a) =>
      run(ctx, () => {
        requireRole(ctx, "editor");
        return generateContent(ctx.orgId, { topic: a.topic, kind: a.kind ?? "post", platforms: a.platforms, tone: a.tone, goal: a.goal });
      }),
  );

  /* ----- Gelen kutusu ----- */

  server.registerTool(
    "list_conversations",
    {
      title: "Inbox · Gelen kutusu",
      description: "DM conversations (Instagram, Messenger, WhatsApp, Telegram, X). needsAttention=true lists only those waiting for a human.",
      inputSchema: { needsAttention: z.boolean().optional(), status: z.enum(["open", "closed"]).optional(), channelId: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      run(ctx, () => {
        const n = names();
        return inboxRepo
          .listConversations(ctx.orgId, { onlyAttention: a.needsAttention, status: a.status, channelId: a.channelId, limit: a.limit ?? 30 })
          .map((c) => ({ id: c.id, channel: n.get(c.channelId) ?? "?", from: c.participantName ?? c.participantId, last: c.lastMessagePreview, lastAt: c.lastMessageAt, unread: c.unread, mode: c.mode, status: c.status, needsAttention: Boolean(c.needsAttention) }));
      }),
  );

  server.registerTool(
    "get_conversation",
    { title: "Conversation · Konuşma", description: "Messages of one conversation.", inputSchema: { conversationId: z.string() }, annotations: { readOnlyHint: true } },
    async (a) =>
      run(ctx, () => {
        const c = inboxRepo.getConversation(ctx.orgId, a.conversationId);
        if (!c) throw new AppError(404, "err.not_found", { what: "what.conversation" });
        return { ...c, messages: inboxRepo.messages(c.id, 60).map((m) => ({ dir: m.direction, by: m.sentBy, text: m.text, at: m.createdAt, status: m.status })) };
      }),
  );

  server.registerTool(
    "reply_conversation",
    { title: "Reply DM · DM yanıtla", description: "Sends a reply through the platform. Keep it short and on-brand.", inputSchema: { conversationId: z.string(), text: z.string().min(1).max(2000) } },
    async (a) => run(ctx, () => replyToConversation(ctx, a.conversationId, a.text)),
  );

  server.registerTool(
    "draft_reply",
    {
      title: "Draft DM reply (built-in AI) · AI yanıt taslağı",
      description: "Asks the workspace AI for an on-brand reply, intent and whether a human should take over. Does not send.",
      inputSchema: { conversationId: z.string(), instructions: z.string().optional() },
    },
    async (a) =>
      run(ctx, () => {
        const c = inboxRepo.getConversation(ctx.orgId, a.conversationId);
        if (!c) throw new AppError(404, "err.not_found", { what: "what.conversation" });
        const ch = channelsRepo.get(ctx.orgId, c.channelId);
        return draftReply(ctx.orgId, { platform: ch?.provider ?? "instagram", participantName: c.participantName, history: inboxRepo.messages(c.id, 40), ruleInstructions: a.instructions ?? null });
      }),
  );

  server.registerTool(
    "set_conversation",
    {
      title: "Conversation mode · Konuşma modu",
      description: "mode=auto lets rules/AI answer; mode=manual means a human handles it. status=closed archives it.",
      inputSchema: { conversationId: z.string(), mode: z.enum(["auto", "manual"]).optional(), status: z.enum(["open", "closed"]).optional(), markRead: z.boolean().optional() },
    },
    async (a) =>
      run(ctx, () => {
        requireRole(ctx, "editor");
        const c = inboxRepo.getConversation(ctx.orgId, a.conversationId);
        if (!c) throw new AppError(404, "err.not_found", { what: "what.conversation" });
        if (a.mode) inboxRepo.setMode(c.id, a.mode);
        if (a.status) inboxRepo.setStatus(c.id, a.status);
        if (a.markRead) inboxRepo.markRead(c.id);
        return inboxRepo.getConversation(ctx.orgId, c.id);
      }),
  );

  /* ----- Oto-yanıt kuralları ----- */

  server.registerTool(
    "list_rules",
    { title: "Auto-reply rules · Oto-yanıt kuralları", description: "DM auto-reply rules in priority order.", annotations: { readOnlyHint: true } },
    async () => run(ctx, () => rulesRepo.list(ctx.orgId)),
  );

  server.registerTool(
    "create_rule",
    {
      title: "Create auto-reply rule · Kural ekle",
      description: "matchType: keyword (comma-separated words), regex, first_contact or any. replyMode template uses replyText ({{name}} placeholder); ai uses aiInstructions. Lower priority runs first.",
      inputSchema: RuleSchema.shape,
    },
    async (a) =>
      run(ctx, () => {
        requireRole(ctx, "admin");
        assertFeature(ctx.orgId, "inbox");
        return rulesRepo.create(ctx.orgId, RuleSchema.parse(a) as RuleInput);
      }),
  );

  server.registerTool(
    "update_rule",
    { title: "Update rule · Kuralı güncelle", description: "Changes only the provided fields of a rule.", inputSchema: { ruleId: z.string(), ...RulePatchSchema.shape } },
    async ({ ruleId, ...rest }) =>
      run(ctx, () => {
        requireRole(ctx, "admin");
        const r = rulesRepo.update(ctx.orgId, ruleId, RulePatchSchema.parse(rest) as Partial<RuleInput>);
        if (!r) throw new AppError(404, "err.not_found", { what: "what.rule" });
        return r;
      }),
  );

  server.registerTool(
    "delete_rule",
    { title: "Delete rule · Kuralı sil", description: "Removes an auto-reply rule.", inputSchema: { ruleId: z.string() }, annotations: { destructiveHint: true } },
    async (a) =>
      run(ctx, () => {
        requireRole(ctx, "admin");
        rulesRepo.remove(ctx.orgId, a.ruleId);
        return { ok: true };
      }),
  );

  /* ----- Analitik ----- */

  server.registerTool(
    "get_analytics",
    {
      title: "Analytics · Analitik",
      description: "Followers per channel, engagement totals, top performing posts and the best posting hours (UTC) for the last N days. Use it to decide what and when to post.",
      inputSchema: { days: z.number().int().min(1).max(365).optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      run(ctx, () => {
        const r = analyticsOverview(ctx.orgId, a.days ?? 30);
        return { ...r, channels: r.channels.map(({ series: _s, ...c }) => c) };
      }),
  );

  server.registerTool(
    "get_dashboard",
    { title: "Dashboard · Panel özeti", description: "Counts, upcoming posts (48h), posts waiting for approval, recent results and quota usage.", annotations: { readOnlyHint: true } },
    async () =>
      run(ctx, () => {
        const d = dashboard(ctx.orgId);
        const n = names();
        return { ...d, upcoming: d.upcoming.map((p) => compactPost(p, n)), pendingApproval: d.pendingApproval.map((p) => compactPost(p, n)), recent: d.recent.map((p) => compactPost(p, n)) };
      }),
  );
  server.registerTool(
    "list_workflows",
    {
      title: "List Automations · İş akışlarını listele",
      description: "Lists all automated workflows in the workspace with their triggers, run counts, and statuses.",
      annotations: { readOnlyHint: true },
    },
    async () => run(ctx, () => workflowsRepo.list(ctx.orgId))
  );

  server.registerTool(
    "get_workflow",
    {
      title: "Get Automation · İş akışı detayı",
      description: "Gets the full definition, trigger and steps of an automated workflow by id.",
      inputSchema: { id: z.string().describe("Workflow id") },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      run(ctx, () => {
        const wf = workflowsRepo.get(ctx.orgId, a.id);
        if (!wf) throw new AppError(404, "err.not_found", { what: "workflow" });
        return wf;
      })
  );

  server.registerTool(
    "create_workflow",
    {
      title: "Create Automation · Yeni iş akışı oluştur",
      description: "Creates an advanced automated workflow with triggers (webhook, post.published, post.failed, message.received, rss, cron) and steps (filter, formatter, ai, sistemler, action_post, action_webhook, action_email, action_notify).",
      inputSchema: {
        name: z.string().describe("Name of the automation"),
        description: z.string().optional().describe("Description of what this workflow does"),
        triggerType: z.enum([
          "webhook.inbound",
          "post.published",
          "post.failed",
          "post.scheduled",
          "message.received",
          "rss.new_item",
          "schedule.cron",
          "manual",
        ]).describe("Trigger event"),
        triggerConfig: z.record(z.string(), z.any()).optional().describe("Trigger configuration (e.g. { rssUrl, channelId, interval })"),
        steps: z.array(
          z.object({
            id: z.string(),
            type: z.enum([
              "filter",
              "formatter",
              "ai",
              "sistemler",
              "delay",
              "action_post",
              "action_reply",
              "action_webhook",
              "action_email",
              "action_notify",
            ]),
            name: z.string(),
            config: z.record(z.string(), z.any()),
          })
        ).describe("Array of workflow steps"),
      },
    },
    async (a) =>
      run(ctx, () => {
        requireRole(ctx, "editor");
        return workflowsRepo.create({
          orgId: ctx.orgId,
          name: a.name,
          description: a.description ?? null,
          triggerType: a.triggerType,
          triggerConfig: a.triggerConfig ?? {},
          steps: a.steps as any,
          createdBy: ctx.userId,
        });
      })
  );

  server.registerTool(
    "toggle_workflow",
    {
      title: "Toggle Automation · İş akışını aç/kapat",
      description: "Enables or disables an automated workflow.",
      inputSchema: { id: z.string().describe("Workflow id") },
    },
    async (a) =>
      run(ctx, () => {
        requireRole(ctx, "editor");
        const wf = workflowsRepo.toggle(ctx.orgId, a.id);
        if (!wf) throw new AppError(404, "err.not_found", { what: "workflow" });
        return { id: wf.id, name: wf.name, enabled: wf.enabled };
      })
  );

  server.registerTool(
    "test_workflow",
    {
      title: "Test Automation · İş akışını test et",
      description: "Runs a test simulation of the automated workflow with a custom sample payload.",
      inputSchema: {
        id: z.string().describe("Workflow id"),
        payload: z.record(z.string(), z.any()).optional().describe("Sample payload object"),
      },
    },
    async (a) =>
      run(ctx, async () => {
        requireRole(ctx, "editor");
        const wf = workflowsRepo.get(ctx.orgId, a.id);
        if (!wf) throw new AppError(404, "err.not_found", { what: "workflow" });
        const sample = a.payload || {
          title: "Test Başlığı",
          text: "Test mesaj içeriği",
          from: "Müşteri Adı",
          body: { topic: "AI ile Sosyal Medya", status: "success" },
        };
        return executeWorkflow(wf, sample, { testMode: true });
      })
  );

  server.registerTool(
    "list_workflow_runs",
    {
      title: "Automation Execution Logs · İş akışı çalışma kayıtları",
      description: "Lists execution history and step-by-step logs for workflows.",
      inputSchema: {
        workflowId: z.string().optional().describe("Filter by specific workflow id"),
        limit: z.number().int().min(1).max(100).optional().describe("Number of logs to return (default 20)"),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      run(ctx, () => workflowRunsRepo.list(ctx.orgId, a.workflowId, a.limit ?? 20))
  );

  /* ----- Hazır komutlar (Claude'da / menüsünde görünür) ----- */

  server.registerPrompt(
    "weekly_plan",
    {
      title: "Plan next week · Gelecek haftayı planla",
      description: "Builds and schedules next week's content across the chosen channels.",
      argsSchema: { topic: z.string().describe("What the week is about"), postsPerChannel: z.string().optional().describe("e.g. 3") },
    },
    ({ topic, postsPerChannel }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Plan next week's social media content about: ${topic}.
1) Call get_workspace_context and get_analytics (days=30).
2) Propose ${postsPerChannel ?? "3"} posts per relevant channel with varied angles and formats; show me the plan as a table (date, channel, type, hook) and wait for my OK.
3) After I approve, call schedule_posts_batch with dryRun=true, fix issues, then dryRun=false with campaignName "${topic.slice(0, 40)}". Use publishAt="next_slot" unless a specific time matters.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "inbox_triage",
    { title: "Triage inbox · Gelen kutusunu ayıkla", description: "Summarizes conversations that need a human and drafts replies." },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Call list_conversations with needsAttention=true. For each one, read it with get_conversation, summarize the customer's need in one line and propose a reply. Do not send anything until I confirm each reply.",
          },
        },
      ],
    }),
  );

  return server;
}

export type { McpServer };
