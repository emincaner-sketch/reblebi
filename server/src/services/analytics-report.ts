import { channelsRepo } from "../core/repos/channels.js";
import { inboxRepo } from "../core/repos/inbox.js";
import { analyticsRepo, postMetricsRepo } from "../core/repos/misc.js";
import { orgsRepo } from "../core/repos/orgs.js";
import { postsRepo } from "../core/repos/posts.js";
import type { Channel, PostKind, ProviderId } from "../core/types.js";
import { getProvider } from "../providers/index.js";
import { INSIGHT_KEYS, insightsRepo, insKey, type InsightKey } from "../core/repos/insights.js";

/**
 * Analitik raporu (panelde Özet ve ağ görünümü; docs/panel/03-PANEL-TASARIM.md §5).
 * Yalnızca mevcut tablolardan okur: kanal anlık görüntüleri (takipçi), yayınlanan hedefler ve gönderi metrikleri, gelen kutusu.
 * - Gün sınırları ve gün × saat ısı haritası çalışma alanının saat diliminde.
 * - Takipçi: anlık görüntüler günlük; aralık başında son bilinen değer taşınır, bağlantıdan önceki günler null (sıfır değil).
 * - Etkileşim: dönemde yayınlanan gönderilerin son çekilen metrikleri (beğeni + yorum + paylaşım + kaydetme). Metriği olmayan gönderi sıfır sayılmaz.
 * - Karşılaştırma: hemen önceki eşit uzunlukta dönem.
 */

export interface ReportQuery {
  from?: string;
  to?: string;
  days?: number;
  provider?: string;
  channelId?: string;
  /** Kampanya panosu: yalnızca bu kampanyanın gönderileri; kanal kümesi kampanyanın kanallarına daralır */
  campaignId?: string;
}

type Num = number | null;

interface Totals {
  posts: number;
  postsWithMetrics: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  interactions: number;
}

const DAY = 86_400_000;
const MAX_DAYS = 366;
const TARGET_LIMIT = 2000;
const LIST_LIMIT = 500;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;

/* ---------------- Saat dilimi yardımcıları (bağımlılıksız) ---------------- */

function partsIn(tz: string, t: number): Record<string, string> {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  return Object.fromEntries(f.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
}

function offsetMs(tz: string, t: number): number {
  const p = partsIn(tz, t);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

/** "YYYY-MM-DD" gününün o saat dilimindeki 00:00 anı (UTC ms) */
export function zonedMidnight(ymd: string, tz: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetMs(tz, guess);
  const second = guess - offsetMs(tz, first);
  return second;
}

export function localYmd(t: number, tz: string): string {
  const p = partsIn(tz, t);
  return `${p.year}-${p.month}-${p.day}`;
}

const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

const isYmd = (s?: string): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));

/* ---------------- Metrik yardımcıları ---------------- */

function interactionsOf(m: Record<string, number>): number {
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? m.saved ?? 0);
}

function viewsOf(m: Record<string, number>): number {
  return m.views ?? m.reach ?? m.impressions ?? 0;
}

function emptyTotals(): Totals {
  return { posts: 0, postsWithMetrics: 0, likes: 0, comments: 0, shares: 0, saves: 0, views: 0, interactions: 0 };
}

function rate(interactions: number, views: number): Num {
  return views > 0 ? Math.round((interactions / views) * 1000) / 10 : null;
}

