import fs from "node:fs";
import path from "node:path";
import { config } from "../core/config.js";
import { backupTo } from "../core/db.js";
import { createLogger } from "../core/logger.js";
import { channelsRepo } from "../core/repos/channels.js";
import { postsRepo } from "../core/repos/posts.js";
import { activityRepo, analyticsRepo, platformSettingsRepo, pollCursorsRepo, postMetricsRepo, webhookEventsRepo } from "../core/repos/misc.js";
import { oauthTokensRepo } from "../core/repos/oauth.js";
import { getProvider } from "../providers/index.js";
import { handleInbound } from "./dm-engine.js";
import { ensureFreshToken, publishPost, runCommentJobs } from "./publisher.js";

const log = createLogger("scheduler");

let timers: NodeJS.Timeout[] = [];
const running = new Set<string>();
/** Poll hatalarında kanal başına üstel geri çekilme (15sn -> 30dk) */
const pollBackoff = new Map<string, { until: number; failures: number }>();

/** Aynı görevin üst üste binmesini engelle */
async function guarded(name: string, fn: () => Promise<void>): Promise<void> {
  if (running.has(name)) return;
  running.add(name);
  try {
    await fn();
  } catch (e) {
    log.error(`${name} hatası`, { e: e instanceof Error ? e.message : e });
  } finally {
    running.delete(name);
  }
}

export async function tickPublish(): Promise<void> {
  await guarded("publish", async () => {
    const due = postsRepo.claimDue(20);
    const retry = postsRepo.retryable(10).filter((p) => !due.some((d) => d.id === p.id));
    // Aynı anda en fazla 5 gönderi yayınla (platform hız sınırları)
    const queue = [...due, ...retry];
    for (let i = 0; i < queue.length; i += 5) {
      await Promise.all(queue.slice(i, i + 5).map((p) => publishPost(p.id)));
    }
    await runCommentJobs(30);
  });
}

async function tickPoll(): Promise<void> {
  await guarded("poll", async () => {
    for (const channel of channelsRepo.listAll()) {
      if (channel.status === "disabled" || channel.status === "expired") continue;
      const provider = getProvider(channel.provider);
      if (provider.capabilities.inbound !== "poll" || !provider.pollInbound) continue;
      if (channel.provider === "x" && !channel.metadata.dmPolling) continue;
      const bo = pollBackoff.get(channel.id);
      if (bo && bo.until > Date.now()) continue;
      try {
        const fresh = await ensureFreshToken(channel);
        const cursor = pollCursorsRepo.get(channel.id);
        const { events, cursor: next } = await provider.pollInbound(fresh, cursor);
        for (const ev of events) await handleInbound(channel.provider, ev, channel.id);
        if (next !== cursor) pollCursorsRepo.set(channel.id, next);
        pollBackoff.delete(channel.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const failures = (bo?.failures ?? 0) + 1;
        const wait = Math.min(15_000 * Math.pow(2, failures), 30 * 60_000);
        pollBackoff.set(channel.id, { until: Date.now() + wait, failures });
        log.warn("poll hatası", { channel: channel.id, msg, retryInSec: Math.round(wait / 1000) });
        if (/^40[13]\b|unauthorized/i.test(msg)) channelsRepo.setStatus(channel.id, "error", msg);
      }
    }
  });
}

/** Günlük kanal metrikleri (takipçi vb.) */
export async function snapshotAnalytics(force = false, orgId?: string): Promise<void> {
  await guarded(`analytics:${orgId ?? "all"}`, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const channels = orgId ? channelsRepo.list(orgId) : channelsRepo.listAll();
    for (const channel of channels) {
      if (channel.status === "disabled") continue;
      const provider = getProvider(channel.provider);
      if (!provider.fetchMetrics) continue;
      if (!force && analyticsRepo.latest(channel.id)?.date === today) continue;
      try {
        const fresh = await ensureFreshToken(channel);
        const metrics = await provider.fetchMetrics(fresh);
        if (Object.keys(metrics).length) analyticsRepo.upsert(channel.id, today, metrics);
      } catch (e) {
        log.warn("analitik alınamadı", { channel: channel.id, msg: e instanceof Error ? e.message : e });
      }
    }
  });
}

