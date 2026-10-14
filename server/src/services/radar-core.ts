/**
 * İçerik Radarı çekirdeği: Instagram verisini normalleştirir, "tutan içerik" skorunu (outlier) hesaplar,
 * üreticileri sıralar, nişe dair içgörü çıkarır ve iki kaynaktan (Meta Business Discovery, Apify) veri çeker.
 *
 * Bu dosya hiçbir şey import etmez: bağımsız uygulama ile Reblebi aynı dosyayı olduğu gibi kullanır.
 * Değiştirirsen iki kopyayı da güncelle (icerik-radari/src/radar-core.ts ↔ sosyalpilot/server/src/services/radar-core.ts).
 */

/* ============================== Tipler ============================== */

export type Region = "TR" | "GLOBAL";
export type MediaKind = "REEL" | "VIDEO" | "CAROUSEL" | "IMAGE";
export type Metric = "views" | "engagement" | "comments";

/** Bir Instagram gönderisi, kaynaktan bağımsız biçimde */
export interface RadarPost {
  /** Kalıcı anahtar: shortcode (iki kaynak da aynı gönderi için aynı değeri verir) */
  key: string;
  shortcode: string | null;
  permalink: string | null;
  kind: MediaKind;
  caption: string;
  thumbnailUrl: string | null;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** Sabitlenmiş gönderi (Apify bildirir); taban hesabında sayılmaz */
  pinned?: boolean;
  /** Gönderi sahibi (hashtag keşfinde gelir) */
  owner?: string | null;
}

/** Bir Instagram hesabı ve son gönderileri */
export interface RadarAccount {
  username: string;
  fullName: string | null;
  biography: string | null;
  avatarUrl: string | null;
  followers: number | null;
  following: number | null;
  mediaCount: number | null;
  isBusiness: boolean | null;
  category: string | null;
  website: string | null;
  verified: boolean | null;
  posts: RadarPost[];
}

export interface ScoredPost extends RadarPost {
  /** beğeni + yorum (ikisi de biliniyorsa) */
  engagement: number | null;
  /** Gönderinin, hesabın diğer gönderilerinin medyanına oranı (ör. 6.2 = medyanın 6,2 katı) */
  outlier: number | null;
  /** Outlier hangi ölçüyle hesaplandı */
  metric: Metric | null;
  /** Etkileşim / takipçi (%) */
  engagementRate: number | null;
  /** İzlenme / takipçi (kat) */
  reachRatio: number | null;
  /** 48 saatten genç: skor hâlâ yükselebilir */
  early: boolean;
  ageHours: number | null;
}

export type Level = "patlama" | "viral" | "ustun" | "normal";

/* ============================== Yardımcılar ============================== */

const HOUR = 3_600_000;
export const EARLY_HOURS = 48;
/** Taban (medyan) için en az bu kadar başka gönderi gerekir */
export const MIN_BASELINE = 3;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function levelOf(outlier: number | null): Level {
  if (outlier === null) return "normal";
  if (outlier >= 10) return "patlama";
  if (outlier >= 5) return "viral";
  if (outlier >= 2.5) return "ustun";
  return "normal";
}

export function normalizeUsername(raw: string): string | null {
  const u = raw
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "")
    .replace(/^@+/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(u) && !/^\.|\.$|\.\./.test(u) ? u : null;
}

export function shortcodeOf(permalink: string | null | undefined): string | null {
  const m = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(permalink ?? "");
  return m ? m[1] : null;
}

