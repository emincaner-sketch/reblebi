import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";
import type { CommentJob, Post, PostComment, PostKind, PostSource, PostStatus, PostTarget, Recurrence, TargetStatus } from "../types.js";

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
    orgId: r.org_id as string,
    title: (r.title as string) ?? null,
    kind: r.kind as PostKind,
    status: r.status as PostStatus,
    content: (r.content as string) ?? "",
    mediaIds: parseJson<string[]>(r.media_ids, []),
    publishAt: (r.publish_at as string) ?? null,
    publishedAt: (r.published_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    source: ((r.source as string) ?? "panel") as PostSource,
    createdBy: (r.created_by as string) ?? null,
    campaignId: (r.campaign_id as string) ?? null,
    tags: parseJson<string[]>(r.tags, []),
    comments: parseJson<PostComment[]>(r.comments, []),
    recurrence: parseJson<Recurrence | null>(r.recurrence, null),
    notes: (r.notes as string) ?? null,
    rejectionReason: (r.rejection_reason as string) ?? null,
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
  orgId: string;
  title?: string | null;
  kind: PostKind;
  content: string;
  mediaIds?: string[];
  publishAt?: string | null;
  status: PostStatus;
  source: PostSource;
  createdBy?: string | null;
  campaignId?: string | null;
  tags?: string[];
  comments?: PostComment[];
  recurrence?: Recurrence | null;
  notes?: string | null;
  targets: TargetInput[];
}

export type UpdatePostInput = Partial<Omit<CreatePostInput, "orgId" | "source" | "createdBy">> & { rejectionReason?: string | null };

function targetsFor(postIds: string[]): Map<string, PostTarget[]> {
  const map = new Map<string, PostTarget[]>();
  if (postIds.length === 0) return map;
  // SQLite değişken sınırı için parçalara böl
  for (let i = 0; i < postIds.length; i += 500) {
    const chunk = postIds.slice(i, i + 500);
    const rows = getDb()
      .prepare(`SELECT * FROM post_targets WHERE post_id IN (${chunk.map(() => "?").join(",")}) ORDER BY rowid`)
      .all(...chunk) as Row[];
    for (const r of rows) {
      const t = rowToTarget(r);
      const arr = map.get(t.postId) ?? [];
      arr.push(t);
      map.set(t.postId, arr);
    }
  }
  return map;
}

function insertTargets(postId: string, targets: TargetInput[]): void {
  const ins = getDb().prepare(
    "INSERT INTO post_targets (id, post_id, channel_id, content, media_ids, settings, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
  );
  for (const t of targets) {
    ins.run(randomId("tgt"), postId, t.channelId, t.content ?? null, t.mediaIds ? JSON.stringify(t.mediaIds) : null, JSON.stringify(t.settings ?? {}));
  }
}

