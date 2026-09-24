import { AppError, notFound, t } from "../core/i18n.js";
import { tx } from "../core/db.js";
import { channelsRepo } from "../core/repos/channels.js";
import { campaignsRepo, postNotesRepo, previewLinksRepo, signaturesRepo, tagsRepo } from "../core/repos/content.js";
import { commentJobsRepo, postsRepo, type ListPostsOptions, type TargetInput } from "../core/repos/posts.js";
import { activityRepo, mediaRepo, postMetricsRepo } from "../core/repos/misc.js";
import { orgSettingsRepo, orgsRepo } from "../core/repos/orgs.js";
import type { Ctx, Post, PostComment, PostKind, PostStatus, Recurrence } from "../core/types.js";
import { getProvider } from "../providers/index.js";
import { splitThread } from "../providers/meta/threads.js";
import { canApprove, requireRole } from "./access.js";
import { assertPostQuota, consumePostQuota } from "./limits.js";
import { emitWebhook, notify, orgT } from "./notify.js";
import { publishPost } from "./publisher.js";
import { SlotAllocator } from "./slots.js";
import { parseFlexibleDate } from "./time.js";

/* ---------------- Girdi tipi ---------------- */

export interface PostTargetInput {
  channelId: string;
  content?: string | null;
  mediaIds?: string[] | null;
  settings?: Record<string, unknown>;
}

export interface PostInput {
  title?: string | null;
  kind?: PostKind;
  content?: string;
  mediaIds?: string[];
  /**
   * null/boş: taslak
   * "now": hemen yayınla
   * "next_slot": kanalların bir sonraki boş paylaşım saatine yerleştir
   * ISO 8601 ya da "YYYY-MM-DD HH:mm" (çalışma alanının saat diliminde)
   */
  publishAt?: string | null;
  /** Açıkça taslak olarak kaydet */
  draft?: boolean;
  targets: PostTargetInput[];
  campaignId?: string | null;
  /** Etiket adları ya da id'leri */
  tags?: string[];
  comments?: PostComment[];
  /** comments'in kısayolu: yayından hemen sonra atılacak ilk yorum */
  firstComment?: string | null;
  recurrence?: Recurrence | null;
  notes?: string | null;
  /** Otomatik imza eklensin mi (varsayılan: evet) */
  applySignature?: boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  publishAt: string | null;
  status: PostStatus;
  perChannel: Array<{ channelId: string; channel: string; provider: string; length: number; maxLength: number; mediaCount: number }>;
}

/* ---------------- Yardımcılar ---------------- */

function sourceOf(ctx: Ctx): Post["source"] {
  return ctx.via === "oauth" || ctx.via === "apikey" ? "mcp" : ctx.via === "system" ? "ai" : "panel";
}

function needsApproval(ctx: Ctx, source: Post["source"]): boolean {
  const mode = orgSettingsRepo.get(ctx.orgId).approvalMode;
  if (mode === "none") return false;
  const fromAi = source === "mcp" || source === "ai" || ctx.via === "oauth" || ctx.via === "apikey";
  if (mode === "ai") return fromAi;
  // "all": yöneticiler panelden kendi gönderilerini onaylamak zorunda değil
  return !canApprove(ctx) || fromAi;
}

function resolveTags(orgId: string, tags: string[] | undefined): string[] {
  if (!tags?.length) return [];
  const out = new Set<string>();
  for (const raw of tags) {
    const v = raw.trim();
    if (!v) continue;
    const byId = tagsRepo.get(orgId, v);
    out.add(byId ? byId.id : tagsRepo.ensure(orgId, v).id);
  }
  return [...out];
}

function normalizeComments(input: PostInput): PostComment[] | undefined {
  const list = [...(input.comments ?? [])];
  if (input.firstComment?.trim()) list.unshift({ text: input.firstComment.trim(), delayMinutes: 0 });
  return input.comments === undefined && !input.firstComment ? undefined : list.map((c) => ({ text: c.text, delayMinutes: Math.max(0, Math.round(c.delayMinutes ?? 0)) }));
}

function applySignature(orgId: string, content: string, apply: boolean | undefined): string {
  if (apply === false) return content;
  const sig = signaturesRepo.autoAdd(orgId);
  if (!sig || !sig.content.trim() || content.includes(sig.content.trim())) return content;
  return content ? `${content}\n\n${sig.content}` : sig.content;
}

/* ---------------- Doğrulama ---------------- */

