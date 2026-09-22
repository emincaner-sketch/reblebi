import path from "node:path";
import { config } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { channelsRepo } from "../../core/repos/channels.js";
import { postsRepo } from "../../core/repos/posts.js";
import { activityRepo, mediaRepo } from "../../core/repos/misc.js";
import type { Channel, Post, PostTarget } from "../../core/types.js";
import { getProvider, ProviderError, type PublishMedia } from "../../providers/index.js";

const log = createLogger("publisher");
const MAX_ATTEMPTS = 3;

export function mediaPublicUrl(filename: string): string {
  return `${config.publicUrl}/media/${encodeURIComponent(filename)}`;
}

export function resolveMedia(ids: string[]): PublishMedia[] {
  return mediaRepo.getMany(ids).map((m) => ({
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
    return channelsRepo.get(channel.id) ?? channel;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    channelsRepo.setStatus(channel.id, "expired", msg);
    activityRepo.add("error", "token", `${channel.name} token yenilenemedi: ${msg}`, { channelId: channel.id });
    throw new ProviderError(`Kanal token'ı yenilenemedi: ${msg}`);
  }
}

async function publishTarget(post: Post, target: PostTarget): Promise<void> {
  const channel0 = channelsRepo.get(target.channelId);
  if (!channel0) {
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
    const media = resolveMedia(target.mediaIds ?? post.mediaIds);
    const result = await provider.publish(channel, { kind: post.kind, text, media, settings: target.settings });
    postsRepo.updateTarget(target.id, {
      status: "published",
      externalId: result.externalId,
      externalUrl: result.url ?? null,
      error: null,
      publishedAt: new Date().toISOString(),
      nextAttemptAt: null,
    });
    activityRepo.add("info", "publish", `${channel.name} (${provider.label}): ${post.kind} yayınlandı`, { postId: post.id, url: result.url ?? null });
    if (channel.status === "error") channelsRepo.setStatus(channel.id, "active", null);
  } catch (e) {
    const attempts = target.attempts + 1;
    const msg = e instanceof Error ? e.message : String(e);
    const retryable = e instanceof ProviderError ? e.retryable : true;
    const willRetry = retryable && attempts < MAX_ATTEMPTS;
    postsRepo.updateTarget(target.id, {
      status: "failed",
      error: msg,
      attempts,
      nextAttemptAt: willRetry ? new Date(Date.now() + Math.pow(2, attempts) * 60_000).toISOString() : null,
    });
    activityRepo.add("error", "publish", `${channel0.name}: yayın hatası (${attempts}/${MAX_ATTEMPTS}) ${msg}`, { postId: post.id });
    if (e instanceof ProviderError && (e.status === 401 || e.status === 403 || /OAuth|token|expired|invalid_grant|190/i.test(msg))) {
      channelsRepo.setStatus(channel0.id, "error", msg);
    }
    log.warn("hedef yayınlanamadı", { target: target.id, msg });
  }
}

/** Bir gönderinin bekleyen/başarısız hedeflerini yayınlar ve gönderi durumunu günceller */
export async function publishPost(postId: string): Promise<Post | null> {
  const post = postsRepo.get(postId);
  if (!post) return null;
  const pending = post.targets.filter((t) => t.status === "pending" || (t.status === "failed" && t.nextAttemptAt && t.attempts < MAX_ATTEMPTS));
  if (post.status !== "publishing") postsRepo.setStatus(post.id, "publishing");
  // Hedefler paralel yayınlanır (platformlar birbirinden bağımsız)
  await Promise.all(pending.map((t) => publishTarget(post, t)));
  const fresh = postsRepo.get(postId)!;
  const statuses = fresh.targets.map((t) => t.status);
  const allDone = statuses.every((s) => s === "published" || s === "skipped");
  const anyPublished = statuses.some((s) => s === "published");
  // Başarısız hedeflerde next_attempt_at doluysa zamanlayıcı otomatik tekrar dener (retryable sorgusu)
  if (allDone) postsRepo.setStatus(post.id, "published", new Date().toISOString());
  else postsRepo.setStatus(post.id, anyPublished ? "partial" : "failed");
  return postsRepo.get(postId);
}
