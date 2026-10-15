import { defined, getDb, nowIso, parseJson, tx } from "../db.js";
import { randomId } from "../crypto.js";
import type { CommentRule, PrivateReply, PrivateReplyStatus } from "../types.js";

type Row = Record<string, unknown>;

/* ---------------- Yorumdan DM'e kuralları ---------------- */

function rowToCommentRule(r: Row): CommentRule {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    name: r.name as string,
    enabled: Number(r.enabled ?? 0),
    channelId: (r.channel_id as string) ?? null,
    mediaIds: parseJson<string[]>(r.media_ids, []),
    matchType: r.match_type as CommentRule["matchType"],
    pattern: (r.pattern as string) ?? null,
    dmText: r.dm_text as string,
    publicReplies: parseJson<string[]>(r.public_replies, []),
    includeReplies: Number(r.include_replies ?? 0),
    botNotice: Number(r.bot_notice ?? 1),
    buttons: parseJson<CommentRule["buttons"]>(r.buttons, []),
    priority: Number(r.priority ?? 100),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export type CommentRuleInput = Omit<CommentRule, "id" | "orgId" | "createdAt" | "updatedAt">;

export const commentRulesRepo = {
  list(orgId: string): CommentRule[] {
    return (getDb().prepare("SELECT * FROM comment_rules WHERE org_id = ? ORDER BY priority ASC, created_at ASC").all(orgId) as Row[]).map(rowToCommentRule);
  },
  get(orgId: string, id: string): CommentRule | null {
    const r = getDb().prepare("SELECT * FROM comment_rules WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToCommentRule(r) : null;
  },
  create(orgId: string, input: CommentRuleInput): CommentRule {
    const id = randomId("crule");
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO comment_rules (id, org_id, name, enabled, channel_id, media_ids, match_type, pattern, dm_text, public_replies,
         include_replies, bot_notice, buttons, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        orgId,
        input.name,
        input.enabled ? 1 : 0,
        input.channelId ?? null,
        JSON.stringify(input.mediaIds ?? []),
        input.matchType,
        input.pattern ?? null,
        input.dmText,
        JSON.stringify(input.publicReplies ?? []),
        input.includeReplies ? 1 : 0,
        input.botNotice ? 1 : 0,
        JSON.stringify(input.buttons ?? []),
        input.priority,
        now,
        now,
      );
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, input: Partial<CommentRuleInput>): CommentRule | null {
    const cur = this.get(orgId, id);
    if (!cur) return null;
    const m = { ...cur, ...defined(input) };
    getDb()
      .prepare(
        `UPDATE comment_rules SET name=?, enabled=?, channel_id=?, media_ids=?, match_type=?, pattern=?, dm_text=?, public_replies=?,
         include_replies=?, bot_notice=?, buttons=?, priority=?, updated_at=? WHERE id=? AND org_id=?`,
      )
      .run(
        m.name,
        m.enabled ? 1 : 0,
        m.channelId ?? null,
        JSON.stringify(m.mediaIds ?? []),
        m.matchType,
        m.pattern ?? null,
        m.dmText,
        JSON.stringify(m.publicReplies ?? []),
        m.includeReplies ? 1 : 0,
        m.botNotice ? 1 : 0,
        JSON.stringify(m.buttons ?? []),
        m.priority,
        nowIso(),
        id,
        orgId,
      );
    return this.get(orgId, id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM comment_rules WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};

/* ---------------- Özel yanıt kuyruğu ---------------- */

function rowToPrivateReply(r: Row): PrivateReply {
  return {
    channelId: r.channel_id as string,
    commentId: r.comment_id as string,
    orgId: r.org_id as string,
    ruleId: (r.rule_id as string) ?? null,
    mediaId: r.media_id as string,
    commenterId: r.commenter_id as string,
    commenterName: (r.commenter_name as string) ?? null,
    commentText: (r.comment_text as string) ?? "",
    commentedAt: r.commented_at as string,
    status: r.status as PrivateReplyStatus,
    attempts: Number(r.attempts ?? 0),
    nextAttemptAt: r.next_attempt_at as string,
    lastAttemptAt: (r.last_attempt_at as string) ?? null,
    dmText: r.dm_text as string,
    dmButtons: parseJson<PrivateReply["dmButtons"]>(r.dm_buttons, []),
    dmMessageId: (r.dm_message_id as string) ?? null,
    publicReplyText: (r.public_reply_text as string) ?? null,
    publicReplyId: (r.public_reply_id as string) ?? null,
    publicReplyError: (r.public_reply_error as string) ?? null,
    error: (r.error as string) ?? null,
    createdAt: r.created_at as string,
    sentAt: (r.sent_at as string) ?? null,
  };
}

export interface PrivateReplyInput {
  channelId: string;
  commentId: string;
  orgId: string;
  ruleId: string;
  mediaId: string;
  commenterId: string;
  commenterName: string | null;
  commentText: string;
  commentedAt: string;
  dmText: string;
  dmButtons: PrivateReply["dmButtons"];
  publicReplyText: string | null;
}

export const privateRepliesRepo = {
  /**
   * Kuyruğa ekler. Aynı yorum (webhook tekrarı) ya da aynı kişinin aynı gönderideki ikinci yorumu
   * için kayıt eklenmez ve false döner.
   */
  enqueue(input: PrivateReplyInput, now = new Date()): boolean {
    const at = now.toISOString();
    const r = getDb()
      .prepare(
        `INSERT OR IGNORE INTO private_replies (channel_id, comment_id, org_id, rule_id, media_id, commenter_id, commenter_name, comment_text,
         commented_at, status, attempts, next_attempt_at, dm_text, dm_buttons, public_reply_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.channelId,
        input.commentId,
        input.orgId,
        input.ruleId,
        input.mediaId,
        input.commenterId,
        input.commenterName,
        input.commentText.slice(0, 2000),
        input.commentedAt,
        at,
        input.dmText,
        JSON.stringify(input.dmButtons ?? []),
        input.publicReplyText,
        at,
      );
    return Number(r.changes) > 0;
  },
  get(channelId: string, commentId: string): PrivateReply | null {
    const r = getDb().prepare("SELECT * FROM private_replies WHERE channel_id = ? AND comment_id = ?").get(channelId, commentId) as Row | undefined;
    return r ? rowToPrivateReply(r) : null;
  },
  /** Gönderilmeyi bekleyen kaydı olan kanallar */
  channelsDue(now = new Date()): string[] {
    return (
      getDb().prepare("SELECT DISTINCT channel_id FROM private_replies WHERE status = 'queued' AND next_attempt_at <= ?").all(now.toISOString()) as Row[]
    ).map((r) => r.channel_id as string);
  },
  /** Kanalda son bir saat içinde denenen gönderim sayısı (Meta'nın saatlik sınırı için) */
  attemptsSince(channelId: string, since: Date): number {
    const r = getDb().prepare("SELECT COUNT(*) c FROM private_replies WHERE channel_id = ? AND last_attempt_at >= ?").get(channelId, since.toISOString()) as Row;
    return Number(r.c ?? 0);
  },
  /** Sırası gelen kayıtları "sending" yapıp döndürür (aynı kaydı iki işçi almasın) */
  claimDue(channelId: string, limit: number, now = new Date()): PrivateReply[] {
    if (limit <= 0) return [];
    const at = now.toISOString();
    return tx(() => {
      const rows = getDb()
        .prepare("SELECT * FROM private_replies WHERE channel_id = ? AND status = 'queued' AND next_attempt_at <= ? ORDER BY created_at ASC LIMIT ?")
        .all(channelId, at, limit) as Row[];
      const claim = getDb().prepare(
        "UPDATE private_replies SET status = 'sending', attempts = attempts + 1, last_attempt_at = ? WHERE channel_id = ? AND comment_id = ? AND status = 'queued'",
      );
      for (const r of rows) claim.run(at, r.channel_id as string, r.comment_id as string);
      return rows.map((r) => ({ ...rowToPrivateReply(r), status: "sending" as const, attempts: Number(r.attempts ?? 0) + 1, lastAttemptAt: at }));
    });
  },
  markSent(channelId: string, commentId: string, dmMessageId: string | null, now = new Date()): void {
    getDb()
      .prepare("UPDATE private_replies SET status = 'sent', dm_message_id = ?, sent_at = ?, error = NULL WHERE channel_id = ? AND comment_id = ?")
      .run(dmMessageId, now.toISOString(), channelId, commentId);
  },
  markPublicReply(channelId: string, commentId: string, result: { id?: string | null; error?: string | null }): void {
    getDb()
      .prepare("UPDATE private_replies SET public_reply_id = ?, public_reply_error = ? WHERE channel_id = ? AND comment_id = ?")
      .run(result.id ?? null, result.error ?? null, channelId, commentId);
  },
  /** Bitti: failed / skipped / expired */
  markDone(channelId: string, commentId: string, status: Exclude<PrivateReplyStatus, "queued" | "sending" | "sent">, error: string | null): void {
    getDb().prepare("UPDATE private_replies SET status = ?, error = ? WHERE channel_id = ? AND comment_id = ?").run(status, error, channelId, commentId);
  },
  retryLater(channelId: string, commentId: string, nextAttemptAt: Date, error: string): void {
    getDb()
      .prepare("UPDATE private_replies SET status = 'queued', next_attempt_at = ?, error = ? WHERE channel_id = ? AND comment_id = ?")
      .run(nextAttemptAt.toISOString(), error, channelId, commentId);
  },
  /** Gönderim sırasında süreç kapandıysa takılı kalan kayıtları kuyruğa geri al */
  recoverStale(now = new Date(), olderThanMinutes = 10): number {
    const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000).toISOString();
    const r = getDb().prepare("UPDATE private_replies SET status = 'queued' WHERE status = 'sending' AND last_attempt_at < ?").run(cutoff);
    return Number(r.changes);
  },
  list(orgId: string, opts: { status?: PrivateReplyStatus; ruleId?: string; limit?: number } = {}): PrivateReply[] {
    const where = ["org_id = ?"];
    const params: Array<string | number> = [orgId];
    if (opts.status) {
      where.push("status = ?");
      params.push(opts.status);
    }
    if (opts.ruleId) {
      where.push("rule_id = ?");
      params.push(opts.ruleId);
    }
    params.push(Math.min(opts.limit ?? 100, 500));
    return (getDb().prepare(`SELECT * FROM private_replies WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...params) as Row[]).map(
      rowToPrivateReply,
    );
  },
  /** Durum başına sayılar (isteğe bağlı kural ve tarih filtresiyle) */
  stats(orgId: string, opts: { ruleId?: string; since?: string } = {}): Record<PrivateReplyStatus, number> {
    const where = ["org_id = ?"];
    const params: string[] = [orgId];
    if (opts.ruleId) {
      where.push("rule_id = ?");
      params.push(opts.ruleId);
    }
    if (opts.since) {
      where.push("created_at >= ?");
      params.push(opts.since);
    }
    const out: Record<PrivateReplyStatus, number> = { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, expired: 0 };
    for (const r of getDb().prepare(`SELECT status, COUNT(*) c FROM private_replies WHERE ${where.join(" AND ")} GROUP BY status`).all(...params) as Row[])
      out[r.status as PrivateReplyStatus] = Number(r.c ?? 0);
    return out;
  },
};
