import { getDb, nowIso, parseJson } from "../db.js";
import { decrypt, encrypt, randomId } from "../crypto.js";
import type { Channel, ChannelStatus, ProviderId } from "../types.js";

type Row = Record<string, unknown>;

function safeDecrypt(v: string): string {
  try {
    return decrypt(v);
  } catch {
    return "";
  }
}

function rowToChannel(r: Row): Channel {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    provider: r.provider as ProviderId,
    externalId: r.external_id as string,
    name: r.name as string,
    username: (r.username as string) ?? null,
    avatarUrl: (r.avatar_url as string) ?? null,
    accessToken: safeDecrypt(r.access_token as string),
    refreshToken: r.refresh_token ? safeDecrypt(r.refresh_token as string) : null,
    tokenExpiresAt: (r.token_expires_at as string) ?? null,
    scopes: (r.scopes as string) ?? null,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    status: r.status as ChannelStatus,
    lastError: (r.last_error as string) ?? null,
    customerId: (r.customer_id as string) ?? null,
    timeSlots: parseJson<number[]>(r.time_slots, []),
    preferences: parseJson<Record<string, unknown>>(r.preferences, {}),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** Panel/MCP'ye giden güvenli görünüm: token ve hassas metadata içermez */
export function publicChannel(c: Channel) {
  const { accessToken: _a, refreshToken: _r, metadata, ...rest } = c;
  const { userToken: _u, ...safeMeta } = metadata;
  return { ...rest, metadata: safeMeta, hasRefreshToken: Boolean(c.refreshToken) };
}
export type PublicChannel = ReturnType<typeof publicChannel>;

export interface UpsertChannelInput {
  orgId: string;
  provider: ProviderId;
  externalId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: string | null;
  scopes?: string | null;
  metadata?: Record<string, unknown>;
}

export const channelsRepo = {
  list(orgId: string): Channel[] {
    return (getDb().prepare("SELECT * FROM channels WHERE org_id = ? ORDER BY created_at ASC").all(orgId) as Row[]).map(rowToChannel);
  },
  /** Zamanlayıcı ve webhook'lar için: tüm org'lar */
  listAll(): Channel[] {
    return (getDb().prepare("SELECT * FROM channels ORDER BY created_at ASC").all() as Row[]).map(rowToChannel);
  },
  count(orgId: string): number {
    return Number((getDb().prepare("SELECT COUNT(*) c FROM channels WHERE org_id = ?").get(orgId) as Row).c ?? 0);
  },
  get(orgId: string, id: string): Channel | null {
    const r = getDb().prepare("SELECT * FROM channels WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToChannel(r) : null;
  },
  /** Org kontrolü olmadan (sadece sistem içi: zamanlayıcı, webhook) */
  getById(id: string): Channel | null {
    const r = getDb().prepare("SELECT * FROM channels WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToChannel(r) : null;
  },
  /** Gelen webhook'lar için: aynı platform hesabı birden çok org'a bağlı olabilir */
  findAllByExternal(provider: ProviderId, externalId: string): Channel[] {
    return (getDb().prepare("SELECT * FROM channels WHERE provider = ? AND external_id = ?").all(provider, externalId) as Row[]).map(rowToChannel);
  },
  findByExternal(orgId: string, provider: ProviderId, externalId: string): Channel | null {
    const r = getDb().prepare("SELECT * FROM channels WHERE org_id = ? AND provider = ? AND external_id = ?").get(orgId, provider, externalId) as Row | undefined;
    return r ? rowToChannel(r) : null;
  },
  /** Aynı platform hesabı aynı org'a tekrar bağlanırsa token'ları yeniler, yeni kanal açmaz */
  upsert(input: UpsertChannelInput): { channel: Channel; created: boolean } {
    const db = getDb();
    const existing = this.findByExternal(input.orgId, input.provider, input.externalId);
    const now = nowIso();
    if (existing) {
      db.prepare(
        `UPDATE channels SET name=?, username=?, avatar_url=?, access_token=?, refresh_token=?, token_expires_at=?,
         scopes=?, metadata=?, status='active', last_error=NULL, updated_at=? WHERE id=?`,
      ).run(
        input.name,
        input.username ?? existing.username,
        input.avatarUrl ?? existing.avatarUrl,
        encrypt(input.accessToken),
        input.refreshToken ? encrypt(input.refreshToken) : existing.refreshToken ? encrypt(existing.refreshToken) : null,
        input.tokenExpiresAt ?? null,
        input.scopes ?? existing.scopes,
        JSON.stringify({ ...existing.metadata, ...(input.metadata ?? {}) }),
        now,
        existing.id,
      );
      return { channel: this.getById(existing.id)!, created: false };
    }
    const id = randomId("ch");
    db.prepare(
      `INSERT INTO channels (id, org_id, provider, external_id, name, username, avatar_url, access_token, refresh_token,
       token_expires_at, scopes, metadata, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      id,
      input.orgId,
      input.provider,
      input.externalId,
      input.name,
      input.username ?? null,
      input.avatarUrl ?? null,
      encrypt(input.accessToken),
      input.refreshToken ? encrypt(input.refreshToken) : null,
      input.tokenExpiresAt ?? null,
      input.scopes ?? null,
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    );
    return { channel: this.getById(id)!, created: true };
  },
  updateTokens(id: string, accessToken: string, refreshToken: string | null | undefined, expiresAt: string | null): void {
    getDb()
      .prepare(
        "UPDATE channels SET access_token=?, refresh_token=COALESCE(?, refresh_token), token_expires_at=?, status='active', last_error=NULL, updated_at=? WHERE id=?",
      )
      .run(encrypt(accessToken), refreshToken ? encrypt(refreshToken) : null, expiresAt, nowIso(), id);
  },
  setStatus(id: string, status: ChannelStatus, error?: string | null): void {
    getDb().prepare("UPDATE channels SET status=?, last_error=?, updated_at=? WHERE id=?").run(status, error ?? null, nowIso(), id);
  },
  update(
    orgId: string,
    id: string,
    patch: { name?: string; customerId?: string | null; timeSlots?: number[]; preferences?: Record<string, unknown>; metadata?: Record<string, unknown> },
  ): Channel | null {
    const c = this.get(orgId, id);
    if (!c) return null;
    getDb()
      .prepare("UPDATE channels SET name=?, customer_id=?, time_slots=?, preferences=?, metadata=?, updated_at=? WHERE id=?")
      .run(
        patch.name ?? c.name,
        patch.customerId === undefined ? c.customerId : patch.customerId,
        JSON.stringify(patch.timeSlots ?? c.timeSlots),
        JSON.stringify({ ...c.preferences, ...(patch.preferences ?? {}) }),
        JSON.stringify({ ...c.metadata, ...(patch.metadata ?? {}) }),
        nowIso(),
        id,
      );
    return this.get(orgId, id);
  },
  remove(orgId: string, id: string): void {
    const db = getDb();
    if (!this.get(orgId, id)) return;
    db.prepare("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE channel_id = ?)").run(id);
    db.prepare("DELETE FROM conversations WHERE channel_id = ?").run(id);
    db.prepare("DELETE FROM analytics_snapshots WHERE channel_id = ?").run(id);
    db.prepare("DELETE FROM poll_cursors WHERE channel_id = ?").run(id);
    db.prepare("DELETE FROM channels WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};
