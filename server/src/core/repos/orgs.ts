import { defined, getDb, nowIso, parseJson } from "../db.js";
import { hashPassword, randomId, randomToken, sha256, verifyPassword } from "../crypto.js";
import {
  DEFAULT_ORG_SETTINGS,
  localizedDefaults,
  type Locale,
  type Membership,
  type Organization,
  type OrgSettings,
  type Role,
  type User,
} from "../types.js";

type Row = Record<string, unknown>;

/* ---------------- Kullanıcılar ---------------- */

function rowToUser(r: Row): User {
  return {
    id: r.id as string,
    email: r.email as string,
    name: (r.name as string) ?? null,
    isSuperadmin: Number(r.is_superadmin ?? 0),
    emailVerifiedAt: (r.email_verified_at as string) ?? null,
    lastLoginAt: (r.last_login_at as string) ?? null,
    locale: ((r.locale as string) === "en" ? "en" : "tr") as Locale,
    disabled: Number(r.disabled ?? 0),
    createdAt: r.created_at as string,
  };
}

export const usersRepo = {
  count(): number {
    return Number((getDb().prepare("SELECT COUNT(*) c FROM users").get() as Row).c ?? 0);
  },
  create(input: { email: string; password: string; name?: string | null; locale?: Locale; superadmin?: boolean; verified?: boolean }): User {
    const id = randomId("usr");
    const now = nowIso();
    getDb()
      .prepare(
        "INSERT INTO users (id, email, password_hash, name, locale, is_superadmin, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.email.toLowerCase().trim(),
        hashPassword(input.password),
        input.name ?? null,
        input.locale ?? "tr",
        input.superadmin ? 1 : 0,
        input.verified ? now : null,
        now,
      );
    return this.get(id)!;
  },
  get(id: string): User | null {
    const r = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToUser(r) : null;
  },
  findByEmail(email: string): User | null {
    const r = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim()) as Row | undefined;
    return r ? rowToUser(r) : null;
  },
  verifyPassword(email: string, password: string): User | null {
    const r = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim()) as Row | undefined;
    if (!r) {
      // Zamanlama saldırısına karşı sahte doğrulama
      verifyPassword(password, "0000000000000000:" + "0".repeat(128));
      return null;
    }
    return verifyPassword(password, r.password_hash as string) ? rowToUser(r) : null;
  },
  checkPassword(userId: string, password: string): boolean {
    const r = getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as Row | undefined;
    return r ? verifyPassword(password, r.password_hash as string) : false;
  },
  setPassword(id: string, password: string): void {
    getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), id);
  },
  update(id: string, patch: { name?: string | null; locale?: Locale; disabled?: boolean; isSuperadmin?: boolean }): User | null {
    const cur = this.get(id);
    if (!cur) return null;
    getDb()
      .prepare("UPDATE users SET name = ?, locale = ?, disabled = ?, is_superadmin = ? WHERE id = ?")
      .run(
        patch.name === undefined ? cur.name : patch.name,
        patch.locale ?? cur.locale,
        patch.disabled === undefined ? cur.disabled : patch.disabled ? 1 : 0,
        patch.isSuperadmin === undefined ? cur.isSuperadmin : patch.isSuperadmin ? 1 : 0,
        id,
      );
    return this.get(id);
  },
  markVerified(id: string): void {
    getDb().prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?").run(nowIso(), id);
  },
  touchLogin(id: string): void {
    getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), id);
  },
  listAll(opts: { q?: string; limit?: number; offset?: number } = {}): User[] {
    const q = opts.q ? `%${opts.q.toLowerCase()}%` : null;
    const rows = (
      q
        ? getDb().prepare("SELECT * FROM users WHERE lower(email) LIKE ? OR lower(COALESCE(name,'')) LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(q, q, opts.limit ?? 100, opts.offset ?? 0)
        : getDb().prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?").all(opts.limit ?? 100, opts.offset ?? 0)
    ) as Row[];
    return rows.map(rowToUser);
  },
  remove(id: string): void {
    getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
  },
};