/**
 * Gönderiyi kaydetmeden doğrular. AI/MCP için "dry run" olarak da kullanılır:
 * her hata tek tek, kanal adıyla ve anlaşılır biçimde döner.
 */
export function validatePost(ctx: Ctx, input: PostInput, allocator?: SlotAllocator): ValidationResult {
  const L = ctx.locale;
  const errors: string[] = [];
  const warnings: string[] = [];
  /** Taslakta uyarı, yayında hata olan eksikler (medya, uzunluk) */
  const soft: string[] = [];
  const perChannel: ValidationResult["perChannel"] = [];
  const kind: PostKind = input.kind ?? "post";
  const content = input.content ?? "";
  const baseMedia = input.mediaIds ?? [];
  const org = orgsRepo.get(ctx.orgId);
  const tz = org?.timezone ?? "Europe/Istanbul";

  if (!input.targets?.length) errors.push(t(L, "post.need_channel"));

  // Medya bu çalışma alanına ait mi
  const allMediaIds = new Set<string>([...baseMedia, ...input.targets.flatMap((x) => x.mediaIds ?? [])]);
  const mediaMap = new Map(mediaRepo.getMany(ctx.orgId, [...allMediaIds]).map((m) => [m.id, m]));
  for (const id of allMediaIds) if (!mediaMap.has(id)) errors.push(t(L, "err.not_found", { what: t(L, "what.media") }) + `: ${id}`);

  const seen = new Set<string>();
  for (const target of input.targets ?? []) {
    if (seen.has(target.channelId)) continue;
    seen.add(target.channelId);
    const ch = channelsRepo.get(ctx.orgId, target.channelId);
    if (!ch) {
      errors.push(t(L, "err.not_found", { what: t(L, "what.channel") }) + `: ${target.channelId}`);
      continue;
    }
    const provider = getProvider(ch.provider);
    const cap = provider.capabilities;
    const text = target.content ?? content;
    const media = (target.mediaIds ?? baseMedia).map((id) => mediaMap.get(id)).filter(Boolean);
    const vars = { channel: ch.name, provider: provider.label, kind };
    perChannel.push({ channelId: ch.id, channel: ch.name, provider: ch.provider, length: text.length, maxLength: cap.maxTextLength, mediaCount: media.length });

    if (ch.status === "disabled" || ch.status === "expired") soft.push(t(L, "post.channel_inactive", { channel: ch.name, status: ch.status }));
    else if (ch.status === "error") warnings.push(t(L, "post.channel_inactive", { channel: ch.name, status: ch.status }));

    const capKey = kind as "post" | "story" | "reel" | "video" | "thread";
    if (cap[capKey] === false) {
      errors.push(t(L, "post.kind_unsupported", vars));
      continue;
    }
    if (!text.trim() && media.length === 0) soft.push(t(L, "post.empty") + ` (${ch.name})`);
    if (kind === "story" && media.length === 0) soft.push(t(L, "post.story_media"));
    if (cap.requiresMedia && media.length === 0) soft.push(t(L, "post.media_required", vars));
    if ((cap.requiresVideo || kind === "reel" || kind === "video") && !media.some((m) => m!.kind === "video")) {
      soft.push(t(L, "post.video_required", vars));
    }
    if (cap.maxMedia && media.length > cap.maxMedia) soft.push(t(L, "post.too_many_media", { channel: ch.name, max: cap.maxMedia }));

    // Metin uzunluğu: zincirde her parça ayrı ölçülür
    const parts = kind === "thread" ? splitThread(text, cap.maxTextLength) : [text];
    for (const p of parts) {
      if (p.length > cap.maxTextLength) {
        soft.push(t(L, "post.too_long", { channel: ch.name, len: p.length, max: cap.maxTextLength }));
        break;
      }
    }
    if (ch.provider === "youtube" && !String(target.settings?.title ?? "").trim()) warnings.push(t(L, "post.youtube_title", { channel: ch.name }));
    if (ch.provider === "tiktok" && !target.settings?.privacyLevel) warnings.push(`${ch.name}: privacyLevel = PUBLIC_TO_EVERYONE`);
  }

  // Zaman: taslaklar da tarih taşıyabilir (AI tarihli taslak plan kurar, insan onaylar)
  let publishAt: string | null = null;
  const when = input.publishAt ?? null;
  if (when) {
    if (when === "now") {
      publishAt = new Date().toISOString();
    } else if (when === "next_slot") {
      const channelIds = [...seen];
      const alloc = allocator ?? new SlotAllocator(ctx.orgId);
      const slot = channelIds.length ? alloc.find({ channelIds, count: 1 })[0] : undefined;
      if (!slot) errors.push(t(L, "post.no_slot"));
      else publishAt = slot.at;
    } else {
      const d = parseFlexibleDate(when, tz);
      if (!d) errors.push(t(L, "post.date_invalid", { value: when }));
      else {
        if (d.getTime() < Date.now() - 60_000) {
          if (input.draft) warnings.push(t(L, "post.date_past"));
          else errors.push(t(L, "post.date_past"));
        }
        publishAt = d.toISOString();
        allocator?.reserve([...seen], d.getTime());
      }
    }
  }
  const status: PostStatus = !publishAt || input.draft ? "draft" : needsApproval(ctx, sourceOf(ctx)) ? "pending_approval" : "scheduled";
  if (status === "draft") warnings.push(...soft);
  else errors.push(...soft);

  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], publishAt, status, perChannel };
}

