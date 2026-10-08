import { z } from "zod";
import { aiAvailable, aiJson, resolveAiConfig } from "../ai/providers.js";
import { AppError, notFound } from "../core/i18n.js";
import { createLogger } from "../core/logger.js";
import { channelsRepo } from "../core/repos/channels.js";
import { LISTEN_SOURCES, listeningRepo, type ListenQuery, type ListenSource, type Mention, type MentionFilter, type MentionInput, type QueryPatch, type Sentiment } from "../core/repos/listening.js";
import { orgsRepo } from "../core/repos/orgs.js";
import type { Ctx } from "../core/types.js";
import { requireRole } from "./access.js";
import { consumeAiQuota } from "./limits.js";
import { addDays, localYmd } from "./analytics-report.js";
import { BACKFILL_DAYS, excluded, FETCHERS, fold, sourceInfo } from "./listening-sources.js";
import { notify, orgT } from "./notify.js";
import { lexiconSentiment } from "./sentiment.js";

/**
 * Bahsetme izleme (sosyal dinleme): marka adı, ürün ya da kampanya terimlerinin haber siteleri, Reddit, Bluesky,
 * Hacker News, YouTube ve web'de geçtiği yerleri toplar; duygu, hacim, kaynak ve "ses payı" (sorgular arası) raporu verir.
 */

const log = createLogger("listening");
export const MAX_QUERIES = 5;
export const MAX_TERMS = 10;
/** Sorgu başına saklanan en fazla bahsetme (eskiler silinir, yıldızlılar kalır) */
export const KEEP_PER_QUERY = 10_000;
/** Elle "Şimdi tara" iki kez arası */
const MANUAL_GAP_MS = 2 * 60_000;

