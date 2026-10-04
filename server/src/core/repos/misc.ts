import { defined, getDb, nowIso, parseJson } from "../db.js";
import { randomId, randomToken, sha256 } from "../crypto.js";
import type { ActivityEntry, AnalyticsSnapshot, ApiKey, AutoReplyRule, MediaFile, ProviderId, RuleMatch, RuleReplyMode } from "../types.js";

type Row = Record<string, unknown>;

/* ---------------- API anahtarları (org başına) ---------------- */

function rowToKey(r: Row): ApiKey {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    name: r.name as string,
    prefix: r.prefix as string,
    createdBy: (r.created_by as string) ?? null,
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string) ?? null,
  };
}

export const apiKeysRepo = {
  list(orgId: string): ApiKey[] {
    return (getDb().prepare("SELECT * FROM api_keys WHERE org_id = ? ORDER BY created_at DESC").all(orgId) as Row[]).map(rowToKey);
  },
  /** Anahtar sadece oluşturulurken bir kez gösterilir */
  create(orgId: string, name: string, createdBy: string | null): { key: string; entry: ApiKey } {
    const secret = "sp_" + randomToken(24);
    const id = randomId("key");
    getDb()
      .prepare("INSERT INTO api_keys (id, org_id, name, prefix, key_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, orgId, name, secret.slice(0, 10), sha256(secret), createdBy, nowIso());
    return { key: secret, entry: rowToKey(getDb().prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as Row) };
  },
  verify(key: string): ApiKey | null {
    const r = getDb().prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(sha256(key)) as Row | undefined;
    if (!r || !r.org_id) return null;
    getDb().prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(nowIso(), r.id as string);
    return rowToKey(r);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM api_keys WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};

/* ---------------- Sosyal platform OAuth durumları ---------------- */

export const oauthStatesRepo = {
  create(provider: ProviderId, orgId: string, userId: string | null): string {
    const state = randomToken(24);
    getDb()
      .prepare("INSERT INTO oauth_states (state, provider, code_verifier, org_id, user_id, created_at) VALUES (?, ?, NULL, ?, ?, ?)")
      .run(state, provider, orgId, userId, nowIso());
    getDb().prepare("DELETE FROM oauth_states WHERE created_at < ?").run(new Date(Date.now() - 3600_000).toISOString());
    return state;
  },
  setVerifier(state: string, codeVerifier: string): void {
    getDb().prepare("UPDATE oauth_states SET code_verifier = ? WHERE state = ?").run(codeVerifier, state);
  },
  consume(state: string): { provider: ProviderId; codeVerifier: string | null; orgId: string; userId: string | null } | null {
    const r = getDb().prepare("SELECT * FROM oauth_states WHERE state = ?").get(state) as Row | undefined;
    if (!r || !r.org_id) return null;
    getDb().prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    if (new Date(r.created_at as string).getTime() < Date.now() - 3600_000) return null;
    return { provider: r.provider as ProviderId, codeVerifier: (r.code_verifier as string) ?? null, orgId: r.org_id as string, userId: (r.user_id as string) ?? null };
  },
};

/* ---------------- Medya ---------------- */

function rowToMedia(r: Row): MediaFile {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    filename: r.filename as string,
    originalName: r.original_name as string,
    mime: r.mime as string,
    size: Number(r.size),
    kind: r.kind as MediaFile["kind"],
    altText: (r.alt_text as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export const mediaRepo = {
  list(orgId: string, opts: { limit?: number; offset?: number; kind?: MediaFile["kind"] } = {}): MediaFile[] {
    const rows = opts.kind
      ? getDb().prepare("SELECT * FROM media WHERE org_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(orgId, opts.kind, opts.limit ?? 200, opts.offset ?? 0)
      : getDb().prepare("SELECT * FROM media WHERE org_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(orgId, opts.limit ?? 200, opts.offset ?? 0);
    return (rows as Row[]).map(rowToMedia);
  },
  get(orgId: string, id: string): MediaFile | null {
    const r = getDb().prepare("SELECT * FROM media WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToMedia(r) : null;
  },
  getMany(orgId: string, ids: string[]): MediaFile[] {
    return ids.map((id) => this.get(orgId, id)).filter((m): m is MediaFile => Boolean(m));
  },
  create(input: Omit<MediaFile, "createdAt" | "altText"> & { altText?: string | null }): MediaFile {
    getDb()
      .prepare("INSERT INTO media (id, org_id, filename, original_name, mime, size, kind, alt_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(input.id, input.orgId, input.filename, input.originalName, input.mime, input.size, input.kind, input.altText ?? null, nowIso());
    return this.get(input.orgId, input.id)!;
  },
  setAlt(orgId: string, id: string, altText: string | null): void {
    getDb().prepare("UPDATE media SET alt_text = ? WHERE id = ? AND org_id = ?").run(altText, id, orgId);
  },
  totalBytes(orgId: string): number {
    return Number((getDb().prepare("SELECT COALESCE(SUM(size),0) s FROM media WHERE org_id = ?").get(orgId) as Row).s ?? 0);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM media WHERE id = ? AND org_id = ?").run(id, orgId);
  },
  /** Medya dosyası servisi için: dosya adı hangi org'a ait */
  findByFilename(filename: string): MediaFile | null {
    const r = getDb().prepare("SELECT * FROM media WHERE filename = ?").get(filename) as Row | undefined;
    return r ? rowToMedia(r) : null;
  },
};

/* ---------------- Oto-yanıt kuralları ---------------- */

function rowToRule(r: Row): AutoReplyRule {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
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

export type RuleInput = Omit<AutoReplyRule, "id" | "orgId" | "createdAt" | "updatedAt">;

export const rulesRepo = {
  list(orgId: string): AutoReplyRule[] {
    return (getDb().prepare("SELECT * FROM auto_reply_rules WHERE org_id = ? ORDER BY priority ASC, created_at ASC").all(orgId) as Row[]).map(rowToRule);
  },
  get(orgId: string, id: string): AutoReplyRule | null {
    const r = getDb().prepare("SELECT * FROM auto_reply_rules WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToRule(r) : null;
  },
  create(orgId: string, input: RuleInput): AutoReplyRule {
    const id = randomId("rule");
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO auto_reply_rules (id, org_id, name, enabled, channel_id, provider, match_type, pattern, reply_mode, reply_text, ai_instructions,
         priority, cooldown_minutes, only_business_hours, handoff_to_human, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        orgId,
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
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, input: Partial<RuleInput>): AutoReplyRule | null {
    const cur = this.get(orgId, id);
    if (!cur) return null;
    const m = { ...cur, ...defined(input) };
    getDb()
      .prepare(
        `UPDATE auto_reply_rules SET name=?, enabled=?, channel_id=?, provider=?, match_type=?, pattern=?, reply_mode=?, reply_text=?,
         ai_instructions=?, priority=?, cooldown_minutes=?, only_business_hours=?, handoff_to_human=?, updated_at=? WHERE id=? AND org_id=?`,
      )
      .run(
        m.name,
        m.enabled ? 1 : 0,
        m.channelId ?? null,
        m.provider ?? null,
        m.matchType,
        m.pattern ?? null,
        m.replyMode,
        m.replyText ?? null,
        m.aiInstructions ?? null,
        m.priority,
        m.cooldownMinutes,
        m.onlyBusinessHours ? 1 : 0,
        m.handoffToHuman ? 1 : 0,
        nowIso(),
        id,
        orgId,
      );
    return this.get(orgId, id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM auto_reply_rules WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};

/* ---------------- Platform geneli anahtar/değer ayarları ---------------- */

export const platformSettingsRepo = {
  get(key: string): string | null {
    const r = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return r ? (r.value as string) : null;
  },
  set(key: string, value: string): void {
    getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  },
};

/* ---------------- Aktivite günlüğü ---------------- */

export const activityRepo = {
  add(orgId: string | null, level: ActivityEntry["level"], source: string, message: string, data?: Record<string, unknown>): void {
    getDb()
      .prepare("INSERT INTO activity_log (id, org_id, level, source, message, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(randomId("act"), orgId, level, source, message, data ? JSON.stringify(data) : null, nowIso());
  },
  list(orgId: string, limit = 50): ActivityEntry[] {
    return (getDb().prepare("SELECT * FROM activity_log WHERE org_id = ? ORDER BY created_at DESC LIMIT ?").all(orgId, limit) as Row[]).map((r) => ({
      id: r.id as string,
      orgId: (r.org_id as string) ?? null,
      level: r.level as ActivityEntry["level"],
      source: r.source as string,
      message: r.message as string,
      data: parseJson<Record<string, unknown> | null>(r.data, null),
      createdAt: r.created_at as string,
    }));
  },
  /** Günlük temizlik: 90 günden eski kayıtlar */
  prune(days = 90): void {
    getDb().prepare("DELETE FROM activity_log WHERE created_at < ?").run(new Date(Date.now() - days * 86400_000).toISOString());
  },
};

export const webhookEventsRepo = {
  add(provider: string, payload: unknown): string {
    const id = randomId("wh");
    getDb().prepare("INSERT INTO webhook_events (id, provider, payload, received_at) VALUES (?, ?, ?, ?)").run(id, provider, JSON.stringify(payload), nowIso());
    return id;
  },
  markProcessed(id: string, error?: string | null): void {
    getDb().prepare("UPDATE webhook_events SET processed = 1, error = ? WHERE id = ?").run(error ?? null, id);
  },
  recent(limit = 30): Array<{ id: string; provider: string; processed: number; error: string | null; receivedAt: string }> {
    return (getDb().prepare("SELECT id, provider, processed, error, received_at FROM webhook_events ORDER BY received_at DESC LIMIT ?").all(limit) as Row[]).map((r) => ({
      id: r.id as string,
      provider: r.provider as string,
      processed: Number(r.processed),
      error: (r.error as string) ?? null,
      receivedAt: r.received_at as string,
    }));
  },
  prune(days = 14): void {
    getDb().prepare("DELETE FROM webhook_events WHERE received_at < ?").run(new Date(Date.now() - days * 86400_000).toISOString());
  },
};

export const analyticsRepo = {
  upsert(channelId: string, date: string, metrics: Record<string, number>): void {
    getDb()
      .prepare("INSERT INTO analytics_snapshots (id, channel_id, date, metrics) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, date) DO UPDATE SET metrics=excluded.metrics")
      .run(randomId("snap"), channelId, date, JSON.stringify(metrics));
  },
  series(channelId: string, days = 30): AnalyticsSnapshot[] {
    const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return (getDb().prepare("SELECT * FROM analytics_snapshots WHERE channel_id = ? AND date >= ? ORDER BY date ASC").all(channelId, from) as Row[]).map((r) => ({
      id: r.id as string,
      channelId: r.channel_id as string,
      date: r.date as string,
      metrics: parseJson<Record<string, number>>(r.metrics, {}),
    }));
  },
  latest(channelId: string): AnalyticsSnapshot | null {
    const r = getDb().prepare("SELECT * FROM analytics_snapshots WHERE channel_id = ? ORDER BY date DESC LIMIT 1").get(channelId) as Row | undefined;
    return r ? { id: r.id as string, channelId: r.channel_id as string, date: r.date as string, metrics: parseJson<Record<string, number>>(r.metrics, {}) } : null;
  },
  /** Analitik raporu: tarih aralığındaki anlık görüntüler (YYYY-MM-DD, iki uç dahil) */
  between(channelId: string, fromDate: string, toDate: string): AnalyticsSnapshot[] {
    return (getDb().prepare("SELECT * FROM analytics_snapshots WHERE channel_id = ? AND date >= ? AND date <= ? ORDER BY date ASC").all(channelId, fromDate, toDate) as Row[]).map((r) => ({
      id: r.id as string,
      channelId: r.channel_id as string,
      date: r.date as string,
      metrics: parseJson<Record<string, number>>(r.metrics, {}),
    }));
  },
  /** Verilen günden önceki son anlık görüntü (aralık başında taşınan değer için) */
  lastBefore(channelId: string, date: string): AnalyticsSnapshot | null {
    const r = getDb().prepare("SELECT * FROM analytics_snapshots WHERE channel_id = ? AND date < ? ORDER BY date DESC LIMIT 1").get(channelId, date) as Row | undefined;
    return r ? { id: r.id as string, channelId: r.channel_id as string, date: r.date as string, metrics: parseJson<Record<string, number>>(r.metrics, {}) } : null;
  },
};

export const postMetricsRepo = {
  set(targetId: string, metrics: Record<string, number>): void {
    getDb()
      .prepare("INSERT INTO post_metrics (target_id, metrics, fetched_at) VALUES (?, ?, ?) ON CONFLICT(target_id) DO UPDATE SET metrics=excluded.metrics, fetched_at=excluded.fetched_at")
      .run(targetId, JSON.stringify(metrics), nowIso());
  },
  getMany(targetIds: string[]): Map<string, { metrics: Record<string, number>; fetchedAt: string }> {
    const map = new Map<string, { metrics: Record<string, number>; fetchedAt: string }>();
    for (let i = 0; i < targetIds.length; i += 500) {
      const chunk = targetIds.slice(i, i + 500);
      if (!chunk.length) continue;
      const rows = getDb().prepare(`SELECT * FROM post_metrics WHERE target_id IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as Row[];
      for (const r of rows) map.set(r.target_id as string, { metrics: parseJson<Record<string, number>>(r.metrics, {}), fetchedAt: r.fetched_at as string });
    }
    return map;
  },
  staleTargets(olderThanHours: number, limit = 50): Array<{ targetId: string; channelId: string; externalId: string; orgId: string }> {
    const cutoff = new Date(Date.now() - olderThanHours * 3600_000).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
    return (
      getDb()
        .prepare(
          `SELECT t.id AS target_id, t.channel_id, t.external_id, p.org_id FROM post_targets t JOIN posts p ON p.id = t.post_id
           LEFT JOIN post_metrics m ON m.target_id = t.id
           WHERE t.status = 'published' AND t.external_id IS NOT NULL AND t.published_at >= ? AND (m.fetched_at IS NULL OR m.fetched_at < ?)
           ORDER BY t.published_at DESC LIMIT ?`,
        )
        .all(monthAgo, cutoff, limit) as Row[]
    ).map((r) => ({ targetId: r.target_id as string, channelId: r.channel_id as string, externalId: r.external_id as string, orgId: r.org_id as string }));
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

/* ---------------- Kullanım sayaçları (plan kotası) ---------------- */

export const usageRepo = {
  get(orgId: string, period: string, metric: string): number {
    const r = getDb().prepare("SELECT value FROM usage_counters WHERE org_id = ? AND period = ? AND metric = ?").get(orgId, period, metric) as Row | undefined;
    return Number(r?.value ?? 0);
  },
  increment(orgId: string, period: string, metric: string, by = 1): number {
    getDb()
      .prepare(
        "INSERT INTO usage_counters (org_id, period, metric, value) VALUES (?, ?, ?, ?) ON CONFLICT(org_id, period, metric) DO UPDATE SET value = value + excluded.value",
      )
      .run(orgId, period, metric, by);
    return this.get(orgId, period, metric);
  },
  forOrg(orgId: string, period: string): Record<string, number> {
    const rows = getDb().prepare("SELECT metric, value FROM usage_counters WHERE org_id = ? AND period = ?").all(orgId, period) as Row[];
    return Object.fromEntries(rows.map((r) => [r.metric as string, Number(r.value)]));
  },
};
