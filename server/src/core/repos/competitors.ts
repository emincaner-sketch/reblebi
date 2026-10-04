import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";

type Row = Record<string, unknown>;

export type CompetitorProvider = "instagram" | "youtube" | "bluesky" | "facebook" | "twitch";

/** YouTube UC… kanal kimlikleri büyük/küçük harfe duyarlıdır; diğer tanıtıcılar küçük harfle saklanır */
const canon = (provider: CompetitorProvider, username: string) => (provider === "youtube" && /^UC[\w-]{22}$/.test(username) ? username : username.toLowerCase());

/** Rakibin son gönderilerinden biri (herkese açık alanlar) */

export interface CompetitorPost {
  id: string;
  caption: string;
  likes: number | null;
  comments: number | null;
  /** YouTube: izlenme */
  views?: number | null;
  /** Bluesky: yeniden paylaşım + alıntı */
  shares?: number | null;
  timestamp: string;
  type: string;
  permalink: string | null;
}

export interface Competitor {
  id: string;
  orgId: string;
  provider: CompetitorProvider;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  biography: string | null;
  recent: CompetitorPost[];
  lastError: string | null;
  lastFetchedAt: string | null;
  createdAt: string;
}

export interface CompetitorSnapshot {
  date: string;
  followers: number | null;
  mediaCount: number | null;
  /** postsLast30, avgLikes, avgComments, engagementRate (%) */
  metrics: Record<string, number>;
}

const rowTo = (r: Row): Competitor => ({
  id: r.id as string,
  orgId: r.org_id as string,
  provider: ((r.provider as string) || "instagram") as CompetitorProvider,
  username: r.username as string,
  name: (r.name as string) ?? null,
  avatarUrl: (r.avatar_url as string) ?? null,
  biography: (r.biography as string) ?? null,
  recent: parseJson<CompetitorPost[]>(r.recent, []),
  lastError: (r.last_error as string) ?? null,
  lastFetchedAt: (r.last_fetched_at as string) ?? null,
  createdAt: r.created_at as string,
});

export const competitorsRepo = {
  list(orgId: string): Competitor[] {
    return (getDb().prepare("SELECT * FROM competitors WHERE org_id = ? ORDER BY created_at ASC").all(orgId) as Row[]).map(rowTo);
  },
  listAll(): Competitor[] {
    return (getDb().prepare("SELECT * FROM competitors ORDER BY created_at ASC").all() as Row[]).map(rowTo);
  },
  get(orgId: string, id: string): Competitor | null {
    const r = getDb().prepare("SELECT * FROM competitors WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowTo(r) : null;
  },
  findByUsername(orgId: string, username: string, provider: CompetitorProvider = "instagram"): Competitor | null {
    const r = getDb().prepare("SELECT * FROM competitors WHERE org_id = ? AND provider = ? AND username = ?").get(orgId, provider, canon(provider, username)) as Row | undefined;
    return r ? rowTo(r) : null;
  },
  create(orgId: string, username: string, provider: CompetitorProvider = "instagram"): Competitor {
    const id = randomId("cmpt");
    getDb().prepare("INSERT INTO competitors (id, org_id, provider, username, created_at) VALUES (?, ?, ?, ?, ?)").run(id, orgId, provider, canon(provider, username), nowIso());
    return this.get(orgId, id)!;
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM competitors WHERE id = ? AND org_id = ?").run(id, orgId);
  },
  saveProfile(id: string, p: { name: string | null; avatarUrl: string | null; biography: string | null; recent: CompetitorPost[] }): void {
    getDb()
      .prepare("UPDATE competitors SET name = ?, avatar_url = ?, biography = ?, recent = ?, last_error = NULL, last_fetched_at = ? WHERE id = ?")
      .run(p.name, p.avatarUrl, p.biography, JSON.stringify(p.recent.slice(0, 25)), nowIso(), id);
  },
  saveError(id: string, error: string): void {
    getDb().prepare("UPDATE competitors SET last_error = ?, last_fetched_at = ? WHERE id = ?").run(error.slice(0, 500), nowIso(), id);
  },
  upsertSnapshot(id: string, date: string, s: { followers: number | null; mediaCount: number | null; metrics: Record<string, number> }): void {
    getDb()
      .prepare(
        "INSERT INTO competitor_snapshots (competitor_id, date, followers, media_count, metrics) VALUES (?, ?, ?, ?, ?) ON CONFLICT(competitor_id, date) DO UPDATE SET followers = excluded.followers, media_count = excluded.media_count, metrics = excluded.metrics",
      )
      .run(id, date, s.followers, s.mediaCount, JSON.stringify(s.metrics));
  },
  snapshots(id: string, fromDate: string, toDate: string): CompetitorSnapshot[] {
    return (getDb().prepare("SELECT * FROM competitor_snapshots WHERE competitor_id = ? AND date >= ? AND date <= ? ORDER BY date ASC").all(id, fromDate, toDate) as Row[]).map((r) => ({
      date: r.date as string,
      followers: r.followers === null ? null : Number(r.followers),
      mediaCount: r.media_count === null ? null : Number(r.media_count),
      metrics: parseJson<Record<string, number>>(r.metrics, {}),
    }));
  },
  lastBefore(id: string, date: string): CompetitorSnapshot | null {
    const r = getDb().prepare("SELECT * FROM competitor_snapshots WHERE competitor_id = ? AND date < ? ORDER BY date DESC LIMIT 1").get(id, date) as Row | undefined;
    return r ? { date: r.date as string, followers: r.followers === null ? null : Number(r.followers), mediaCount: r.media_count === null ? null : Number(r.media_count), metrics: parseJson(r.metrics, {}) } : null;
  },
};
