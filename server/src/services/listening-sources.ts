import { config } from "../core/config.js";
import { channelsRepo } from "../core/repos/channels.js";
import type { ListenQuery, ListenSource, MentionInput } from "../core/repos/listening.js";
import { http } from "../providers/http.js";
import { ProviderError } from "../providers/types.js";
import { ensureFreshToken } from "./publisher.js";

/**
 * Bahsetme kaynakları. Her kaynak sorgunun terimlerini kendi arama sözdizimine çevirir ve son bahsetmeleri döndürür.
 * Kaynak seçimi lisans ve erişim koşullarına göre: Google Haberler RSS'i ticari kullanıma kapalı olduğundan haberler
 * yayıncıların kendi RSS akışlarından ve açık GDELT DOC API'sinden; Reddit anahtarsız istekleri engellediği için uygulama (OAuth) anahtarıyla; web araması
 * isteğe bağlı Brave Search API anahtarıyla; YouTube çalışma alanının bağlı kanalının yetkisiyle.
 */

export interface SourceInfo {
  id: ListenSource;
  /** Bu çalışma alanında kullanılabilir mi */
  available: boolean;
  /** Kullanılamıyorsa ne gerekiyor: platform ayarı (yönetici) ya da kanal bağlama (kullanıcı) */
  needs?: "platform" | "channel";
  /** Zamanlayıcıda iki çalışma arası en az süre (dakika) */
  interval: number;
}

const UA = `web:reblebi-listening:1.0 (+${config.publicUrl})`;
const DAY = 86_400_000;
/** İlk çalışmada geriye dönük bakılan süre */
export const BACKFILL_DAYS = 7;

export const INTERVALS: Record<ListenSource, number> = { news: 60, reddit: 30, bluesky: 30, hn: 60, youtube: 360, web: 720 };

function youtubeChannel(orgId: string) {
  return channelsRepo.list(orgId).find((c) => c.provider === "youtube" && c.status === "active") ?? null;
}

export function sourceInfo(orgId: string): SourceInfo[] {
  const redditOk = Boolean(config.listening.redditClientId && config.listening.redditClientSecret);
  return [
    { id: "news", available: true, interval: INTERVALS.news },
    { id: "reddit", available: redditOk, needs: redditOk ? undefined : "platform", interval: INTERVALS.reddit },
    { id: "bluesky", available: true, interval: INTERVALS.bluesky },
    { id: "hn", available: true, interval: INTERVALS.hn },
    { id: "youtube", available: Boolean(youtubeChannel(orgId)), needs: youtubeChannel(orgId) ? undefined : "channel", interval: INTERVALS.youtube },
    { id: "web", available: Boolean(config.listening.braveKey), needs: config.listening.braveKey ? undefined : "platform", interval: INTERVALS.web },
  ];
}

/* ---------------- Ortak yardımcılar ---------------- */