/* ---------------- Tek kullanımlık kullanıcı tokenları (doğrulama, şifre sıfırlama) ---------------- */

export const userTokensRepo = {
  create(userId: string, kind: "verify" | "reset", ttlMinutes: number): string {
    const token = randomToken(32);
    getDb()
      .prepare("INSERT INTO user_tokens (token_hash, user_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(sha256(token), userId, kind, new Date(Date.now() + ttlMinutes * 60_000).toISOString(), nowIso());
    return token;
  },
  consume(token: string, kind: "verify" | "reset"): string | null {
    const r = getDb().prepare("SELECT * FROM user_tokens WHERE token_hash = ? AND kind = ?").get(sha256(token), kind) as Row | undefined;
    if (!r || r.used_at || new Date(r.expires_at as string).getTime() < Date.now()) return null;
    getDb().prepare("UPDATE user_tokens SET used_at = ? WHERE token_hash = ?").run(nowIso(), sha256(token));
    return r.user_id as string;
  },
};

/* ---------------- Oturumlar ---------------- */

export const sessionsRepo = {
  create(userId: string, orgId: string | null, days = 30): string {
    const id = randomToken(32);
    getDb()
      .prepare("INSERT INTO sessions (id, user_id, org_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(sha256(id), userId, orgId, new Date(Date.now() + days * 86400_000).toISOString(), nowIso());
    // Süresi dolmuş oturumları temizle
    getDb().prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso());
    return id;
  },
  resolve(id: string): { userId: string; orgId: string | null } | null {
    const r = getDb().prepare("SELECT user_id, org_id, expires_at FROM sessions WHERE id = ?").get(sha256(id)) as Row | undefined;
    if (!r) return null;
    if (new Date(r.expires_at as string).getTime() < Date.now()) {
      this.remove(id);
      return null;
    }
    return { userId: r.user_id as string, orgId: (r.org_id as string) ?? null };
  },
  setOrg(id: string, orgId: string): void {
    getDb().prepare("UPDATE sessions SET org_id = ? WHERE id = ?").run(orgId, sha256(id));
  },
  remove(id: string): void {
    getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sha256(id));
  },
  removeAllForUser(userId: string, exceptId?: string): void {
    if (exceptId) getDb().prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, sha256(exceptId));
    else getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  },
};

/* ---------------- Organizasyonlar ---------------- */