/** Yayınlanmış gönderilerin beğeni/yorum/görüntülenme metrikleri (6 saatte bir) */
async function tickPostMetrics(): Promise<void> {
  await guarded("post-metrics", async () => {
    for (const row of postMetricsRepo.staleTargets(6, 40)) {
      const channel = channelsRepo.getById(row.channelId);
      if (!channel || channel.status !== "active") continue;
      const provider = getProvider(channel.provider);
      if (!provider.fetchPostMetrics) continue;
      try {
        const fresh = await ensureFreshToken(channel);
        const m = await provider.fetchPostMetrics(fresh, row.externalId);
        postMetricsRepo.set(row.targetId, m);
      } catch (e) {
        // Metrik alınamasa da tekrar tekrar denememek için boş kayıt at
        postMetricsRepo.set(row.targetId, {});
        log.debug("gönderi metriği alınamadı", { target: row.targetId, msg: e instanceof Error ? e.message : e });
      }
    }
  });
}

async function tickTokens(): Promise<void> {
  await guarded("tokens", async () => {
    for (const channel of channelsRepo.listAll()) {
      if (channel.status === "disabled") continue;
      try {
        await ensureFreshToken(channel);
      } catch {
        /* ensureFreshToken hatayı loglar ve kanalı işaretler */
      }
    }
  });
}

/** Günlük bakım: yedek + eski kayıt temizliği */
export async function dailyMaintenance(force = false): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  if (!force && platformSettingsRepo.get("last_maintenance") === today) return null;
  platformSettingsRepo.set("last_maintenance", today);
  activityRepo.prune(90);
  webhookEventsRepo.prune(14);
  oauthTokensRepo.prune();
  let file: string | null = null;
  if (config.backup.enabled) {
    try {
      fs.mkdirSync(config.backupDir, { recursive: true });
      file = path.join(config.backupDir, `sosyalpilot-${today}.db`);
      if (fs.existsSync(file)) fs.rmSync(file);
      backupTo(file);
      const backups = fs
        .readdirSync(config.backupDir)
        .filter((f) => f.startsWith("sosyalpilot-") && f.endsWith(".db"))
        .sort()
        .reverse();
      for (const old of backups.slice(config.backup.keep)) fs.rmSync(path.join(config.backupDir, old), { force: true });
      log.info("yedek alındı", { file });
    } catch (e) {
      log.error("yedek alınamadı", { e: e instanceof Error ? e.message : e });
      file = null;
    }
  }
  return file;
}

export function startScheduler(): void {
  stopScheduler();
  const recovered = postsRepo.recoverStuck(10);
  if (recovered) log.warn("takılı kalan gönderiler kuyruğa geri alındı", { count: recovered });
  timers.push(setInterval(() => void tickPublish(), 20_000));
  timers.push(setInterval(() => void tickPoll(), 15_000));
  timers.push(setInterval(() => void tickTokens(), 30 * 60_000));
  timers.push(setInterval(() => void snapshotAnalytics(), 60 * 60_000));
  timers.push(setInterval(() => void tickPostMetrics(), 30 * 60_000));
  timers.push(setInterval(() => void dailyMaintenance(), 60 * 60_000));
  setTimeout(() => void tickPublish(), 3_000);
  setTimeout(() => void tickPoll(), 5_000);
  setTimeout(() => void snapshotAnalytics(), 30_000);
  setTimeout(() => void tickPostMetrics(), 60_000);
  setTimeout(() => void dailyMaintenance(), 90_000);
  log.info("zamanlayıcı aktif (yayın 20sn, poll 15sn, token 30dk, analitik 60dk, metrik 30dk, bakım günlük)");
}

export function stopScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
}