/* ---------------- Oluşturma ---------------- */

function toTargets(input: PostInput): TargetInput[] {
  const seen = new Set<string>();
  return input.targets
    .filter((x) => (seen.has(x.channelId) ? false : (seen.add(x.channelId), true)))
    .map((x) => ({ channelId: x.channelId, content: x.content ?? null, mediaIds: x.mediaIds ?? null, settings: x.settings ?? {} }));
}

export async function createPost(ctx: Ctx, input: PostInput, opts: { allocator?: SlotAllocator; skipPublish?: boolean } = {}): Promise<Post> {
  requireRole(ctx, "editor");
  const v = validatePost(ctx, input, opts.allocator);
  if (!v.ok) throw new AppError(400, "err.validation", { detail: v.errors.join(" | ") }, { errors: v.errors, warnings: v.warnings });
  if (input.campaignId && !campaignsRepo.get(ctx.orgId, input.campaignId)) throw notFound("campaign");
  if (v.status !== "draft") consumePostQuota(ctx.orgId, 1);

  const post = postsRepo.create({
    orgId: ctx.orgId,
    title: input.title ?? null,
    kind: input.kind ?? "post",
    content: applySignature(ctx.orgId, input.content ?? "", input.applySignature),
    mediaIds: input.mediaIds ?? [],
    publishAt: v.publishAt,
    status: v.status,
    source: sourceOf(ctx),
    createdBy: ctx.userId,
    campaignId: input.campaignId ?? null,
    tags: resolveTags(ctx.orgId, input.tags),
    comments: normalizeComments(input) ?? [],
    recurrence: input.recurrence ?? null,
    notes: input.notes ?? null,
    targets: toTargets(input),
  });
  if (post.campaignId) campaignsRepo.refreshRange(ctx.orgId, post.campaignId);
  activityRepo.add(ctx.orgId, "info", "post", `${post.kind} · ${post.status}${ctx.clientName ? ` · ${ctx.clientName}` : ""}`, { postId: post.id });
  afterStatusChange(ctx, post);

  if (input.publishAt === "now" && post.status === "scheduled" && !opts.skipPublish) {
    postsRepo.setStatus(post.id, "publishing");
    return (await publishPost(post.id)) ?? post;
  }
  return post;
}

function afterStatusChange(ctx: Ctx, post: Post): void {
  if (post.status === "pending_approval") {
    notify(ctx.orgId, {
      kind: "warning",
      title: orgT(ctx.orgId, "notif.pending_approval", { title: post.title ?? post.content.slice(0, 60) }),
      body: ctx.clientName ? `${ctx.clientName}` : null,
      link: `/app/posts/${post.id}`,
    });
  }
  if (post.status === "scheduled") emitWebhook(ctx.orgId, "post.scheduled", { postId: post.id, publishAt: post.publishAt, kind: post.kind });
}

/* ---------------- Toplu oluşturma (AI içerik planı) ---------------- */

export interface BulkResult {
  ok: boolean;
  dryRun: boolean;
  campaignId: string | null;
  created: number;
  items: Array<{ index: number; ok: boolean; errors: string[]; warnings: string[]; publishAt: string | null; status: PostStatus; postId?: string }>;
}

