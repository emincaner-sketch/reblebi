import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";

type Row = Record<string, unknown>;

export const LISTEN_SOURCES = ["news", "reddit", "bluesky", "hn", "youtube", "web"] as const;
export type ListenSource = (typeof LISTEN_SOURCES)[number];
export type Sentiment = "positive" | "neutral" | "negative";
export type MentionStatus = "new" | "seen" | "hidden";

/** Kaynak başına son çalışma ve hata (zamanlayıcı aralığı buna göre) */
export interface SourceState {
  lastRun?: string;
  error?: string | null;
  added?: number;
}

export interface ListenQuery {
  id: string;
  orgId: string;
  name: string;
  terms: string[];
  excludes: string[];
  sources: ListenSource[];
  lang: "tr" | "en" | "any";
  enabled: boolean;
  notify: boolean;
  aiSentiment: boolean;
  state: Partial<Record<ListenSource, SourceState>>;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Mention {
  id: string;
  queryId: string;
  orgId: string;
  source: ListenSource;
  externalId: string;
  url: string;
  title: string | null;
  snippet: string | null;
  author: string | null;
  site: string | null;
  lang: string | null;
  publishedAt: string;
  foundAt: string;
  sentiment: Sentiment;
  sentimentBy: "lexicon" | "ai" | "user";
  reach: number | null;
  engagement: number | null;
  status: MentionStatus;
  starred: boolean;
}

/** Kaynaktan gelen, henüz kaydedilmemiş bahsetme */
export type MentionInput = Pick<Mention, "source" | "externalId" | "url" | "title" | "snippet" | "author" | "site" | "lang" | "publishedAt" | "reach" | "engagement">;

const queryRow = (r: Row): ListenQuery => ({
  id: r.id as string,
  orgId: r.org_id as string,
  name: r.name as string,
  terms: parseJson<string[]>(r.terms, []),
  excludes: parseJson<string[]>(r.excludes, []),
  sources: parseJson<ListenSource[]>(r.sources, []),
  lang: ((r.lang as string) || "tr") as ListenQuery["lang"],
  enabled: Boolean(r.enabled),
  notify: Boolean(r.notify),
  aiSentiment: Boolean(r.ai_sentiment),
  state: parseJson<ListenQuery["state"]>(r.state, {}),
  lastRunAt: (r.last_run_at as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const mentionRow = (r: Row): Mention => ({
  id: r.id as string,
  queryId: r.query_id as string,
  orgId: r.org_id as string,
  source: r.source as ListenSource,
  externalId: r.external_id as string,
  url: r.url as string,
  title: (r.title as string) ?? null,
  snippet: (r.snippet as string) ?? null,
  author: (r.author as string) ?? null,
  site: (r.site as string) ?? null,
  lang: (r.lang as string) ?? null,
  publishedAt: r.published_at as string,
  foundAt: r.found_at as string,
  sentiment: r.sentiment as Sentiment,
  sentimentBy: r.sentiment_by as Mention["sentimentBy"],
  reach: r.reach === null || r.reach === undefined ? null : Number(r.reach),
  engagement: r.engagement === null || r.engagement === undefined ? null : Number(r.engagement),
  status: r.status as MentionStatus,
  starred: Boolean(r.starred),
});

export interface QueryPatch {
  name?: string;
  terms?: string[];
  excludes?: string[];
  sources?: ListenSource[];
  lang?: ListenQuery["lang"];
  enabled?: boolean;
  notify?: boolean;
  aiSentiment?: boolean;
}

export interface MentionFilter {
  queryId?: string;
  source?: ListenSource;
  sentiment?: Sentiment;
  /** "inbox": gizlenmemiş (varsayılan), "new", "starred", "hidden" */
  view?: "inbox" | "new" | "starred" | "hidden";
  q?: string;
  from?: string;
  to?: string;
}

function where(orgId: string, f: MentionFilter): { sql: string; args: Array<string | number> } {
  const parts = ["org_id = ?"];
  const args: Array<string | number> = [orgId];
  if (f.queryId) (parts.push("query_id = ?"), args.push(f.queryId));
  if (f.source) (parts.push("source = ?"), args.push(f.source));
  if (f.sentiment) (parts.push("sentiment = ?"), args.push(f.sentiment));
  const view = f.view ?? "inbox";
  if (view === "inbox") parts.push("status != 'hidden'");
  if (view === "new") parts.push("status = 'new'");
  if (view === "starred") parts.push("starred = 1");
  if (view === "hidden") parts.push("status = 'hidden'");
  if (f.from) (parts.push("published_at >= ?"), args.push(f.from));
  if (f.to) (parts.push("published_at < ?"), args.push(f.to));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    parts.push("(title LIKE ? ESCAPE '\\' OR snippet LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR site LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  return { sql: parts.join(" AND "), args };
}

export const listeningRepo = {
  list(orgId: string): ListenQuery[] {
    return (getDb().prepare("SELECT * FROM listen_queries WHERE org_id = ? ORDER BY created_at").all(orgId) as Row[]).map(queryRow);
  },
  listEnabled(): ListenQuery[] {
    return (getDb().prepare("SELECT * FROM listen_queries WHERE enabled = 1 ORDER BY last_run_at IS NOT NULL, last_run_at").all() as Row[]).map(queryRow);
  },
  get(orgId: string, id: string): ListenQuery | null {
    const r = getDb().prepare("SELECT * FROM listen_queries WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? queryRow(r) : null;
  },
  create(orgId: string, q: Required<Pick<QueryPatch, "name" | "terms" | "excludes" | "sources" | "lang" | "notify" | "aiSentiment">>, userId: string | null): ListenQuery {
    const id = randomId("lsn");
    const now = nowIso();
    getDb()
      .prepare(
        "INSERT INTO listen_queries (id, org_id, name, terms, excludes, sources, lang, notify, ai_sentiment, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, orgId, q.name, JSON.stringify(q.terms), JSON.stringify(q.excludes), JSON.stringify(q.sources), q.lang, q.notify ? 1 : 0, q.aiSentiment ? 1 : 0, userId, now, now);
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, p: QueryPatch): ListenQuery | null {
    const sets: string[] = [];
    const args: Array<string | number> = [];
    const set = (col: string, v: string | number) => (sets.push(`${col} = ?`), args.push(v));
    if (p.name !== undefined) set("name", p.name);
    if (p.terms !== undefined) set("terms", JSON.stringify(p.terms));
    if (p.excludes !== undefined) set("excludes", JSON.stringify(p.excludes));
    if (p.sources !== undefined) set("sources", JSON.stringify(p.sources));
    if (p.lang !== undefined) set("lang", p.lang);
    if (p.enabled !== undefined) set("enabled", p.enabled ? 1 : 0);
    if (p.notify !== undefined) set("notify", p.notify ? 1 : 0);
    if (p.aiSentiment !== undefined) set("ai_sentiment", p.aiSentiment ? 1 : 0);
    if (sets.length) {
      set("updated_at", nowIso());
      getDb()
        .prepare(`UPDATE listen_queries SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`)
        .run(...args, id, orgId);
    }
    return this.get(orgId, id);
  },
  /** Terimler değişince kaynak imleçleri sıfırlanır (yeni terimin geçmişi de çekilsin) */
  resetState(id: string): void {
    getDb().prepare("UPDATE listen_queries SET state = '{}' WHERE id = ?").run(id);
  },
  saveState(id: string, state: ListenQuery["state"], ranAt: string): void {
    getDb().prepare("UPDATE listen_queries SET state = ?, last_run_at = ? WHERE id = ?").run(JSON.stringify(state), ranAt, id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM listen_queries WHERE id = ? AND org_id = ?").run(id, orgId);
  },

  /** Yeni bahsetmeleri ekler, aynı kaynak kimliği varsa atlar; eklenenleri döndürür */
  insertMany(q: ListenQuery, items: Array<MentionInput & { sentiment: Sentiment }>): Mention[] {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO mentions (id, query_id, org_id, source, external_id, url, title, snippet, author, site, lang, published_at, found_at, sentiment, reach, engagement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(query_id, source, external_id) DO NOTHING`,
    );
    const added: string[] = [];
    const now = nowIso();
    for (const m of items) {
      const id = randomId("mnt");
      const r = stmt.run(id, q.id, q.orgId, m.source, m.externalId.slice(0, 300), m.url.slice(0, 2000), m.title?.slice(0, 500) ?? null, m.snippet?.slice(0, 1000) ?? null, m.author?.slice(0, 200) ?? null, m.site?.slice(0, 200) ?? null, m.lang ?? null, m.publishedAt, now, m.sentiment, m.reach, m.engagement);
      if (Number(r.changes) > 0) added.push(id);
    }
    return added.length ? this.byIds(q.orgId, added) : [];
  },
  byIds(orgId: string, ids: string[]): Mention[] {
    if (!ids.length) return [];
    return (getDb().prepare(`SELECT * FROM mentions WHERE org_id = ? AND id IN (${ids.map(() => "?").join(",")})`).all(orgId, ...ids) as Row[]).map(mentionRow);
  },
  getMention(orgId: string, id: string): Mention | null {
    const r = getDb().prepare("SELECT * FROM mentions WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? mentionRow(r) : null;
  },
  mentions(orgId: string, f: MentionFilter, limit = 50, offset = 0): { items: Mention[]; total: number } {
    const w = where(orgId, f);
    const total = Number((getDb().prepare(`SELECT COUNT(*) AS c FROM mentions WHERE ${w.sql}`).get(...w.args) as { c: number }).c);
    const items = (getDb().prepare(`SELECT * FROM mentions WHERE ${w.sql} ORDER BY published_at DESC, id LIMIT ? OFFSET ?`).all(...w.args, limit, offset) as Row[]).map(mentionRow);
    return { items, total };
  },
  /** Rapor için dönem içindeki gizlenmemiş bahsetmelerin özet alanları */
  forReport(orgId: string, from: string, to: string, queryId?: string): Array<Pick<Mention, "queryId" | "source" | "site" | "author" | "publishedAt" | "sentiment" | "reach" | "engagement">> {
    const args: string[] = [orgId, from, to];
    let sql = "SELECT query_id, source, site, author, published_at, sentiment, reach, engagement FROM mentions WHERE org_id = ? AND published_at >= ? AND published_at < ? AND status != 'hidden'";
    if (queryId) (sql += " AND query_id = ?"), args.push(queryId);
    return (getDb().prepare(sql).all(...args) as Row[]).map((r) => ({
      queryId: r.query_id as string,
      source: r.source as ListenSource,
      site: (r.site as string) ?? null,
      author: (r.author as string) ?? null,
      publishedAt: r.published_at as string,
      sentiment: r.sentiment as Sentiment,
      reach: r.reach === null ? null : Number(r.reach),
      engagement: r.engagement === null ? null : Number(r.engagement),
    }));
  },
  unreadByQuery(orgId: string): Record<string, number> {
    const rows = getDb().prepare("SELECT query_id, COUNT(*) AS c FROM mentions WHERE org_id = ? AND status = 'new' GROUP BY query_id").all(orgId) as Row[];
    return Object.fromEntries(rows.map((r) => [r.query_id as string, Number(r.c)]));
  },
  patch(orgId: string, id: string, p: { status?: MentionStatus; starred?: boolean; sentiment?: Sentiment }): Mention | null {
    const sets: string[] = [];
    const args: Array<string | number> = [];
    if (p.status) (sets.push("status = ?"), args.push(p.status));
    if (p.starred !== undefined) (sets.push("starred = ?"), args.push(p.starred ? 1 : 0));
    if (p.sentiment) (sets.push("sentiment = ?", "sentiment_by = 'user'"), args.push(p.sentiment));
    if (sets.length) getDb().prepare(`UPDATE mentions SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`).run(...args, id, orgId);
    return this.getMention(orgId, id);
  },
  markAllSeen(orgId: string, queryId?: string): number {
    const r = queryId
      ? getDb().prepare("UPDATE mentions SET status = 'seen' WHERE org_id = ? AND query_id = ? AND status = 'new'").run(orgId, queryId)
      : getDb().prepare("UPDATE mentions SET status = 'seen' WHERE org_id = ? AND status = 'new'").run(orgId);
    return Number(r.changes);
  },
  /** AI ile yeniden sınıflandırılacaklar: kullanıcı elle değiştirmemiş, sözlükle etiketlenmiş son bahsetmeler */
  lexiconLabeled(queryId: string, limit: number): Mention[] {
    return (getDb().prepare("SELECT * FROM mentions WHERE query_id = ? AND sentiment_by = 'lexicon' ORDER BY found_at DESC LIMIT ?").all(queryId, limit) as Row[]).map(mentionRow);
  },
  setAiSentiment(id: string, s: Sentiment): void {
    getDb().prepare("UPDATE mentions SET sentiment = ?, sentiment_by = 'ai' WHERE id = ? AND sentiment_by != 'user'").run(s, id);
  },
  /** Sorgu başına en fazla `keep` bahsetme tutulur (eskiler silinir; yıldızlılar korunur) */
  prune(queryId: string, keep: number): number {
    const r = getDb()
      .prepare(
        `DELETE FROM mentions WHERE query_id = ? AND starred = 0 AND id NOT IN (SELECT id FROM mentions WHERE query_id = ? ORDER BY published_at DESC LIMIT ?)`,
      )
      .run(queryId, queryId, keep);
    return Number(r.changes);
  },
};
