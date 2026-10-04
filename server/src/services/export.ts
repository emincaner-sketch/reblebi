import { channelsRepo } from "../core/repos/channels.js";
import { analyticsRepo, postMetricsRepo } from "../core/repos/misc.js";
import { orgsRepo } from "../core/repos/orgs.js";
import { postsRepo } from "../core/repos/posts.js";
import { addDays, localYmd, zonedMidnight } from "./analytics-report.js";

/**
 * Günlük düz tablo (kanal × gün): Looker Studio bağlayıcısı, Google Sheets ve CSV indirmesi için.
 * Gönderi metrikleri yayın gününe yazılır; takipçi bir önceki bilinen değerden taşınır; hesap insights platform verirse dolar.
 */

export const EXPORT_FIELDS = [
  "date",
  "network",
  "channel",
  "channelId",
  "followers",
  "posts",
  "likes",
  "comments",
  "shares",
  "saves",
  "interactions",
  "postViews",
  "reach",
  "accountViews",
  "profileViews",
  "websiteClicks",
  "follows",
  "unfollows",
  "watchMinutes",
] as const;
export type ExportRow = Record<(typeof EXPORT_FIELDS)[number], string | number | null>;

const isYmd = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const MAX_DAYS = 366;

export function dailyExport(orgId: string, q: { from?: string; to?: string }): { from: string; to: string; rows: ExportRow[] } {
  const tz = orgsRepo.get(orgId)?.timezone || "Europe/Istanbul";
  const today = localYmd(Date.now(), tz);
  let to = isYmd(q.to) ? q.to! : today;
  if (to > today) to = today;
  let from = isYmd(q.from) ? q.from! : addDays(to, -29);
  if (from > to) from = to;
  if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

  // Gönderiler: yayın gününe göre (çalışma alanı saatiyle)
  const targets = postsRepo.publishedBetween(orgId, new Date(zonedMidnight(from, tz)).toISOString(), new Date(zonedMidnight(addDays(to, 1), tz)).toISOString(), 20_000);
  const metrics = postMetricsRepo.getMany(targets.map((t) => t.id));
  const postAgg = new Map<string, { posts: number; likes: number; comments: number; shares: number; saves: number; views: number; withViews: boolean }>();
  for (const t of targets) {
    if (!t.publishedAt) continue;
    const key = `${t.channelId}|${localYmd(Date.parse(t.publishedAt), tz)}`;
    const a = postAgg.get(key) ?? { posts: 0, likes: 0, comments: 0, shares: 0, saves: 0, views: 0, withViews: false };
    const m = metrics.get(t.id)?.metrics;
    a.posts++;
    if (m) {
      a.likes += m.likes ?? 0;
      a.comments += m.comments ?? 0;
      a.shares += m.shares ?? 0;
      a.saves += m.saves ?? m.saved ?? 0;
      const v = m.views ?? m.reach;
      if (typeof v === "number") {
        a.views += v;
        a.withViews = true;
      }
    }
    postAgg.set(key, a);
  }

  const rows: ExportRow[] = [];
  for (const c of channelsRepo.list(orgId)) {
    const snaps = new Map(analyticsRepo.between(c.id, from, to).map((s) => [s.date, s.metrics]));
    let followers: number | null = analyticsRepo.lastBefore(c.id, from)?.metrics.followers ?? null;
    for (const d of dates) {
      const s = snaps.get(d);
      if (typeof s?.followers === "number") followers = s.followers;
      const p = postAgg.get(`${c.id}|${d}`);
      const ins = (k: string) => (typeof s?.[`ins_${k}`] === "number" ? (s[`ins_${k}`] as number) : null);
      rows.push({
        date: d,
        network: c.provider,
        channel: c.name,
        channelId: c.id,
        followers,
        posts: p?.posts ?? 0,
        likes: p ? p.likes : 0,
        comments: p ? p.comments : 0,
        shares: p ? p.shares : 0,
        saves: p ? p.saves : 0,
        interactions: p ? p.likes + p.comments + p.shares + p.saves : 0,
        postViews: p?.withViews ? p.views : null,
        reach: ins("reach"),
        accountViews: ins("views"),
        profileViews: ins("profileViews"),
        websiteClicks: ins("websiteClicks"),
        follows: ins("follows"),
        unfollows: ins("unfollows"),
        watchMinutes: ins("watchMinutes"),
      });
    }
  }
  return { from, to, rows };
}

export function toCsv(rows: ExportRow[]): string {
  const esc = (v: string | number | null) => {
    if (v === null) return "";
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [EXPORT_FIELDS.join(","), ...rows.map((r) => EXPORT_FIELDS.map((f) => esc(r[f])).join(","))].join("\n");
}