export async function bulkCreatePosts(
  ctx: Ctx,
  items: PostInput[],
  opts: { dryRun?: boolean; atomic?: boolean; campaign?: { name: string; goal?: string | null; brief?: string | null } | null; campaignId?: string | null } = {},
): Promise<BulkResult> {
  requireRole(ctx, "editor");
  const atomic = opts.atomic !== false;
  const allocator = new SlotAllocator(ctx.orgId);
  const checks = items.map((item, index) => ({ index, item, v: validatePost(ctx, item, allocator) }));
  const nonDraft = checks.filter((c) => c.v.ok && c.v.status !== "draft").length;
  const quotaError = (() => {
    try {
      assertPostQuota(ctx.orgId, nonDraft);
      return null;
    } catch (e) {
      return e instanceof AppError ? e.localized(ctx.locale) : String(e);
    }
  })();

  const results: BulkResult["items"] = checks.map((c) => ({
    index: c.index,
    ok: c.v.ok,
    errors: c.v.errors,
    warnings: c.v.warnings,
    publishAt: c.v.publishAt,
    status: c.v.status,
  }));
  const allValid = checks.every((c) => c.v.ok) && !quotaError;
  if (quotaError) results.forEach((r) => r.errors.push(quotaError));

  if (opts.dryRun || (atomic && !allValid)) {
    return { ok: allValid, dryRun: Boolean(opts.dryRun), campaignId: opts.campaignId ?? null, created: 0, items: results };
  }

  let campaignId = opts.campaignId ?? null;
  if (campaignId && !campaignsRepo.get(ctx.orgId, campaignId)) throw notFound("campaign");
  if (!campaignId && opts.campaign?.name) {
    campaignId = campaignsRepo.create(ctx.orgId, {
      name: opts.campaign.name,
      goal: opts.campaign.goal ?? null,
      brief: opts.campaign.brief ?? null,
      source: sourceOf(ctx),
      createdBy: ctx.userId,
    }).id;
  }

  let created = 0;
  tx(() => {
    for (const c of checks) {
      if (!c.v.ok) continue;
      if (c.v.status !== "draft") consumePostQuota(ctx.orgId, 1);
      const post = postsRepo.create({
        orgId: ctx.orgId,
        title: c.item.title ?? null,
        kind: c.item.kind ?? "post",
        content: applySignature(ctx.orgId, c.item.content ?? "", c.item.applySignature),
        mediaIds: c.item.mediaIds ?? [],
        publishAt: c.v.publishAt,
        status: c.v.status === "scheduled" && c.item.publishAt === "now" ? "scheduled" : c.v.status,
        source: sourceOf(ctx),
        createdBy: ctx.userId,
        campaignId: campaignId ?? c.item.campaignId ?? null,
        tags: resolveTags(ctx.orgId, c.item.tags),
        comments: normalizeComments(c.item) ?? [],
        recurrence: c.item.recurrence ?? null,
        notes: c.item.notes ?? null,
        targets: toTargets(c.item),
      });
      results[c.index].postId = post.id;
      created++;
    }
  });
  if (campaignId) campaignsRepo.refreshRange(ctx.orgId, campaignId);
  const pending = results.filter((r) => r.postId && r.status === "pending_approval").length;
  if (pending) notify(ctx.orgId, { kind: "warning", title: orgT(ctx.orgId, "notif.pending_approval", { title: `${pending}×` }), link: "/app/posts?status=pending_approval" });
  activityRepo.add(ctx.orgId, "info", "post", `bulk: ${created}/${items.length}${ctx.clientName ? ` · ${ctx.clientName}` : ""}`, { campaignId });
  return { ok: allValid, dryRun: false, campaignId, created, items: results };
}

/* ---------------- Okuma ---------------- */

export function listPosts(ctx: Ctx, opts: ListPostsOptions = {}): Post[] {
  return postsRepo.list(ctx.orgId, opts);
}

export function getPostDetail(ctx: Ctx, id: string) {
  const post = postsRepo.get(ctx.orgId, id);
  if (!post) throw notFound("post");
  const metrics = postMetricsRepo.getMany(post.targets.map((x) => x.id));
  return {
    ...post,
    targets: post.targets.map((x) => ({ ...x, metrics: metrics.get(x.id)?.metrics ?? null })),
    notesList: postNotesRepo.list(post.id),
    commentJobs: commentJobsRepo.forPost(post.id),
    previewLinks: previewLinksRepo.forPost(ctx.orgId, post.id),
  };
}

/* ---------------- Güncelleme ---------------- */