export const fold = (s: string) => s.toLocaleLowerCase("tr").normalize("NFC");
const quote = (t: string) => `"${t.replace(/"/g, "")}"`;
const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? s.slice(0, n - 1) + "…" : s) : null);
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Metin hariç tutulan terimlerden birini içeriyor mu */
export function excluded(q: ListenQuery, text: string): boolean {
  const t = fold(text);
  return q.excludes.some((x) => x && t.includes(fold(x)));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Metin terimlerden en az birini kelime başında içeriyor mu ("ali" → "kaliteli" eşleşmez; Türkçe ekler serbest: "leblebi" → "leblebici") */
export function matches(q: ListenQuery, text: string): boolean {
  const t = fold(text);
  return q.terms.some((x) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(fold(x))}`, "u").test(t));
}

/** Aynı haber farklı kaynaklardan izleme parametreleriyle gelebilir: utm_*, fbclid vb. atılır */
export function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ocid|cmpid|ref$)/i.test(k)) x.searchParams.delete(k);
    x.hash = "";
    x.hostname = x.hostname.toLowerCase().replace(/^www\./, "");
    return x.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
}

/* ---------------- Haber: yayıncıların RSS akışları (ortak havuz) + GDELT DOC 2.0 ---------------- */

/**
 * Varsayılan haber akışları: yayıncıların kendi yayımladığı RSS adresleri. Havuz tüm sorgular için 15 dakikada bir tek kez
 * çekilir; başlık ve özet terimlerle eşleştirilir (yalnızca başlık, kısa özet ve bağlantı saklanır).
 * LISTEN_RSS_FEEDS ile virgülle ayrılmış ek akışlar (sektör blogları, yerel haber siteleri) eklenebilir.
 */
const DEFAULT_FEEDS: Record<"tr" | "en", string[]> = {
  tr: [
    "https://www.hurriyet.com.tr/rss/anasayfa",
    "https://www.hurriyet.com.tr/rss/ekonomi",
    "https://www.sabah.com.tr/rss/anasayfa.xml",
    "https://www.cnnturk.com/feed/rss/all/news",
    "https://www.haberturk.com/rss",
    "https://www.aa.com.tr/tr/rss/default?cat=guncel",
    "https://www.trthaber.com/manset_articles.rss",
    "https://www.milliyet.com.tr/rss/rssnew/gundemrss.xml",
    "https://feeds.bbci.co.uk/turkce/rss.xml",
    "https://www.sozcu.com.tr/feeds-rss-category-sozcu",
    "https://www.cumhuriyet.com.tr/rss/son_dakika.xml",
    "https://www.yenisafak.com/rss?xml=gundem",
    "https://www.star.com.tr/rss/rss.asp",
    "https://www.gzt.com/rss",
    "https://www.ensonhaber.com/rss/ensonhaber.xml",
    "https://www.mynet.com/haber/rss/sondakika",
    "https://www.dunya.com/rss",
    "https://www.ekonomim.com/export/rss",
    "https://www.bloomberght.com/rss",
    "https://www.webtekno.com/rss.xml",
    "https://shiftdelete.net/feed",
    "https://www.donanimhaber.com/rss/tum/",
    "https://webrazzi.com/feed/",
    "https://www.marketingturkiye.com.tr/feed/",
    "https://www.campaigntr.com/feed/",
  ],
  en: [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://www.theguardian.com/world/rss",
    "https://feeds.npr.org/1001/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    "https://techcrunch.com/feed/",
    "https://www.theverge.com/rss/index.xml",
    "https://www.adweek.com/feed/",
    "https://www.socialmediatoday.com/feeds/news/",
    "https://www.marketingdive.com/feeds/news/",
    "https://www.dailysabah.com/rss/home",
  ],
};
const FEED_TTL = 15 * 60_000;

interface FeedItem {
  id: string;
  url: string;
  title: string;
  summary: string;
  publishedAt: string;
}
const feedCache = new Map<string, { at: number; items: FeedItem[] }>();
let feedRefresh: Promise<void> | null = null;

/** XML metni: CDATA açılır, varlıklar çözülür (özetteki kodlanmış HTML etiketleri de), sonra etiketler atılır */
const decodeXml = (s: string) =>
  stripHtml(
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&"),
  );
const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decodeXml(m[1]) : "";
};

/** RSS 2.0 ve Atom: başlık, bağlantı, tarih, özet (bağımlılıksız, düzenli ifadeyle) */
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    let link = tag(b, "link").replace(/&amp;/g, "&");
    if (!/^https?:/i.test(link)) link = (/<link[^>]*href="([^"]+)"/i.exec(b)?.[1] ?? "").replace(/&amp;/g, "&");
    const title = tag(b, "title");
    if (!/^https?:/i.test(link) || !title) continue;
    const date = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const ts = Date.parse(date);
    out.push({
      id: normalizeUrl(link),
      url: link,
      title: title.slice(0, 400),
      summary: (tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 600),
      publishedAt: Number.isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString(),
    });
  }
  return out;
}

function feedsFor(lang: ListenQuery["lang"]): string[] {
  const extra = (process.env.LISTEN_RSS_FEEDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^https:\/\//.test(x));
  const base = lang === "tr" ? DEFAULT_FEEDS.tr : lang === "en" ? DEFAULT_FEEDS.en : [...DEFAULT_FEEDS.tr, ...DEFAULT_FEEDS.en];
  return [...new Set([...base, ...extra])];
}

/** Süresi dolan akışları yeniler (aynı anda tek yenileme; bir akışın hatası diğerlerini etkilemez) */
async function refreshFeeds(urls: string[]): Promise<void> {
  const stale = urls.filter((u) => (feedCache.get(u)?.at ?? 0) < Date.now() - FEED_TTL);
  if (!stale.length) return;
  if (!feedRefresh) {
    feedRefresh = (async () => {
      const queue = [...stale];
      const worker = async () => {
        for (let u = queue.shift(); u; u = queue.shift()) {
          try {
            const xml = await http<string>(u, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, asText: true, retries: 0, timeoutMs: 12_000 });
            feedCache.set(u, { at: Date.now(), items: parseFeed(xml) });
          } catch {
            // Akış geçici olarak erişilemiyorsa eski öğeler kalır, 15 dakika sonra yeniden denenir
            feedCache.set(u, { at: Date.now(), items: feedCache.get(u)?.items ?? [] });
          }
        }
      };
      await Promise.all(Array.from({ length: 5 }, worker));
    })().finally(() => {
      feedRefresh = null;
    });
  }
  await feedRefresh;
  // Başka bir yenileme sürerken çağrıldıysa bu sorgunun akışları da tazelensin
  if (urls.some((u) => !feedCache.has(u))) await refreshFeeds(urls);
}

async function rssNews(q: ListenQuery, since: number): Promise<MentionInput[]> {
  const urls = feedsFor(q.lang);
  await refreshFeeds(urls);
  const out: MentionInput[] = [];
  for (const u of urls) {
    for (const it of feedCache.get(u)?.items ?? []) {
      if (Date.parse(it.publishedAt) < since) continue;
      if (!matches(q, `${it.title} ${it.summary}`)) continue;
      out.push({
        source: "news",
        externalId: it.id,
        url: it.url,
        title: it.title,
        snippet: clip(it.summary, 400),
        author: null,
        site: hostOf(it.url),
        lang: q.lang === "any" ? null : q.lang,
        publishedAt: it.publishedAt,
        reach: null,
        engagement: null,
      });
    }
  }
  return out;
}

/* GDELT DOC 2.0: dünya genelindeki haber siteleri (açık veri). Yoğunlukta 429 döner; o zaman 30 dakika geri çekilir. */

const GDELT_LANG: Record<string, string> = { tr: "turkish", en: "english" };
const GDELT_LANG_CODE: Record<string, string> = { turkish: "tr", english: "en" };
let gdeltNext = 0;
let gdeltBlockedUntil = 0;
/** GDELT IP başına 5 saniyede bir isteğe izin verir: tüm sorgular tek kuyruktan, aralıklı */
async function gdeltSlot(): Promise<void> {
  const wait = gdeltNext - Date.now();
  gdeltNext = Math.max(Date.now(), gdeltNext) + 6_000;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** "20261004T121500Z" → ISO */
function gdeltDate(s: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

type GdeltResponse = { articles?: Array<{ url: string; title?: string; seendate?: string; domain?: string; language?: string; sourcecountry?: string }> } | string;

async function gdeltNews(q: ListenQuery, since: number): Promise<MentionInput[]> {
  if (Date.now() < gdeltBlockedUntil) return [];
  const terms = q.terms.map(quote);
  let query = terms.length > 1 ? `(${terms.join(" OR ")})` : terms[0];
  for (const x of q.excludes) query += ` -${quote(x)}`;
  if (GDELT_LANG[q.lang]) query += ` sourcelang:${GDELT_LANG[q.lang]}`;
  const hours = Math.min(24 * 90, Math.max(1, Math.ceil((Date.now() - since) / 3_600_000)));
  await gdeltSlot();
  let r: GdeltResponse;
  try {
    r = await http<GdeltResponse>("https://api.gdeltproject.org/api/v2/doc/doc", {
      query: { query, mode: "artlist", format: "json", maxrecords: 250, sort: "datedesc", timespan: `${hours}h` },
      headers: { "User-Agent": UA },
      retries: 0,
      timeoutMs: 25_000,
    });
  } catch (e) {
    // Yoğunluk (429), sunucu ya da ağ hatası: sessizce geri çekil, RSS havuzu çalışmaya devam eder
    if (e instanceof ProviderError && (e.status === 429 || !e.status || e.status >= 500)) {
      gdeltBlockedUntil = Date.now() + 30 * 60_000;
      return [];
    }
    throw e;
  }
  // Hatalı sorguda GDELT düz metin döndürür (ör. çok kısa kelime)
  if (typeof r === "string") throw new ProviderError(`GDELT: ${r.slice(0, 200)}`, 400);
  return (r.articles ?? []).flatMap((a) => {
    const publishedAt = gdeltDate(a.seendate);
    if (!a.url || !publishedAt) return [];
    return [
      {
        source: "news" as const,
        externalId: normalizeUrl(a.url),
        url: a.url,
        title: clip(a.title ?? null, 400),
        snippet: null,
        author: null,
        site: a.domain ?? hostOf(a.url),
        lang: GDELT_LANG_CODE[(a.language ?? "").toLowerCase()] ?? null,
        publishedAt,
        reach: null,
        engagement: null,
      },
    ];
  });
}

/** Haber = RSS havuzu ∪ GDELT. GDELT sorgu hatası (ör. çok kısa terim) uyarı olarak döner, RSS sonuçları yine kaydedilir. */
async function fetchNews(q: ListenQuery, since: number): Promise<FetchResult> {
  const out = new Map<string, MentionInput>();
  for (const m of await rssNews(q, since)) out.set(m.externalId, m);
  let warning: string | undefined;
  try {
    for (const m of await gdeltNews(q, since)) if (!out.has(m.externalId)) out.set(m.externalId, m);
  } catch (e) {
    warning = e instanceof Error ? e.message : String(e);
  }
  return { items: [...out.values()], warning };
}

/* ---------------- Reddit (uygulama yetkisi, yalnızca okuma) ---------------- */

let redditToken: { value: string; until: number } | null = null;
async function redditAuth(): Promise<string> {
  if (redditToken && redditToken.until > Date.now() + 60_000) return redditToken.value;
  const basic = Buffer.from(`${config.listening.redditClientId}:${config.listening.redditClientSecret}`).toString("base64");
  const r = await http<{ access_token: string; expires_in: number }>("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    form: { grant_type: "client_credentials" },
    headers: { Authorization: `Basic ${basic}`, "User-Agent": UA },
    retries: 1,
  });
  redditToken = { value: r.access_token, until: Date.now() + (r.expires_in ?? 3600) * 1000 };
  return redditToken.value;
}

async function fetchReddit(q: ListenQuery, since: number): Promise<MentionInput[]> {
  const token = await redditAuth();
  const terms = q.terms.map(quote);
  let query = terms.length > 1 ? `(${terms.join(" OR ")})` : terms[0];
  for (const x of q.excludes) query += ` NOT ${quote(x)}`;
  const days = (Date.now() - since) / DAY;
  const r = await http<{ data?: { children?: Array<{ data: { name: string; title?: string; selftext?: string; author?: string; subreddit?: string; permalink?: string; created_utc?: number; score?: number; num_comments?: number; lang?: string } }> } }>(
    "https://oauth.reddit.com/search",
    {
      query: { q: query, sort: "new", limit: 100, t: days <= 1 ? "day" : days <= 7 ? "week" : "month", type: "link", raw_json: 1 },
      headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
      retries: 1,
    },
  );
  return (r.data?.children ?? []).flatMap(({ data: p }) => {
    if (!p.created_utc || p.created_utc * 1000 < since || !p.permalink) return [];
    return [
      {
        source: "reddit" as const,
        externalId: p.name,
        url: `https://www.reddit.com${p.permalink}`,
        title: clip(p.title ?? null, 400),
        snippet: clip(p.selftext ? stripHtml(p.selftext) : null, 600),
        author: p.author && p.author !== "[deleted]" ? `u/${p.author}` : null,
        site: p.subreddit ? `r/${p.subreddit}` : null,
        lang: null,
        publishedAt: new Date(p.created_utc * 1000).toISOString(),
        reach: typeof p.score === "number" ? p.score : null,
        engagement: typeof p.num_comments === "number" ? p.num_comments : null,
      },
    ];
  });
}

