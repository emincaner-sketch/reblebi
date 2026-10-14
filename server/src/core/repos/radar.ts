import { getDb, nowIso } from "../db.js";
import { randomId } from "../crypto.js";
import type { MediaKind, RadarAccount, RadarPost, Region } from "../../services/radar-core.js";

type Row = Record<string, unknown>;
const bool = (v: boolean | null | undefined) => (v === null || v === undefined ? null : v ? 1 : 0);

/* ---------------- Nişler ---------------- */

export interface RadarNiche {
  id: string;
  orgId: string;
  name: string;
  color: string | null;
  createdAt: string;
}
const nicheOf = (r: Row): RadarNiche => ({ id: r.id as string, orgId: r.org_id as string, name: r.name as string, color: (r.color as string) ?? null, createdAt: r.created_at as string });

/* ---------------- Hesaplar ---------------- */

export type RadarRole = "watch" | "competitor" | "own";

export interface RadarAccountRow {
  id: string;
  orgId: string;
  username: string;
  nicheId: string | null;
  region: Region;
  role: RadarRole;
  fullName: string | null;
  biography: string | null;
  avatarUrl: string | null;
  followers: number | null;
  following: number | null;
  mediaCount: number | null;
  website: string | null;
  email: string | null;
  isBusiness: boolean | null;
  lastSource: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
  paused: boolean;
  createdAt: string;
}
const accountOf = (r: Row): RadarAccountRow => ({
  id: r.id as string,
  orgId: r.org_id as string,
  username: r.username as string,
  nicheId: (r.niche_id as string) ?? null,
  region: ((r.region as string) === "GLOBAL" ? "GLOBAL" : "TR") as Region,
  role: ((r.role as string) || "watch") as RadarRole,
  fullName: (r.full_name as string) ?? null,
  biography: (r.biography as string) ?? null,
  avatarUrl: (r.avatar_url as string) ?? null,
  followers: (r.followers as number) ?? null,
  following: (r.following as number) ?? null,
  mediaCount: (r.media_count as number) ?? null,
  website: (r.website as string) ?? null,
  email: (r.email as string) ?? null,
  isBusiness: r.is_business === null || r.is_business === undefined ? null : Boolean(r.is_business),
  lastSource: (r.last_source as string) ?? null,
  lastFetchedAt: (r.last_fetched_at as string) ?? null,
  lastError: (r.last_error as string) ?? null,
  paused: Boolean(r.paused),
  createdAt: r.created_at as string,
});

export type RadarStoredPost = RadarPost & { accountId: string };
const postOf = (r: Row): RadarStoredPost => ({
  accountId: r.account_id as string,
  key: r.key as string,
  shortcode: /^[A-Za-z0-9_-]+$/.test(r.key as string) ? (r.key as string) : null,
  permalink: (r.permalink as string) ?? null,
  kind: r.kind as MediaKind,
  caption: (r.caption as string) ?? "",
  thumbnailUrl: (r.thumbnail_url as string) ?? null,
  postedAt: (r.posted_at as string) ?? null,
  likes: (r.likes as number) ?? null,
  comments: (r.comments as number) ?? null,
  views: (r.views as number) ?? null,
  pinned: Boolean(r.pinned),
});

/* ---------------- Pano ve sponsorlar ---------------- */

