import { getDb, nowIso, parseJson } from "../db.js";
import type { Contact } from "../types.js";

type Row = Record<string, unknown>;

function rowToContact(r: Row): Contact {
  return {
    channelId: r.channel_id as string,
    participantId: r.participant_id as string,
    orgId: r.org_id as string,
    tags: parseJson<string[]>(r.tags, []),
    fields: parseJson<Record<string, string>>(r.fields, {}),
    optedOutAt: (r.opted_out_at as string) ?? null,
    optedOutReason: (r.opted_out_reason as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export const contactsRepo = {
  get(channelId: string, participantId: string): Contact | null {
    const r = getDb().prepare("SELECT * FROM contacts WHERE channel_id = ? AND participant_id = ?").get(channelId, participantId) as Row | undefined;
    return r ? rowToContact(r) : null;
  },
  /** Kayıt yoksa açar, verilen alanları günceller */
  upsert(orgId: string, channelId: string, participantId: string, patch: { tags?: string[]; fields?: Record<string, string> }): Contact {
    const cur = this.get(channelId, participantId);
    const now = nowIso();
    const tags = patch.tags ?? cur?.tags ?? [];
    const fields = patch.fields ?? cur?.fields ?? {};
    getDb()
      .prepare(
        `INSERT INTO contacts (channel_id, participant_id, org_id, tags, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, participant_id) DO UPDATE SET tags = excluded.tags, fields = excluded.fields, updated_at = excluded.updated_at`,
      )
      .run(channelId, participantId, orgId, JSON.stringify(tags), JSON.stringify(fields), now, now);
    return this.get(channelId, participantId)!;
  },
  /** Çıkış listesine ekler (at = tarih) ya da çıkarır (at = null) */
  setOptOut(orgId: string, channelId: string, participantId: string, at: string | null, reason: string | null = null): Contact {
    if (!this.get(channelId, participantId)) this.upsert(orgId, channelId, participantId, {});
    getDb()
      .prepare("UPDATE contacts SET opted_out_at = ?, opted_out_reason = ?, updated_at = ? WHERE channel_id = ? AND participant_id = ?")
      .run(at, at ? reason : null, nowIso(), channelId, participantId);
    return this.get(channelId, participantId)!;
  },
  isOptedOut(channelId: string, participantId: string): boolean {
    const r = getDb().prepare("SELECT opted_out_at FROM contacts WHERE channel_id = ? AND participant_id = ?").get(channelId, participantId) as Row | undefined;
    return Boolean(r?.opted_out_at);
  },
  /** Kişinin bu kanaldaki DM konuşmalarında son gelen mesajın zamanı (yorum ve değerlendirmeler sayılmaz; Meta'nın 24 saat penceresi buna göre) */
  lastUserMessageAt(channelId: string, participantId: string): string | null {
    const r = getDb()
      .prepare(
        `SELECT MAX(m.created_at) AS at FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.channel_id = ? AND c.participant_id = ? AND m.direction = 'in'
         AND COALESCE(json_extract(c.metadata, '$.kind'), 'dm') NOT IN ('comment', 'review')`,
      )
      .get(channelId, participantId) as Row | undefined;
    return (r?.at as string) ?? null;
  },
  listOptedOut(orgId: string, limit = 200): Contact[] {
    return (getDb().prepare("SELECT * FROM contacts WHERE org_id = ? AND opted_out_at IS NOT NULL ORDER BY opted_out_at DESC LIMIT ?").all(orgId, limit) as Row[]).map(
      rowToContact,
    );
  },
};