/* ---------------- Bluesky (herkese açık AppView araması) ---------------- */

interface BskyPost {
  uri: string;
  author?: { handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string; langs?: string[] };
  indexedAt?: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
}

async function fetchBluesky(q: ListenQuery, since: number): Promise<MentionInput[]> {
  const out = new Map<string, MentionInput>();
  // Sözdizimi resmî olarak tanımlı değil: her terim ayrı aranır, hariç tutulanlar sonradan elenir
  for (const term of q.terms.slice(0, 5)) {
    const r = await http<{ posts?: BskyPost[] }>("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts", {
      query: { q: term.includes(" ") ? quote(term) : term, sort: "latest", limit: 100, since: new Date(since).toISOString(), lang: q.lang === "any" ? undefined : q.lang },
      headers: { "User-Agent": UA },
      retries: 1,
    });
    for (const p of r.posts ?? []) {
      const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/.exec(p.uri);
      const created = p.record?.createdAt ?? p.indexedAt;
      if (!m || !created || Date.parse(created) < since) continue;
      const handle = p.author?.handle ?? m[1];
      out.set(p.uri, {
        source: "bluesky",
        externalId: p.uri,
        url: `https://bsky.app/profile/${handle}/post/${m[2]}`,
        title: null,
        snippet: clip(p.record?.text ?? "", 600),
        author: `@${handle}`,
        site: "bsky.app",
        lang: p.record?.langs?.[0] ?? null,
        publishedAt: new Date(created).toISOString(),
        reach: null,
        engagement: (p.likeCount ?? 0) + (p.repostCount ?? 0) + (p.replyCount ?? 0) + (p.quoteCount ?? 0),
      });
    }
  }
  return [...out.values()];
}

