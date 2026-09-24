import path from "node:path";
import { config } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { channelsRepo } from "../core/repos/channels.js";
import { commentJobsRepo, postsRepo } from "../core/repos/posts.js";
import { activityRepo, mediaRepo } from "../core/repos/misc.js";
import type { Channel, Post, PostTarget, Recurrence } from "../core/types.js";
import { getProvider, ProviderError, type PublishMedia } from "../providers/index.js";
import { emailFailure, emitWebhook, notify, orgT } from "./notify.js";

const log = createLogger("publisher");
export const MAX_ATTEMPTS = 3;

export function mediaPublicUrl(filename: string): string {
  return `${config.publicUrl}/media/${encodeURIComponent(filename)}`;
}

export function resolveMedia(orgId: string, ids: string[]): PublishMedia[] {
  return mediaRepo.getMany(orgId, ids).map((m) => ({
    ...m,
    localPath: path.join(config.mediaDir, m.filename),
    publicUrl: mediaPublicUrl(m.filename),
  }));
}

/** Token süresi dolmak üzereyse yeniler; başarısızsa kanalı 'expired' işaretler */
export async function ensureFreshToken(channel: Channel): Promise<Channel> {
  const provider = getProvider(channel.provider);
  if (!channel.tokenExpiresAt || !provider.refreshToken) return channel;
  const msLeft = new Date(channel.tokenExpiresAt).getTime() - Date.now();
  if (msLeft > 10 * 60_000) return channel;
  try {
    const refreshed = await provider.refreshToken(channel);
    if (!refreshed) return channel;
    channelsRepo.updateTokens(channel.id, refreshed.accessToken, refreshed.refreshToken ?? null, refreshed.tokenExpiresAt ?? null);
    log.info("token yenilendi", { channel: channel.id, provider: channel.provider });
    return channelsRepo.getById(channel.id) ?? channel;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    channelsRepo.setStatus(channel.id, "expired", msg);
    activityRepo.add(channel.orgId, "error", "token", `${channel.name}: ${msg}`, { channelId: channel.id });
    notify(channel.orgId, { kind: "error", title: orgT(channel.orgId, "notif.token_expired", { channel: channel.name }), body: msg, link: "/app/channels" });
    emitWebhook(channel.orgId, "channel.error", { channelId: channel.id, name: channel.name, provider: channel.provider, error: msg });
    throw new ProviderError(`Token yenilenemedi: ${msg}`);
  }
}

function isAuthError(e: unknown, msg: string): boolean {
  return e instanceof ProviderError && (e.status === 401 || /OAuth|invalid_grant|expired|kod 190|Unauthorized/i.test(msg));
}

