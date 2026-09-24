import { getDb, nowIso, parseJson } from "../db.js";
import { randomId, randomToken, sha256 } from "../crypto.js";

type Row = Record<string, unknown>;

/**
 * MCP istemcileri (claude.ai, Claude Desktop, Gemini CLI, ChatGPT, Grok...) için OAuth 2.1 yetkilendirme sunucusu deposu.
 * Token'lar sadece SHA-256 özetiyle saklanır.
 */

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  clientUri: string | null;
  logoUri: string | null;
  hasSecret: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

const rowToClient = (r: Row): OAuthClient => ({
  id: r.id as string,
  name: r.name as string,
  redirectUris: parseJson<string[]>(r.redirect_uris, []),
  clientUri: (r.client_uri as string) ?? null,
  logoUri: (r.logo_uri as string) ?? null,
  hasSecret: Boolean(r.secret_hash),
  createdAt: r.created_at as string,
  lastUsedAt: (r.last_used_at as string) ?? null,
});

export const oauthClientsRepo = {
  /** RFC 7591 dinamik istemci kaydı */
  register(input: { name: string; redirectUris: string[]; clientUri?: string | null; logoUri?: string | null; confidential: boolean }): { client: OAuthClient; secret: string | null } {
    const id = "mcp_" + randomToken(16);
    const secret = input.confidential ? "mcps_" + randomToken(32) : null;
    getDb()
      .prepare("INSERT INTO oauth_clients (id, secret_hash, name, redirect_uris, client_uri, logo_uri, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, secret ? sha256(secret) : null, input.name.slice(0, 120), JSON.stringify(input.redirectUris), input.clientUri ?? null, input.logoUri ?? null, nowIso());
    return { client: this.get(id)!, secret };
  },
  get(id: string): OAuthClient | null {
    const r = getDb().prepare("SELECT * FROM oauth_clients WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToClient(r) : null;
  },
  verifySecret(id: string, secret: string | null | undefined): boolean {
    const r = getDb().prepare("SELECT secret_hash FROM oauth_clients WHERE id = ?").get(id) as Row | undefined;
    if (!r) return false;
    if (!r.secret_hash) return true; // public istemci (PKCE ile korunur)
    return Boolean(secret) && sha256(secret!) === r.secret_hash;
  },
  touch(id: string): void {
    getDb().prepare("UPDATE oauth_clients SET last_used_at = ? WHERE id = ?").run(nowIso(), id);
  },
};

export interface AuthCode {
  clientId: string;
  userId: string;
  orgId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string | null;
  resource: string | null;
}

export const oauthCodesRepo = {
  create(input: AuthCode): string {
    const code = randomToken(32);
    getDb()
      .prepare(
        "INSERT INTO oauth_codes (code_hash, client_id, user_id, org_id, redirect_uri, code_challenge, scope, resource, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(sha256(code), input.clientId, input.userId, input.orgId, input.redirectUri, input.codeChallenge, input.scope, input.resource, new Date(Date.now() + 10 * 60_000).toISOString(), nowIso());
    getDb().prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(nowIso());
    return code;
  },
  /** Tek kullanımlık: okunduğu anda silinir */
  consume(code: string): (AuthCode & { expiresAt: string }) | null {
    const h = sha256(code);
    const r = getDb().prepare("SELECT * FROM oauth_codes WHERE code_hash = ?").get(h) as Row | undefined;
    if (!r) return null;
    getDb().prepare("DELETE FROM oauth_codes WHERE code_hash = ?").run(h);
    if (new Date(r.expires_at as string).getTime() < Date.now()) return null;
    return {
      clientId: r.client_id as string,
      userId: r.user_id as string,
      orgId: r.org_id as string,
      redirectUri: r.redirect_uri as string,
      codeChallenge: r.code_challenge as string,
      scope: (r.scope as string) ?? null,
      resource: (r.resource as string) ?? null,
      expiresAt: r.expires_at as string,
    };
  },
};

export interface AccessTokenInfo {
  id: string;
  clientId: string;
  clientName: string | null;
  userId: string;
  orgId: string;
  scope: string | null;
  resource: string | null;
  expiresAt: string;
}

const ACCESS_TTL_S = 60 * 60; // 1 saat
const REFRESH_TTL_S = 60 * 86400; // 60 gün

export const oauthTokensRepo = {
  issue(input: { clientId: string; userId: string; orgId: string; scope: string | null; resource: string | null }): {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  } {
    const accessToken = "spat_" + randomToken(32);
    const refreshToken = "sprt_" + randomToken(32);
    getDb()
      .prepare(
        `INSERT INTO oauth_tokens (id, access_hash, refresh_hash, client_id, user_id, org_id, scope, resource, expires_at, refresh_expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomId("tok"),
        sha256(accessToken),
        sha256(refreshToken),
        input.clientId,
        input.userId,
        input.orgId,
        input.scope,
        input.resource,
        new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
        new Date(Date.now() + REFRESH_TTL_S * 1000).toISOString(),
        nowIso(),
      );
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_S };
  },
  verifyAccess(token: string): AccessTokenInfo | null {
    const r = getDb()
      .prepare("SELECT t.*, c.name AS client_name FROM oauth_tokens t LEFT JOIN oauth_clients c ON c.id = t.client_id WHERE t.access_hash = ?")
      .get(sha256(token)) as Row | undefined;
    if (!r || r.revoked_at || new Date(r.expires_at as string).getTime() < Date.now()) return null;
    getDb().prepare("UPDATE oauth_tokens SET last_used_at = ? WHERE id = ?").run(nowIso(), r.id as string);
    return {
      id: r.id as string,
      clientId: r.client_id as string,
      clientName: (r.client_name as string) ?? null,
      userId: r.user_id as string,
      orgId: r.org_id as string,
      scope: (r.scope as string) ?? null,
      resource: (r.resource as string) ?? null,
      expiresAt: r.expires_at as string,
    };
  },
  /** Refresh token rotasyonu: eski satır iptal edilir, yenisi verilir */
  rotate(refreshToken: string, clientId: string): { accessToken: string; refreshToken: string; expiresIn: number; scope: string | null } | null {
    const r = getDb().prepare("SELECT * FROM oauth_tokens WHERE refresh_hash = ?").get(sha256(refreshToken)) as Row | undefined;
    if (!r || r.client_id !== clientId) return null;
    if (r.revoked_at) {
      // Yeniden kullanım tespiti: bu kullanıcı+istemci için tüm token'ları iptal et
      getDb().prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE client_id = ? AND user_id = ? AND revoked_at IS NULL").run(nowIso(), r.client_id as string, r.user_id as string);
      return null;
    }
    if (r.refresh_expires_at && new Date(r.refresh_expires_at as string).getTime() < Date.now()) return null;
    getDb().prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE id = ?").run(nowIso(), r.id as string);
    const issued = this.issue({
      clientId,
      userId: r.user_id as string,
      orgId: r.org_id as string,
      scope: (r.scope as string) ?? null,
      resource: (r.resource as string) ?? null,
    });
    return { ...issued, scope: (r.scope as string) ?? null };
  },
  revoke(token: string): void {
    const h = sha256(token);
    getDb().prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE (access_hash = ? OR refresh_hash = ?) AND revoked_at IS NULL").run(nowIso(), h, h);
  },
  /** Panelde "Bağlı AI uygulamaları" listesi: istemci başına tek satır */
  listConnections(orgId: string): Array<{ clientId: string; clientName: string; userId: string; email: string | null; createdAt: string; lastUsedAt: string | null }> {
    return (
      getDb()
        .prepare(
          `SELECT t.client_id, c.name AS client_name, t.user_id, u.email, MIN(t.created_at) AS created_at, MAX(t.last_used_at) AS last_used_at
           FROM oauth_tokens t LEFT JOIN oauth_clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.user_id
           WHERE t.org_id = ? AND t.revoked_at IS NULL AND (t.refresh_expires_at IS NULL OR t.refresh_expires_at > ?)
           GROUP BY t.client_id, t.user_id ORDER BY last_used_at DESC`,
        )
        .all(orgId, nowIso()) as Row[]
    ).map((r) => ({
      clientId: r.client_id as string,
      clientName: (r.client_name as string) ?? (r.client_id as string),
      userId: r.user_id as string,
      email: (r.email as string) ?? null,
      createdAt: r.created_at as string,
      lastUsedAt: (r.last_used_at as string) ?? null,
    }));
  },
  revokeConnection(orgId: string, clientId: string, userId?: string): void {
    if (userId) getDb().prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE org_id = ? AND client_id = ? AND user_id = ? AND revoked_at IS NULL").run(nowIso(), orgId, clientId, userId);
    else getDb().prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE org_id = ? AND client_id = ? AND revoked_at IS NULL").run(nowIso(), orgId, clientId);
  },
  prune(): void {
    getDb().prepare("DELETE FROM oauth_tokens WHERE (refresh_expires_at IS NOT NULL AND refresh_expires_at < ?) OR (revoked_at IS NOT NULL AND revoked_at < ?)").run(
      nowIso(),
      new Date(Date.now() - 7 * 86400_000).toISOString(),
    );
  },
};
