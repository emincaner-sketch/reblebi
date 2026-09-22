import { getDb, nowIso, parseJson } from "../db.js";
import { hashPassword, randomId, randomToken, sha256, verifyPassword } from "../crypto.js";
import {
  DEFAULT_SETTINGS,
  type ActivityEntry,
  type AnalyticsSnapshot,
  type ApiKey,
  type AutoReplyRule,
  type MediaFile,
  type ProviderId,
  type RuleMatch,
  type RuleReplyMode,
  type Settings,
} from "../types.js";

type Row = Record<string, unknown>;

/* ---------------- Kullanıcı / oturum / API anahtarı ---------------- */

export const usersRepo = {
  count(): number {
    return Number((getDb().prepare("SELECT COUNT(*) c FROM users").get() as Row).c ?? 0);
  },
  create(email: string, password: string): { id: string; email: string } {
    const id = randomId("usr");
    getDb()
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, email.toLowerCase().trim(), hashPassword(password), nowIso());
    return { id, email: email.toLowerCase().trim() };
  },
  verify(email: string, password: string): { id: string; email: string } | null {
    const r = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim()) as Row | undefined;
    if (!r) return null;
    return verifyPassword(password, r.password_hash as string) ? { id: r.id as string, email: r.email as string } : null;
  },
  get(id: string): { id: string; email: string } | null {
    const r = getDb().prepare("SELECT id, email FROM users WHERE id = ?").get(id) as Row | undefined;
    return r ? { id: r.id as string, email: r.email as string } : null;
  },
  changePassword(id: string, password: string): void {
    getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), id);
  },
};

export const sessionsRepo = {
  create(userId: string, days = 30): string {
    const id = randomToken(32);
    const expires = new Date(Date.now() + days * 86400_000).toISOString();
    getDb()
      .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(id, userId, expires, nowIso());
    return id;
  },
  resolve(id: string): string | null {
    const r = getDb().prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    if (new Date(r.expires_at as string).getTime() < Date.now()) {
      this.remove(id);
      return null;
    }
    return r.user_id as string;
  },
  remove(id: string): void {
    getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
  },
};