/** Açıklamanın ilk anlamlı satırı (kanca) */
export function firstLine(caption: string, max = 140): string {
  const line = (caption || "").split(/\r?\n/).map((s) => s.trim()).find((s) => s.replace(/[#@][\p{L}\p{N}._]+/gu, "").trim().length > 2) ?? "";
  return line.length <= max ? line : line.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

export function extractHashtags(caption: string): string[] {
  const out = new Set<string>();
  for (const m of (caption || "").matchAll(/#([\p{L}\p{N}_]{2,60})/gu)) out.add(m[1].toLocaleLowerCase("tr"));
  return [...out];
}

export function extractMentions(caption: string): string[] {
  const out = new Set<string>();
  for (const m of (caption || "").matchAll(/(?<![\w.@])@([A-Za-z0-9._]{1,30})/g)) {
    const u = m[1].replace(/\.+$/, "").toLowerCase();
    if (u && normalizeUsername(u)) out.add(u);
  }
  return [...out];
}

export function extractEmail(text: string | null | undefined): string | null {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(text ?? "")?.[0] ?? null;
}

/* ============================== Skorlama ============================== */

const engagementOf = (p: RadarPost) => (p.likes !== null && p.comments !== null ? p.likes + p.comments : null);
const ageHoursOf = (p: RadarPost, now: number) => (p.postedAt && !Number.isNaN(Date.parse(p.postedAt)) ? Math.max(0, (now - Date.parse(p.postedAt)) / HOUR) : null);

/**
 * Hesabın gönderilerini puanlar. Outlier = gönderinin ölçüsü / hesabın DİĞER gönderilerinin medyanı.
 * Ölçü sırası: izlenme (Reel'lerde) → beğeni+yorum → yorum (beğeni gizliyse).
 * Taban hesaplanırken 48 saatten genç ve sabitlenmiş gönderiler dışarıda kalır (henüz olgunlaşmamış / seçilmiş).
 */
export function scoreAccount(acc: { followers: number | null; posts: RadarPost[] }, now = Date.now()): ScoredPost[] {
  const rows = acc.posts.map((p) => {
    const ageHours = ageHoursOf(p, now);
    return { p, engagement: engagementOf(p), ageHours, mature: ageHours !== null && ageHours >= EARLY_HOURS && !p.pinned };
  });
  const pick: Record<Metric, (r: (typeof rows)[number]) => number | null> = {
    views: (r) => r.p.views,
    engagement: (r) => r.engagement,
    comments: (r) => r.p.comments,
  };
  const baselineFor = (metric: Metric, self: (typeof rows)[number]): number | null => {
    const xs = rows.filter((r) => r !== self && r.mature).map(pick[metric]).filter((v): v is number => v !== null);
    if (xs.length < MIN_BASELINE) return null;
    return Math.max(median(xs)!, 1);
  };
  const f = acc.followers && acc.followers > 0 ? acc.followers : null;
  return rows.map((r) => {
    let outlier: number | null = null;
    let metric: Metric | null = null;
    for (const m of ["views", "engagement", "comments"] as Metric[]) {
      const v = pick[m](r);
      if (v === null) continue;
      const base = baselineFor(m, r);
      if (base === null) continue;
      outlier = round(v / base, 2);
      metric = m;
      break;
    }
    return {
      ...r.p,
      engagement: r.engagement,
      outlier,
      metric,
      engagementRate: f && r.engagement !== null ? round((r.engagement / f) * 100, 2) : null,
      reachRatio: f && r.p.views !== null ? round(r.p.views / f, 2) : null,
      early: r.ageHours !== null && r.ageHours < EARLY_HOURS,
      ageHours: r.ageHours === null ? null : round(r.ageHours, 1),
    };
  });
}

/* ============================== Üretici özeti ve sıralama ============================== */

export interface FollowerPoint {
  date: string;
  followers: number | null;
}

export interface CreatorStats {
  followers: number | null;
  /** Son ~30 gündeki takipçi değişimi (%), yeterli geçmiş yoksa null */
  growth30: number | null;
  growth30Abs: number | null;
  postsPerWeek: number | null;
  medianEngagement: number | null;
  /** medyan etkileşim / takipçi (%) */
  engagementRate: number | null;
  medianViews: number | null;
  /** medyan izlenme / takipçi (kat) */
  reachRatio: number | null;
  /** Olgun gönderilerin yüzde kaçı hesabın medyanının 2,5 katını geçmiş */
  hitRate: number | null;
  /** 5x ve üstü gönderi sayısı */
  viralCount: number;
  bestOutlier: number | null;
  sample: number;
}

export function creatorStats(followers: number | null, scored: ScoredPost[], history: FollowerPoint[] = [], now = Date.now()): CreatorStats {
  const mature = scored.filter((p) => !p.early && !p.pinned);
  const eng = mature.map((p) => p.engagement).filter((v): v is number => v !== null);
  const views = mature.map((p) => p.views).filter((v): v is number => v !== null);
  const medEng = median(eng);
  const medViews = median(views);
  const outs = mature.map((p) => p.outlier).filter((v): v is number => v !== null);
  const allOuts = scored.map((p) => p.outlier).filter((v): v is number => v !== null);
  const recent = scored.filter((p) => p.postedAt && now - Date.parse(p.postedAt) <= 28 * 24 * HOUR).length;
  const dated = scored.filter((p) => p.postedAt).map((p) => Date.parse(p.postedAt!)).sort((a, b) => a - b);
  // Örneklem 28 günü kapsamıyorsa (çok sık paylaşan hesap) sıklığı örneklemin süresinden hesapla
  let perWeek: number | null = null;
  if (dated.length >= 2) {
    const spanDays = (dated[dated.length - 1] - dated[0]) / (24 * HOUR);
    perWeek = spanDays < 28 && dated.length >= 5 ? round(((dated.length - 1) / Math.max(spanDays, 1)) * 7, 1) : round(recent / 4, 1);
  }
  let growth30: number | null = null;
  let growth30Abs: number | null = null;
  const pts = history.filter((h) => h.followers !== null).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length >= 2 && followers) {
    const cutoff = new Date(now - 30 * 24 * HOUR).toISOString().slice(0, 10);
    const start = pts.find((h) => h.date >= cutoff) ?? pts[0];
    const spanDays = (now - Date.parse(start.date)) / (24 * HOUR);
    if (spanDays >= 3 && start.followers) {
      growth30Abs = followers - start.followers;
      growth30 = round((growth30Abs / start.followers) * 100, 2);
    }
  }
  const f = followers && followers > 0 ? followers : null;
  return {
    followers,
    growth30,
    growth30Abs,
    postsPerWeek: perWeek,
    medianEngagement: medEng,
    engagementRate: f && medEng !== null ? round((medEng / f) * 100, 2) : null,
    medianViews: medViews,
    reachRatio: f && medViews !== null ? round(medViews / f, 2) : null,
    hitRate: outs.length ? round((outs.filter((o) => o >= 2.5).length / outs.length) * 100, 0) : null,
    viralCount: scored.filter((p) => (p.outlier ?? 0) >= 5).length,
    bestOutlier: allOuts.length ? Math.max(...allOuts) : null,
    sample: scored.length,
  };
}

/** Değerin listedeki yüzdelik sırası (0-1); eşitlikte ortalama sıra */
function percentile(values: number[], v: number): number {
  if (values.length <= 1) return 0.5;
  const below = values.filter((x) => x < v).length;
  const equal = values.filter((x) => x === v).length;
  return (below + (equal - 1) / 2) / (values.length - 1);
}

/**
 * Radar puanı (0-100): üreticileri kendi aralarında karşılaştırır (aynı niş içinde anlamlıdır).
 * Ağırlıklar: etkileşim oranı 30, erişim (izlenme/takipçi; yoksa medyan etkileşim) 25, büyüme 25, isabet oranı 10, sıklık 10.
 * Bir bileşen kimsede yoksa ağırlığı diğerlerine dağıtılır.
 */
export function radarScores(list: CreatorStats[]): Array<number | null> {
  const parts: Array<{ w: number; get: (s: CreatorStats) => number | null }> = [
    { w: 30, get: (s) => s.engagementRate },
    { w: 25, get: (s) => s.reachRatio ?? (s.medianEngagement !== null ? Math.log10(s.medianEngagement + 1) : null) },
    { w: 25, get: (s) => s.growth30 },
    { w: 10, get: (s) => s.hitRate },
    { w: 10, get: (s) => (s.postsPerWeek !== null ? Math.min(s.postsPerWeek, 14) : null) },
  ];
  const pool = list.filter((s) => s.sample > 0);
  const cols = parts.map((p) => pool.map(p.get).filter((v): v is number => v !== null));
  return list.map((s) => {
    if (s.sample === 0) return null;
    let total = 0;
    let weight = 0;
    parts.forEach((p, i) => {
      const v = p.get(s);
      if (v === null || cols[i].length < 2) return;
      total += percentile(cols[i], v) * p.w;
      weight += p.w;
    });
    return weight ? Math.round((total / weight) * 100) : null;
  });
}

/* ============================== İçgörüler ============================== */

export interface FormatInsight {
  kind: MediaKind;
  count: number;
  medianOutlier: number | null;
  hitRate: number | null;
  medianEngagement: number | null;
  medianViews: number | null;
}

export function formatInsights(posts: ScoredPost[]): FormatInsight[] {
  const kinds: MediaKind[] = ["REEL", "CAROUSEL", "IMAGE", "VIDEO"];
  return kinds
    .map((kind) => {
      const xs = posts.filter((p) => p.kind === kind && !p.early);
      const outs = xs.map((p) => p.outlier).filter((v): v is number => v !== null);
      return {
        kind,
        count: xs.length,
        medianOutlier: outs.length ? round(median(outs)!, 2) : null,
        hitRate: outs.length ? round((outs.filter((o) => o >= 2.5).length / outs.length) * 100, 0) : null,
        medianEngagement: median(xs.map((p) => p.engagement).filter((v): v is number => v !== null)),
        medianViews: median(xs.map((p) => p.views).filter((v): v is number => v !== null)),
      };
    })
    .filter((f) => f.count > 0);
}

/** Gün (0=Pazartesi) x 3 saatlik dilim (0=00-03 … 7=21-24): gönderi sayısı ve medyan outlier */
export function timeHeatmap(posts: ScoredPost[], timeZone = "Europe/Istanbul"): Array<Array<{ count: number; medianOutlier: number | null }>> {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" });
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cells: number[][][] = Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => [] as number[]));
  const counts = Array.from({ length: 7 }, () => Array(8).fill(0) as number[]);
  for (const p of posts) {
    if (!p.postedAt || p.early) continue;
    const parts = fmt.formatToParts(new Date(p.postedAt));
    const d = days.indexOf(parts.find((x) => x.type === "weekday")?.value ?? "");
    const h = Number(parts.find((x) => x.type === "hour")?.value);
    if (d < 0 || !Number.isFinite(h)) continue;
    const slot = Math.min(7, Math.floor(h / 3));
    counts[d][slot]++;
    if (p.outlier !== null) cells[d][slot].push(p.outlier);
  }
  return cells.map((row, d) => row.map((xs, s) => ({ count: counts[d][s], medianOutlier: xs.length ? round(median(xs)!, 2) : null })));
}

export interface TagInsight {
  tag: string;
  count: number;
  medianOutlier: number | null;
  accounts: number;
}

export function hashtagInsights(posts: Array<ScoredPost & { owner?: string | null }>, minCount = 2): TagInsight[] {
  const map = new Map<string, { outs: number[]; count: number; owners: Set<string> }>();
  for (const p of posts) {
    for (const t of extractHashtags(p.caption)) {
      const e = map.get(t) ?? { outs: [], count: 0, owners: new Set<string>() };
      e.count++;
      if (p.outlier !== null) e.outs.push(p.outlier);
      if (p.owner) e.owners.add(p.owner);
      map.set(t, e);
    }
  }
  return [...map.entries()]
    .filter(([, e]) => e.count >= minCount)
    .map(([tag, e]) => ({ tag, count: e.count, medianOutlier: e.outs.length ? round(median(e.outs)!, 2) : null, accounts: e.owners.size }))
    .sort((a, b) => (b.medianOutlier ?? 0) * Math.log2(b.count + 1) - (a.medianOutlier ?? 0) * Math.log2(a.count + 1));
}

export interface MentionSuggestion {
  username: string;
  count: number;
  /** Bu hesabı etiketleyen takip edilen hesaplar */
  mentionedBy: string[];
  /** Bu hesabı etiketleyen gönderilerin en yüksek outlier'ı */
  bestOutlier: number | null;
}

/** Takip edilen hesapların gönderilerinde etiketlenen ama henüz takip edilmeyen hesaplar */
export function mentionSuggestions(posts: Array<{ caption: string; owner: string | null; outlier: number | null }>, exclude: Set<string>): MentionSuggestion[] {
  const map = new Map<string, { count: number; by: Set<string>; best: number | null }>();
  for (const p of posts) {
    for (const u of extractMentions(p.caption)) {
      if (exclude.has(u) || u === p.owner) continue;
      const e = map.get(u) ?? { count: 0, by: new Set<string>(), best: null };
      e.count++;
      if (p.owner) e.by.add(p.owner);
      if (p.outlier !== null) e.best = Math.max(e.best ?? 0, p.outlier);
      map.set(u, e);
    }
  }
  return [...map.entries()]
    .map(([username, e]) => ({ username, count: e.count, mentionedBy: [...e.by].sort(), bestOutlier: e.best }))
    .sort((a, b) => b.mentionedBy.length - a.mentionedBy.length || b.count - a.count);
}

/* ============================== Kaynak 1: Meta Business Discovery ============================== */

export type GraphErrorKind = "field" | "not_found" | "rate_limit" | "auth" | "other";

export class GraphError extends Error {
  code: number | null;
  subcode: number | null;
  kind: GraphErrorKind;
  constructor(message: string, code: number | null, subcode: number | null, status: number) {
    super(message);
    this.name = "GraphError";
    this.code = code;
    this.subcode = subcode;
    const msg = message.toLowerCase();
    this.kind =
      code === 4 || code === 17 || code === 32 || code === 613 || code === 80002 || status === 429
        ? "rate_limit"
        : code === 190 || code === 102 || code === 10 || (code !== null && code >= 200 && code < 300)
          ? "auth"
          : code === 100 && /nonexist|unknown field|tried accessing/.test(msg)
            ? "field"
            : code === 110 || subcode === 2207013 || /cannot find user|business_discovery|not a business|invalid user/.test(msg)
              ? "not_found"
              : "other";
  }
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export function graphBase(token: string): string {
  // Instagram ile Giriş jetonları (IGAA…) graph.instagram.com'da, Facebook ile Giriş jetonları graph.facebook.com'da çalışır
  return /^IG/.test(token) ? "https://graph.instagram.com/v23.0" : "https://graph.facebook.com/v23.0";
}

export async function graphGet<T>(path: string, token: string, params: Record<string, string | number>, opts: { base?: string; fetch?: FetchLike; timeoutMs?: number } = {}): Promise<T> {
  const base = opts.base ?? graphBase(token);
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  // graph.instagram.com yetkilendirme başlığını her uçta kabul etmiyor; jeton parametre olarak gider (URL hiçbir yerde günlüğe yazılmaz)
  url.searchParams.set("access_token", token);
  const f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const r = await f(url.toString(), { signal: ctrl.signal });
    const body = (await r.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number } };
    if (!r.ok || body.error) {
      const e = body.error ?? {};
      throw new GraphError(e.message || `Graph HTTP ${r.status}`, e.code ?? null, e.error_subcode ?? null, r.status);
    }
    return body as T;
  } catch (e) {
    if (e instanceof GraphError) throw e;
    throw new GraphError(e instanceof Error && e.name === "AbortError" ? "Meta isteği zaman aşımına uğradı" : String(e instanceof Error ? e.message : e), null, null, 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Alan kümeleri: en zengin olandan başlanır, Meta "böyle alan yok" derse bir alt kümeye inilir */
const BD_PROFILE_FIELDS = ["username,name,profile_picture_url,biography,followers_count,follows_count,media_count,website", "username,name,profile_picture_url,biography,followers_count,media_count"];
const BD_MEDIA_FIELDS = [
  "id,caption,like_count,comments_count,view_count,timestamp,media_type,media_product_type,permalink,media_url,thumbnail_url",
  "id,caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink,media_url,thumbnail_url",
  "id,caption,like_count,comments_count,timestamp,media_type,permalink",
];
/** Süreç boyunca hangi alan kümesinin çalıştığı hatırlanır (her hesapta tekrar denenmesin) */
let bdLevel = 0;

type BdMedia = {
  id: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
  view_count?: number;
  timestamp?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  media_url?: string;
  thumbnail_url?: string;
};
type BdAccount = {
  username?: string;
  name?: string;
  profile_picture_url?: string;
  biography?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  website?: string;
  media?: { data?: BdMedia[]; paging?: { cursors?: { after?: string } } };
};

export function kindFromGraph(mediaType?: string, productType?: string): MediaKind {
  const t = (mediaType ?? "").toUpperCase();
  const pt = (productType ?? "").toUpperCase();
  if (t === "CAROUSEL_ALBUM") return "CAROUSEL";
  if (t === "VIDEO") return pt === "FEED" ? "VIDEO" : "REEL";
  return "IMAGE";
}

export function postFromGraph(m: BdMedia): RadarPost {
  const shortcode = shortcodeOf(m.permalink);
  const kind = kindFromGraph(m.media_type, m.media_product_type);
  return {
    key: shortcode ?? `ig:${m.id}`,
    shortcode,
    permalink: m.permalink ?? null,
    kind,
    caption: m.caption ?? "",
    thumbnailUrl: (kind === "REEL" || kind === "VIDEO" ? (m.thumbnail_url ?? m.media_url) : (m.media_url ?? m.thumbnail_url)) ?? null,
    postedAt: m.timestamp ? new Date(m.timestamp).toISOString() : null,
    likes: num(m.like_count),
    comments: num(m.comments_count),
    views: num(m.view_count),
  };
}

export function accountFromGraph(b: BdAccount, fallbackUsername: string): RadarAccount {
  return {
    username: (b.username ?? fallbackUsername).toLowerCase(),
    fullName: str(b.name),
    biography: str(b.biography),
    avatarUrl: str(b.profile_picture_url),
    followers: num(b.followers_count),
    following: num(b.follows_count),
    mediaCount: num(b.media_count),
    isBusiness: true,
    category: null,
    website: str(b.website),
    verified: null,
    posts: (b.media?.data ?? []).map(postFromGraph),
  };
}

/**
 * Business Discovery: kendi işletme/üretici IG hesabının jetonuyla başka bir işletme/üretici hesabının
 * herkese açık profilini ve son gönderilerini getirir. Kişisel hesaplar desteklenmez (GraphError kind=not_found).
 */
export async function fetchBusinessDiscovery(
  opts: { igUserId: string; token: string; username: string; limit?: number; base?: string; fetch?: FetchLike },
): Promise<RadarAccount> {
  const clean = opts.username.replace(/^@/, "").trim().toLowerCase();
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 50);
  let profileLevel = 0;
  for (;;) {
    const fields = `business_discovery.username(${clean}){${BD_PROFILE_FIELDS[profileLevel]},media.limit(${limit}){${BD_MEDIA_FIELDS[bdLevel]}}}`;
    try {
      const r = await graphGet<{ business_discovery?: BdAccount }>(`/${opts.igUserId}`, opts.token, { fields }, { base: opts.base, fetch: opts.fetch });
      if (!r.business_discovery) throw new GraphError("Hesap bulunamadı ya da işletme/üretici hesabı değil", 110, null, 404);
      return accountFromGraph(r.business_discovery, clean);
    } catch (e) {
      if (e instanceof GraphError && e.kind === "field") {
        if (bdLevel < BD_MEDIA_FIELDS.length - 1) {
          bdLevel++;
          continue;
        }
        if (profileLevel < BD_PROFILE_FIELDS.length - 1) {
          profileLevel++;
          continue;
        }
      }
      throw e;
    }
  }
}

/** Jetonun erişebildiği Instagram işletme hesapları (Facebook ile Giriş: Sayfalar üzerinden; Instagram ile Giriş: kendisi) */
export async function listInstagramAccounts(token: string, fetchImpl?: FetchLike): Promise<Array<{ igUserId: string; username: string; pageName: string | null }>> {
  if (/^IG/.test(token)) {
    const me = await graphGet<{ user_id?: string; id?: string; username?: string }>("/me", token, { fields: "user_id,username" }, { fetch: fetchImpl });
    return [{ igUserId: String(me.user_id ?? me.id), username: me.username ?? "", pageName: null }];
  }
  const r = await graphGet<{ data?: Array<{ name?: string; instagram_business_account?: { id: string; username?: string } }> }>(
    "/me/accounts",
    token,
    { fields: "name,instagram_business_account{id,username}", limit: 100 },
    { fetch: fetchImpl },
  );
  return (r.data ?? []).filter((p) => p.instagram_business_account).map((p) => ({ igUserId: p.instagram_business_account!.id, username: p.instagram_business_account!.username ?? "", pageName: p.name ?? null }));
}

/** Kısa ömürlü kullanıcı jetonunu 60 günlük jetona çevirir (Facebook ile Giriş; uygulama kimliği ve gizli anahtarı gerekir) */
export async function exchangeLongLived(token: string, appId: string, appSecret: string, fetchImpl?: FetchLike): Promise<{ token: string; expiresAt: string | null }> {
  const r = await graphGet<{ access_token: string; expires_in?: number }>(
    "/oauth/access_token",
    token,
    { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: token },
    { base: "https://graph.facebook.com/v23.0", fetch: fetchImpl },
  );
  return { token: r.access_token, expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null };
}

/* ============================== Kaynak 2: Apify ============================== */

export const APIFY_PROFILE_ACTOR = "apify~instagram-profile-scraper";
export const APIFY_HASHTAG_ACTOR = "apify~instagram-hashtag-scraper";
export const APIFY_SEARCH_ACTOR = "apify~instagram-search-scraper";

export class ApifyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApifyError";
    this.status = status;
  }
}

/**
 * Apify aktörünü çalıştırır, bitmesini bekler ve veri kümesini döndürür.
 * Jeton URL'ye değil başlığa konur (günlüklerde görünmesin). maxChargeUsd, ödeme-olay-başına aktörlerde harcama tavanıdır.
 */
export async function runApifyActor(opts: {
  token: string;
  actor: string;
  input: unknown;
  maxItems?: number;
  maxChargeUsd?: number;
  timeoutMs?: number;
  fetch?: FetchLike;
  onProgress?: (msg: string) => void;
}): Promise<unknown[]> {
  const f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const api = "https://api.apify.com/v2";
  const headers = { authorization: `Bearer ${opts.token}`, "content-type": "application/json" };
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  const q = new URLSearchParams({ waitForFinish: "30" });
  if (opts.maxItems) q.set("maxItems", String(opts.maxItems));
  if (opts.maxChargeUsd) q.set("maxTotalChargeUsd", String(opts.maxChargeUsd));
  const start = await f(`${api}/acts/${encodeURIComponent(opts.actor)}/runs?${q}`, { method: "POST", headers, body: JSON.stringify(opts.input) });
  const startBody = (await start.json().catch(() => ({}))) as { data?: { id: string; status: string; defaultDatasetId: string }; error?: { message?: string } };
  if (!start.ok || !startBody.data) throw new ApifyError(startBody.error?.message || `Apify HTTP ${start.status}`, start.status);
  let run = startBody.data;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
    if (Date.now() > deadline) throw new ApifyError("Apify çalışması zaman aşımına uğradı", 408);
    opts.onProgress?.(`Apify çalışıyor (${run.status})…`);
    const r = await f(`${api}/actor-runs/${run.id}?waitForFinish=30`, { headers });
    const b = (await r.json().catch(() => ({}))) as { data?: typeof run };
    if (!r.ok || !b.data) throw new ApifyError(`Apify durum HTTP ${r.status}`, r.status);
    run = b.data;
  }
  // Tavana takılan çalışma ABORTED/FAILED olabilir; o ana kadar toplananlar yine de kullanılır
  const items = await f(`${api}/datasets/${run.defaultDatasetId}/items?clean=true&format=json`, { headers });
  const list = (await items.json().catch(() => [])) as unknown;
  if (!Array.isArray(list)) throw new ApifyError(`Apify veri kümesi okunamadı (HTTP ${items.status})`, items.status);
  if (run.status !== "SUCCEEDED" && !list.length) throw new ApifyError(`Apify çalışması ${run.status} bitti`, 500);
  return list;
}

/** Apify hesabının aylık kullanımı; eksik dönen profillerin sebebi çoğu zaman dolan aylık sınırdır */
export async function apifyUsage(token: string, fetchImpl?: FetchLike): Promise<{ usedUsd: number | null; maxUsd: number | null; resetsAt: string | null; exhausted: boolean } | null> {
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  try {
    const r = await f("https://api.apify.com/v2/users/me/limits", { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const d = ((await r.json()) as { data?: { current?: { monthlyUsageUsd?: number }; limits?: { maxMonthlyUsageUsd?: number }; monthlyUsageCycle?: { endAt?: string } } }).data;
    const used = num(d?.current?.monthlyUsageUsd);
    const max = num(d?.limits?.maxMonthlyUsageUsd);
    return { usedUsd: used, maxUsd: max, resetsAt: d?.monthlyUsageCycle?.endAt ?? null, exhausted: used !== null && max !== null && used >= max - 0.01 };
  } catch {
    return null;
  }
}

export function apifyExhaustedMessage(u: { usedUsd: number | null; maxUsd: number | null; resetsAt: string | null }): string {
  const reset = u.resetsAt ? new Date(Date.parse(u.resetsAt) + 1000).toLocaleDateString("tr-TR", { day: "numeric", month: "long" }) : null;
  return `Apify aylık kullanım sınırı doldu (${u.usedUsd?.toFixed(2)}$ / ${u.maxUsd}$)${reset ? `; ${reset} tarihinde yenilenir` : ""}`;
}

type ApifyPost = {
  id?: string;
  type?: string;
  productType?: string;
  shortCode?: string;
  caption?: string;
  url?: string;
  displayUrl?: string;
  commentsCount?: number;
  likesCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  timestamp?: string;
  isPinned?: boolean;
  ownerUsername?: string;
};

export function kindFromApify(type?: string, productType?: string): MediaKind {
  const t = (type ?? "").toLowerCase();
  if (t === "sidecar") return "CAROUSEL";
  if (t === "video") return (productType ?? "").toLowerCase() === "feed" ? "VIDEO" : "REEL";
  return "IMAGE";
}

export function postFromApify(p: ApifyPost): RadarPost {
  const shortcode = p.shortCode ?? shortcodeOf(p.url);
  return {
    key: shortcode ?? `ap:${p.id}`,
    shortcode: shortcode ?? null,
    permalink: p.url ?? (shortcode ? `https://www.instagram.com/p/${shortcode}/` : null),
    kind: kindFromApify(p.type, p.productType),
    caption: p.caption ?? "",
    thumbnailUrl: str(p.displayUrl),
    postedAt: p.timestamp ? new Date(p.timestamp).toISOString() : null,
    likes: num(p.likesCount),
    comments: num(p.commentsCount),
    views: num(p.videoPlayCount) ?? num(p.videoViewCount),
    pinned: Boolean(p.isPinned),
    owner: p.ownerUsername ? p.ownerUsername.toLowerCase() : null,
  };
}

type ApifyProfile = {
  username?: string;
  fullName?: string;
  biography?: string;
  profilePicUrl?: string;
  profilePicUrlHD?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  isBusinessAccount?: boolean;
  businessCategoryName?: string;
  externalUrl?: string;
  verified?: boolean;
  private?: boolean;
  latestPosts?: ApifyPost[];
  error?: string;
};

export function accountFromApify(p: ApifyProfile): RadarAccount {
  return {
    username: (p.username ?? "").toLowerCase(),
    fullName: str(p.fullName),
    biography: str(p.biography),
    avatarUrl: str(p.profilePicUrlHD) ?? str(p.profilePicUrl),
    followers: num(p.followersCount),
    following: num(p.followsCount),
    mediaCount: num(p.postsCount),
    isBusiness: typeof p.isBusinessAccount === "boolean" ? p.isBusinessAccount : null,
    category: str(p.businessCategoryName),
    website: str(p.externalUrl),
    verified: typeof p.verified === "boolean" ? p.verified : null,
    posts: (p.latestPosts ?? []).map(postFromApify),
  };
}

/** Birden çok profili tek Apify çalışmasında çeker (profil başına ücretlendirilir; her profilde son ~12 gönderi gelir) */
export async function fetchApifyProfiles(opts: { token: string; usernames: string[]; actor?: string; maxChargeUsd?: number; fetch?: FetchLike; onProgress?: (msg: string) => void }): Promise<{
  accounts: RadarAccount[];
  missing: string[];
}> {
  const items = (await runApifyActor({
    token: opts.token,
    actor: opts.actor || APIFY_PROFILE_ACTOR,
    input: { usernames: opts.usernames },
    maxChargeUsd: opts.maxChargeUsd,
    fetch: opts.fetch,
    onProgress: opts.onProgress,
  })) as ApifyProfile[];
  const accounts = items.filter((p) => p && p.username && !p.error).map(accountFromApify);
  const got = new Set(accounts.map((a) => a.username));
  return { accounts, missing: opts.usernames.filter((u) => !got.has(u.toLowerCase())) };
}

export interface FoundUser {
  username: string;
  fullName: string | null;
  followers: number | null;
  biography: string | null;
  avatarUrl: string | null;
  verified: boolean | null;
  isBusiness: boolean | null;
  /** Hangi arama kelimesiyle bulundu */
  query: string;
}

/**
 * Anahtar kelimeyle Instagram hesabı arar (ör. "almanca", "deutsch lernen", "yds").
 * Resmî API'de hesap araması olmadığı için yalnız Apify ile çalışır. Takipçiye göre büyükten küçüğe döner.
 */
export async function searchApifyUsers(opts: { token: string; queries: string[]; perQuery?: number; actor?: string; maxChargeUsd?: number; fetch?: FetchLike; onProgress?: (msg: string) => void }): Promise<FoundUser[]> {
  const queries = [...new Set(opts.queries.map((q) => q.trim()).filter(Boolean))].slice(0, 10);
  if (!queries.length) return [];
  const per = Math.min(Math.max(opts.perQuery ?? 30, 5), 100);
  const items = (await runApifyActor({
    token: opts.token,
    actor: opts.actor || APIFY_SEARCH_ACTOR,
    input: { search: queries.join(","), searchType: "user", searchLimit: per },
    maxItems: per * queries.length,
    maxChargeUsd: opts.maxChargeUsd,
    fetch: opts.fetch,
    onProgress: opts.onProgress,
  })) as Array<Record<string, unknown>>;
  const out = new Map<string, FoundUser>();
  for (const it of items) {
    const username = normalizeUsername(String(it.username ?? ""));
    if (!username || out.has(username)) continue;
    out.set(username, {
      username,
      fullName: str(it.fullName) ?? str(it.full_name),
      followers: num(it.followersCount) ?? num(it.followers),
      biography: str(it.biography),
      avatarUrl: str(it.profilePicUrlHD) ?? str(it.profilePicUrl),
      verified: typeof it.verified === "boolean" ? it.verified : null,
      isBusiness: typeof it.isBusinessAccount === "boolean" ? it.isBusinessAccount : null,
      query: String(it.searchTerm ?? it.query ?? queries[0]),
    });
  }
  return [...out.values()].sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1));
}

/** Hashtag'lerin öne çıkan gönderilerini çeker (sahip kullanıcı adıyla birlikte: yeni üretici keşfi için) */
export async function fetchApifyHashtags(opts: { token: string; hashtags: string[]; perTag?: number; actor?: string; maxChargeUsd?: number; fetch?: FetchLike; onProgress?: (msg: string) => void }): Promise<RadarPost[]> {
  const per = Math.min(Math.max(opts.perTag ?? 30, 5), 200);
  const items = (await runApifyActor({
    token: opts.token,
    actor: opts.actor || APIFY_HASHTAG_ACTOR,
    input: { hashtags: opts.hashtags.map((h) => h.replace(/^#/, "")), resultsLimit: per, resultsType: "posts" },
    maxItems: per * opts.hashtags.length,
    maxChargeUsd: opts.maxChargeUsd,
    fetch: opts.fetch,
    onProgress: opts.onProgress,
  })) as ApifyPost[];
  return items.filter((p) => p && (p.shortCode || p.url)).map(postFromApify);
}
