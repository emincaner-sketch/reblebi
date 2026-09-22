import { getDb, nowIso, parseJson } from "../db.js";
import { decrypt, encrypt, randomId } from "../crypto.js";
import type { Channel, ChannelStatus, ProviderId } from "../types.js";

type Row = Record<string, unknown>;

function rowToChannel(r: Row): Channel {
  return {
    id: r.id as string,
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
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function safeDecrypt(v: string): string {
  try {
    return decrypt(v);
  } catch {
    return "";
  }
}

/** Panel/MCP'ye giden güvenli görünüm: token içermez */
export function publicChannel(c: Channel) {
  const { accessToken: _a, refreshToken: _r, ...rest } = c;
  return { ...rest, hasRefreshToken: Boolean(c.refreshToken) };
}
export type PublicChannel = ReturnType<typeof publicChannel>;

export interface UpsertChannelInput {
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
  list(): Channel[] {
    const rows = getDb().prepare("SELECT * FROM channels ORDER BY created_at ASC").all() as Row[];
    return rows.map(rowToChannel);
  },
  get(id: string): Channel | null {
    const r = getDb().prepare("SELECT * FROM channels WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToChannel(r) : null;
  },
  findByExternal(provider: ProviderId, externalId: string): Channel | null {
    const r = getDb()
      .prepare("SELECT * FROM channels WHERE provider = ? AND external_id = ?")
      .get(provider, externalId) as Row | undefined;
    return r ? rowToChannel(r) : null;
  },
  /** Aynı platform hesabı tekrar bağlanırsa token'ları yeniler, yeni kanal açmaz */
  upsert(input: UpsertChannelInput): Channel {
    const db = getDb();
    const existing = this.findByExternal(input.provider, input.externalId);
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
      return this.get(existing.id)!;
    }
    const id = randomId("ch");
    db.prepare(
      `INSERT INTO channels (id, provider, external_id, name, username, avatar_url, access_token, refresh_token,
       token_expires_at, scopes, metadata, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      id,
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
    return this.get(id)!;
  },
  updateTokens(id: string, accessToken: string, refreshToken: string | null | undefined, expiresAt: string | null): void {
    getDb()
      .prepare(
        "UPDATE channels SET access_token=?, refresh_token=COALESCE(?, refresh_token), token_expires_at=?, status='active', last_error=NULL, updated_at=? WHERE id=?",
      )
      .run(encrypt(accessToken), refreshToken ? encrypt(refreshToken) : null, expiresAt, nowIso(), id);
  },
  setStatus(id: string, status: ChannelStatus, error?: string | null): void {
    getDb()
      .prepare("UPDATE channels SET status=?, last_error=?, updated_at=? WHERE id=?")
      .run(status, error ?? null, nowIso(), id);
  },
  updateMetadata(id: string, patch: Record<string, unknown>): void {
    const c = this.get(id);
    if (!c) return;
    getDb()
      .prepare("UPDATE channels SET metadata=?, updated_at=? WHERE id=?")
      .run(JSON.stringify({ ...c.metadata, ...patch }), nowIso(), id);
  },
  rename(id: string, name: string): void {
    getDb().prepare("UPDATE channels SET name=?, updated_at=? WHERE id=?").run(name, nowIso(), id);
  },
  remove(id: string): void {
    const db = getDb();
    db.prepare("DELETE FROM conversations WHERE channel_id = ?").run(id);
    db.prepare("DELETE FROM analytics_snapshots WHERE channel_id = ?").run(id);
    db.prepare("DELETE FROM poll_cursors WHERE channel_id = ?").run(id);
    db.prepare("DELETE FROM channels WHERE id = ?").run(id);
  },
};
