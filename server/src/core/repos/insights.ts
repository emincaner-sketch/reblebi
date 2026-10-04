import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";
import type { AudienceBreakdown } from "../../providers/types.js";

type Row = Record<string, unknown>;

/** Günlük hesap insights anahtarları; analytics_snapshots.metrics içinde "ins_" önekiyle saklanır */
export const INSIGHT_KEYS = ["reach", "views", "profileViews", "websiteClicks", "follows", "unfollows", "engaged", "watchMinutes", "clicks", "saves", "calls", "directions"] as const;
export type InsightKey = (typeof INSIGHT_KEYS)[number];
export const insKey = (k: InsightKey) => `ins_${k}`;

export const insightsRepo = {
  /** O günün anlık görüntüsüne ekler (takipçi gibi var olan alanlar korunur; satır yoksa açılır) */
  mergeDay(channelId: string, date: string, values: Partial<Record<InsightKey, number>>): void {
    const entries = Object.entries(values).filter(([, v]) => typeof v === "number" && Number.isFinite(v));
    if (!entries.length) return;
    const db = getDb();
    const r = db.prepare("SELECT metrics FROM analytics_snapshots WHERE channel_id = ? AND date = ?").get(channelId, date) as Row | undefined;
    const merged = { ...parseJson<Record<string, number>>(r?.metrics, {}), ...Object.fromEntries(entries.map(([k, v]) => [insKey(k as InsightKey), v])) };
    db.prepare("INSERT INTO analytics_snapshots (id, channel_id, date, metrics) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, date) DO UPDATE SET metrics = excluded.metrics").run(
      randomId("snap"),
      channelId,
      date,
      JSON.stringify(merged),
    );
  },

  /** Platform o gün için hiçbir metrik vermediyse (izin yok, hesap küçük) günü "denendi" diye işaretle */
  markChecked(channelId: string, date: string): void {
    const db = getDb();
    const r = db.prepare("SELECT metrics FROM analytics_snapshots WHERE channel_id = ? AND date = ?").get(channelId, date) as Row | undefined;
    const merged = { ...parseJson<Record<string, number>>(r?.metrics, {}), ins_checked: 1 };
    db.prepare("INSERT INTO analytics_snapshots (id, channel_id, date, metrics) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, date) DO UPDATE SET metrics = excluded.metrics").run(
      randomId("snap"),
      channelId,
      date,
      JSON.stringify(merged),
    );
  },

  /** Verilen günlerden hangilerinde insights zaten var (yeniden çekmemek için) */
  daysWithInsights(channelId: string, fromDate: string, toDate: string): Set<string> {
    const rows = getDb().prepare("SELECT date, metrics FROM analytics_snapshots WHERE channel_id = ? AND date >= ? AND date <= ?").all(channelId, fromDate, toDate) as Row[];
    return new Set(rows.filter((r) => Object.keys(parseJson<Record<string, number>>(r.metrics, {})).some((k) => k.startsWith("ins_"))).map((r) => r.date as string));
  },

  setAudience(channelId: string, data: AudienceBreakdown): void {
    getDb()
      .prepare("INSERT INTO channel_audience (channel_id, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at")
      .run(channelId, JSON.stringify(data), nowIso());
  },

  audience(channelId: string): { data: AudienceBreakdown; fetchedAt: string } | null {
    const r = getDb().prepare("SELECT data, fetched_at FROM channel_audience WHERE channel_id = ?").get(channelId) as Row | undefined;
    return r ? { data: parseJson<AudienceBreakdown>(r.data, {}), fetchedAt: r.fetched_at as string } : null;
  },
};