export const apiKeysRepo = {
  list(): ApiKey[] {
    return (getDb().prepare("SELECT id, name, prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC").all() as Row[]).map(
      (r) => ({
        id: r.id as string,
        name: r.name as string,
        prefix: r.prefix as string,
        createdAt: r.created_at as string,
        lastUsedAt: (r.last_used_at as string) ?? null,
      }),
    );
  },
  /** Anahtar sadece oluşturulurken bir kez gösterilir */
  create(name: string): { key: string; entry: ApiKey } {
    const secret = "sp_" + randomToken(24);
    const id = randomId("key");
    const prefix = secret.slice(0, 10);
    const now = nowIso();
    getDb()
      .prepare("INSERT INTO api_keys (id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, prefix, sha256(secret), now);
    return { key: secret, entry: { id, name, prefix, createdAt: now, lastUsedAt: null } };
  },
  verify(key: string): ApiKey | null {
    const r = getDb().prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(sha256(key)) as Row | undefined;
    if (!r) return null;
    getDb().prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(nowIso(), r.id as string);
    return { id: r.id as string, name: r.name as string, prefix: r.prefix as string, createdAt: r.created_at as string, lastUsedAt: nowIso() };
  },
  remove(id: string): void {
    getDb().prepare("DELETE FROM api_keys WHERE id = ?").run(id);
  },
};

export const oauthStatesRepo = {
  create(provider: ProviderId, codeVerifier?: string): string {
    const state = randomToken(24);
    getDb()
      .prepare("INSERT INTO oauth_states (state, provider, code_verifier, created_at) VALUES (?, ?, ?, ?)")
      .run(state, provider, codeVerifier ?? null, nowIso());
    // 1 saatten eski state kayıtlarını temizle
    getDb().prepare("DELETE FROM oauth_states WHERE created_at < ?").run(new Date(Date.now() - 3600_000).toISOString());
    return state;
  },
  setVerifier(state: string, codeVerifier: string): void {
    getDb().prepare("UPDATE oauth_states SET code_verifier = ? WHERE state = ?").run(codeVerifier, state);
  },
  consume(state: string): { provider: ProviderId; codeVerifier: string | null } | null {
    const r = getDb().prepare("SELECT * FROM oauth_states WHERE state = ?").get(state) as Row | undefined;
    if (!r) return null;
    getDb().prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    return { provider: r.provider as ProviderId, codeVerifier: (r.code_verifier as string) ?? null };
  },
};

/* ---------------- Medya ---------------- */

export const mediaRepo = {
  list(limit = 200): MediaFile[] {
    return (getDb().prepare("SELECT * FROM media ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(rowToMedia);
  },
  get(id: string): MediaFile | null {
    const r = getDb().prepare("SELECT * FROM media WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToMedia(r) : null;
  },
  getMany(ids: string[]): MediaFile[] {
    return ids.map((id) => this.get(id)).filter((m): m is MediaFile => Boolean(m));
  },
  create(input: Omit<MediaFile, "createdAt">): MediaFile {
    getDb()
      .prepare("INSERT INTO media (id, filename, original_name, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(input.id, input.filename, input.originalName, input.mime, input.size, input.kind, nowIso());
    return this.get(input.id)!;
  },
  remove(id: string): void {
    getDb().prepare("DELETE FROM media WHERE id = ?").run(id);
  },
};

function rowToMedia(r: Row): MediaFile {
  return {
    id: r.id as string,
    filename: r.filename as string,
    originalName: r.original_name as string,
    mime: r.mime as string,
    size: Number(r.size),
    kind: r.kind as MediaFile["kind"],
    createdAt: r.created_at as string,
  };
}

/* ---------------- Oto-yanıt kuralları ---------------- */

function rowToRule(r: Row): AutoReplyRule {
  return {
    id: r.id as string,
    name: r.name as string,
    enabled: Number(r.enabled ?? 1),
    channelId: (r.channel_id as string) ?? null,
    provider: (r.provider as ProviderId) ?? null,
    matchType: r.match_type as RuleMatch,
    pattern: (r.pattern as string) ?? null,
    replyMode: r.reply_mode as RuleReplyMode,
    replyText: (r.reply_text as string) ?? null,
    aiInstructions: (r.ai_instructions as string) ?? null,
    priority: Number(r.priority ?? 100),
    cooldownMinutes: Number(r.cooldown_minutes ?? 60),
    onlyBusinessHours: Number(r.only_business_hours ?? 0),
    handoffToHuman: Number(r.handoff_to_human ?? 0),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export type RuleInput = Omit<AutoReplyRule, "id" | "createdAt" | "updatedAt">;

export const rulesRepo = {
  list(): AutoReplyRule[] {
    return (getDb().prepare("SELECT * FROM auto_reply_rules ORDER BY priority ASC, created_at ASC").all() as Row[]).map(rowToRule);
  },
  get(id: string): AutoReplyRule | null {
    const r = getDb().prepare("SELECT * FROM auto_reply_rules WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToRule(r) : null;
  },
  create(input: RuleInput): AutoReplyRule {
    const id = randomId("rule");
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO auto_reply_rules (id, name, enabled, channel_id, provider, match_type, pattern, reply_mode, reply_text, ai_instructions,
         priority, cooldown_minutes, only_business_hours, handoff_to_human, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.enabled ? 1 : 0,
        input.channelId ?? null,
        input.provider ?? null,
        input.matchType,
        input.pattern ?? null,
        input.replyMode,
        input.replyText ?? null,
        input.aiInstructions ?? null,
        input.priority,
        input.cooldownMinutes,
        input.onlyBusinessHours ? 1 : 0,
        input.handoffToHuman ? 1 : 0,
        now,
        now,
      );
    return this.get(id)!;
  },
  update(id: string, input: Partial<RuleInput>): AutoReplyRule | null {
    const cur = this.get(id);
    if (!cur) return null;
    const merged = { ...cur, ...input };
    getDb()
      .prepare(
        `UPDATE auto_reply_rules SET name=?, enabled=?, channel_id=?, provider=?, match_type=?, pattern=?, reply_mode=?, reply_text=?,
         ai_instructions=?, priority=?, cooldown_minutes=?, only_business_hours=?, handoff_to_human=?, updated_at=? WHERE id=?`,
      )
      .run(
        merged.name,
        merged.enabled ? 1 : 0,
        merged.channelId ?? null,
        merged.provider ?? null,
        merged.matchType,
        merged.pattern ?? null,
        merged.replyMode,
        merged.replyText ?? null,
        merged.aiInstructions ?? null,
        merged.priority,
        merged.cooldownMinutes,
        merged.onlyBusinessHours ? 1 : 0,
        merged.handoffToHuman ? 1 : 0,
        nowIso(),
        id,
      );
    return this.get(id);
  },
  remove(id: string): void {
    getDb().prepare("DELETE FROM auto_reply_rules WHERE id = ?").run(id);
  },
};

/* ---------------- Ayarlar ---------------- */

export const settingsRepo = {
  get(): Settings {
    const r = getDb().prepare("SELECT value FROM settings WHERE key = 'app'").get() as Row | undefined;
    return { ...DEFAULT_SETTINGS, ...parseJson<Partial<Settings>>(r?.value, {}) };
  },
  set(patch: Partial<Settings>): Settings {
    const merged = { ...this.get(), ...patch };
    getDb()
      .prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(merged));
    return merged;
  },
  getValue(key: string): string | null {
    const r = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return r ? (r.value as string) : null;
  },
  setValue(key: string, value: string): void {
    getDb()
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(key, value);
  },
};

/* ---------------- Aktivite / webhook / analitik / poll cursor ---------------- */

export const activityRepo = {
  add(level: ActivityEntry["level"], source: string, message: string, data?: Record<string, unknown>): void {
    getDb()
      .prepare("INSERT INTO activity_log (id, level, source, message, data, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(randomId("act"), level, source, message, data ? JSON.stringify(data) : null, nowIso());
    // Tabloyu makul boyutta tut
    getDb().prepare(
      "DELETE FROM activity_log WHERE id IN (SELECT id FROM activity_log ORDER BY created_at DESC LIMIT -1 OFFSET 5000)",
    ).run();
  },
  list(limit = 50): ActivityEntry[] {
    return (getDb().prepare("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map((r) => ({
      id: r.id as string,
      level: r.level as ActivityEntry["level"],
      source: r.source as string,
      message: r.message as string,
      data: parseJson<Record<string, unknown> | null>(r.data, null),
      createdAt: r.created_at as string,
    }));
  },
};

export const webhookEventsRepo = {
  add(provider: string, payload: unknown): string {
    const id = randomId("wh");
    getDb()
      .prepare("INSERT INTO webhook_events (id, provider, payload, received_at) VALUES (?, ?, ?, ?)")
      .run(id, provider, JSON.stringify(payload), nowIso());
    getDb().prepare(
      "DELETE FROM webhook_events WHERE id IN (SELECT id FROM webhook_events ORDER BY received_at DESC LIMIT -1 OFFSET 1000)",
    ).run();
    return id;
  },
  markProcessed(id: string, error?: string | null): void {
    getDb().prepare("UPDATE webhook_events SET processed = 1, error = ? WHERE id = ?").run(error ?? null, id);
  },
  recent(limit = 30): Array<{ id: string; provider: string; processed: number; error: string | null; receivedAt: string }> {
    return (getDb().prepare("SELECT id, provider, processed, error, received_at FROM webhook_events ORDER BY received_at DESC LIMIT ?").all(limit) as Row[]).map(
      (r) => ({
        id: r.id as string,
        provider: r.provider as string,
        processed: Number(r.processed),
        error: (r.error as string) ?? null,
        receivedAt: r.received_at as string,
      }),
    );
  },
};

export const analyticsRepo = {
  upsert(channelId: string, date: string, metrics: Record<string, number>): void {
    getDb()
      .prepare(
        "INSERT INTO analytics_snapshots (id, channel_id, date, metrics) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, date) DO UPDATE SET metrics=excluded.metrics",
      )
      .run(randomId("snap"), channelId, date, JSON.stringify(metrics));
  },
  series(channelId: string, days = 30): AnalyticsSnapshot[] {
    const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return (
      getDb()
        .prepare("SELECT * FROM analytics_snapshots WHERE channel_id = ? AND date >= ? ORDER BY date ASC")
        .all(channelId, from) as Row[]
    ).map((r) => ({
      id: r.id as string,
      channelId: r.channel_id as string,
      date: r.date as string,
      metrics: parseJson<Record<string, number>>(r.metrics, {}),
    }));
  },
  latest(channelId: string): AnalyticsSnapshot | null {
    const r = getDb()
      .prepare("SELECT * FROM analytics_snapshots WHERE channel_id = ? ORDER BY date DESC LIMIT 1")
      .get(channelId) as Row | undefined;
    return r
      ? { id: r.id as string, channelId: r.channel_id as string, date: r.date as string, metrics: parseJson<Record<string, number>>(r.metrics, {}) }
      : null;
  },
};

export const pollCursorsRepo = {
  get(channelId: string): string | null {
    const r = getDb().prepare("SELECT cursor FROM poll_cursors WHERE channel_id = ?").get(channelId) as Row | undefined;
    return r ? ((r.cursor as string) ?? null) : null;
  },
  set(channelId: string, cursor: string | null): void {
    getDb()
      .prepare("INSERT INTO poll_cursors (channel_id, cursor, updated_at) VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at")
      .run(channelId, cursor, nowIso());
  },
};
