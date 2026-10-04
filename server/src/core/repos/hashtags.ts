import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";

type Row = Record<string, unknown>;

/** Hashtag altındaki öne çıkan bir gönderi (herkese açık alanlar) */
export interface HashtagPost {
  id: string;
  caption: string;
  likes: number | null;
  comments: number | null;
  type: string;
  permalink: string | null;
  timestamp: string | null;
}

export interface HashtagTrack {
  id: string;
  orgId: string;
  hashtag: string;
  igHashtagId: string | null;
  top: HashtagPost[];
  lastError: string | null;
  lastFetchedAt: string | null;
  createdAt: string;
}

const rowTo = (r: Row): HashtagTrack => ({
  id: r.id as string,
  orgId: r.org_id as string,
  hashtag: r.hashtag as string,
  igHashtagId: (r.ig_hashtag_id as string) ?? null,
  top: parseJson<HashtagPost[]>(r.top, []),
  lastError: (r.last_error as string) ?? null,
  lastFetchedAt: (r.last_fetched_at as string) ?? null,
  createdAt: r.created_at as string,
});

export const hashtagsRepo = {
  list(orgId: string): HashtagTrack[] {
    return (getDb().prepare("SELECT * FROM hashtag_tracks WHERE org_id = ? ORDER BY created_at").all(orgId) as Row[]).map(rowTo);
  },
  listAll(): HashtagTrack[] {
    return (getDb().prepare("SELECT * FROM hashtag_tracks ORDER BY org_id, created_at").all() as Row[]).map(rowTo);
  },
  get(orgId: string, id: string): HashtagTrack | null {
    const r = getDb().prepare("SELECT * FROM hashtag_tracks WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowTo(r) : null;
  },
  find(orgId: string, hashtag: string): HashtagTrack | null {
    const r = getDb().prepare("SELECT * FROM hashtag_tracks WHERE org_id = ? AND hashtag = ?").get(orgId, hashtag) as Row | undefined;
    return r ? rowTo(r) : null;
  },
  create(orgId: string, hashtag: string, igHashtagId: string | null): HashtagTrack {
    const id = randomId("htag");
    getDb().prepare("INSERT INTO hashtag_tracks (id, org_id, hashtag, ig_hashtag_id, created_at) VALUES (?, ?, ?, ?, ?)").run(id, orgId, hashtag, igHashtagId, nowIso());
    return this.get(orgId, id)!;
  },
  saveTop(id: string, top: HashtagPost[]): void {
    getDb().prepare("UPDATE hashtag_tracks SET top = ?, last_error = NULL, last_fetched_at = ? WHERE id = ?").run(JSON.stringify(top.slice(0, 9)), nowIso(), id);
  },
  saveError(id: string, error: string): void {
    getDb().prepare("UPDATE hashtag_tracks SET last_error = ?, last_fetched_at = ? WHERE id = ?").run(error.slice(0, 500), nowIso(), id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM hashtag_tracks WHERE id = ? AND org_id = ?").run(id, orgId);
  },
  upsertSnapshot(id: string, date: string, metrics: Record<string, number>): void {
    getDb()
      .prepare("INSERT INTO hashtag_snapshots (track_id, date, metrics) VALUES (?, ?, ?) ON CONFLICT(track_id, date) DO UPDATE SET metrics = excluded.metrics")
      .run(id, date, JSON.stringify(metrics));
  },
  snapshots(id: string, fromDate: string, toDate: string): Array<{ date: string; metrics: Record<string, number> }> {
    return (getDb().prepare("SELECT * FROM hashtag_snapshots WHERE track_id = ? AND date >= ? AND date <= ? ORDER BY date").all(id, fromDate, toDate) as Row[]).map((r) => ({
      date: r.date as string,
      metrics: parseJson<Record<string, number>>(r.metrics, {}),
    }));
  },
};