/** Kanal kümesinin bir gündeki toplam takipçisi; hiçbir kanalın verisi yoksa null */
function sumFollowers(values: Num[]): Num {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/* ---------------- Rapor ---------------- */

export function analyticsReport(orgId: string, q: ReportQuery) {
  const org = orgsRepo.get(orgId);
  const tz = org?.timezone || "Europe/Istanbul";
  const today = localYmd(Date.now(), tz);

  // Aralık: from/to (dahil) ya da son N gün
  let to = isYmd(q.to) ? q.to : today;
  if (to > today) to = today;
  let from = isYmd(q.from) ? q.from : addDays(to, -((q.days && q.days > 0 ? Math.min(q.days, MAX_DAYS) : 30) - 1));
  if (from > to) from = to;
  if (daysBetween(from, to) + 1 > MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
  const length = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(length - 1));

  const fromMs = zonedMidnight(from, tz);
  const toMs = zonedMidnight(addDays(to, 1), tz);
  const prevFromMs = zonedMidnight(prevFrom, tz);

  // Kanallar ve süzgeç
  const all = channelsRepo.list(orgId);
  const supports = (c: Channel) => Boolean(getProvider(c.provider).fetchMetrics);
  const networks = [...new Set(all.map((c) => c.provider))].map((p) => ({
    provider: p,
    channels: all.filter((c) => c.provider === p).length,
    supported: all.some((c) => c.provider === p && supports(c)),
  }));
  // Kampanya süzgecinde kanal kümesi, kampanyanın gönderi attığı kanallardır (takipçi kartı da onlara göre)
  const campaignChannels = q.campaignId ? new Set(postsRepo.publishedBetween(orgId, "0000", "9999", 10_000).filter((t) => t.campaignId === q.campaignId).map((t) => t.channelId)) : null;
  const channels = all.filter((c) => (!q.provider || c.provider === q.provider) && (!q.channelId || c.id === q.channelId) && (!campaignChannels || campaignChannels.has(c.id)));
  const channelIds = new Set(channels.map((c) => c.id));
  const inScope = (t: { channelId: string; campaignId: string | null }) => channelIds.has(t.channelId) && (!q.campaignId || t.campaignId === q.campaignId);

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  /* ---- Takipçi serileri (kanal başına, taşıma ile) ---- */
  const perChannel = channels.map((c) => {
    const snaps = analyticsRepo.between(c.id, from, to);
    const before = analyticsRepo.lastBefore(c.id, from);
    const beforePrev = analyticsRepo.lastBefore(c.id, prevFrom);
    const daily: Num[] = [];
    let carry: Num = before?.metrics.followers ?? null;
    let si = 0;
    for (const d of dates) {
      while (si < snaps.length && snaps[si].date <= d) {
        if (typeof snaps[si].metrics.followers === "number") carry = snaps[si].metrics.followers;
        si++;
      }
      daily.push(carry);
    }
    const end = daily[daily.length - 1] ?? null;
    const firstKnown = daily.find((v) => v !== null) ?? null;
    const start = before?.metrics.followers ?? firstKnown;
    return {
      channel: c,
      daily,
      end,
      delta: end !== null && start !== null ? end - start : null,
      prevEnd: before?.metrics.followers ?? null,
      prevDelta: before?.metrics.followers !== undefined && beforePrev?.metrics.followers !== undefined ? before.metrics.followers - beforePrev.metrics.followers : null,
      supported: supports(c),
    };
  });

  /* ---- Gönderiler ve metrikler (bu dönem + önceki dönem) ---- */
  const current = postsRepo.publishedBetween(orgId, new Date(fromMs).toISOString(), new Date(toMs).toISOString(), TARGET_LIMIT).filter(inScope);
  const previous = postsRepo.publishedBetween(orgId, new Date(prevFromMs).toISOString(), new Date(fromMs).toISOString(), TARGET_LIMIT).filter(inScope);
  const metrics = postMetricsRepo.getMany([...current, ...previous].map((t) => t.id));

  const accumulate = (acc: Totals, m: Record<string, number> | undefined) => {
    acc.posts++;
    if (!m) return;
    acc.postsWithMetrics++;
    acc.likes += m.likes ?? 0;
    acc.comments += m.comments ?? 0;
    acc.shares += m.shares ?? 0;
    acc.saves += m.saves ?? m.saved ?? 0;
    acc.views += viewsOf(m);
    acc.interactions += interactionsOf(m);
  };

  const cur = emptyTotals();
  const prev = emptyTotals();
  for (const t of previous) accumulate(prev, metrics.get(t.id)?.metrics);

  const daily = dates.map((date) => ({ date, posts: 0, interactions: 0, views: 0, likes: 0, comments: 0, shares: 0 }));
  const byChannel = new Map<string, Totals>(channels.map((c) => [c.id, emptyTotals()]));
  const kinds = new Map<PostKind, { posts: number; interactions: number; views: number; withMetrics: number }>();
  const tags = new Map<string, { tag: string; posts: number; interactions: number; views: number; likes: number; comments: number }>();
  const heat = new Map<string, { weekday: number; hour: number; posts: number; interactions: number; withMetrics: number }>();

  for (const t of current) {
    const m = metrics.get(t.id)?.metrics;
    accumulate(cur, m);
    accumulate(byChannel.get(t.channelId)!, m);
    const at = t.publishedAt ? Date.parse(t.publishedAt) : NaN;
    if (Number.isNaN(at)) continue;
    const i = dateIndex.get(localYmd(at, tz));
    if (i !== undefined) {
      daily[i].posts++;
      if (m) {
        daily[i].interactions += interactionsOf(m);
        daily[i].views += viewsOf(m);
        daily[i].likes += m.likes ?? 0;
        daily[i].comments += m.comments ?? 0;
        daily[i].shares += m.shares ?? 0;
      }
    }
    const k = kinds.get(t.kind) ?? { posts: 0, interactions: 0, views: 0, withMetrics: 0 };
    k.posts++;
    if (m) {
      k.withMetrics++;
      k.interactions += interactionsOf(m);
      k.views += viewsOf(m);
    }
    kinds.set(t.kind, k);

    const p = partsIn(tz, at);
    const key = `${WEEKDAY[p.weekday]}-${+p.hour}`;
    const h = heat.get(key) ?? { weekday: WEEKDAY[p.weekday], hour: +p.hour, posts: 0, interactions: 0, withMetrics: 0 };
    h.posts++;
    if (m) {
      h.withMetrics++;
      h.interactions += interactionsOf(m);
    }
    heat.set(key, h);

    const seen = new Set<string>();
    for (const raw of t.content.match(HASHTAG) ?? []) {
      const key2 = raw.toLowerCase();
      if (seen.has(key2)) continue;
      seen.add(key2);
      const e = tags.get(key2) ?? { tag: raw, posts: 0, interactions: 0, views: 0, likes: 0, comments: 0 };
      e.posts++;
      if (m) {
        e.interactions += interactionsOf(m);
        e.views += viewsOf(m);
        e.likes += m.likes ?? 0;
        e.comments += m.comments ?? 0;
      }
      tags.set(key2, e);
    }
  }

  /* ---- Takipçi toplamları ---- */
  const followersDaily = dates.map((_, i) => sumFollowers(perChannel.map((c) => c.daily[i])));
  const providersInView = [...new Set(channels.map((c) => c.provider))];
  const followersByProvider = Object.fromEntries(
    providersInView.map((p) => [p, dates.map((_, i) => sumFollowers(perChannel.filter((c) => c.channel.provider === p).map((c) => c.daily[i])))]),
  ) as Record<ProviderId, Num[]>;

  const sumKnown = (vals: Num[]) => sumFollowers(vals);
  const followersEnd = sumKnown(perChannel.map((c) => c.end));
  const followersPrevEnd = sumKnown(perChannel.map((c) => c.prevEnd));
  const followersDelta = sumKnown(perChannel.map((c) => c.delta));
  const followersPrevDelta = sumKnown(perChannel.map((c) => c.prevDelta));

  /* ---- Gelen kutusu (çalışma alanı geneli; ağ süzgecinden bağımsız) ---- */
  const inboxNow = inboxRepo.periodStats(orgId, new Date(fromMs).toISOString(), new Date(toMs).toISOString());
  const inboxPrev = inboxRepo.periodStats(orgId, new Date(prevFromMs).toISOString(), new Date(fromMs).toISOString());
  const autoRate = (s: { incoming: number; autoReplied: number }): Num => (s.incoming > 0 ? Math.round((s.autoReplied / s.incoming) * 1000) / 10 : null);

  const channelRows = perChannel.map((c) => {
    const tot = byChannel.get(c.channel.id)!;
    return {
      channelId: c.channel.id,
      name: c.channel.name,
      provider: c.channel.provider,
      avatarUrl: c.channel.avatarUrl,
      status: c.channel.status,
      supported: c.supported,
      followers: c.end,
      followersDelta: c.delta,
      posts: tot.posts,
      postsWithMetrics: tot.postsWithMetrics,
      interactions: tot.interactions,
      views: tot.views,
      engagementRate: rate(tot.interactions, tot.views),
    };
  });

  const byProvider = providersInView.map((p) => {
    const rows = channelRows.filter((r) => r.provider === p);
    const interactions = rows.reduce((a, r) => a + r.interactions, 0);
    const views = rows.reduce((a, r) => a + r.views, 0);
    return {
      provider: p,
      channels: rows.length,
      supported: rows.some((r) => r.supported),
      followers: sumKnown(rows.map((r) => r.followers)),
      followersDelta: sumKnown(rows.map((r) => r.followersDelta)),
      posts: rows.reduce((a, r) => a + r.posts, 0),
      postsWithMetrics: rows.reduce((a, r) => a + r.postsWithMetrics, 0),
      interactions,
      views,
      engagementRate: rate(interactions, views),
    };
  });

  const nameOf = new Map(channels.map((c) => [c.id, c]));
  const posts = current.slice(0, LIST_LIMIT).map((t) => {
    const m = metrics.get(t.id);
    const mm = m?.metrics;
    const ch = nameOf.get(t.channelId);
    return {
      targetId: t.id,
      postId: t.postId,
      channelId: t.channelId,
      channel: ch?.name ?? "?",
      provider: ch?.provider ?? null,
      kind: t.kind,
      url: t.externalUrl,
      preview: t.content.slice(0, 220),
      publishedAt: t.publishedAt,
      hasMetrics: Boolean(mm),
      metricsAt: m?.fetchedAt ?? null,
      likes: mm ? (mm.likes ?? 0) : null,
      comments: mm ? (mm.comments ?? 0) : null,
      shares: mm ? (mm.shares ?? 0) : null,
      views: mm ? viewsOf(mm) : null,
      interactions: mm ? interactionsOf(mm) : null,
      engagementRate: mm ? rate(interactionsOf(mm), viewsOf(mm)) : null,
    };
  });

  /* ---- Hesap insights (günlük, tamamlanmış günler) ve kitle ---- */
  const insightSeries = (fromD: string, toD: string, ds: string[]) => {
    const idx = new Map(ds.map((d, i) => [d, i]));
    const series = Object.fromEntries(INSIGHT_KEYS.map((k) => [k, ds.map((): Num => null)])) as Record<InsightKey, Num[]>;
    const withData = new Set<string>();
    for (const c of channels) {
      for (const snap of analyticsRepo.between(c.id, fromD, toD)) {
        const i = idx.get(snap.date);
        if (i === undefined) continue;
        for (const k of INSIGHT_KEYS) {
          const v = snap.metrics[insKey(k)];
          if (typeof v !== "number") continue;
          series[k][i] = (series[k][i] ?? 0) + v;
          withData.add(c.id);
        }
      }
    }
    const totals = Object.fromEntries(INSIGHT_KEYS.map((k) => [k, series[k].some((v) => v !== null) ? series[k].reduce<number>((a, v) => a + (v ?? 0), 0) : null])) as Record<InsightKey, Num>;
    return { series, totals, channels: withData.size };
  };
  const prevDates: string[] = [];
  for (let d = prevFrom; d <= prevTo; d = addDays(d, 1)) prevDates.push(d);
  const insNow = insightSeries(from, to, dates);
  const insPrev = insightSeries(prevFrom, prevTo, prevDates);
  const insights = {
    available: insNow.channels > 0,
    channels: insNow.channels,
    daily: insNow.series,
    kpis: Object.fromEntries(INSIGHT_KEYS.map((k) => [k, { value: insNow.totals[k], prev: insPrev.totals[k] }])) as Record<InsightKey, { value: Num; prev: Num }>,
  };

  // Kitle: takipçi sayıları (Instagram, Facebook) ile izleyici yüzdeleri (YouTube) karıştırılmaz.
  // Kapsamda sayı tabanlı kanal varsa onlar toplanır; yoksa yüzde tabanlılar ortalanır.
  type Dim = "country" | "city" | "age" | "gender";
  const DIMS: Dim[] = ["country", "city", "age", "gender"];
  const withAudience = channels
    .map((c) => ({ c, a: insightsRepo.audience(c.id) }))
    .filter((x): x is { c: Channel; a: NonNullable<ReturnType<typeof insightsRepo.audience>> } => Boolean(x.a && DIMS.some((d) => Object.keys(x.a!.data[d] ?? {}).length)));
  const counted = withAudience.filter((x) => !x.a.data.percent);
  const pool = counted.length ? counted : withAudience;
  const audienceAcc = Object.fromEntries(DIMS.map((d) => [d, new Map<string, number>()])) as Record<Dim, Map<string, number>>;
  for (const { a } of pool) for (const dim of DIMS) for (const [key, v] of Object.entries(a.data[dim] ?? {})) audienceAcc[dim].set(key, (audienceAcc[dim].get(key) ?? 0) + v);
  const percent = !counted.length && pool.length > 0;
  // Yüzdelerde yaş/cinsiyet kanal sayısına bölünür (ortalama pay); ülke değerleri izlenme sayısıdır
  if (percent) for (const dim of ["age", "gender"] as const) for (const [k, v] of audienceAcc[dim]) audienceAcc[dim].set(k, Math.round((v / pool.length) * 10) / 10);
  const listOf = (m: Map<string, number>, limit: number, byKey = false) =>
    [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => (byKey ? a.key.localeCompare(b.key) : b.value - a.value)).slice(0, limit);
  const audience = pool.length
    ? {
        channels: pool.map((x) => x.c.name),
        fetchedAt: pool.map((x) => x.a.fetchedAt).sort()[0] ?? null,
        basis: pool.some((x) => x.a.data.basis === "viewers") && !counted.length ? ("viewers" as const) : ("followers" as const),
        percent,
        country: listOf(audienceAcc.country, 10),
        city: listOf(audienceAcc.city, 10),
        age: listOf(audienceAcc.age, 12, true),
        gender: listOf(audienceAcc.gender, 3),
      }
    : null;

  const heatCells = [...heat.values()].map((h) => ({ ...h, avgInteractions: h.withMetrics ? Math.round((h.interactions / h.withMetrics) * 10) / 10 : null }));

  return {
    range: { from, to, days: length, prevFrom, prevTo, tz, today },
    filter: { provider: q.provider ?? null, channelId: q.channelId ?? null, campaignId: q.campaignId ?? null },
    networks,
    truncated: current.length >= TARGET_LIMIT,
    kpis: {
      followers: { value: followersEnd, prev: followersPrevEnd },
      followersDelta: { value: followersDelta, prev: followersPrevDelta },
      posts: { value: cur.posts, prev: prev.posts },
      postsWithMetrics: { value: cur.postsWithMetrics, prev: prev.postsWithMetrics },
      interactions: { value: cur.interactions, prev: prev.interactions },
      likes: { value: cur.likes, prev: prev.likes },
      comments: { value: cur.comments, prev: prev.comments },
      shares: { value: cur.shares, prev: prev.shares },
      views: { value: cur.views, prev: prev.views },
      engagementRate: { value: rate(cur.interactions, cur.views), prev: rate(prev.interactions, prev.views) },
      autoReplyRate: { value: autoRate(inboxNow), prev: autoRate(inboxPrev) },
      incomingMessages: { value: inboxNow.incoming, prev: inboxPrev.incoming },
    },
    daily: daily.map((d, i) => ({ ...d, followers: followersDaily[i] })),
    followersByProvider,
    channels: channelRows,
    byProvider,
    kinds: [...kinds.entries()].map(([kind, v]) => ({ kind, posts: v.posts, withMetrics: v.withMetrics, interactions: v.interactions, views: v.views, avgInteractions: v.withMetrics ? Math.round((v.interactions / v.withMetrics) * 10) / 10 : null })).sort((a, b) => b.posts - a.posts),
    hashtags: [...tags.values()].sort((a, b) => b.interactions - a.interactions || b.posts - a.posts).slice(0, 50),
    heatmap: { cells: heatCells, maxAvg: Math.max(0, ...heatCells.map((c) => c.avgInteractions ?? 0)) },
    posts,
    insights,
    audience,
  };
}

export type AnalyticsReport = ReturnType<typeof analyticsReport>;

/**
 * Takvimdeki "en iyi saatler" katmanı: yalnızca gün × saat ısı haritası ve en iyi 5 saat.
 * Kaynak raporla aynı (kendi gönderilerinin ortalama etkileşimi); tek hücrelik şans etkisini azaltmak için
 * "en iyi" listesine en az 2 metrikli gönderisi olan hücreler girer.
 */
export function bestTimes(orgId: string, q: { days?: number; provider?: string; channelId?: string }) {
  const r = analyticsReport(orgId, { days: q.days ?? 90, provider: q.provider, channelId: q.channelId });
  const top = r.heatmap.cells
    .filter((c) => c.withMetrics >= 2 && c.avgInteractions !== null)
    .sort((a, b) => (b.avgInteractions ?? 0) - (a.avgInteractions ?? 0))
    .slice(0, 5)
    .map((c) => ({ weekday: c.weekday, hour: c.hour }));
  return { range: r.range, cells: r.heatmap.cells, maxAvg: r.heatmap.maxAvg, top };
}