/* ---------------- Hacker News (Algolia) ---------------- */

async function fetchHn(q: ListenQuery, since: number): Promise<MentionInput[]> {
  const out = new Map<string, MentionInput>();
  for (const term of q.terms.slice(0, 5)) {
    const r = await http<{ hits?: Array<{ objectID: string; title?: string; story_title?: string; comment_text?: string; story_text?: string; author?: string; url?: string; points?: number; num_comments?: number; created_at_i?: number }> }>(
      "https://hn.algolia.com/api/v1/search_by_date",
      { query: { query: term.includes(" ") ? quote(term) : term, tags: "(story,comment)", hitsPerPage: 50, numericFilters: `created_at_i>${Math.floor(since / 1000)}` }, headers: { "User-Agent": UA }, retries: 1 },
    );
    for (const h of r.hits ?? []) {
      if (!h.created_at_i) continue;
      out.set(h.objectID, {
        source: "hn",
        externalId: h.objectID,
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: clip(h.title ?? h.story_title ?? null, 400),
        snippet: clip(stripHtml(h.comment_text ?? h.story_text ?? ""), 600),
        author: h.author ?? null,
        site: h.url ? hostOf(h.url) : "news.ycombinator.com",
        lang: "en",
        publishedAt: new Date(h.created_at_i * 1000).toISOString(),
        reach: typeof h.points === "number" ? h.points : null,
        engagement: typeof h.num_comments === "number" ? h.num_comments : null,
      });
    }
  }
  return [...out.values()];
}