export async function updatePost(ctx: Ctx, id: string, patch: Partial<PostInput>): Promise<Post> {
  requireRole(ctx, "editor");
  const cur = postsRepo.get(ctx.orgId, id);
  if (!cur) throw notFound("post");
  if (cur.status === "publishing") throw new AppError(409, "post.publishing_locked");

  // Yayınlanmış gönderide sadece meta alanlar değişir
  if (cur.status === "published" || cur.status === "partial") {
    const updated = postsRepo.update(ctx.orgId, id, {
      title: patch.title,
      tags: patch.tags ? resolveTags(ctx.orgId, patch.tags) : undefined,
      notes: patch.notes,
      campaignId: patch.campaignId,
    })!;
    return updated;
  }

  const merged: PostInput = {
    title: patch.title === undefined ? cur.title : patch.title,
    kind: patch.kind ?? cur.kind,
    content: patch.content ?? cur.content,
    mediaIds: patch.mediaIds ?? cur.mediaIds,
    publishAt: patch.publishAt === undefined ? cur.publishAt : patch.publishAt,
    draft: patch.draft,
    targets: patch.targets ?? cur.targets.map((x) => ({ channelId: x.channelId, content: x.content, mediaIds: x.mediaIds, settings: x.settings })),
    campaignId: patch.campaignId === undefined ? cur.campaignId : patch.campaignId,
    tags: patch.tags,
    comments: patch.comments ?? (patch.firstComment !== undefined ? undefined : cur.comments),
    firstComment: patch.firstComment,
    recurrence: patch.recurrence === undefined ? cur.recurrence : patch.recurrence,
    notes: patch.notes === undefined ? cur.notes : patch.notes,
  };
  const wasInactive = cur.status === "draft" || cur.status === "failed" || cur.status === "cancelled";
  if (patch.publishAt === undefined && patch.draft === undefined) {
    if (wasInactive) {
      // Taslak/başarısız gönderi düzenlenince kendiliğinden yayına girmesin
      merged.draft = true;
    } else if (cur.publishAt && new Date(cur.publishAt).getTime() < Date.now()) {
      // Tarihi geçmiş planlı gönderi: hemen sıraya al
      merged.publishAt = "now";
    }
  }
  const v = validatePost(ctx, merged);
  if (!v.ok) throw new AppError(400, "err.validation", { detail: v.errors.join(" | ") }, { errors: v.errors, warnings: v.warnings });
  let status = v.status;
  // Onay bekleyen gönderi değişince yine onay bekler; yönetici düzenlerse de onayı ayrı adımda verir
  if (cur.status === "pending_approval" && status === "scheduled") status = "pending_approval";
  if (wasInactive && status !== "draft") consumePostQuota(ctx.orgId, 1);

  const updated = postsRepo.update(ctx.orgId, id, {
    title: merged.title,
    kind: merged.kind,
    content: merged.content,
    mediaIds: merged.mediaIds,
    publishAt: v.publishAt,
    status,
    targets: patch.targets ? toTargets(merged) : cur.status === "failed" ? toTargets(merged) : undefined,
    campaignId: merged.campaignId,
    tags: patch.tags ? resolveTags(ctx.orgId, patch.tags) : undefined,
    comments: normalizeComments(merged),
    recurrence: merged.recurrence,
    notes: merged.notes,
    rejectionReason: status !== "draft" ? null : undefined,
  })!;
  if (updated.campaignId) campaignsRepo.refreshRange(ctx.orgId, updated.campaignId);
  if (status !== cur.status) afterStatusChange(ctx, updated);
  if (patch.publishAt === "now" && updated.status === "scheduled") {
    postsRepo.setStatus(id, "publishing");
    return (await publishPost(id)) ?? updated;
  }
  return updated;
}

/** Takvimde sürükle-bırak ve MCP için sadece tarihi değiştir */
export async function reschedulePost(ctx: Ctx, id: string, publishAt: string): Promise<Post> {
  return updatePost(ctx, id, { publishAt });
}

export async function publishNow(ctx: Ctx, id: string): Promise<Post> {
  requireRole(ctx, "editor");
  const post = postsRepo.get(ctx.orgId, id);
  if (!post) throw notFound("post");
  if (post.status === "publishing") throw new AppError(409, "post.already_publishing");
  if (post.status === "pending_approval" && !canApprove(ctx)) throw new AppError(403, "err.forbidden");
  if (post.status === "draft" || post.status === "cancelled") consumePostQuota(ctx.orgId, 1);
  postsRepo.resetTargetsForRetry(id);
  postsRepo.update(ctx.orgId, id, { publishAt: new Date().toISOString(), status: "scheduled", rejectionReason: null });
  postsRepo.setStatus(id, "publishing");
  activityRepo.add(ctx.orgId, "info", "post", `publish now${ctx.clientName ? ` · ${ctx.clientName}` : ""}`, { postId: id });
  return (await publishPost(id)) ?? post;
}

