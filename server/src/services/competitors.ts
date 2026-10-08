import { AppError, notFound } from "../core/i18n.js";
import { createLogger } from "../core/logger.js";
import { channelsRepo } from "../core/repos/channels.js";
import { competitorsRepo, type Competitor, type CompetitorPost, type CompetitorProvider } from "../core/repos/competitors.js";
import { orgsRepo } from "../core/repos/orgs.js";
import type { Channel, Ctx } from "../core/types.js";
import { blueskyProfile, blueskyRecentPosts } from "../providers/bluesky.js";
import { facebookPagePublic } from "../providers/meta/facebook.js";
import { twitchPublicChannel } from "../providers/twitch.js";
import { businessDiscovery } from "../providers/meta/instagram.js";
import { channelBase } from "../providers/meta/common.js";
import { ProviderError } from "../providers/types.js";
import { youtubePublicChannel } from "../providers/youtube.js";
import { requireRole } from "./access.js";
import { addDays, analyticsReport, localYmd } from "./analytics-report.js";
import { ensureFreshToken } from "./publisher.js";

/**
 * Rakip takibi (Metricool "Competitors" karşılığı): herkese açık takipçi, gönderi ve etkileşim ortalamaları;
 * günde bir anlık görüntü. Ağ başına kaynak:
 * - Instagram: kendi bağlı IG hesabının jetonuyla Business Discovery (kişisel hesaplar desteklenmez)
 * - YouTube: bağlı YouTube kanalının jetonuyla Data API (kanal başına 3 kota birimi)
 * - Bluesky: herkese açık AppView, jeton gerekmez
 * - Facebook: bağlı Sayfanın jetonuyla herkese açık Sayfa verisi (Page Public Metadata/Content Access)
 * - Twitch: bağlı Twitch kanalının jetonuyla Helix (toplam takipçi, son videolar)
 */