export type RadarSavedStatus = "idea" | "producing" | "published" | "dropped";
export interface RadarSaved {
  key: string;
  username: string;
  permalink: string | null;
  kind: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  outlier: number | null;
  status: RadarSavedStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
const savedOf = (r: Row): RadarSaved => ({
  key: r.key as string,
  username: r.username as string,
  permalink: (r.permalink as string) ?? null,
  kind: (r.kind as string) ?? null,
  caption: (r.caption as string) ?? null,
  thumbnailUrl: (r.thumbnail_url as string) ?? null,
  outlier: (r.outlier as number) ?? null,
  status: ((r.status as string) || "idea") as RadarSavedStatus,
  note: (r.note as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export type RadarSponsorStatus = "candidate" | "contacted" | "offered" | "agreed" | "declined";
export interface RadarSponsor {
  username: string;
  status: RadarSponsorStatus;
  note: string | null;
  contact: string | null;
  price: string | null;
  createdAt: string;
  updatedAt: string;
}
const sponsorOf = (r: Row): RadarSponsor => ({
  username: r.username as string,
  status: ((r.status as string) || "candidate") as RadarSponsorStatus,
  note: (r.note as string) ?? null,
  contact: (r.contact as string) ?? null,
  price: (r.price as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export const radarRepo = {
  /* nişler */
  niches(orgId: string): RadarNiche[] {
    return (getDb().prepare("SELECT * FROM radar_niches WHERE org_id = ? ORDER BY name COLLATE NOCASE").all(orgId) as Row[]).map(nicheOf);
  },
  niche(orgId: string, id: string): RadarNiche | null {
    const r = getDb().prepare("SELECT * FROM radar_niches WHERE org_id = ? AND id = ?").get(orgId, id) as Row | undefined;
    return r ? nicheOf(r) : null;
  },
  nicheByName(orgId: string, name: string): RadarNiche | null {
    const r = getDb().prepare("SELECT * FROM radar_niches WHERE org_id = ? AND name = ? COLLATE NOCASE").get(orgId, name.trim()) as Row | undefined;
    return r ? nicheOf(r) : null;
  },
  createNiche(orgId: string, name: string, color: string | null): RadarNiche {
    const id = randomId("rdn");
    getDb().prepare("INSERT INTO radar_niches (id, org_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)").run(id, orgId, name.trim(), color, nowIso());
    return radarRepo.niche(orgId, id)!;
  },
  updateNiche(orgId: string, id: string, patch: { name?: string; color?: string | null }): void {
    const cur = radarRepo.niche(orgId, id);
    if (!cur) return;
    getDb()
      .prepare("UPDATE radar_niches SET name = ?, color = ? WHERE org_id = ? AND id = ?")
      .run((patch.name ?? cur.name).trim(), patch.color === undefined ? cur.color : patch.color, orgId, id);
  },
  removeNiche(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM radar_niches WHERE org_id = ? AND id = ?").run(orgId, id);
  },

  /* hesaplar */
  accounts(orgId: string): RadarAccountRow[] {
    return (getDb().prepare("SELECT * FROM radar_accounts WHERE org_id = ? ORDER BY username").all(orgId) as Row[]).map(accountOf);
  },
  allAccounts(): RadarAccountRow[] {
    return (getDb().prepare("SELECT * FROM radar_accounts ORDER BY org_id, username").all() as Row[]).map(accountOf);
  },
  account(orgId: string, id: string): RadarAccountRow | null {
    const r = getDb().prepare("SELECT * FROM radar_accounts WHERE org_id = ? AND id = ?").get(orgId, id) as Row | undefined;
    return r ? accountOf(r) : null;
  },
  accountByUsername(orgId: string, username: string): RadarAccountRow | null {
    const r = getDb().prepare("SELECT * FROM radar_accounts WHERE org_id = ? AND username = ?").get(orgId, username.toLowerCase()) as Row | undefined;
    return r ? accountOf(r) : null;
  },
  countAccounts(orgId: string): number {
    return Number((getDb().prepare("SELECT COUNT(*) AS n FROM radar_accounts WHERE org_id = ?").get(orgId) as Row).n);
  },
  createAccount(orgId: string, username: string, opts: { nicheId: string | null; region: Region; role: RadarRole }): RadarAccountRow {
    const id = randomId("rda");
    getDb()
      .prepare("INSERT INTO radar_accounts (id, org_id, username, niche_id, region, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, orgId, username.toLowerCase(), opts.nicheId, opts.region, opts.role, nowIso());
    getDb().prepare("DELETE FROM radar_dismissed WHERE org_id = ? AND username = ?").run(orgId, username.toLowerCase());
    return radarRepo.account(orgId, id)!;
  },
  patchAccount(orgId: string, id: string, p: { nicheId?: string | null; region?: Region; role?: RadarRole; paused?: boolean }): void {
    const cur = radarRepo.account(orgId, id);
    if (!cur) return;
    getDb()
      .prepare("UPDATE radar_accounts SET niche_id = ?, region = ?, role = ?, paused = ? WHERE org_id = ? AND id = ?")
      .run(p.nicheId === undefined ? cur.nicheId : p.nicheId, p.region ?? cur.region, p.role ?? cur.role, bool(p.paused ?? cur.paused), orgId, id);
  },
  removeAccount(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM radar_accounts WHERE org_id = ? AND id = ?").run(orgId, id);
  },
  saveError(id: string, msg: string): void {
    getDb().prepare("UPDATE radar_accounts SET last_error = ?, last_fetched_at = ? WHERE id = ?").run(msg.slice(0, 500), nowIso(), id);
  },
  /** Çekilen profili, günlük takipçi görüntüsünü ve gönderileri kaydeder; yeni görülen gönderi sayısını döndürür */
  store(a: RadarAccountRow, acc: RadarAccount, source: string, today: string, email: string | null): number {
    const d = getDb();
    const now = nowIso();
    d.exec("BEGIN");
    try {
      d.prepare(
        `UPDATE radar_accounts SET full_name = ?, biography = ?, avatar_url = ?, followers = ?, following = ?, media_count = ?, website = ?,
         email = COALESCE(?, email), is_business = ?, last_source = ?, last_fetched_at = ?, last_error = NULL WHERE id = ?`,
      ).run(acc.fullName, acc.biography, acc.avatarUrl, acc.followers, acc.following, acc.mediaCount, acc.website, email, bool(acc.isBusiness), source, now, a.id);
      d.prepare(
        "INSERT INTO radar_account_snapshots (account_id, date, followers, media_count) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, date) DO UPDATE SET followers = excluded.followers, media_count = excluded.media_count",
      ).run(a.id, today, acc.followers, acc.mediaCount);
      const exists = d.prepare("SELECT 1 FROM radar_posts WHERE account_id = ? AND key = ?");
      const upsert = d.prepare(
        `INSERT INTO radar_posts (account_id, key, org_id, permalink, kind, caption, thumbnail_url, posted_at, likes, comments, views, pinned, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, key) DO UPDATE SET permalink = COALESCE(excluded.permalink, permalink), kind = excluded.kind, caption = excluded.caption,
           thumbnail_url = COALESCE(excluded.thumbnail_url, thumbnail_url), posted_at = COALESCE(excluded.posted_at, posted_at),
           likes = COALESCE(excluded.likes, likes), comments = COALESCE(excluded.comments, comments), views = COALESCE(excluded.views, views),
           pinned = excluded.pinned, updated_at = excluded.updated_at`,
      );
      let fresh = 0;
      for (const p of acc.posts) {
        if (!exists.get(a.id, p.key)) fresh++;
        upsert.run(a.id, p.key, a.orgId, p.permalink, p.kind, p.caption, p.thumbnailUrl, p.postedAt, p.likes, p.comments, p.views, p.pinned ? 1 : 0, now, now);
      }
      d.exec("COMMIT");
      return fresh;
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }
  },
  posts(orgId: string): RadarStoredPost[] {
    return (getDb().prepare("SELECT * FROM radar_posts WHERE org_id = ?").all(orgId) as Row[]).map(postOf);
  },
  postsOf(accountId: string): RadarStoredPost[] {
    return (getDb().prepare("SELECT * FROM radar_posts WHERE account_id = ?").all(accountId) as Row[]).map(postOf);
  },
  history(accountId: string, since = "0000"): Array<{ date: string; followers: number | null }> {
    return getDb().prepare("SELECT date, followers FROM radar_account_snapshots WHERE account_id = ? AND date >= ? ORDER BY date").all(accountId, since) as Array<{ date: string; followers: number | null }>;
  },

  /* pano */
  saved(orgId: string): RadarSaved[] {
    return (getDb().prepare("SELECT * FROM radar_saved WHERE org_id = ? ORDER BY updated_at DESC").all(orgId) as Row[]).map(savedOf);
  },
  savedOne(orgId: string, key: string): RadarSaved | null {
    const r = getDb().prepare("SELECT * FROM radar_saved WHERE org_id = ? AND key = ?").get(orgId, key) as Row | undefined;
    return r ? savedOf(r) : null;
  },
  putSaved(orgId: string, s: Omit<RadarSaved, "createdAt" | "updatedAt">): void {
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO radar_saved (org_id, key, username, permalink, kind, caption, thumbnail_url, outlier, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(org_id, key) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(orgId, s.key, s.username, s.permalink, s.kind, s.caption, s.thumbnailUrl, s.outlier, s.status, s.note, now, now);
  },
  removeSaved(orgId: string, key: string): void {
    getDb().prepare("DELETE FROM radar_saved WHERE org_id = ? AND key = ?").run(orgId, key);
  },

  /* sponsorlar */
  sponsors(orgId: string): RadarSponsor[] {
    return (getDb().prepare("SELECT * FROM radar_sponsors WHERE org_id = ? ORDER BY updated_at DESC").all(orgId) as Row[]).map(sponsorOf);
  },
  sponsor(orgId: string, username: string): RadarSponsor | null {
    const r = getDb().prepare("SELECT * FROM radar_sponsors WHERE org_id = ? AND username = ?").get(orgId, username) as Row | undefined;
    return r ? sponsorOf(r) : null;
  },
  putSponsor(orgId: string, s: { username: string; status?: RadarSponsorStatus; note?: string | null; contact?: string | null; price?: string | null }): void {
    const cur = radarRepo.sponsor(orgId, s.username);
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO radar_sponsors (org_id, username, status, note, contact, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(org_id, username) DO UPDATE SET status = excluded.status, note = excluded.note, contact = excluded.contact, price = excluded.price, updated_at = excluded.updated_at`,
      )
      .run(
        orgId,
        s.username,
        s.status ?? cur?.status ?? "candidate",
        s.note === undefined ? (cur?.note ?? null) : s.note,
        s.contact === undefined ? (cur?.contact ?? null) : s.contact,
        s.price === undefined ? (cur?.price ?? null) : s.price,
        cur?.createdAt ?? now,
        now,
      );
  },
  removeSponsor(orgId: string, username: string): void {
    getDb().prepare("DELETE FROM radar_sponsors WHERE org_id = ? AND username = ?").run(orgId, username);
  },

  /* keşif */
  dismiss(orgId: string, username: string): void {
    getDb().prepare("INSERT INTO radar_dismissed (org_id, username, at) VALUES (?, ?, ?) ON CONFLICT(org_id, username) DO NOTHING").run(orgId, username, nowIso());
  },
  dismissed(orgId: string): Set<string> {
    return new Set((getDb().prepare("SELECT username FROM radar_dismissed WHERE org_id = ?").all(orgId) as Row[]).map((r) => r.username as string));
  },

  /* ayarlar (Apify anahtarı şifreli saklanır) */
  settings(orgId: string): { apifyToken: string | null; apifyMaxUsd: number | null } {
    const r = getDb().prepare("SELECT apify_token, apify_max_usd FROM radar_settings WHERE org_id = ?").get(orgId) as Row | undefined;
    return { apifyToken: (r?.apify_token as string) ?? null, apifyMaxUsd: (r?.apify_max_usd as number) ?? null };
  },
  putSettings(orgId: string, s: { apifyToken?: string | null; apifyMaxUsd?: number | null }): void {
    const cur = radarRepo.settings(orgId);
    getDb()
      .prepare(
        `INSERT INTO radar_settings (org_id, apify_token, apify_max_usd, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(org_id) DO UPDATE SET apify_token = excluded.apify_token, apify_max_usd = excluded.apify_max_usd, updated_at = excluded.updated_at`,
      )
      .run(orgId, s.apifyToken === undefined ? cur.apifyToken : s.apifyToken, s.apifyMaxUsd === undefined ? cur.apifyMaxUsd : s.apifyMaxUsd, nowIso());
  },
};
