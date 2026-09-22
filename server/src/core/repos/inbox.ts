import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";
import type { Conversation, ConversationMode, Message, MessageDirection, MessageSender } from "../types.js";

type Row = Record<string, unknown>;

function rowToConversation(r: Row): Conversation {
  return {
    id: r.id as string,
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
  listConversations(opts: { channelId?: string; status?: "open" | "closed"; limit?: number; onlyAttention?: boolean } = {}): Conversation[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (opts.channelId) {
      where.push("channel_id = ?");
      params.push(opts.channelId);
    }
    if (opts.status) {
      where.push("status = ?");
      params.push(opts.status);
    }
    if (opts.onlyAttention) where.push("needs_attention = 1");
    const sql =
      "SELECT * FROM conversations" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY last_message_at DESC LIMIT ?";
    params.push(opts.limit ?? 100);
    return (getDb().prepare(sql).all(...params) as Row[]).map(rowToConversation);
  },
  getConversation(id: string): Conversation | null {
    const r = getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToConversation(r) : null;
  },
  findConversation(channelId: string, externalId: string): Conversation | null {
    const r = getDb()
      .prepare("SELECT * FROM conversations WHERE channel_id = ? AND external_id = ?")
      .get(channelId, externalId) as Row | undefined;
    return r ? rowToConversation(r) : null;
  },
  messages(conversationId: string, limit = 200): Message[] {
    return (
      getDb()
        .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?")
        .all(conversationId, limit) as Row[]
    ).map(rowToMessage);
  },
  hasInboundBefore(conversationId: string, excludeMessageId: string): boolean {
    const r = getDb()
      .prepare("SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND direction = 'in' AND id != ?")
      .get(conversationId, excludeMessageId) as Row;
    return Number(r.c ?? 0) > 0;
  },
  /** Gelen mesajı kaydeder; konuşma yoksa açar. Aynı external id tekrar gelirse null döner (webhook tekrarları). */
  recordInbound(input: InboundMessageInput): { conversation: Conversation; message: Message; created: boolean } | null {
    const db = getDb();
    const now = input.receivedAt ?? nowIso();
    if (input.externalMessageId) {
      const dup = db.prepare("SELECT id FROM messages WHERE external_id = ?").get(input.externalMessageId);
      if (dup) return null;
    }
    let conv = this.findConversation(input.channelId, input.conversationExternalId);
    let created = false;
    if (!conv) {
      const id = randomId("conv");
      db.prepare(
        `INSERT INTO conversations (id, channel_id, external_id, participant_id, participant_name, participant_avatar,
         last_message_at, last_message_preview, unread, mode, status, needs_attention, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'auto', 'open', 0, ?, ?)`,
      ).run(
        id,
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
      conv = this.getConversation(id)!;
      created = true;
    } else {
      db.prepare(
        `UPDATE conversations SET last_message_at=?, last_message_preview=?, unread=unread+1, status='open',
         participant_name=COALESCE(?, participant_name), participant_avatar=COALESCE(?, participant_avatar) WHERE id=?`,
      ).run(now, input.text.slice(0, 140), input.participantName ?? null, input.participantAvatar ?? null, conv.id);
      conv = this.getConversation(conv.id)!;
    }
    const mid = randomId("msg");
    db.prepare(
      `INSERT INTO messages (id, conversation_id, direction, external_id, text, attachments, sent_by, status, created_at)
       VALUES (?, ?, 'in', ?, ?, ?, 'customer', 'received', ?)`,
    ).run(mid, conv.id, input.externalMessageId ?? null, input.text, JSON.stringify(input.attachments ?? []), now);
    const message = rowToMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(mid) as Row);
    return { conversation: conv, message, created };
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
    db.prepare("UPDATE conversations SET last_message_at=?, last_message_preview=? WHERE id=?").run(
      now,
      ("↩ " + text).slice(0, 140),
      conversationId,
    );
    return rowToMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Row);
  },
  markRead(conversationId: string): void {
    getDb().prepare("UPDATE conversations SET unread=0, needs_attention=0 WHERE id=?").run(conversationId);
  },
  setMode(conversationId: string, mode: ConversationMode): void {
    getDb().prepare("UPDATE conversations SET mode=? WHERE id=?").run(mode, conversationId);
  },
  setStatus(conversationId: string, status: "open" | "closed"): void {
    getDb().prepare("UPDATE conversations SET status=? WHERE id=?").run(status, conversationId);
  },
  flagAttention(conversationId: string, flag: boolean): void {
    getDb().prepare("UPDATE conversations SET needs_attention=? WHERE id=?").run(flag ? 1 : 0, conversationId);
  },
  ruleHitRecently(ruleId: string, conversationId: string, cooldownMinutes: number): boolean {
    if (cooldownMinutes <= 0) return false;
    const r = getDb()
      .prepare("SELECT last_hit_at FROM rule_hits WHERE rule_id=? AND conversation_id=?")
      .get(ruleId, conversationId) as Row | undefined;
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
  stats(): { open: number; unread: number; attention: number; inLast7: number; autoRepliedLast7: number } {
    const db = getDb();
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const n = (sql: string, ...p: string[]) => Number((db.prepare(sql).get(...p) as Row).c ?? 0);
    return {
      open: n("SELECT COUNT(*) c FROM conversations WHERE status='open'"),
      unread: n("SELECT COALESCE(SUM(unread),0) c FROM conversations"),
      attention: n("SELECT COUNT(*) c FROM conversations WHERE needs_attention=1"),
      inLast7: n("SELECT COUNT(*) c FROM messages WHERE direction='in' AND created_at >= ?", weekAgo),
      autoRepliedLast7: n("SELECT COUNT(*) c FROM messages WHERE direction='out' AND sent_by IN ('rule','ai') AND created_at >= ?", weekAgo),
    };
  },
};
