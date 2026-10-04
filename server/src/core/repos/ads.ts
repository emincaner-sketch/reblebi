import { getDb, nowIso, parseJson } from "../db.js";
import { decrypt, encrypt, randomId } from "../crypto.js";

type Row = Record<string, unknown>;

export type AdsProviderId = "meta" | "google" | "tiktok";

export interface AdAccount {
  id: string;
  orgId: string;
  provider: AdsProviderId;
  externalId: string;
  name: string;
  currency: string | null;
  enabled: boolean;
  lastError: string | null;
  lastSyncedAt: string | null;
  tokenExpiresAt: string | null;
  /** Platforma özel: Google'da yönetici (MCC) hesabı → { loginCustomerId } */
  extra: Record<string, unknown>;
  createdAt: string;
}

/** Günlük reklam metrikleri: spend (hesap para birimi), impressions, reach, clicks, linkClicks, conversions, purchases, leads, messages */
export type AdMetrics = Record<string, number>;

/** Kampanya altı düzeyler: reklam seti / reklam grubu, tekil reklam, anahtar kelime (Google) */
export type AdLevel = "group" | "ad" | "keyword";

const rowTo = (r: Row): AdAccount => ({
  id: r.id as string,
  orgId: r.org_id as string,
  provider: ((r.provider as string) || "meta") as AdsProviderId,
  externalId: r.external_id as string,
  name: r.name as string,
  currency: (r.currency as string) ?? null,
  enabled: Number(r.enabled) === 1,
  lastError: (r.last_error as string) ?? null,
  lastSyncedAt: (r.last_synced_at as string) ?? null,
  tokenExpiresAt: (r.token_expires_at as string) ?? null,
  extra: parseJson<Record<string, unknown>>(r.extra, {}),
  createdAt: r.created_at as string,
});

