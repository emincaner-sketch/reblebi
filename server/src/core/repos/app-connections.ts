import { getDb, nowIso, parseJson, bindable } from "../db.js";
import { decrypt, encrypt, randomId } from "../crypto.js";
import type { AppConnection, AppConnectorId } from "../types.js";

type Row = Record<string, unknown>;

function safeDecrypt(v: string): string {
  try {
    return decrypt(v);
  } catch {
    return "";
  }
}

function rowToAppConnection(r: Row): AppConnection {
  const dec = safeDecrypt(r.credentials_enc as string);
  const credentials = parseJson<Record<string, any>>(dec, {});
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    appId: r.app_id as AppConnectorId,
    name: r.name as string,
    credentials,
    metadata: parseJson<Record<string, any>>(r.metadata, {}),
    status: r.status as "active" | "error" | "revoked",
    lastError: (r.last_error as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** Hassas kimlik bilgilerini gizleyen güvenli görünüm */
export function publicAppConnection(conn: AppConnection) {
  const { credentials, ...rest } = conn;
  // Parola, webhook URL veya token'ların sadece son 4 hanesini göster
  const maskedKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(credentials)) {
    if (typeof v === "string" && v.length > 6) {
      maskedKeys[k] = `***${v.slice(-4)}`;
    } else {
      maskedKeys[k] = "***";
    }
  }
  return {
    ...rest,
    credentialsMasked: maskedKeys,
  };
}

export const appConnectionsRepo = {
  create(
    orgId: string,
    input: {
      appId: AppConnectorId;
      name: string;
      credentials: Record<string, any>;
      metadata?: Record<string, any>;
    },
  ): AppConnection {
    const db = getDb();
    const id = randomId("app");
    const now = nowIso();
    const enc = encrypt(JSON.stringify(input.credentials));

    db.prepare(`
      INSERT INTO app_connections (id, org_id, app_id, name, credentials_enc, metadata, status, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)
    `).run(
      id,
      orgId,
      input.appId,
      input.name.trim(),
      enc,
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    );

    return this.getById(id, orgId)!;
  },

  list(orgId: string, appId?: AppConnectorId): AppConnection[] {
    const db = getDb();
    if (appId) {
      const rows = db.prepare("SELECT * FROM app_connections WHERE org_id = ? AND app_id = ? ORDER BY created_at DESC").all(orgId, appId) as Row[];
      return rows.map(rowToAppConnection);
    }
    const rows = db.prepare("SELECT * FROM app_connections WHERE org_id = ? ORDER BY created_at DESC").all(orgId) as Row[];
    return rows.map(rowToAppConnection);
  },

  getById(id: string, orgId?: string): AppConnection | null {
    const db = getDb();
    const row = orgId
      ? (db.prepare("SELECT * FROM app_connections WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined)
      : (db.prepare("SELECT * FROM app_connections WHERE id = ?").get(id) as Row | undefined);
    return row ? rowToAppConnection(row) : null;
  },

  update(
    id: string,
    orgId: string,
    patch: {
      name?: string;
      credentials?: Record<string, any>;
      metadata?: Record<string, any>;
      status?: "active" | "error" | "revoked";
      lastError?: string | null;
    },
  ): AppConnection | null {
    const existing = this.getById(id, orgId);
    if (!existing) return null;

    const db = getDb();
    const now = nowIso();
    const name = patch.name !== undefined ? patch.name.trim() : existing.name;
    const enc = patch.credentials !== undefined ? encrypt(JSON.stringify(patch.credentials)) : encrypt(JSON.stringify(existing.credentials));
    const metadata = patch.metadata !== undefined ? JSON.stringify(patch.metadata) : JSON.stringify(existing.metadata);
    const status = patch.status !== undefined ? patch.status : existing.status;
    const lastError = patch.lastError !== undefined ? patch.lastError : existing.lastError;

    db.prepare(`
      UPDATE app_connections
      SET name = ?, credentials_enc = ?, metadata = ?, status = ?, last_error = ?, updated_at = ?
      WHERE id = ? AND org_id = ?
    `).run(name, enc, metadata, status, lastError, now, id, orgId);

    return this.getById(id, orgId);
  },

  delete(id: string, orgId: string): boolean {
    const db = getDb();
    const res = db.prepare("DELETE FROM app_connections WHERE id = ? AND org_id = ?").run(id, orgId);
    return Number(res.changes) > 0;
  },
};