const log = createLogger("competitors");
/** Ağ başına en fazla takip edilen rakip */
export const MAX_COMPETITORS = 20;
export const COMPETITOR_PROVIDERS: CompetitorProvider[] = ["instagram", "facebook", "youtube", "twitch", "bluesky"];
const IG_RE = /^[a-z0-9._]{1,30}$/;
const YT_HANDLE_RE = /^[a-z0-9._-]{3,30}$/i;
const YT_ID_RE = /^UC[\w-]{22}$/;
const FB_RE = /^([a-z0-9.\-]{5,50}|\d{5,20})$/i;
const TWITCH_RE = /^[a-z0-9_]{3,25}$/;
const BSKY_RE = /^(did:plc:[a-z2-7]{24}|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/i;
const DAY = 86_400_000;

type Num = number | null;

const BAD_KEY: Record<CompetitorProvider, string> = {
  instagram: "competitor.bad_username",
  youtube: "competitor.bad_youtube",
  bluesky: "competitor.bad_bluesky",
  facebook: "competitor.bad_facebook",
  twitch: "competitor.bad_twitch",
};
const NO_SOURCE_KEY: Record<CompetitorProvider, string> = {
  instagram: "competitor.no_instagram",
  youtube: "competitor.no_youtube",
  bluesky: "competitor.no_instagram",
  facebook: "competitor.no_facebook",
  twitch: "competitor.no_twitch",
};

interface Fetched {
  username: string;
  name: string | null;
  avatarUrl: string | null;
  biography: string | null;
  followers: Num;
  mediaCount: Num;
  media: CompetitorPost[];
}

function sourceChannel(orgId: string, provider: CompetitorProvider): Channel | null {
  if (provider === "bluesky") return null;
  return channelsRepo.list(orgId).find((c) => c.provider === provider && c.status === "active") ?? null;
}

/** Bu ağdaki rakipleri izlemek için gereken kaynak var mı (Bluesky her zaman açık) */
function canTrack(orgId: string, provider: CompetitorProvider): boolean {
  return provider === "bluesky" || Boolean(sourceChannel(orgId, provider));
}

/** Kullanıcının yazdığı ad/URL → ağın kanonik tanıtıcısı; geçersizse null */
export function normalizeHandle(provider: CompetitorProvider, raw: string): string | null {
  const s = raw.trim();
  if (provider === "instagram") {
    const u = s
      .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "")
      .replace(/^@/, "")
      .replace(/[/?#].*$/, "")
      .toLowerCase();
    return IG_RE.test(u) ? u : null;
  }
  if (provider === "youtube") {
    const u = s
      .replace(/^(https?:\/\/)?((www|m)\.)?youtube\.com\//i, "")
      .replace(/^channel\//i, "")
      .replace(/^@/, "")
      .replace(/[/?#].*$/, "");
    if (YT_ID_RE.test(u)) return u;
    return YT_HANDLE_RE.test(u) ? u.toLowerCase() : null;
  }
  if (provider === "facebook") {
    const id = /profile\.php\?id=(\d+)/i.exec(s)?.[1];
    if (id) return id;
    const u = s
      .replace(/^(https?:\/\/)?((www|m|web|business)\.)?(facebook|fb)\.com\//i, "")
      .replace(/^@/, "")
      .replace(/[/?#].*$/, "")
      .toLowerCase();
    return FB_RE.test(u) ? u : null;
  }
  if (provider === "twitch") {
    const u = s
      .replace(/^(https?:\/\/)?((www|m)\.)?twitch\.tv\//i, "")
      .replace(/^@/, "")
      .replace(/[/?#].*$/, "")
      .toLowerCase();
    return TWITCH_RE.test(u) ? u : null;
  }
  const u = s
    .replace(/^(https?:\/\/)?(www\.)?bsky\.app\/profile\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  return BSKY_RE.test(u) ? u : null;
}

async function fetchAccount(provider: CompetitorProvider, channel: Channel | null, handle: string): Promise<Fetched> {
  if (provider === "bluesky") {
    const [p, posts] = await Promise.all([blueskyProfile(handle), blueskyRecentPosts(handle, 25)]);
    return {
      username: p.handle,
      name: p.displayName || null,
      avatarUrl: p.avatar ?? null,
      biography: p.description ?? null,
      followers: p.followersCount ?? null,
      mediaCount: p.postsCount ?? null,
      media: posts.map((x) => ({
        id: x.uri,
        caption: x.text,
        likes: x.likes,
        comments: x.replies,
        shares: x.reposts,
        timestamp: x.createdAt,
        type: "POST",
        permalink: /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/.test(x.uri) ? x.uri.replace(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/, "https://bsky.app/profile/$1/post/$2") : null,
      })),
    };
  }
  if (provider === "twitch") {
    const ch = await twitchPublicChannel(channel!.accessToken, handle);
    return { username: ch.login, name: ch.name, avatarUrl: ch.avatarUrl, biography: ch.description, followers: ch.followers, mediaCount: ch.videos.length, media: ch.videos };
  }
  const fresh = await ensureFreshToken(channel!);
  if (provider === "facebook") {
    const pg = await facebookPagePublic(fresh.accessToken, handle);
    return { username: pg.username, name: pg.name, avatarUrl: pg.avatarUrl, biography: pg.about, followers: pg.followers, mediaCount: null, media: pg.posts };
  }
  if (provider === "youtube") {
    const ch = await youtubePublicChannel(fresh.accessToken, handle);
    return { username: ch.handle, name: ch.name, avatarUrl: ch.avatarUrl, biography: ch.description, followers: ch.subscribers, mediaCount: ch.videoCount, media: ch.videos };
  }
  const acc = await businessDiscovery(fresh.externalId, fresh.accessToken, handle, channelBase(fresh));
  return { username: acc.username, name: acc.name, avatarUrl: acc.avatarUrl, biography: acc.biography, followers: acc.followers, mediaCount: acc.mediaCount, media: acc.media };
}

const avg = (list: CompetitorPost[], pick: (m: CompetitorPost) => Num | undefined): number | undefined => {
  const xs = list.map(pick).filter((v): v is number => typeof v === "number");
  return xs.length ? Math.round((xs.reduce((a, v) => a + v, 0) / xs.length) * 10) / 10 : undefined;
};

/** Son gönderilerden dönem özeti: 30 günde gönderi, ortalama beğeni/yorum/izlenme, etkileşim oranı (% takipçi) */
export function summarize(acc: { followers: Num; media: CompetitorPost[] }, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  out.postsLast30 = acc.media.filter((m) => m.timestamp && Date.parse(m.timestamp) >= now - 30 * DAY).length;
  const avgLikes = avg(acc.media, (m) => m.likes);
  const avgComments = avg(acc.media, (m) => m.comments);
  const avgShares = avg(acc.media, (m) => m.shares);
  const avgViews = avg(acc.media, (m) => m.views);
  if (avgLikes !== undefined) out.avgLikes = avgLikes;
  if (avgComments !== undefined) out.avgComments = avgComments;
  if (avgShares !== undefined) out.avgShares = avgShares;
  if (avgViews !== undefined) out.avgViews = avgViews;
  if (acc.followers && (avgLikes !== undefined || avgComments !== undefined)) out.engagementRate = Math.round((((avgLikes ?? 0) + (avgComments ?? 0)) / acc.followers) * 10000) / 100;
  return out;
}

function store(c: Pick<Competitor, "id" | "orgId">, acc: Fetched, now = Date.now()): void {
  competitorsRepo.saveProfile(c.id, { name: acc.name, avatarUrl: acc.avatarUrl, biography: acc.biography, recent: acc.media });
  const tz = orgsRepo.get(c.orgId)?.timezone || "Europe/Istanbul";
  competitorsRepo.upsertSnapshot(c.id, localYmd(now, tz), { followers: acc.followers, mediaCount: acc.mediaCount, metrics: summarize(acc, now) });
}

export async function addCompetitor(ctx: Ctx, rawUsername: string, provider: CompetitorProvider = "instagram"): Promise<Competitor> {
  requireRole(ctx, "editor");
  const handle = normalizeHandle(provider, rawUsername);
  if (!handle) throw new AppError(400, BAD_KEY[provider]);
  if (competitorsRepo.findByUsername(ctx.orgId, handle, provider)) throw new AppError(409, "competitor.exists");
  if (competitorsRepo.list(ctx.orgId).filter((c) => c.provider === provider).length >= MAX_COMPETITORS) throw new AppError(400, "competitor.too_many", { max: MAX_COMPETITORS });
  const channel = sourceChannel(ctx.orgId, provider);
  if (!canTrack(ctx.orgId, provider)) throw new AppError(400, NO_SOURCE_KEY[provider]);
  const own = (h: string) => channelsRepo.list(ctx.orgId).some((ch) => ch.provider === provider && [ch.username, ch.externalId].some((x) => (x ?? "").replace(/^@/, "").toLowerCase() === h.toLowerCase()));
  if (own(handle)) throw new AppError(400, "competitor.own_account");
  // Önce doğrula: hesap yoksa (ya da IG'de işletme hesabı değilse) kayıt açılmaz
  let acc: Fetched;
  try {
    acc = await fetchAccount(provider, channel, handle);
  } catch (e) {
    log.debug("rakip doğrulanamadı", { provider, handle, msg: e instanceof Error ? e.message : e });
    throw new AppError(400, provider === "instagram" ? "competitor.not_found" : "competitor.channel_not_found", { username: handle });
  }
  const canonical = acc.username || handle;
  if (canonical !== handle && (own(canonical) || competitorsRepo.findByUsername(ctx.orgId, canonical, provider))) throw new AppError(409, "competitor.exists");
  const c = competitorsRepo.create(ctx.orgId, canonical, provider);
  store(c, acc);
  return competitorsRepo.get(ctx.orgId, c.id)!;
}

export function removeCompetitor(ctx: Ctx, id: string): void {
  requireRole(ctx, "editor");
  competitorsRepo.remove(ctx.orgId, id);
}

export async function refreshCompetitor(ctx: Ctx, id: string): Promise<Competitor> {
  requireRole(ctx, "editor");
  const c = competitorsRepo.get(ctx.orgId, id);
  if (!c) throw notFound("competitor");
  if (!canTrack(ctx.orgId, c.provider)) throw new AppError(400, NO_SOURCE_KEY[c.provider]);
  try {
    store(c, await fetchAccount(c.provider, sourceChannel(ctx.orgId, c.provider), c.username));
  } catch (e) {
    const msg = e instanceof ProviderError || e instanceof Error ? e.message : String(e);
    competitorsRepo.saveError(c.id, msg);
  }
  return competitorsRepo.get(ctx.orgId, id)!;
}

/** Zamanlayıcı: her rakip için günde bir anlık görüntü (çalışma alanı saatine göre) */
export async function snapshotCompetitors(now = Date.now()): Promise<number> {
  let done = 0;
  const byOrg = new Map<string, Competitor[]>();
  for (const c of competitorsRepo.listAll()) byOrg.set(c.orgId, [...(byOrg.get(c.orgId) ?? []), c]);
  for (const [orgId, list] of byOrg) {
    const org = orgsRepo.get(orgId);
    if (!org || org.disabled) continue;
    const today = localYmd(now, org.timezone);
    for (const c of list) {
      if (!canTrack(orgId, c.provider)) continue;
      if (c.lastFetchedAt && localYmd(Date.parse(c.lastFetchedAt), org.timezone) === today) continue;
      try {
        store(c, await fetchAccount(c.provider, sourceChannel(orgId, c.provider), c.username), now);
        done++;
      } catch (e) {
        competitorsRepo.saveError(c.id, e instanceof Error ? e.message : String(e));
      }
    }
  }
  return done;
}

/* ---------------- Rapor: rakipler + kendi hesapların (aynı ağlarda) ---------------- */

export function competitorReport(ctx: Ctx, days = 30) {
  const tz = orgsRepo.get(ctx.orgId)?.timezone || "Europe/Istanbul";
  const n = Math.min(Math.max(Math.round(days), 7), 366);
  const to = localYmd(Date.now(), tz);
  const from = addDays(to, -(n - 1));
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const score = (m: CompetitorPost) => (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0);

  const items = competitorsRepo.list(ctx.orgId).map((c) => {
    const snaps = competitorsRepo.snapshots(c.id, from, to);
    const before = competitorsRepo.lastBefore(c.id, from);
    let carry: Num = before?.followers ?? null;
    let si = 0;
    const series: Num[] = dates.map((d) => {
      while (si < snaps.length && snaps[si].date <= d) {
        if (snaps[si].followers !== null) carry = snaps[si].followers;
        si++;
      }
      return carry;
    });
    const last = snaps[snaps.length - 1] ?? before;
    const start = before?.followers ?? series.find((v) => v !== null) ?? null;
    const end = series[series.length - 1] ?? null;
    const byViews = c.provider === "youtube" || c.provider === "twitch";
    const top = [...c.recent].sort((a, b) => (byViews ? (b.views ?? 0) - (a.views ?? 0) : score(b) - score(a))).slice(0, 3);
    return {
      id: c.id,
      provider: c.provider,
      username: c.username,
      name: c.name,
      avatarUrl: c.avatarUrl,
      biography: c.biography,
      followers: end,
      followersDelta: end !== null && start !== null ? end - start : null,
      mediaCount: last?.mediaCount ?? null,
      postsLast30: last?.metrics.postsLast30 ?? null,
      avgLikes: last?.metrics.avgLikes ?? null,
      avgComments: last?.metrics.avgComments ?? null,
      avgViews: last?.metrics.avgViews ?? null,
      engagementRate: last?.metrics.engagementRate ?? null,
      lastFetchedAt: c.lastFetchedAt,
      lastError: c.lastError,
      series,
      topPosts: top,
    };
  });

  // Kendi hesapların aynı ölçülerle (gönderi metrikleri kendi verimizden)
  const self = channelsRepo
    .list(ctx.orgId)
    .filter((c) => (COMPETITOR_PROVIDERS as string[]).includes(c.provider))
    .map((c) => {
      const r = analyticsReport(ctx.orgId, { from, to, channelId: c.id });
      const r30 = analyticsReport(ctx.orgId, { days: 30, channelId: c.id });
      const k30 = r30.kpis;
      const withM = k30.postsWithMetrics.value ?? 0;
      const avgLikes = withM ? Math.round(((k30.likes.value ?? 0) / withM) * 10) / 10 : null;
      const avgComments = withM ? Math.round(((k30.comments.value ?? 0) / withM) * 10) / 10 : null;
      const avgViews = withM && (c.provider === "youtube" || c.provider === "twitch") ? Math.round(((k30.views.value ?? 0) / withM) * 10) / 10 : null;
      const followers = r.kpis.followers.value;
      return {
        channelId: c.id,
        provider: c.provider as CompetitorProvider,
        username: c.username ?? c.name,
        name: c.name,
        avatarUrl: c.avatarUrl,
        followers,
        followersDelta: r.kpis.followersDelta.value,
        postsLast30: k30.posts.value,
        avgLikes,
        avgComments,
        avgViews,
        engagementRate: followers && avgLikes !== null ? Math.round((((avgLikes ?? 0) + (avgComments ?? 0)) / followers) * 10000) / 100 : null,
        series: r.daily.map((x) => x.followers),
      };
    });

  const tracking = Object.fromEntries(COMPETITOR_PROVIDERS.map((p) => [p, canTrack(ctx.orgId, p)])) as Record<CompetitorProvider, boolean>;
  return { range: { from, to, days: n, tz }, dates, items, self, max: MAX_COMPETITORS, canTrack: tracking.instagram, tracking };
}
