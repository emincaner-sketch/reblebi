import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";
import type { Post, PostKind, PostStatus, PostTarget, TargetStatus } from "../types.js";

type Row = Record<string, unknown>;

function rowToTarget(r: Row): PostTarget {
  return {
    id: r.id as string,
    postId: r.post_id as string,
    channelId: r.channel_id as string,
    content: (r.content as string) ?? null,
    mediaIds: r.media_ids ? parseJson<string[]>(r.media_ids, []) : null,
    settings: parseJson<Record<string, unknown>>(r.settings, {}),
    status: r.status as TargetStatus,
    externalId: (r.external_id as string) ?? null,
    externalUrl: (r.external_url as string) ?? null,
    error: (r.error as string) ?? null,
    attempts: Number(r.attempts ?? 0),
    nextAttemptAt: (r.next_attempt_at as string) ?? null,
    publishedAt: (r.published_at as string) ?? null,
  };
}

function rowToPost(r: Row, targets: PostTarget[]): Post {
  return {
    id: r.id as string,
    title: (r.title as string) ?? null,
    kind: r.kind as PostKind,
    status: r.status as PostStatus,
    content: (r.content as string) ?? "",
    mediaIds: parseJson<string[]>(r.media_ids, []),
    publishAt: (r.publish_at as string) ?? null,
    publishedAt: (r.published_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    source: (r.source as Post["source"]) ?? "panel",
    targets,
  };
}

export interface TargetInput {
  channelId: string;
  content?: string | null;
  mediaIds?: string[] | null;
  settings?: Record<string, unknown>;
}

export interface CreatePostInput {
  title?: string | null;
  kind: PostKind;
  content: string;
  mediaIds?: string[];
  publishAt?: string | null;
  status?: "draft" | "scheduled";
  source?: Post["source"];
  targets: TargetInput[];
}

function targetsFor(postIds: string[]): Map<string, PostTarget[]> {
  const map = new Map<string, PostTarget[]>();
  if (postIds.length === 0) return map;
  const placeholders = postIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM post_targets WHERE post_id IN (${placeholders}) ORDER BY rowid`)
    .all(...postIds) as Row[];
  for (const r of rows) {
    const t = rowToTarget(r);
    const arr = map.get(t.postId) ?? [];
    arr.push(t);
    map.set(t.postId, arr);
  }
  return map;
}

export const postsRepo = {
  list(opts: { status?: PostStatus[]; from?: string; to?: string; limit?: number } = {}): Post[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (opts.status?.length) {
      where.push(`status IN (${opts.status.map(() => "?").join(",")})`);
      params.push(...opts.status);
    }
    if (opts.from) {
      where.push("COALESCE(publish_at, created_at) >= ?");
      params.push(opts.from);
    }
    if (opts.to) {
      where.push("COALESCE(publish_at, created_at) <= ?");
      params.push(opts.to);
    }
    const sql =
      "SELECT * FROM posts" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY COALESCE(publish_at, created_at) DESC LIMIT ?";
    params.push(opts.limit ?? 200);
    const rows = getDb().prepare(sql).all(...params) as Row[];
    const tmap = targetsFor(rows.map((r) => r.id as string));
    return rows.map((r) => rowToPost(r, tmap.get(r.id as string) ?? []));
  },
  get(id: string): Post | null {
    const r = getDb().prepare("SELECT * FROM posts WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    return rowToPost(r, targetsFor([id]).get(id) ?? []);
  },
  create(input: CreatePostInput): Post {
    const db = getDb();
    const id = randomId("post");
    const now = nowIso();
    const status: PostStatus = input.status ?? (input.publishAt ? "scheduled" : "draft");
    db.prepare(
      `INSERT INTO posts (id, title, kind, status, content, media_ids, publish_at, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.title ?? null,
      input.kind,
      status,
      input.content,
      JSON.stringify(input.mediaIds ?? []),
      input.publishAt ?? null,
      input.source ?? "panel",
      now,
      now,
    );
    const ins = db.prepare(
      `INSERT INTO post_targets (id, post_id, channel_id, content, media_ids, settings, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    );
    for (const t of input.targets) {
      ins.run(
        randomId("tgt"),
        id,
        t.channelId,
        t.content ?? null,
        t.mediaIds ? JSON.stringify(t.mediaIds) : null,
        JSON.stringify(t.settings ?? {}),
      );
    }
    return this.get(id)!;
  },
  update(id: string, input: Partial<CreatePostInput>): Post | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;
    const now = nowIso();
    const status: PostStatus =
      input.status ?? (existing.status === "draft" || existing.status === "scheduled"
        ? (input.publishAt ?? existing.publishAt) ? "scheduled" : "draft"
        : existing.status);
    db.prepare(
      `UPDATE posts SET title=?, kind=?, status=?, content=?, media_ids=?, publish_at=?, updated_at=? WHERE id=?`,
    ).run(
      input.title === undefined ? existing.title : input.title,
      input.kind ?? existing.kind,
      status,
      input.content ?? existing.content,
      JSON.stringify(input.mediaIds ?? existing.mediaIds),
      input.publishAt === undefined ? existing.publishAt : input.publishAt,
      now,
      id,
    );
    if (input.targets) {
      db.prepare("DELETE FROM post_targets WHERE post_id = ?").run(id);
      const ins = db.prepare(
        `INSERT INTO post_targets (id, post_id, channel_id, content, media_ids, settings, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      );
      for (const t of input.targets) {
        ins.run(
          randomId("tgt"),
          id,
          t.channelId,
          t.content ?? null,
          t.mediaIds ? JSON.stringify(t.mediaIds) : null,
          JSON.stringify(t.settings ?? {}),
        );
      }
    }
    return this.get(id);
  },
  setStatus(id: string, status: PostStatus, publishedAt?: string | null): void {
    getDb()
      .prepare("UPDATE posts SET status=?, published_at=COALESCE(?, published_at), updated_at=? WHERE id=?")
      .run(status, publishedAt ?? null, nowIso(), id);
  },
  remove(id: string): void {
    getDb().prepare("DELETE FROM posts WHERE id = ?").run(id);
  },
  /** Zamanı gelmiş ve yayınlanmayı bekleyen gönderileri kilitleyerek alır */
  claimDue(limit = 10): Post[] {
    const db = getDb();
    const now = nowIso();
    const rows = db
      .prepare("SELECT id FROM posts WHERE status='scheduled' AND publish_at IS NOT NULL AND publish_at <= ? ORDER BY publish_at ASC LIMIT ?")
      .all(now, limit) as Row[];
    const claimed: Post[] = [];
    for (const r of rows) {
      const res = db
        .prepare("UPDATE posts SET status='publishing', updated_at=? WHERE id=? AND status='scheduled'")
        .run(nowIso(), r.id as string);
      if (res.changes > 0) {
        const p = this.get(r.id as string);
        if (p) claimed.push(p);
      }
    }
    return claimed;
  },
  /** Kısmen başarısız olup tekrar denenecek hedefleri olan gönderiler */
  retryable(limit = 10): Post[] {
    const now = nowIso();
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT p.id FROM posts p JOIN post_targets t ON t.post_id = p.id
         WHERE p.status IN ('partial','failed','publishing') AND t.status='failed' AND t.next_attempt_at IS NOT NULL AND t.next_attempt_at <= ? LIMIT ?`,
      )
      .all(now, limit) as Row[];
    return rows.map((r) => this.get(r.id as string)!).filter(Boolean);
  },
  updateTarget(
    id: string,
    patch: Partial<Pick<PostTarget, "status" | "externalId" | "externalUrl" | "error" | "attempts" | "nextAttemptAt" | "publishedAt">>,
  ): void {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    const map: Record<string, string> = {
      status: "status",
      externalId: "external_id",
      externalUrl: "external_url",
      error: "error",
      attempts: "attempts",
      nextAttemptAt: "next_attempt_at",
      publishedAt: "published_at",
    };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${map[k]} = ?`);
      params.push(v as string | number | null);
    }
    if (!sets.length) return;
    params.push(id);
    getDb().prepare(`UPDATE post_targets SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  },
  stats(): { scheduled: number; published: number; failed: number; draft: number; publishedLast7: number } {
    const db = getDb();
    const count = (sql: string, ...p: string[]) => Number((db.prepare(sql).get(...p) as Row).c ?? 0);
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    return {
      scheduled: count("SELECT COUNT(*) c FROM posts WHERE status='scheduled'"),
      published: count("SELECT COUNT(*) c FROM posts WHERE status='published'"),
      failed: count("SELECT COUNT(*) c FROM posts WHERE status IN ('failed','partial')"),
      draft: count("SELECT COUNT(*) c FROM posts WHERE status='draft'"),
      publishedLast7: count("SELECT COUNT(*) c FROM posts WHERE status='published' AND published_at >= ?", weekAgo),
    };
  },
};
