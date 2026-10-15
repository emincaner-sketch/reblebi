import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";
import type { Conversation, ConversationMode, Message, MessageDirection, MessageSender } from "../types.js";

type Row = Record<string, unknown>;

function rowToConversation(r: Row): Conversation {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    channelId: r.channel_id as string,
    externalId: r.external_id as string,
    participantId: r.participant_id as string,
    participantName: (r.participant_name as string) ?? null,
    participantAvatar: (r.participant_avatar as string) ?? null,
    lastMessageAt: r.last_message_at as string,
    lastMessagePreview: (r.last_message_preview as string) ?? null,
    unread: Number(r.unread ?? 0),
    mode: r.mode as ConversationMode,
    status: r.status as Conversation["status"],
    needsAttention: Number(r.needs_attention ?? 0),
    assignedTo: (r.assigned_to as string) ?? null,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    createdAt: r.created_at as string,
  };
}

function rowToMessage(r: Row): Message {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    direction: r.direction as MessageDirection,
    externalId: (r.external_id as string) ?? null,
    text: (r.text as string) ?? "",
    attachments: parseJson<Message["attachments"]>(r.attachments, []),
    sentBy: r.sent_by as MessageSender,
    ruleId: (r.rule_id as string) ?? null,
    status: r.status as Message["status"],
    error: (r.error as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export interface InboundMessageInput {
  orgId: string;
  channelId: string;
  conversationExternalId: string;
  participantId: string;
  participantName?: string | null;
  participantAvatar?: string | null;
  externalMessageId?: string | null;
  text: string;
  attachments?: Message["attachments"];
  receivedAt?: string;
  metadata?: Record<string, unknown>;
}

export const inboxRepo = {
  listConversations(
    orgId: string,
    opts: { channelId?: string; status?: "open" | "closed"; limit?: number; onlyAttention?: boolean; assignedTo?: string; q?: string } = {},
  ): Conversation[] {
    const where: string[] = ["org_id = ?"];
    const params: Array<string | number> = [orgId];
    if (opts.channelId) {
      where.push("channel_id = ?");
      params.push(opts.channelId);
    }
    if (opts.status) {
      where.push("status = ?");
      params.push(opts.status);
    }
    if (opts.onlyAttention) where.push("needs_attention = 1");
    if (opts.assignedTo) {
      where.push("assigned_to = ?");
      params.push(opts.assignedTo);
    }
    if (opts.q) {
      where.push("(lower(COALESCE(participant_name,'')) LIKE ? OR lower(COALESCE(last_message_preview,'')) LIKE ?)");
      params.push(`%${opts.q.toLowerCase()}%`, `%${opts.q.toLowerCase()}%`);
    }
    params.push(Math.min(opts.limit ?? 100, 500));
    return (getDb().prepare(`SELECT * FROM conversations WHERE ${where.join(" AND ")} ORDER BY last_message_at DESC LIMIT ?`).all(...params) as Row[]).map(
      rowToConversation,
    );
  },
  getConversation(orgId: string, id: string): Conversation | null {
    const r = getDb().prepare("SELECT * FROM conversations WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToConversation(r) : null;
  },
  getConversationById(id: string): Conversation | null {
    const r = getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToConversation(r) : null;
  },
  findConversation(channelId: string, externalId: string): Conversation | null {
    const r = getDb().prepare("SELECT * FROM conversations WHERE channel_id = ? AND external_id = ?").get(channelId, externalId) as Row | undefined;
    return r ? rowToConversation(r) : null;
  },
  messages(conversationId: string, limit = 300): Message[] {
    // Son N mesaj, kronolojik sırada
    return (
      getDb()
        .prepare("SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC")
        .all(conversationId, limit) as Row[]
    ).map(rowToMessage);
  },
  hasInboundBefore(conversationId: string, excludeMessageId: string): boolean {
    const r = getDb()
      .prepare("SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND direction = 'in' AND id != ?")
      .get(conversationId, excludeMessageId) as Row;
    return Number(r.c ?? 0) > 0;
  },
  /** Gelen mesajı kaydeder; konuşma yoksa açar. Aynı mesaj tekrar gelirse null döner (webhook tekrarları). */
  recordInbound(input: InboundMessageInput): { conversation: Conversation; message: Message; created: boolean } | null {
    const db = getDb();
    const now = input.receivedAt ?? nowIso();
    if (input.externalMessageId) {
      const dup = db
        .prepare("SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.channel_id = ? AND m.external_id = ?")
        .get(input.channelId, input.externalMessageId);
      if (dup) return null;
    }
    let conv = this.findConversation(input.channelId, input.conversationExternalId);
    let created = false;
    if (!conv) {
      const id = randomId("conv");
      db.prepare(
        `INSERT INTO conversations (id, org_id, channel_id, external_id, participant_id, participant_name, participant_avatar,
         last_message_at, last_message_preview, unread, mode, status, needs_attention, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'auto', 'open', 0, ?, ?)`,
      ).run(
        id,
        input.orgId,
        input.channelId,
        input.conversationExternalId,
        input.participantId,
        input.participantName ?? null,
        input.participantAvatar ?? null,
        now,
        input.text.slice(0, 140),
        JSON.stringify(input.metadata ?? {}),
        now,
      );
      conv = this.getConversationById(id)!;
      created = true;
    } else {
      db.prepare(
        `UPDATE conversations SET last_message_at=?, last_message_preview=?, unread=unread+1, status='open',
         participant_name=COALESCE(?, participant_name), participant_avatar=COALESCE(?, participant_avatar) WHERE id=?`,
      ).run(now, input.text.slice(0, 140), input.participantName ?? null, input.participantAvatar ?? null, conv.id);
      conv = this.getConversationById(conv.id)!;
    }
    const mid = randomId("msg");
    db.prepare(
      `INSERT INTO messages (id, conversation_id, direction, external_id, text, attachments, sent_by, status, created_at)
       VALUES (?, ?, 'in', ?, ?, ?, 'customer', 'received', ?)`,
    ).run(mid, conv.id, input.externalMessageId ?? null, input.text, JSON.stringify(input.attachments ?? []), now);
    const message = rowToMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(mid) as Row);
    return { conversation: conv, message, created };
  },
  /** Mesaj kaydetmeden konuşmayı bulur ya da açar (ör. yorumdan DM'e ilk giden mesaj için) */
  ensureConversation(input: { orgId: string; channelId: string; externalId: string; participantId: string; participantName?: string | null }): Conversation {
    const existing = this.findConversation(input.channelId, input.externalId);
    if (existing) return existing;
    const id = randomId("conv");
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO conversations (id, org_id, channel_id, external_id, participant_id, participant_name, participant_avatar,
         last_message_at, last_message_preview, unread, mode, status, needs_attention, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, 'auto', 'open', 0, '{}', ?)`,
      )
      .run(id, input.orgId, input.channelId, input.externalId, input.participantId, input.participantName ?? null, now, now);
    return this.getConversationById(id)!;
  },
  /** Konuşma metadata alanına alan ekler/günceller (ör. yorum konusunda son yorum kimliği) */
  mergeMetadata(conversationId: string, patch: Record<string, unknown>): void {
    const db = getDb();
    const r = db.prepare("SELECT metadata FROM conversations WHERE id = ?").get(conversationId) as Row | undefined;
    if (!r) return;
    db.prepare("UPDATE conversations SET metadata = ? WHERE id = ?").run(JSON.stringify({ ...parseJson<Record<string, unknown>>(r.metadata, {}), ...patch }), conversationId);
  },
  recordOutbound(
    conversationId: string,
    text: string,
    sentBy: MessageSender,
    opts: { externalId?: string | null; ruleId?: string | null; status?: Message["status"]; error?: string | null } = {},
  ): Message {
    const db = getDb();
    const now = nowIso();
    const id = randomId("msg");
    db.prepare(
      `INSERT INTO messages (id, conversation_id, direction, external_id, text, attachments, sent_by, rule_id, status, error, created_at)
       VALUES (?, ?, 'out', ?, ?, '[]', ?, ?, ?, ?, ?)`,
    ).run(id, conversationId, opts.externalId ?? null, text, sentBy, opts.ruleId ?? null, opts.status ?? "sent", opts.error ?? null, now);
    db.prepare("UPDATE conversations SET last_message_at=?, last_message_preview=? WHERE id=?").run(now, ("↩ " + text).slice(0, 140), conversationId);
    return rowToMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Row);
  },
  markRead(id: string): void {
    getDb().prepare("UPDATE conversations SET unread=0 WHERE id=?").run(id);
  },
  setMode(id: string, mode: ConversationMode): void {
    getDb().prepare("UPDATE conversations SET mode=? WHERE id=?").run(mode, id);
  },
  setStatus(id: string, status: "open" | "closed"): void {
    getDb().prepare("UPDATE conversations SET status=?, needs_attention = CASE WHEN ? = 'closed' THEN 0 ELSE needs_attention END WHERE id=?").run(status, status, id);
  },
  assign(id: string, userId: string | null): void {
    getDb().prepare("UPDATE conversations SET assigned_to=? WHERE id=?").run(userId, id);
  },
  flagAttention(id: string, flag: boolean): void {
    getDb().prepare("UPDATE conversations SET needs_attention=? WHERE id=?").run(flag ? 1 : 0, id);
  },
  ruleHitRecently(ruleId: string, conversationId: string, cooldownMinutes: number): boolean {
    if (cooldownMinutes <= 0) return false;
    const r = getDb().prepare("SELECT last_hit_at FROM rule_hits WHERE rule_id=? AND conversation_id=?").get(ruleId, conversationId) as Row | undefined;
    if (!r) return false;
    return Date.now() - new Date(r.last_hit_at as string).getTime() < cooldownMinutes * 60_000;
  },
  recordRuleHit(ruleId: string, conversationId: string): void {
    getDb()
      .prepare(
        "INSERT INTO rule_hits (rule_id, conversation_id, last_hit_at) VALUES (?, ?, ?) ON CONFLICT(rule_id, conversation_id) DO UPDATE SET last_hit_at=excluded.last_hit_at",
      )
      .run(ruleId, conversationId, nowIso());
  },
  stats(orgId: string): { open: number; unread: number; attention: number; inLast7: number; autoRepliedLast7: number } {
    const db = getDb();
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const n = (sql: string, ...p: string[]) => Number((db.prepare(sql).get(orgId, ...p) as Row).c ?? 0);
    return {
      open: n("SELECT COUNT(*) c FROM conversations WHERE org_id = ? AND status='open'"),
      unread: n("SELECT COALESCE(SUM(unread),0) c FROM conversations WHERE org_id = ?"),
      attention: n("SELECT COUNT(*) c FROM conversations WHERE org_id = ? AND needs_attention=1 AND status='open'"),
      inLast7: n(
        "SELECT COUNT(*) c FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.org_id = ? AND m.direction='in' AND m.created_at >= ?",
        weekAgo,
      ),
      autoRepliedLast7: n(
        "SELECT COUNT(*) c FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.org_id = ? AND m.direction='out' AND m.sent_by IN ('rule','ai') AND m.created_at >= ?",
        weekAgo,
      ),
    };
  },
  /** Analitik raporu: dönemde gelen mesaj ve kural/AI ile giden otomatik yanıt sayısı ([from, to) ISO) */
  periodStats(orgId: string, from: string, to: string): { incoming: number; autoReplied: number } {
    const db = getDb();
    const n = (sql: string) => Number((db.prepare(sql).get(orgId, from, to) as Row).c ?? 0);
    return {
      incoming: n("SELECT COUNT(*) c FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.org_id = ? AND m.direction='in' AND m.created_at >= ? AND m.created_at < ?"),
      autoReplied: n(
        "SELECT COUNT(*) c FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.org_id = ? AND m.direction='out' AND m.sent_by IN ('rule','ai') AND m.created_at >= ? AND m.created_at < ?",
      ),
    };
  },
};