export const adsRepo = {
  list(orgId: string): AdAccount[] {
    return (getDb().prepare("SELECT * FROM ad_accounts WHERE org_id = ? ORDER BY provider, name").all(orgId) as Row[]).map(rowTo);
  },
  listAll(): AdAccount[] {
    return (getDb().prepare("SELECT * FROM ad_accounts WHERE enabled = 1").all() as Row[]).map(rowTo);
  },
  get(orgId: string, id: string): AdAccount | null {
    const r = getDb().prepare("SELECT * FROM ad_accounts WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowTo(r) : null;
  },
  token(id: string): string | null {
    const r = getDb().prepare("SELECT token_enc FROM ad_accounts WHERE id = ?").get(id) as Row | undefined;
    return r ? decrypt(r.token_enc as string) : null;
  },
  refreshToken(id: string): string | null {
    const r = getDb().prepare("SELECT refresh_token_enc FROM ad_accounts WHERE id = ?").get(id) as Row | undefined;
    return r?.refresh_token_enc ? decrypt(r.refresh_token_enc as string) : null;
  },
  setToken(id: string, token: string, expiresAt: string | null): void {
    getDb().prepare("UPDATE ad_accounts SET token_enc = ?, token_expires_at = ? WHERE id = ?").run(encrypt(token), expiresAt, id);
  },
  /** Bağlantıda gelen hesapları ekler ya da jetonunu yeniler (aynı org + platform + hesap tekildir) */
  upsert(
    orgId: string,
    a: { provider?: AdsProviderId; externalId: string; name: string; currency: string | null; token: string; tokenExpiresAt: string | null; refreshToken?: string | null; extra?: Record<string, unknown> },
  ): AdAccount {
    const db = getDb();
    const provider = a.provider ?? "meta";
    const refresh = a.refreshToken ? encrypt(a.refreshToken) : null;
    const existing = db.prepare("SELECT id FROM ad_accounts WHERE org_id = ? AND provider = ? AND external_id = ?").get(orgId, provider, a.externalId) as Row | undefined;
    if (existing) {
      db.prepare(
        "UPDATE ad_accounts SET name = ?, currency = ?, token_enc = ?, token_expires_at = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), extra = ?, last_error = NULL WHERE id = ?",
      ).run(a.name, a.currency, encrypt(a.token), a.tokenExpiresAt, refresh, JSON.stringify(a.extra ?? {}), existing.id as string);
      return this.get(orgId, existing.id as string)!;
    }
    const id = randomId("adacc");
    db.prepare(
      "INSERT INTO ad_accounts (id, org_id, provider, external_id, name, currency, token_enc, token_expires_at, refresh_token_enc, extra, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
    ).run(id, orgId, provider, a.externalId, a.name, a.currency, encrypt(a.token), a.tokenExpiresAt, refresh, JSON.stringify(a.extra ?? {}), nowIso());
    return this.get(orgId, id)!;
  },
  /** extra alanına anahtar ekler/günceller (diğer anahtarlar korunur; ör. Google loginCustomerId) */
  mergeExtra(id: string, patch: Record<string, unknown>): void {
    const r = getDb().prepare("SELECT extra FROM ad_accounts WHERE id = ?").get(id) as Row | undefined;
    if (!r) return;
    getDb().prepare("UPDATE ad_accounts SET extra = ? WHERE id = ?").run(JSON.stringify({ ...parseJson<Record<string, unknown>>(r.extra, {}), ...patch }), id);
  },
  setEnabled(orgId: string, id: string, enabled: boolean): void {
    getDb().prepare("UPDATE ad_accounts SET enabled = ? WHERE id = ? AND org_id = ?").run(enabled ? 1 : 0, id, orgId);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM ad_accounts WHERE id = ? AND org_id = ?").run(id, orgId);
  },
  markSynced(id: string, error: string | null): void {
    getDb().prepare("UPDATE ad_accounts SET last_synced_at = ?, last_error = ? WHERE id = ?").run(nowIso(), error ? error.slice(0, 500) : null, id);
  },
  /** Hesap toplamı (campaignId '') ya da kampanya satırı */
  upsertDay(adAccountId: string, date: string, campaignId: string, campaignName: string | null, metrics: AdMetrics): void {
    getDb()
      .prepare(
        "INSERT INTO ad_insights (ad_account_id, date, campaign_id, campaign_name, metrics) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ad_account_id, date, campaign_id) DO UPDATE SET campaign_name = excluded.campaign_name, metrics = excluded.metrics",
      )
      .run(adAccountId, date, campaignId, campaignName, JSON.stringify(metrics));
  },
  rows(adAccountId: string, fromDate: string, toDate: string): Array<{ date: string; campaignId: string; campaignName: string | null; metrics: AdMetrics }> {
    return (getDb().prepare("SELECT * FROM ad_insights WHERE ad_account_id = ? AND date >= ? AND date <= ? ORDER BY date").all(adAccountId, fromDate, toDate) as Row[]).map((r) => ({
      date: r.date as string,
      campaignId: r.campaign_id as string,
      campaignName: (r.campaign_name as string) ?? null,
      metrics: parseJson<AdMetrics>(r.metrics, {}),
    }));
  },
  /** Grup / reklam / anahtar kelime günlük satırı */
  upsertEntity(
    adAccountId: string,
    e: { date: string; level: AdLevel; id: string; name: string | null; parentId?: string | null; parentName?: string | null; extra?: Record<string, unknown>; metrics: AdMetrics },
  ): void {
    getDb()
      .prepare(
        `INSERT INTO ad_entity_insights (ad_account_id, date, level, entity_id, name, parent_id, parent_name, extra, metrics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ad_account_id, date, level, entity_id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id, parent_name = excluded.parent_name, extra = excluded.extra, metrics = excluded.metrics`,
      )
      .run(adAccountId, e.date, e.level, e.id, e.name, e.parentId ?? null, e.parentName ?? null, JSON.stringify(e.extra ?? {}), JSON.stringify(e.metrics));
  },
  entities(adAccountId: string, level: AdLevel, fromDate: string, toDate: string): Array<{ date: string; id: string; name: string | null; parentId: string | null; parentName: string | null; extra: Record<string, unknown>; metrics: AdMetrics }> {
    return (
      getDb().prepare("SELECT * FROM ad_entity_insights WHERE ad_account_id = ? AND level = ? AND date >= ? AND date <= ? ORDER BY date").all(adAccountId, level, fromDate, toDate) as Row[]
    ).map((r) => ({
      date: r.date as string,
      id: r.entity_id as string,
      name: (r.name as string) ?? null,
      parentId: (r.parent_id as string) ?? null,
      parentName: (r.parent_name as string) ?? null,
      extra: parseJson<Record<string, unknown>>(r.extra, {}),
      metrics: parseJson<AdMetrics>(r.metrics, {}),
    }));
  },
};