function rowToOrg(r: Row): Organization {
  return {
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    plan: r.plan as string,
    planExpiresAt: (r.plan_expires_at as string) ?? null,
    billingRef: (r.billing_ref as string) ?? null,
    timezone: r.timezone as string,
    locale: ((r.locale as string) === "en" ? "en" : "tr") as Locale,
    disabled: Number(r.disabled ?? 0),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function slugify(name: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u" };
  const base = name
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "calisma-alani";
}

export const orgsRepo = {
  create(input: { name: string; plan: string; planExpiresAt?: string | null; timezone?: string; locale?: Locale; ownerId: string }): Organization {
    const db = getDb();
    const id = randomId("org");
    let slug = slugify(input.name);
    if (db.prepare("SELECT 1 FROM organizations WHERE slug = ?").get(slug)) slug = `${slug}-${id.slice(-5).toLowerCase()}`;
    const now = nowIso();
    db.prepare(
      "INSERT INTO organizations (id, name, slug, plan, plan_expires_at, timezone, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, input.name, slug, input.plan, input.planExpiresAt ?? null, input.timezone ?? "Europe/Istanbul", input.locale ?? "tr", now, now);
    db.prepare("INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(id, input.ownerId, now);
    orgSettingsRepo.set(id, localizedDefaults(input.locale ?? "tr"));
    return this.get(id)!;
  },
  get(id: string): Organization | null {
    const r = getDb().prepare("SELECT * FROM organizations WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToOrg(r) : null;
  },
  update(id: string, patch: Partial<Pick<Organization, "name" | "timezone" | "locale" | "plan" | "planExpiresAt" | "billingRef" | "disabled">>): Organization | null {
    const cur = this.get(id);
    if (!cur) return null;
    const m = { ...cur, ...defined(patch) };
    getDb()
      .prepare("UPDATE organizations SET name=?, timezone=?, locale=?, plan=?, plan_expires_at=?, billing_ref=?, disabled=?, updated_at=? WHERE id=?")
      .run(m.name, m.timezone, m.locale, m.plan, m.planExpiresAt ?? null, m.billingRef ?? null, m.disabled ? 1 : 0, nowIso(), id);
    return this.get(id);
  },
  listForUser(userId: string): Array<Organization & { role: Role }> {
    const rows = getDb()
      .prepare("SELECT o.*, m.role FROM organizations o JOIN memberships m ON m.org_id = o.id WHERE m.user_id = ? ORDER BY o.created_at ASC")
      .all(userId) as Row[];
    return rows.map((r) => ({ ...rowToOrg(r), role: r.role as Role }));
  },
  listAll(opts: { q?: string; limit?: number; offset?: number } = {}): Array<Organization & { members: number; channels: number; posts: number }> {
    const q = opts.q ? `%${opts.q.toLowerCase()}%` : "%";
    const rows = getDb()
      .prepare(
        `SELECT o.*,
          (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS members,
          (SELECT COUNT(*) FROM channels c WHERE c.org_id = o.id) AS channels,
          (SELECT COUNT(*) FROM posts p WHERE p.org_id = o.id) AS posts
         FROM organizations o WHERE lower(o.name) LIKE ? OR lower(o.slug) LIKE ? ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(q, q, opts.limit ?? 100, opts.offset ?? 0) as Row[];
    return rows.map((r) => ({ ...rowToOrg(r), members: Number(r.members), channels: Number(r.channels), posts: Number(r.posts) }));
  },
  count(): number {
    return Number((getDb().prepare("SELECT COUNT(*) c FROM organizations").get() as Row).c ?? 0);
  },
  remove(id: string): void {
    const db = getDb();
    // Org'a bağlı tüm veri (foreign key olmayanlar dahil) silinir
    const channelIds = (db.prepare("SELECT id FROM channels WHERE org_id = ?").all(id) as Row[]).map((r) => r.id as string);
    for (const cid of channelIds) {
      db.prepare("DELETE FROM analytics_snapshots WHERE channel_id = ?").run(cid);
      db.prepare("DELETE FROM poll_cursors WHERE channel_id = ?").run(cid);
    }
    for (const table of ["channels", "posts", "media", "conversations", "auto_reply_rules", "comment_rules", "private_replies", "contacts", "api_keys", "activity_log", "comment_jobs", "usage_counters", "oauth_tokens", "oauth_codes"]) {
      db.prepare(`DELETE FROM ${table} WHERE org_id = ?`).run(id);
    }
    db.prepare("DELETE FROM organizations WHERE id = ?").run(id);
  },
};

/* ---------------- Üyelikler ---------------- */

export const membershipsRepo = {
  get(orgId: string, userId: string): Membership | null {
    const r = getDb().prepare("SELECT * FROM memberships WHERE org_id = ? AND user_id = ?").get(orgId, userId) as Row | undefined;
    return r ? { orgId: r.org_id as string, userId: r.user_id as string, role: r.role as Role, createdAt: r.created_at as string } : null;
  },
  list(orgId: string): Array<Membership & { email: string; name: string | null; lastLoginAt: string | null }> {
    const rows = getDb()
      .prepare("SELECT m.*, u.email, u.name, u.last_login_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.created_at ASC")
      .all(orgId) as Row[];
    return rows.map((r) => ({
      orgId: r.org_id as string,
      userId: r.user_id as string,
      role: r.role as Role,
      createdAt: r.created_at as string,
      email: r.email as string,
      name: (r.name as string) ?? null,
      lastLoginAt: (r.last_login_at as string) ?? null,
    }));
  },
  count(orgId: string): number {
    return Number((getDb().prepare("SELECT COUNT(*) c FROM memberships WHERE org_id = ?").get(orgId) as Row).c ?? 0);
  },
  countOwners(orgId: string): number {
    return Number((getDb().prepare("SELECT COUNT(*) c FROM memberships WHERE org_id = ? AND role = 'owner'").get(orgId) as Row).c ?? 0);
  },
  add(orgId: string, userId: string, role: Role): void {
    getDb()
      .prepare("INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role")
      .run(orgId, userId, role, nowIso());
  },
  setRole(orgId: string, userId: string, role: Role): void {
    getDb().prepare("UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?").run(role, orgId, userId);
  },
  remove(orgId: string, userId: string): void {
    getDb().prepare("DELETE FROM memberships WHERE org_id = ? AND user_id = ?").run(orgId, userId);
  },
};

/* ---------------- Davetler ---------------- */

export interface Invitation {
  id: string;
  orgId: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

function rowToInvite(r: Row): Invitation {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    email: r.email as string,
    role: r.role as Role,
    invitedBy: (r.invited_by as string) ?? null,
    expiresAt: r.expires_at as string,
    acceptedAt: (r.accepted_at as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export const invitationsRepo = {
  create(orgId: string, email: string, role: Role, invitedBy: string | null): { token: string; invitation: Invitation } {
    const id = randomId("inv");
    const token = randomToken(32);
    // Aynı e-postaya bekleyen eski davetleri kaldır
    getDb().prepare("DELETE FROM invitations WHERE org_id = ? AND email = ? AND accepted_at IS NULL").run(orgId, email.toLowerCase().trim());
    getDb()
      .prepare("INSERT INTO invitations (id, org_id, email, role, token_hash, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, orgId, email.toLowerCase().trim(), role, sha256(token), invitedBy, new Date(Date.now() + 7 * 86400_000).toISOString(), nowIso());
    return { token, invitation: rowToInvite(getDb().prepare("SELECT * FROM invitations WHERE id = ?").get(id) as Row) };
  },
  findByToken(token: string): Invitation | null {
    const r = getDb().prepare("SELECT * FROM invitations WHERE token_hash = ?").get(sha256(token)) as Row | undefined;
    if (!r) return null;
    const inv = rowToInvite(r);
    if (inv.acceptedAt || new Date(inv.expiresAt).getTime() < Date.now()) return null;
    return inv;
  },
  markAccepted(id: string): void {
    getDb().prepare("UPDATE invitations SET accepted_at = ? WHERE id = ?").run(nowIso(), id);
  },
  listPending(orgId: string): Invitation[] {
    return (getDb().prepare("SELECT * FROM invitations WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC").all(orgId, nowIso()) as Row[]).map(rowToInvite);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM invitations WHERE org_id = ? AND id = ?").run(orgId, id);
  },
};

/* ---------------- Org ayarları ---------------- */

export const orgSettingsRepo = {
  get(orgId: string): OrgSettings {
    const r = getDb().prepare("SELECT value FROM org_settings WHERE org_id = ?").get(orgId) as Row | undefined;
    return { ...DEFAULT_ORG_SETTINGS, ...parseJson<Partial<OrgSettings>>(r?.value, {}) };
  },
  set(orgId: string, patch: Partial<OrgSettings>): OrgSettings {
    const merged = { ...this.get(orgId), ...patch };
    getDb()
      .prepare("INSERT INTO org_settings (org_id, value) VALUES (?, ?) ON CONFLICT(org_id) DO UPDATE SET value = excluded.value")
      .run(orgId, JSON.stringify(merged));
    return merged;
  },
};