async function publishTarget(post: Post, target: PostTarget): Promise<void> {
  const channel0 = channelsRepo.getById(target.channelId);
  if (!channel0 || channel0.orgId !== post.orgId) {
    postsRepo.updateTarget(target.id, { status: "failed", error: "Kanal bulunamadı (silinmiş olabilir)", attempts: MAX_ATTEMPTS, nextAttemptAt: null });
    return;
  }
  if (channel0.status === "disabled") {
    postsRepo.updateTarget(target.id, { status: "skipped", error: "Kanal devre dışı" });
    return;
  }
  postsRepo.updateTarget(target.id, { status: "publishing" });
  try {
    const channel = await ensureFreshToken(channel0);
    const provider = getProvider(channel.provider);
    const text = target.content ?? post.content;
    const media = resolveMedia(post.orgId, target.mediaIds ?? post.mediaIds);
    const result = await provider.publish(channel, { kind: post.kind, text, media, settings: target.settings });
    postsRepo.updateTarget(target.id, {
      status: "published",
      externalId: result.externalId,
      externalUrl: result.url ?? null,
      error: null,
      publishedAt: new Date().toISOString(),
      nextAttemptAt: null,
    });
    activityRepo.add(post.orgId, "info", "publish", `${channel.name} (${provider.label}): ${post.kind}`, { postId: post.id, url: result.url ?? null });
    if (channel.status === "error") channelsRepo.setStatus(channel.id, "active", null);

    // İlk yorum / ek yorumlar: kanal ayarı öncelikli, yoksa gönderi geneli
    const comments = Array.isArray(target.settings.comments) ? (target.settings.comments as Post["comments"]) : post.comments;
    if (comments.length && provider.capabilities.comments && provider.publishComment && post.kind !== "story") {
      commentJobsRepo.enqueue(post.orgId, post.id, target.id, comments);
    }
  } catch (e) {
    const attempts = target.attempts + 1;
    const msg = e instanceof Error ? e.message : String(e);
    const retryable = e instanceof ProviderError ? e.retryable : true;
    const willRetry = retryable && attempts < MAX_ATTEMPTS;
    postsRepo.updateTarget(target.id, {
      status: "failed",
      error: msg.slice(0, 1000),
      attempts,
      nextAttemptAt: willRetry ? new Date(Date.now() + Math.pow(2, attempts) * 60_000).toISOString() : null,
    });
    activityRepo.add(post.orgId, "error", "publish", `${channel0.name}: (${attempts}/${MAX_ATTEMPTS}) ${msg}`, { postId: post.id });
    if (isAuthError(e, msg)) {
      channelsRepo.setStatus(channel0.id, "error", msg);
      emitWebhook(post.orgId, "channel.error", { channelId: channel0.id, name: channel0.name, provider: channel0.provider, error: msg });
    }
    if (!willRetry) void emailFailure(post.orgId, channel0.name, msg, post.id);
    log.warn("hedef yayınlanamadı", { target: target.id, msg });
  }
}

function nextOccurrence(from: Date, r: Recurrence): Date {
  const d = new Date(from);
  if (r.unit === "day") d.setUTCDate(d.getUTCDate() + r.every);
  else if (r.unit === "week") d.setUTCDate(d.getUTCDate() + 7 * r.every);
  else d.setUTCMonth(d.getUTCMonth() + r.every);
  return d;
}

/** Tekrarlayan gönderi: yayın bittikten sonra bir sonraki kopyayı planla */
function scheduleRecurrence(post: Post): void {
  const r = post.recurrence;
  if (!r || !post.publishAt || r.every < 1) return;
  if (r.remaining !== undefined && r.remaining !== null && r.remaining <= 0) return;
  let next = nextOccurrence(new Date(post.publishAt), r);
  // Geçmişte kaldıysa ileriye taşı
  let guard = 0;
  while (next.getTime() < Date.now() && guard++ < 500) next = nextOccurrence(next, r);
  if (r.until && next.getTime() > new Date(r.until).getTime()) return;
  const remaining = r.remaining === undefined || r.remaining === null ? null : r.remaining - 1;
  postsRepo.create({
    orgId: post.orgId,
    title: post.title,
    kind: post.kind,
    content: post.content,
    mediaIds: post.mediaIds,
    publishAt: next.toISOString(),
    status: "scheduled",
    source: "recurrence",
    createdBy: post.createdBy,
    campaignId: post.campaignId,
    tags: post.tags,
    comments: post.comments,
    recurrence: { ...r, remaining },
    notes: post.notes,
    targets: post.targets.map((t) => ({ channelId: t.channelId, content: t.content, mediaIds: t.mediaIds, settings: t.settings })),
  });
  // Eski kopya artık tekrar etmesin (zincir yeni kopyada devam eder)
  postsRepo.update(post.orgId, post.id, { recurrence: null });
}

