import { AppError, notFound } from "../core/i18n.js";
import { createLogger } from "../core/logger.js";
import { channelsRepo } from "../core/repos/channels.js";
import { hashtagsRepo, type HashtagPost, type HashtagTrack } from "../core/repos/hashtags.js";
import { orgsRepo } from "../core/repos/orgs.js";
import type { Channel, Ctx } from "../core/types.js";
import { graph } from "../providers/meta/common.js";
import { requireRole } from "./access.js";
import { addDays, localYmd } from "./analytics-report.js";
import { ensureFreshToken } from "./publisher.js";

/**
 * Hashtag takibi (Metricool "Hashtag Tracker" karşılığı): Instagram hashtag araması ile
 * son 24 saatte paylaşılan gönderi sayısı (örneklem), en popüler gönderilerin ortalama etkileşimi ve öne çıkanlar.
 * Platform sınırı: bir Instagram hesabı 7 günde en fazla 30 farklı hashtag sorgulayabilir; bu yüzden çalışma alanı başına 10.
 */

const log = createLogger("hashtags");
export const MAX_TRACKS = 10;
/** recent_media en fazla bu kadar sayfa (50'şer) okunur; üstü "200+" demektir */
const RECENT_PAGES = 4;
const TAG_RE = /^[\p{L}\p{N}_]{2,100}$/u;

type MediaRow = { id: string; caption?: string; like_count?: number; comments_count?: number; media_type?: string; permalink?: string; timestamp?: string };
const FIELDS = "id,caption,like_count,comments_count,media_type,permalink,timestamp";

function igChannel(orgId: string): Channel | null {
  return channelsRepo.list(orgId).find((c) => c.provider === "instagram" && c.status === "active") ?? null;
}

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").toLocaleLowerCase("tr");
}

const toPost = (m: MediaRow): HashtagPost => ({
  id: m.id,
  caption: (m.caption ?? "").slice(0, 280),
  likes: typeof m.like_count === "number" ? m.like_count : null,
  comments: typeof m.comments_count === "number" ? m.comments_count : null,
  type: m.media_type ?? "IMAGE",
  permalink: m.permalink ?? null,
  timestamp: m.timestamp ?? null,
});

/** Bir hashtag'in günlük ölçümü: son 24 saat gönderi sayısı (örneklem) + en popüler gönderilerin ortalamaları */
export async function measureHashtag(igUserId: string, token: string, hashtagId: string): Promise<{ metrics: Record<string, number>; top: HashtagPost[] }> {
  let recent = 0;
  let next: string | undefined = `/${hashtagId}/recent_media`;
  for (let page = 0; page < RECENT_PAGES && next; page++) {
    const r: { data?: MediaRow[]; paging?: { next?: string } } = await graph(next, token, page === 0 ? { params: { user_id: igUserId, fields: "id", limit: 50 } } : {});
    recent += r.data?.length ?? 0;
    next = r.paging?.next;
  }
  const top = await graph<{ data?: MediaRow[] }>(`/${hashtagId}/top_media`, token, { params: { user_id: igUserId, fields: FIELDS, limit: 50 } });
  const media = top.data ?? [];
  const withLikes = media.filter((m) => typeof m.like_count === "number");
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : undefined);
  const metrics: Record<string, number> = { recentPosts: recent, recentCapped: next ? 1 : 0 };
  const avgLikes = avg(withLikes.map((m) => m.like_count!));
  const avgComments = avg(media.filter((m) => typeof m.comments_count === "number").map((m) => m.comments_count!));
  if (avgLikes !== undefined) metrics.avgLikes = avgLikes;
  if (avgComments !== undefined) metrics.avgComments = avgComments;
  const ranked = media.map(toPost).sort((a, b) => (b.likes ?? 0) + (b.comments ?? 0) - ((a.likes ?? 0) + (a.comments ?? 0)));
  return { metrics, top: ranked.slice(0, 9) };
}

async function refresh(track: HashtagTrack, channel: Channel, now = Date.now()): Promise<void> {
  const fresh = await ensureFreshToken(channel);
  let hashtagId = track.igHashtagId;
  if (!hashtagId) {
    const r = await graph<{ data?: Array<{ id: string }> }>("/ig_hashtag_search", fresh.accessToken, { params: { user_id: fresh.externalId, q: track.hashtag } });
    hashtagId = r.data?.[0]?.id ?? null;
    if (!hashtagId) throw new AppError(400, "hashtag.not_found", { tag: track.hashtag });
  }
  const m = await measureHashtag(fresh.externalId, fresh.accessToken, hashtagId);
  hashtagsRepo.saveTop(track.id, m.top);
  const tz = orgsRepo.get(track.orgId)?.timezone || "Europe/Istanbul";
  hashtagsRepo.upsertSnapshot(track.id, localYmd(now, tz), m.metrics);
}