const Term = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .refine((s) => !/["\n\r]/.test(s));

export const QueryInput = z.object({
  name: z.string().trim().min(1).max(80),
  terms: z.array(Term).min(1).max(MAX_TERMS),
  excludes: z.array(Term).max(MAX_TERMS).default([]),
  sources: z.array(z.enum(LISTEN_SOURCES)).min(1).default(["news", "reddit", "bluesky", "youtube", "web"]),
  lang: z.enum(["tr", "en", "any"]).default("tr"),
  notify: z.boolean().default(true),
  aiSentiment: z.boolean().default(false),
});
export const QueryPatchInput = QueryInput.partial().extend({ enabled: z.boolean().optional() });

const uniq = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = fold(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export function listQueries(ctx: Ctx) {
  const unread = listeningRepo.unreadByQuery(ctx.orgId);
  return {
    items: listeningRepo.list(ctx.orgId).map((q) => ({ ...q, unread: unread[q.id] ?? 0 })),
    sources: sourceInfo(ctx.orgId),
    max: MAX_QUERIES,
    ai: aiAvailable(ctx.orgId),
  };
}

export async function createQuery(ctx: Ctx, raw: unknown): Promise<ListenQuery> {
  requireRole(ctx, "editor");
  const b = QueryInput.parse(raw);
  if (listeningRepo.list(ctx.orgId).length >= MAX_QUERIES) throw new AppError(400, "listen.too_many", { max: MAX_QUERIES });
  const q = listeningRepo.create(ctx.orgId, { ...b, terms: uniq(b.terms), excludes: uniq(b.excludes), sources: [...new Set(b.sources)] }, ctx.userId);
  // İlk tarama arka planda: sayfa hemen açılır, sonuçlar birkaç saniyede gelir
  void runQuery(q, { manual: true }).catch((e) => log.warn("ilk tarama başarısız", { id: q.id, e: e instanceof Error ? e.message : e }));
  return q;
}

export function updateQuery(ctx: Ctx, id: string, raw: unknown): ListenQuery {
  requireRole(ctx, "editor");
  const b = QueryPatchInput.parse(raw);
  const cur = listeningRepo.get(ctx.orgId, id);
  if (!cur) throw notFound("listen");
  const patch: QueryPatch = { ...b, terms: b.terms ? uniq(b.terms) : undefined, excludes: b.excludes ? uniq(b.excludes) : undefined, sources: b.sources ? [...new Set(b.sources)] : undefined };
  const termsChanged = (patch.terms && patch.terms.join("\n") !== cur.terms.join("\n")) || (patch.lang && patch.lang !== cur.lang);
  const q = listeningRepo.update(ctx.orgId, id, patch)!;
  if (termsChanged) {
    listeningRepo.resetState(id);
    void runQuery(listeningRepo.get(ctx.orgId, id)!, { manual: true }).catch(() => undefined);
  }
  return q;
}

export function removeQuery(ctx: Ctx, id: string): void {
  requireRole(ctx, "editor");
  if (!listeningRepo.get(ctx.orgId, id)) throw notFound("listen");
  listeningRepo.remove(ctx.orgId, id);
}

/** Kendi bağlı hesapların paylaşımları bahsetme sayılmaz */
function ownAuthors(orgId: string): Set<string> {
  const out = new Set<string>();
  for (const c of channelsRepo.list(orgId)) {
    if (!c.username) continue;
    const u = fold(c.username.replace(/^@/, ""));
    out.add(u);
    out.add(`@${u}`);
    out.add(`u/${u}`);
  }
  return out;
}

export interface RunResult {
  added: number;
  bySource: Partial<Record<ListenSource, { added: number; error: string | null; skipped?: boolean }>>;
}

/**
 * Bir sorguyu çalıştırır. Zamanlayıcıda yalnızca aralığı dolan kaynaklar; elle çalıştırmada tümü (iki dakikada bir).
 * Bir kaynağın hatası diğerlerini durdurmaz, kaynağın durumuna yazılır.
 */
export async function runQuery(q: ListenQuery, opts: { manual?: boolean; now?: number } = {}): Promise<RunResult> {
  const now = opts.now ?? Date.now();
  const info = new Map(sourceInfo(q.orgId).map((s) => [s.id, s]));
  const state = { ...q.state };
  const own = ownAuthors(q.orgId);
  const result: RunResult = { added: 0, bySource: {} };
  const fresh: Mention[] = [];
  for (const source of q.sources) {
    const si = info.get(source);
    if (!si?.available) {
      result.bySource[source] = { added: 0, error: null, skipped: true };
      continue;
    }
    const last = state[source]?.lastRun ? Date.parse(state[source]!.lastRun!) : 0;
    const due = opts.manual ? now - last >= MANUAL_GAP_MS : now - last >= si.interval * 60_000 - 30_000;
    if (!due) continue;
    // İlk çalışmada geriye dönük, sonra son çalışmadan bir saat öncesinden (geç dizinlenenler kaçmasın)
    const since = last ? last - 60 * 60_000 : now - BACKFILL_DAYS * 86_400_000;
    // Demo sunucusu: kaynaklara istek atılmaz (kurgusal veri kalır)
    if (process.env.LISTEN_OFFLINE === "1") {
      state[source] = { lastRun: new Date(now).toISOString(), error: null, added: 0 };
      result.bySource[source] = { added: 0, error: null };
      continue;
    }
    try {
      const res = await FETCHERS[source](q, since);
      const items = Array.isArray(res) ? res : res.items;
      const warning = Array.isArray(res) ? null : (res.warning?.slice(0, 300) ?? null);
      const keep: Array<MentionInput & { sentiment: Sentiment }> = [];
      for (const m of items) {
        const text = [m.title, m.snippet].filter(Boolean).join(" ");
        if (excluded(q, text)) continue;
        if (m.author && own.has(fold(m.author))) continue;
        keep.push({ ...m, sentiment: lexiconSentiment(text) });
      }
      const added = listeningRepo.insertMany(q, keep);
      fresh.push(...added);
      state[source] = { lastRun: new Date(now).toISOString(), error: warning, added: added.length };
      result.bySource[source] = { added: added.length, error: warning };
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      state[source] = { ...state[source], lastRun: new Date(now).toISOString(), error: msg };
      result.bySource[source] = { added: 0, error: msg };
      log.debug("kaynak hatası", { query: q.id, source, msg });
    }
  }
  result.added = fresh.length;
  listeningRepo.saveState(q.id, state, new Date(now).toISOString());
  if (fresh.length) {
    listeningRepo.prune(q.id, KEEP_PER_QUERY);
    if (q.aiSentiment) await classifyWithAi(q, fresh).catch((e) => log.debug("AI duygu analizi atlandı", { e: e instanceof Error ? e.message : e }));
    if (q.notify && !opts.manual) {
      const negative = fresh.filter((m) => m.sentiment === "negative").length;
      notify(q.orgId, {
        kind: negative ? "warning" : "info",
        title: negative ? orgT(q.orgId, "listen.notify_negative", { n: fresh.length, neg: negative, name: q.name }) : orgT(q.orgId, "listen.notify", { n: fresh.length, name: q.name }),
        body: fresh[0].title ?? fresh[0].snippet ?? null,
        link: `/app/analytics/mentions?query=${q.id}`,
      });
    }
  }
  return result;
}

const AiLabels = z.object({ items: z.array(z.object({ id: z.string(), sentiment: z.enum(["positive", "neutral", "negative"]) })) });

/** AI ile duygu sınıflandırma: yeni bahsetmeler tek istekte (en fazla 40) */
async function classifyWithAi(q: ListenQuery, items: Mention[]): Promise<void> {
  const cfg = resolveAiConfig(q.orgId);
  if (!cfg) return;
  // Bir parti = bir AI üretimi (platform anahtarıyla çalışıyorsa aylık kotadan düşer; kota bittiyse sözlük etiketi kalır)
  consumeAiQuota(q.orgId, cfg.usingPlatformKey);
  const batch = items.slice(0, 40);
  const list = batch.map((m) => `${m.id}\t${[m.title, m.snippet].filter(Boolean).join(" — ").slice(0, 400)}`).join("\n");
  const r = await aiJson(cfg, AiLabels, {
    system:
      "You label the sentiment of brand mentions toward the tracked brand or topic. positive = praise, recommendation, satisfaction; negative = complaint, criticism, problem, warning; neutral = news, questions, plain mentions. Return one label per id.",
    user: `Tracked terms: ${q.terms.join(", ")}\nMentions (id<TAB>text):\n${list}`,
    maxTokens: 2000,
    effort: "low",
  });
  const ids = new Set(batch.map((m) => m.id));
  for (const x of r.items) if (ids.has(x.id)) listeningRepo.setAiSentiment(x.id, x.sentiment);
}

export async function runQueryNow(ctx: Ctx, id: string): Promise<RunResult> {
  requireRole(ctx, "editor");
  const q = listeningRepo.get(ctx.orgId, id);
  if (!q) throw notFound("listen");
  return runQuery(q, { manual: true });
}

/** Zamanlayıcı: aralığı dolan kaynakları olan tüm açık sorgular (askıdaki çalışma alanları hariç) */
export async function runDueListening(now = Date.now()): Promise<number> {
  let added = 0;
  for (const q of listeningRepo.listEnabled()) {
    const org = orgsRepo.get(q.orgId);
    if (!org || org.disabled) continue;
    try {
      added += (await runQuery(q, { now })).added;
    } catch (e) {
      log.warn("sorgu çalıştırılamadı", { id: q.id, e: e instanceof Error ? e.message : e });
    }
  }
  return added;
}

/* ---------------- Bahsetme listesi ---------------- */

export const MentionQuery = z.object({
  query: z.string().optional(),
  source: z.enum(LISTEN_SOURCES).optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  view: z.enum(["inbox", "new", "starred", "hidden"]).optional(),
  q: z.string().trim().max(100).optional(),
  days: z.coerce.number().int().min(1).max(366).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function filterOf(ctx: Ctx, f: z.infer<typeof MentionQuery>): MentionFilter {
  if (f.query && !listeningRepo.get(ctx.orgId, f.query)) throw notFound("listen");
  return {
    queryId: f.query || undefined,
    source: f.source,
    sentiment: f.sentiment,
    view: f.view,
    q: f.q || undefined,
    from: f.days ? new Date(Date.now() - f.days * 86_400_000).toISOString() : undefined,
  };
}

export function listMentions(ctx: Ctx, raw: unknown) {
  const f = MentionQuery.parse(raw);
  return listeningRepo.mentions(ctx.orgId, filterOf(ctx, f), f.limit, f.offset);
}

export function patchMention(ctx: Ctx, id: string, raw: unknown): Mention {
  requireRole(ctx, "editor");
  const b = z.object({ status: z.enum(["new", "seen", "hidden"]).optional(), starred: z.boolean().optional(), sentiment: z.enum(["positive", "neutral", "negative"]).optional() }).parse(raw);
  const m = listeningRepo.patch(ctx.orgId, id, b);
  if (!m) throw notFound("mention");
  return m;
}

export function markAllSeen(ctx: Ctx, queryId?: string): number {
  requireRole(ctx, "editor");
  return listeningRepo.markAllSeen(ctx.orgId, queryId || undefined);
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s;
};

/** CSV (Excel/Sheets): en fazla 5.000 satır, formül enjeksiyonuna karşı kaçışlı */
export function mentionsCsv(ctx: Ctx, raw: unknown): string {
  const f = MentionQuery.parse(raw);
  const names = new Map(listeningRepo.list(ctx.orgId).map((q) => [q.id, q.name]));
  const { items } = listeningRepo.mentions(ctx.orgId, filterOf(ctx, f), 5000, 0);
  const head = ["published_at", "query", "source", "site", "author", "title", "snippet", "url", "sentiment", "reach", "engagement", "status", "starred"];
  const rows = items.map((m) => [m.publishedAt, names.get(m.queryId) ?? "", m.source, m.site, m.author, m.title, m.snippet, m.url, m.sentiment, m.reach, m.engagement, m.status, m.starred ? 1 : 0]);
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/* ---------------- Rapor ---------------- */

type Count = { key: string; count: number };
const top = (m: Map<string, number>, n: number): Count[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));

function totals(rows: ReturnType<typeof listeningRepo.forReport>) {
  const pos = rows.filter((r) => r.sentiment === "positive").length;
  const neg = rows.filter((r) => r.sentiment === "negative").length;
  return {
    mentions: rows.length,
    positive: pos,
    neutral: rows.length - pos - neg,
    negative: neg,
    /** Net duygu: (olumlu − olumsuz) / (olumlu + olumsuz) × 100; ikisi de yoksa null */
    net: pos + neg ? Math.round(((pos - neg) / (pos + neg)) * 100) : null,
    engagement: rows.reduce((a, r) => a + (r.engagement ?? 0) + Math.max(0, r.reach ?? 0), 0),
    sites: new Set(rows.map((r) => r.site).filter(Boolean)).size,
  };
}

export function listeningReport(ctx: Ctx, raw: unknown) {
  const { query, days } = z.object({ query: z.string().optional(), days: z.coerce.number().int().min(7).max(366).default(30) }).parse(raw);
  if (query && !listeningRepo.get(ctx.orgId, query)) throw notFound("listen");
  const tz = orgsRepo.get(ctx.orgId)?.timezone || "Europe/Istanbul";
  const to = localYmd(Date.now(), tz);
  const fromDay = addDays(to, -(days - 1));
  const dates: string[] = [];
  for (let d = fromDay; d <= to; d = addDays(d, 1)) dates.push(d);
  const now = Date.now();
  const fromIso = new Date(now - days * 86_400_000).toISOString();
  const prevIso = new Date(now - 2 * days * 86_400_000).toISOString();
  const rows = listeningRepo.forReport(ctx.orgId, fromIso, new Date(now + 60_000).toISOString(), query || undefined);
  const prevRows = listeningRepo.forReport(ctx.orgId, prevIso, fromIso, query || undefined);

  const idx = new Map(dates.map((d, i) => [d, i]));
  const bySourceDaily: Record<string, number[]> = {};
  const sentimentDaily: Record<Sentiment, number[]> = { positive: dates.map(() => 0), neutral: dates.map(() => 0), negative: dates.map(() => 0) };
  const sites = new Map<string, number>();
  const authors = new Map<string, number>();
  const sources = new Map<string, number>();
  const perQuery = new Map<string, { count: number; positive: number; negative: number }>();
  // Ses payı her zaman tüm sorgular üzerinden (tek sorgu seçiliyken de karşılaştırma görünsün)
  for (const r of query ? listeningRepo.forReport(ctx.orgId, fromIso, new Date(now + 60_000).toISOString()) : rows) {
    const pq = perQuery.get(r.queryId) ?? { count: 0, positive: 0, negative: 0 };
    pq.count++;
    if (r.sentiment === "positive") pq.positive++;
    if (r.sentiment === "negative") pq.negative++;
    perQuery.set(r.queryId, pq);
  }
  for (const r of rows) {
    const i = idx.get(localYmd(Date.parse(r.publishedAt), tz));
    if (i !== undefined) {
      (bySourceDaily[r.source] ??= dates.map(() => 0))[i]++;
      sentimentDaily[r.sentiment][i]++;
    }
    if (r.site) sites.set(r.site, (sites.get(r.site) ?? 0) + 1);
    if (r.author) authors.set(r.author, (authors.get(r.author) ?? 0) + 1);
    sources.set(r.source, (sources.get(r.source) ?? 0) + 1);
  }
  const queries = listeningRepo.list(ctx.orgId);
  return {
    range: { from: fromDay, to, days, tz },
    dates,
    totals: totals(rows),
    prev: totals(prevRows),
    bySourceDaily,
    sentimentDaily,
    sources: top(sources, 10),
    sites: top(sites, 10),
    authors: top(authors, 10),
    /** Ses payı: sorgular (marka ve rakipler) arasında bahsetme dağılımı */
    shareOfVoice: queries.map((q) => ({ id: q.id, name: q.name, ...(perQuery.get(q.id) ?? { count: 0, positive: 0, negative: 0 }) })),
  };
}