/* ---------------- YouTube (bağlı kanalın yetkisiyle arama; 100 kota birimi) ---------------- */

async function fetchYoutube(q: ListenQuery, since: number): Promise<MentionInput[]> {
  const ch = youtubeChannel(q.orgId);
  if (!ch) throw new ProviderError("YouTube kanalı bağlı değil", 400);
  const fresh = await ensureFreshToken(ch);
  let query = q.terms.map(quote).join("|");
  for (const x of q.excludes) query += ` -${quote(x)}`;
  const r = await http<{ items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; description?: string; channelTitle?: string; channelId?: string; publishedAt?: string } }> }>(
    "https://www.googleapis.com/youtube/v3/search",
    {
      query: { part: "snippet", q: query, type: "video", order: "date", maxResults: 50, publishedAfter: new Date(since).toISOString(), relevanceLanguage: q.lang === "any" ? undefined : q.lang },
      headers: { Authorization: `Bearer ${fresh.accessToken}` },
      retries: 1,
    },
  );
  return (r.items ?? []).flatMap((it) => {
    const id = it.id?.videoId;
    const s = it.snippet;
    if (!id || !s?.publishedAt) return [];
    // Kendi kanalının videoları bahsetme sayılmaz
    if (s.channelId && s.channelId === fresh.externalId) return [];
    return [
      {
        source: "youtube" as const,
        externalId: id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: clip(stripHtml(s.title ?? ""), 400),
        snippet: clip(stripHtml(s.description ?? ""), 600),
        author: s.channelTitle ?? null,
        site: "youtube.com",
        lang: null,
        publishedAt: new Date(s.publishedAt).toISOString(),
        reach: null,
        engagement: null,
      },
    ];
  });
}