export interface ListPostsOptions {
  status?: PostStatus[];
  from?: string;
  to?: string;
  campaignId?: string;
  channelId?: string;
  tag?: string;
  customerId?: string;
  q?: string;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

export const postsRepo = {
  list(orgId: string, opts: ListPostsOptions = {}): Post[] {
    const where: string[] = ["p.org_id = ?"];
    const params: Array<string | number> = [orgId];
    if (opts.status?.length) {
      where.push(`p.status IN (${opts.status.map(() => "?").join(",")})`);
      params.push(...opts.status);
    }
    if (opts.from) {
      where.push("COALESCE(p.publish_at, p.created_at) >= ?");
      params.push(opts.from);
    }
    if (opts.to) {
      where.push("COALESCE(p.publish_at, p.created_at) <= ?");
      params.push(opts.to);
    }
    if (opts.campaignId) {
      where.push("p.campaign_id = ?");
      params.push(opts.campaignId);
    }
    if (opts.channelId) {
      where.push("EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = p.id AND t.channel_id = ?)");
      params.push(opts.channelId);
    }
    if (opts.customerId) {
      where.push("EXISTS (SELECT 1 FROM post_targets t JOIN channels c ON c.id = t.channel_id WHERE t.post_id = p.id AND c.customer_id = ?)");
      params.push(opts.customerId);
    }
    if (opts.tag) {
      where.push("EXISTS (SELECT 1 FROM json_each(p.tags) j WHERE j.value = ?)");
      params.push(opts.tag);
    }
    if (opts.q) {
      where.push("(lower(p.content) LIKE ? OR lower(COALESCE(p.title,'')) LIKE ?)");
      params.push(`%${opts.q.toLowerCase()}%`, `%${opts.q.toLowerCase()}%`);
    }
    const order = opts.order === "asc" ? "ASC" : "DESC";
    const sql = `SELECT p.* FROM posts p WHERE ${where.join(" AND ")} ORDER BY COALESCE(p.publish_at, p.created_at) ${order} LIMIT ? OFFSET ?`;
    params.push(Math.min(opts.limit ?? 200, 2000), opts.offset ?? 0);
    const rows = getDb().prepare(sql).all(...params) as Row[];
    const tmap = targetsFor(rows.map((r) => r.id as string));
    return rows.map((r) => rowToPost(r, tmap.get(r.id as string) ?? []));
  },
  get(orgId: string, id: string): Post | null {
    const r = getDb().prepare("SELECT * FROM posts WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    if (!r) return null;
    return rowToPost(r, targetsFor([id]).get(id) ?? []);
  },
  /** Sistem içi (zamanlayıcı) */
  getById(id: string): Post | null {
    const r = getDb().prepare("SELECT * FROM posts WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    return rowToPost(r, targetsFor([id]).get(id) ?? []);
  },
  create(input: CreatePostInput): Post {
    const db = getDb();
    const id = randomId("post");
    const now = nowIso();
    db.prepare(
      `INSERT INTO posts (id, org_id, title, kind, status, content, media_ids, publish_at, source, created_by, campaign_id, tags, comments,
       recurrence, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.orgId,
      input.title ?? null,
      input.kind,
      input.status,
      input.content,
      JSON.stringify(input.mediaIds ?? []),
      input.publishAt ?? null,
      input.source,
      input.createdBy ?? null,
      input.campaignId ?? null,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.comments ?? []),
      input.recurrence ? JSON.stringify(input.recurrence) : null,
      input.notes ?? null,
      now,
      now,
    );
    insertTargets(id, input.targets);
    return this.getById(id)!;
  },
  update(orgId: string, id: string, input: UpdatePostInput): Post | null {
    const db = getDb();
    const cur = this.get(orgId, id);
    if (!cur) return null;
    db.prepare(
      `UPDATE posts SET title=?, kind=?, status=?, content=?, media_ids=?, publish_at=?, campaign_id=?, tags=?, comments=?, recurrence=?, notes=?,
       rejection_reason=?, updated_at=? WHERE id=? AND org_id=?`,
    ).run(
      input.title === undefined ? cur.title : input.title,
      input.kind ?? cur.kind,
      input.status ?? cur.status,
      input.content ?? cur.content,
      JSON.stringify(input.mediaIds ?? cur.mediaIds),
      input.publishAt === undefined ? cur.publishAt : input.publishAt,
      input.campaignId === undefined ? cur.campaignId : input.campaignId,
      JSON.stringify(input.tags ?? cur.tags),
      JSON.stringify(input.comments ?? cur.comments),
      input.recurrence === undefined ? (cur.recurrence ? JSON.stringify(cur.recurrence) : null) : input.recurrence ? JSON.stringify(input.recurrence) : null,
      input.notes === undefined ? cur.notes : input.notes,
      input.rejectionReason === undefined ? cur.rejectionReason : input.rejectionReason,
      nowIso(),
      id,
      orgId,
    );
    if (input.targets) {
      db.prepare("DELETE FROM post_targets WHERE post_id = ?").run(id);
      insertTargets(id, input.targets);
    }
    return this.get(orgId, id);
  },
  setStatus(id: string, status: PostStatus, publishedAt?: string | null): void {
    getDb().prepare("UPDATE posts SET status=?, published_at=COALESCE(?, published_at), updated_at=? WHERE id=?").run(status, publishedAt ?? null, nowIso(), id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM comment_jobs WHERE post_id = ?").run(id);
    getDb().prepare("DELETE FROM posts WHERE id = ? AND org_id = ?").run(id, orgId);
  },
  resetTargetsForRetry(postId: string): void {
    getDb()
      .prepare("UPDATE post_targets SET status='pending', next_attempt_at=NULL, error=NULL WHERE post_id = ? AND status IN ('failed','pending')")
      .run(postId);
  },
  /** Zamanı gelmiş ve yayınlanmayı bekleyen gönderileri kilitleyerek alır (tüm org'lar) */
  claimDue(limit = 10): Post[] {
    const db = getDb();
    const rows = db
      .prepare("SELECT id FROM posts WHERE status='scheduled' AND publish_at IS NOT NULL AND publish_at <= ? ORDER BY publish_at ASC LIMIT ?")
      .all(nowIso(), limit) as Row[];
    const claimed: Post[] = [];
    for (const r of rows) {
      const res = db.prepare("UPDATE posts SET status='publishing', updated_at=? WHERE id=? AND status='scheduled'").run(nowIso(), r.id as string);
      if (res.changes > 0) {
        const p = this.getById(r.id as string);
        if (p) claimed.push(p);
      }
    }
    return claimed;
  },
  /** Kısmen başarısız olup tekrar denenecek hedefleri olan gönderiler */
  retryable(limit = 10): Post[] {
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT p.id FROM posts p JOIN post_targets t ON t.post_id = p.id
         WHERE p.status IN ('partial','failed') AND t.status='failed' AND t.next_attempt_at IS NOT NULL AND t.next_attempt_at <= ? LIMIT ?`,
      )
      .all(nowIso(), limit) as Row[];
    return rows.map((r) => this.getById(r.id as string)).filter((p): p is Post => Boolean(p));
  },
  /** Sunucu yeniden başlarken 'publishing' durumunda takılı kalanları kurtar */
  recoverStuck(olderThanMinutes = 15): number {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
    const r = getDb().prepare("UPDATE posts SET status='scheduled', updated_at=? WHERE status='publishing' AND updated_at < ?").run(nowIso(), cutoff);
    getDb().prepare("UPDATE post_targets SET status='pending' WHERE status='publishing'").run();
    return Number(r.changes);
  },
  updateTarget(
    id: string,
    patch: Partial<Pick<PostTarget, "status" | "externalId" | "externalUrl" | "error" | "attempts" | "nextAttemptAt" | "publishedAt">>,
  ): void {
    const map: Record<string, string> = {
      status: "status",
      externalId: "external_id",
      externalUrl: "external_url",
      error: "error",
      attempts: "attempts",
      nextAttemptAt: "next_attempt_at",
      publishedAt: "published_at",
    };
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${map[k]} = ?`);
      params.push(v as string | number | null);
    }
    if (!sets.length) return;
    params.push(id);
    getDb().prepare(`UPDATE post_targets SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  },
  /** Bir kanaldaki planlı gönderi zamanları (boş saat bulucu için) */
  scheduledTimesForChannels(orgId: string, channelIds: string[], from: string, to: string): Array<{ channelId: string; at: string }> {
    if (!channelIds.length) return [];
    const rows = getDb()
      .prepare(
        `SELECT t.channel_id, p.publish_at FROM posts p JOIN post_targets t ON t.post_id = p.id
         WHERE p.org_id = ? AND p.status IN ('scheduled','pending_approval','publishing','published') AND p.publish_at BETWEEN ? AND ?
         AND t.channel_id IN (${channelIds.map(() => "?").join(",")})`,
      )
      .all(orgId, from, to, ...channelIds) as Row[];
    return rows.map((r) => ({ channelId: r.channel_id as string, at: r.publish_at as string }));
  },
  stats(orgId: string): { scheduled: number; published: number; failed: number; draft: number; pendingApproval: number; publishedLast7: number } {
    const db = getDb();
    const n = (sql: string, ...p: string[]) => Number((db.prepare(sql).get(orgId, ...p) as Row).c ?? 0);
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    return {
      scheduled: n("SELECT COUNT(*) c FROM posts WHERE org_id = ? AND status='scheduled'"),
      published: n("SELECT COUNT(*) c FROM posts WHERE org_id = ? AND status='published'"),
      failed: n("SELECT COUNT(*) c FROM posts WHERE org_id = ? AND status IN ('failed','partial')"),
      draft: n("SELECT COUNT(*) c FROM posts WHERE org_id = ? AND status='draft'"),
      pendingApproval: n("SELECT COUNT(*) c FROM posts WHERE org_id = ? AND status='pending_approval'"),
      publishedLast7: n("SELECT COUNT(*) c FROM posts WHERE org_id = ? AND status='published' AND published_at >= ?", weekAgo),
    };
  },
  /** Kanal bazında hedef sonuçları (analitik) */
  targetOutcomes(orgId: string, from: string): Array<{ channelId: string; status: string; n: number }> {
    return (
      getDb()
        .prepare(
          `SELECT t.channel_id, t.status, COUNT(*) n FROM post_targets t JOIN posts p ON p.id = t.post_id
           WHERE p.org_id = ? AND COALESCE(p.publish_at, p.created_at) >= ? GROUP BY t.channel_id, t.status`,
        )
        .all(orgId, from) as Row[]
    ).map((r) => ({ channelId: r.channel_id as string, status: r.status as string, n: Number(r.n) }));
  },
  publishedTargets(orgId: string, from: string, limit = 200): Array<PostTarget & { orgId: string; kind: PostKind; content: string; publishAt: string | null }> {
    return (
      getDb()
        .prepare(
          `SELECT t.*, p.org_id, p.kind, COALESCE(t.content, p.content) AS pcontent, p.publish_at FROM post_targets t JOIN posts p ON p.id = t.post_id
           WHERE p.org_id = ? AND t.status = 'published' AND t.published_at >= ? ORDER BY t.published_at DESC LIMIT ?`,
        )
        .all(orgId, from, limit) as Row[]
    ).map((r) => ({ ...rowToTarget(r), orgId: r.org_id as string, kind: r.kind as PostKind, content: r.pcontent as string, publishAt: (r.publish_at as string) ?? null }));
  },
};

/* ---------------- Yorum işleri (ilk yorum / zincir yanıtları) ---------------- */

function rowToJob(r: Row): CommentJob {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    postId: r.post_id as string,
    targetId: r.target_id as string,
    position: Number(r.position),
    text: r.text as string,
    runAt: r.run_at as string,
    status: r.status as CommentJob["status"],
    externalId: (r.external_id as string) ?? null,
    error: (r.error as string) ?? null,
    attempts: Number(r.attempts ?? 0),
  };
}

export const commentJobsRepo = {
  enqueue(orgId: string, postId: string, targetId: string, comments: PostComment[], baseTime = Date.now()): void {
    const ins = getDb().prepare(
      "INSERT INTO comment_jobs (id, org_id, post_id, target_id, position, text, run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    comments.forEach((c, i) => {
      if (!c.text.trim()) return;
      ins.run(randomId("cj"), orgId, postId, targetId, i, c.text, new Date(baseTime + Math.max(0, c.delayMinutes) * 60_000).toISOString(), nowIso());
    });
  },
  due(limit = 20): CommentJob[] {
    return (getDb().prepare("SELECT * FROM comment_jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at ASC LIMIT ?").all(nowIso(), limit) as Row[]).map(rowToJob);
  },
  forPost(postId: string): CommentJob[] {
    return (getDb().prepare("SELECT * FROM comment_jobs WHERE post_id = ? ORDER BY target_id, position").all(postId) as Row[]).map(rowToJob);
  },
  /** Aynı hedefte önceki yorumun dış kimliği (zincir yanıtları için) */
  previousExternalId(targetId: string, position: number): string | null {
    const r = getDb()
      .prepare("SELECT external_id FROM comment_jobs WHERE target_id = ? AND position < ? AND status = 'done' ORDER BY position DESC LIMIT 1")
      .get(targetId, position) as Row | undefined;
    return (r?.external_id as string) ?? null;
  },
  update(id: string, patch: { status?: CommentJob["status"]; externalId?: string | null; error?: string | null; attempts?: number; runAt?: string }): void {
    const cur = getDb().prepare("SELECT * FROM comment_jobs WHERE id = ?").get(id) as Row | undefined;
    if (!cur) return;
    const j = rowToJob(cur);
    getDb()
      .prepare("UPDATE comment_jobs SET status=?, external_id=?, error=?, attempts=?, run_at=? WHERE id=?")
      .run(
        patch.status ?? j.status,
        patch.externalId === undefined ? j.externalId : patch.externalId,
        patch.error === undefined ? j.error : patch.error,
        patch.attempts ?? j.attempts,
        patch.runAt ?? j.runAt,
        id,
      );
  },
};
