import { createLogger } from "../../core/logger.js";
import { channelsRepo } from "../../core/repos/channels.js";
import { postsRepo } from "../../core/repos/posts.js";
import { activityRepo, analyticsRepo, pollCursorsRepo } from "../../core/repos/misc.js";
import { getProvider } from "../../providers/index.js";
import { publishPost, ensureFreshToken } from "./publisher.js";
import { handleInbound } from "./dm-engine.js";

const log = createLogger("scheduler");

let timers: NodeJS.Timeout[] = [];
let publishing = false;
let polling = false;
/** Poll hatalarında kanal başına üstel geri çekilme (15sn -> 30dk) */
const pollBackoff = new Map<string, { until: number; failures: number }>();

/** Zamanı gelen gönderileri yayınlar, başarısızları tekrar dener */
async function tickPublish(): Promise<void> {
  if (publishing) return;
  publishing = true;
  try {
    const due = postsRepo.claimDue(10);
    const retry = postsRepo.retryable(10).filter((p) => !due.some((d) => d.id === p.id));
    for (const post of [...due, ...retry]) {
      log.info("yayınlanıyor", { post: post.id, kind: post.kind });
      await publishPost(post.id);
    }
  } catch (e) {
    log.error("yayın döngüsü hatası", { e: e instanceof Error ? e.message : e });
  } finally {
    publishing = false;
  }
}

/** Polling tabanlı gelen kutuları (Telegram, X) */
async function tickPoll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    for (const channel of channelsRepo.list()) {
      if (channel.status === "disabled" || channel.status === "expired") continue;
      const provider = getProvider(channel.provider);
      if (provider.capabilities.inbound !== "poll" || !provider.pollInbound) continue;
      // X DM polling sadece kanal ayarında açıksa (ücretli API katmanı gerekir)
      if (channel.provider === "x" && !channel.metadata.dmPolling) continue;
      const bo = pollBackoff.get(channel.id);
      if (bo && bo.until > Date.now()) continue;
      try {
        const fresh = await ensureFreshToken(channel);
        const cursor = pollCursorsRepo.get(channel.id);
        const { events, cursor: next } = await provider.pollInbound(fresh, cursor);
        for (const ev of events) await handleInbound(channel.provider, ev);
        if (next !== cursor) pollCursorsRepo.set(channel.id, next);
        pollBackoff.delete(channel.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const failures = (bo?.failures ?? 0) + 1;
        const wait = Math.min(15_000 * Math.pow(2, failures), 30 * 60_000);
        pollBackoff.set(channel.id, { until: Date.now() + wait, failures });
        log.warn("poll hatası", { channel: channel.id, msg, retryInSec: Math.round(wait / 1000) });
        if (/^40[134]|unauthorized/i.test(msg)) channelsRepo.setStatus(channel.id, "error", msg);
      }
    }
  } finally {
    polling = false;
  }
}

/** Günlük analitik anlık görüntüsü (takipçi vb.) */
export async function snapshotAnalytics(force = false): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  for (const channel of channelsRepo.list()) {
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
}

/** Token sağlığı: süresi yaklaşanları önceden yenile */
async function tickTokens(): Promise<void> {
  for (const channel of channelsRepo.list()) {
    if (channel.status === "disabled") continue;
    try {
      await ensureFreshToken(channel);
    } catch {
      /* ensureFreshToken hatayı loglar ve kanalı işaretler */
    }
  }
}

export function startScheduler(): void {
  stopScheduler();
  timers.push(setInterval(() => void tickPublish(), 20_000));
  timers.push(setInterval(() => void tickPoll(), 15_000));
  timers.push(setInterval(() => void tickTokens(), 30 * 60_000));
  timers.push(setInterval(() => void snapshotAnalytics(), 60 * 60_000));
  setTimeout(() => void tickPublish(), 3_000);
  setTimeout(() => void tickPoll(), 5_000);
  setTimeout(() => void snapshotAnalytics(), 20_000);
  activityRepo.add("info", "system", "Zamanlayıcı başlatıldı");
  log.info("zamanlayıcı aktif (yayın 20sn, poll 15sn, token 30dk, analitik 60dk)");
}

export function stopScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
}

export { tickPublish, tickPoll };