/** Bir gönderinin bekleyen/başarısız hedeflerini yayınlar ve gönderi durumunu günceller */
export async function publishPost(postId: string): Promise<Post | null> {
  const post = postsRepo.getById(postId);
  if (!post) return null;
  const pending = post.targets.filter((t) => t.status === "pending" || (t.status === "failed" && t.nextAttemptAt && t.attempts < MAX_ATTEMPTS));
  if (post.status !== "publishing") postsRepo.setStatus(post.id, "publishing");
  // Hedefler paralel yayınlanır (platformlar birbirinden bağımsız)
  await Promise.all(pending.map((t) => publishTarget(post, t)));

  const fresh = postsRepo.getById(postId)!;
  const statuses = fresh.targets.map((t) => t.status);
  const allDone = statuses.every((s) => s === "published" || s === "skipped");
  const anyPublished = statuses.some((s) => s === "published");
  const anyRetryPending = fresh.targets.some((t) => t.status === "failed" && t.nextAttemptAt);
  const summary = {
    postId,
    title: fresh.title,
    kind: fresh.kind,
    targets: fresh.targets.map((t) => ({ channelId: t.channelId, status: t.status, url: t.externalUrl, error: t.error })),
  };
  const link = `/app/posts/${postId}`;

  if (allDone) {
    postsRepo.setStatus(post.id, "published", new Date().toISOString());
    emitWebhook(post.orgId, "post.published", summary);
    scheduleRecurrence(fresh);
  } else if (anyPublished) {
    postsRepo.setStatus(post.id, "partial");
    if (!anyRetryPending) {
      notify(post.orgId, { kind: "warning", title: orgT(post.orgId, "notif.publish_partial"), body: fresh.title ?? fresh.content.slice(0, 120), link });
      emitWebhook(post.orgId, "post.partial", summary);
    }
  } else {
    postsRepo.setStatus(post.id, "failed");
    if (!anyRetryPending) {
      notify(post.orgId, {
        kind: "error",
        title: orgT(post.orgId, "notif.publish_failed"),
        body: fresh.targets.map((t) => t.error).filter(Boolean).join(" | ").slice(0, 500),
        link,
      });
      emitWebhook(post.orgId, "post.failed", summary);
    }
  }
  return postsRepo.getById(postId);
}

/** Zamanı gelen yorum işlerini çalıştır */
export async function runCommentJobs(limit = 20): Promise<number> {
  const jobs = commentJobsRepo.due(limit);
  for (const job of jobs) {
    const post = postsRepo.getById(job.postId);
    const target = post?.targets.find((t) => t.id === job.targetId);
    if (!post || !target || target.status !== "published" || !target.externalId) {
      commentJobsRepo.update(job.id, { status: "skipped", error: "Ana gönderi yayınlanmamış" });
      continue;
    }
    const channel = channelsRepo.getById(target.channelId);
    const provider = channel ? getProvider(channel.provider) : null;
    if (!channel || !provider?.publishComment) {
      commentJobsRepo.update(job.id, { status: "skipped", error: "Kanal yorum desteklemiyor" });
      continue;
    }
    try {
      const fresh = await ensureFreshToken(channel);
      // Zincir yanıtları (X/Threads/Telegram) bir önceki yoruma bağlanır; diğerleri ana gönderiye
      const chained = channel.provider === "x" || channel.provider === "threads" || channel.provider === "telegram";
      const replyTo = chained ? commentJobsRepo.previousExternalId(job.targetId, job.position) : null;
      const r = await provider.publishComment(fresh, target.externalId, job.text, replyTo);
      commentJobsRepo.update(job.id, { status: "done", externalId: r.externalId, error: null, attempts: job.attempts + 1 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const attempts = job.attempts + 1;
      const retry = attempts < 3 && (!(e instanceof ProviderError) || e.retryable);
      commentJobsRepo.update(job.id, {
        status: retry ? "pending" : "failed",
        error: msg.slice(0, 500),
        attempts,
        runAt: retry ? new Date(Date.now() + attempts * 2 * 60_000).toISOString() : undefined,
      });
      activityRepo.add(post.orgId, "warn", "comment", `${channel.name}: ${msg}`, { postId: post.id });
    }
  }
  return jobs.length;
}