/* ---------------- Web (Brave Search API) ---------------- */

async function fetchWeb(q: ListenQuery, since: number): Promise<MentionInput[]> {
  const terms = q.terms.map(quote);
  let query = terms.join(" OR ");
  for (const x of q.excludes) query += ` -${quote(x)}`;
  const days = (Date.now() - since) / DAY;
  const r = await http<{ web?: { results?: Array<{ url: string; title?: string; description?: string; page_age?: string; age?: string; meta_url?: { hostname?: string }; profile?: { name?: string } }> } }>(
    "https://api.search.brave.com/res/v1/web/search",
    {
      query: { q: query, count: 20, freshness: days <= 1 ? "pd" : days <= 7 ? "pw" : "pm", search_lang: q.lang === "any" ? undefined : q.lang },
      headers: { "X-Subscription-Token": config.listening.braveKey, Accept: "application/json" },
      retries: 1,
    },
  );
  return (r.web?.results ?? []).flatMap((w) => {
    const published = w.page_age && !Number.isNaN(Date.parse(w.page_age)) ? new Date(w.page_age).toISOString() : new Date().toISOString();
    return [
      {
        source: "web" as const,
        externalId: w.url,
        url: w.url,
        title: clip(stripHtml(w.title ?? ""), 400),
        snippet: clip(stripHtml(w.description ?? ""), 600),
        author: null,
        site: w.meta_url?.hostname?.replace(/^www\./, "") ?? hostOf(w.url),
        lang: null,
        publishedAt: published,
        reach: null,
        engagement: null,
      },
    ];
  });
}

/** Kaynak sonucu: öğeler ve (kısmi hata varsa) uyarı; tamamen başarısızsa fetcher hata fırlatır */
export type FetchResult = MentionInput[] | { items: MentionInput[]; warning?: string };

export const FETCHERS: Record<ListenSource, (q: ListenQuery, since: number) => Promise<FetchResult>> = {
  news: fetchNews,
  reddit: fetchReddit,
  bluesky: fetchBluesky,
  hn: fetchHn,
  youtube: fetchYoutube,
  web: fetchWeb,
};

/** Testler için: modül durumunu sıfırla */
export function resetSourceState(): void {
  gdeltNext = 0;
  gdeltBlockedUntil = 0;
  redditToken = null;
  feedCache.clear();
}