export function cancelPost(ctx: Ctx, id: string): Post {
  requireRole(ctx, "editor");
  const post = postsRepo.get(ctx.orgId, id);
  if (!post) throw notFound("post");
  if (post.status !== "scheduled" && post.status !== "pending_approval") throw new AppError(400, "post.only_scheduled_cancel");
  postsRepo.setStatus(id, "draft");
  return postsRepo.get(ctx.orgId, id)!;
}

export async function approvePost(ctx: Ctx, id: string): Promise<Post> {
  if (!canApprove(ctx)) throw new AppError(403, "err.forbidden");
  const post = postsRepo.get(ctx.orgId, id);
  if (!post) throw notFound("post");
  if (post.status !== "pending_approval") throw new AppError(400, "post.not_pending_approval");
  const due = !post.publishAt || new Date(post.publishAt).getTime() <= Date.now();
  postsRepo.update(ctx.orgId, id, { status: "scheduled", publishAt: due ? new Date().toISOString() : post.publishAt, rejectionReason: null });
  activityRepo.add(ctx.orgId, "info", "approval", `approved`, { postId: id, by: ctx.userId });
  const fresh = postsRepo.get(ctx.orgId, id)!;
  emitWebhook(ctx.orgId, "post.scheduled", { postId: id, publishAt: fresh.publishAt, kind: fresh.kind });
  if (due) {
    postsRepo.setStatus(id, "publishing");
    return (await publishPost(id)) ?? fresh;
  }
  return fresh;
}

export function rejectPost(ctx: Ctx, id: string, reason: string | null): Post {
  if (!canApprove(ctx)) throw new AppError(403, "err.forbidden");
  const post = postsRepo.get(ctx.orgId, id);
  if (!post) throw notFound("post");
  if (post.status !== "pending_approval") throw new AppError(400, "post.not_pending_approval");
  postsRepo.update(ctx.orgId, id, { status: "draft", rejectionReason: reason ?? "" });
  if (reason) postNotesRepo.add(id, { authorUserId: ctx.userId, authorName: "✗", text: reason, source: "team" });
  activityRepo.add(ctx.orgId, "warn", "approval", `rejected`, { postId: id, by: ctx.userId });
  return postsRepo.get(ctx.orgId, id)!;
}

export function deletePost(ctx: Ctx, id: string): void {
  requireRole(ctx, "editor");
  const post = postsRepo.get(ctx.orgId, id);
  if (!post) return;
  if (post.status === "publishing") throw new AppError(409, "post.publishing_locked");
  postsRepo.remove(ctx.orgId, id);
  if (post.campaignId) campaignsRepo.refreshRange(ctx.orgId, post.campaignId);
}

export function duplicatePost(ctx: Ctx, id: string): Post {
  requireRole(ctx, "editor");
  const post = postsRepo.get(ctx.orgId, id);
  if (!post) throw notFound("post");
  return postsRepo.create({
    orgId: ctx.orgId,
    title: post.title ? `${post.title} (${ctx.locale === "en" ? "copy" : "kopya"})` : null,
    kind: post.kind,
    content: post.content,
    mediaIds: post.mediaIds,
    publishAt: null,
    status: "draft",
    source: sourceOf(ctx),
    createdBy: ctx.userId,
    campaignId: post.campaignId,
    tags: post.tags,
    comments: post.comments,
    recurrence: null,
    notes: post.notes,
    targets: post.targets.map((x) => ({ channelId: x.channelId, content: x.content, mediaIds: x.mediaIds, settings: x.settings })),
  });
}

/* ---------------- Takvim (AI için özet görünüm) ---------------- */

export function calendarView(ctx: Ctx, from: string, to: string) {
  const channels = new Map(channelsRepo.list(ctx.orgId).map((c) => [c.id, c]));
  return postsRepo.list(ctx.orgId, { from, to, limit: 1000, order: "asc" }).map((p) => ({
    id: p.id,
    at: p.publishAt,
    status: p.status,
    kind: p.kind,
    title: p.title,
    preview: p.content.slice(0, 120),
    campaignId: p.campaignId,
    channels: p.targets.map((x) => {
      const c = channels.get(x.channelId);
      return { id: x.channelId, name: c?.name ?? "?", provider: c?.provider ?? "?", status: x.status, url: x.externalUrl };
    }),
  }));
}