export async function addHashtag(ctx: Ctx, raw: string): Promise<HashtagTrack> {
  requireRole(ctx, "editor");
  const tag = normalizeTag(raw);
  if (!TAG_RE.test(tag)) throw new AppError(400, "hashtag.invalid");
  if (hashtagsRepo.find(ctx.orgId, tag)) throw new AppError(409, "hashtag.exists");
  if (hashtagsRepo.list(ctx.orgId).length >= MAX_TRACKS) throw new AppError(400, "hashtag.too_many", { max: MAX_TRACKS });
  const channel = igChannel(ctx.orgId);
  if (!channel) throw new AppError(400, "competitor.no_instagram");
  const fresh = await ensureFreshToken(channel);
  let id: string | undefined;
  try {
    const r = await graph<{ data?: Array<{ id: string }> }>("/ig_hashtag_search", fresh.accessToken, { params: { user_id: fresh.externalId, q: tag } });
    id = r.data?.[0]?.id;
  } catch (e) {
    log.debug("hashtag aranamadı", { tag, msg: e instanceof Error ? e.message : e });
  }
  if (!id) throw new AppError(400, "hashtag.not_found", { tag });
  const track = hashtagsRepo.create(ctx.orgId, tag, id);
  try {
    await refresh(track, channel);
  } catch (e) {
    hashtagsRepo.saveError(track.id, e instanceof Error ? e.message : String(e));
  }
  return hashtagsRepo.get(ctx.orgId, track.id)!;
}

export function removeHashtag(ctx: Ctx, id: string): void {
  requireRole(ctx, "editor");
  hashtagsRepo.remove(ctx.orgId, id);
}

export async function refreshHashtag(ctx: Ctx, id: string): Promise<HashtagTrack> {
  requireRole(ctx, "editor");
  const t = hashtagsRepo.get(ctx.orgId, id);
  if (!t) throw notFound("hashtag");
  const channel = igChannel(ctx.orgId);
  if (!channel) throw new AppError(400, "competitor.no_instagram");
  try {
    await refresh(t, channel);
  } catch (e) {
    hashtagsRepo.saveError(t.id, e instanceof Error ? e.message : String(e));
  }
  return hashtagsRepo.get(ctx.orgId, id)!;
}

/** Zamanlayıcı: her hashtag için günde bir ölçüm (çalışma alanı saatine göre) */
export async function snapshotHashtags(now = Date.now()): Promise<number> {
  let n = 0;
  for (const t of hashtagsRepo.listAll()) {
    const org = orgsRepo.get(t.orgId);
    if (!org || org.disabled) continue;
    if (t.lastFetchedAt && localYmd(Date.parse(t.lastFetchedAt), org.timezone) === localYmd(now, org.timezone)) continue;
    const channel = igChannel(t.orgId);
    if (!channel) continue;
    try {
      await refresh(t, channel, now);
      n++;
    } catch (e) {
      hashtagsRepo.saveError(t.id, e instanceof Error ? e.message : String(e));
    }
  }
  return n;
}

export function hashtagReport(ctx: Ctx, days = 30) {
  const tz = orgsRepo.get(ctx.orgId)?.timezone || "Europe/Istanbul";
  const n = Math.min(Math.max(Math.round(days), 7), 366);
  const to = localYmd(Date.now(), tz);
  const from = addDays(to, -(n - 1));
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const items = hashtagsRepo.list(ctx.orgId).map((t) => {
    const snaps = new Map(hashtagsRepo.snapshots(t.id, from, to).map((s) => [s.date, s.metrics]));
    const series = dates.map((d) => snaps.get(d)?.recentPosts ?? null);
    const last = [...snaps.values()].pop() ?? null;
    const known = series.filter((v): v is number => v !== null);
    return {
      id: t.id,
      hashtag: t.hashtag,
      recentPosts: last?.recentPosts ?? null,
      recentCapped: Boolean(last?.recentCapped),
      avgLikes: last?.avgLikes ?? null,
      avgComments: last?.avgComments ?? null,
      avgDaily: known.length ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 10) / 10 : null,
      series,
      top: t.top,
      lastFetchedAt: t.lastFetchedAt,
      lastError: t.lastError,
    };
  });
  return { range: { from, to, days: n, tz }, dates, items, max: MAX_TRACKS, canTrack: Boolean(igChannel(ctx.orgId)) };
}
