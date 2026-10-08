import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("db");

interface Migration {
  id: number;
  sql?: string;
  up?: (d: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    sql: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      code_verifier TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT,
      avatar_url TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at TEXT,
      scopes TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, external_id)
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      title TEXT,
      kind TEXT NOT NULL DEFAULT 'post',
      status TEXT NOT NULL DEFAULT 'draft',
      content TEXT NOT NULL DEFAULT '',
      media_ids TEXT NOT NULL DEFAULT '[]',
      publish_at TEXT,
      published_at TEXT,
      source TEXT NOT NULL DEFAULT 'panel',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_status_publish ON posts(status, publish_at);
    CREATE TABLE IF NOT EXISTS post_targets (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      content TEXT,
      media_ids TEXT,
      settings TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      external_id TEXT,
      external_url TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      published_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_targets_post ON post_targets(post_id);
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      participant_name TEXT,
      participant_avatar TEXT,
      last_message_at TEXT NOT NULL,
      last_message_preview TEXT,
      unread INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'auto',
      status TEXT NOT NULL DEFAULT 'open',
      needs_attention INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(channel_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_conv_last ON conversations(last_message_at DESC);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      external_id TEXT,
      text TEXT NOT NULL DEFAULT '',
      attachments TEXT NOT NULL DEFAULT '[]',
      sent_by TEXT NOT NULL,
      rule_id TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_external ON messages(external_id) WHERE external_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS auto_reply_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      channel_id TEXT,
      provider TEXT,
      match_type TEXT NOT NULL DEFAULT 'keyword',
      pattern TEXT,
      reply_mode TEXT NOT NULL DEFAULT 'template',
      reply_text TEXT,
      ai_instructions TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      cooldown_minutes INTEGER NOT NULL DEFAULT 60,
      only_business_hours INTEGER NOT NULL DEFAULT 0,
      handoff_to_human INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rule_hits (
      rule_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      last_hit_at TEXT NOT NULL,
      PRIMARY KEY(rule_id, conversation_id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      payload TEXT NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      received_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      data TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
    CREATE TABLE IF NOT EXISTS analytics_snapshots (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      date TEXT NOT NULL,
      metrics TEXT NOT NULL,
      UNIQUE(channel_id, date)
    );
    CREATE TABLE IF NOT EXISTS poll_cursors (
      channel_id TEXT PRIMARY KEY,
      cursor TEXT,
      updated_at TEXT NOT NULL
    );
    `,
  },
  { id: 2, up: migrateToMultiTenant },
  {
    id: 3,
    sql: `
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL DEFAULT '{}',
      webhook_slug TEXT UNIQUE,
      steps TEXT NOT NULL DEFAULT '[]',
      created_by TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      last_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflows_org ON workflows(org_id);
    CREATE INDEX IF NOT EXISTS idx_workflows_trigger ON workflows(trigger_type, enabled);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_slug ON workflows(webhook_slug) WHERE webhook_slug IS NOT NULL;

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL,
      trigger_payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      error TEXT,
      steps_executed TEXT NOT NULL DEFAULT '[]',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_wf ON workflow_runs(workflow_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_org ON workflow_runs(org_id, created_at DESC);
    `,
  },
  {
    id: 4,
    sql: `
    CREATE TABLE IF NOT EXISTS app_connections (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL,
      name TEXT NOT NULL,
      credentials_enc TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_conn_org ON app_connections(org_id, app_id);
    `,
  },
  {
    // Çöp kutusu: silinen gönderinin anlık görüntüsü (gönderi + hedefler + notlar) 30 gün saklanır, geri alınabilir
    id: 5,
    sql: `
    CREATE TABLE IF NOT EXISTS deleted_posts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      title TEXT,
      preview TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'post',
      status TEXT NOT NULL,
      publish_at TEXT,
      channel_ids TEXT NOT NULL DEFAULT '[]',
      campaign_id TEXT,
      snapshot TEXT NOT NULL,
      deleted_by TEXT,
      deleted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deleted_posts_org ON deleted_posts(org_id, deleted_at DESC);
    `,
  },
  {
    // Link in bio sayfaları (/l/:slug) ve günlük, kişisel veri içermeyen sayaçlar (link_id '' = sayfa görüntüleme)
    id: 6,
    sql: `
    CREATE TABLE IF NOT EXISTS bio_pages (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      bio TEXT,
      avatar_url TEXT,
      theme TEXT NOT NULL DEFAULT '{}',
      links TEXT NOT NULL DEFAULT '[]',
      socials TEXT NOT NULL DEFAULT '[]',
      grid TEXT NOT NULL DEFAULT '[]',
      published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bio_pages_org ON bio_pages(org_id);
    CREATE TABLE IF NOT EXISTS bio_events (
      page_id TEXT NOT NULL REFERENCES bio_pages(id) ON DELETE CASCADE,
      link_id TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'direct',
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (page_id, link_id, day, source)
    );
    `,
  },
  {
    // Kanal kitlesi (ülke, şehir, yaş, cinsiyet): son çekilen kırılım; günlük hesap insights analytics_snapshots'ta ins_* anahtarlarıyla durur
    id: 7,
    sql: `
    CREATE TABLE IF NOT EXISTS channel_audience (
      channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    `,
  },
  {
    // Rakip takibi: herkese açık hesap metrikleri (Instagram Business Discovery), günlük anlık görüntü
    id: 8,
    sql: `
    CREATE TABLE IF NOT EXISTS competitors (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'instagram',
      username TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      biography TEXT,
      recent TEXT NOT NULL DEFAULT '[]',
      last_error TEXT,
      last_fetched_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (org_id, provider, username)
    );
    CREATE TABLE IF NOT EXISTS competitor_snapshots (
      competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      followers INTEGER,
      media_count INTEGER,
      metrics TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (competitor_id, date)
    );
    `,
  },
  {
    // Reklam metrikleri (salt okunur): bağlı reklam hesapları ve günlük hesap/kampanya insights (campaign_id '' = hesap toplamı)
    id: 9,
    sql: `
    CREATE TABLE IF NOT EXISTS ad_accounts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'meta',
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      currency TEXT,
      token_enc TEXT NOT NULL,
      token_expires_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (org_id, provider, external_id)
    );
    CREATE TABLE IF NOT EXISTS ad_insights (
      ad_account_id TEXT NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      campaign_id TEXT NOT NULL DEFAULT '',
      campaign_name TEXT,
      metrics TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (ad_account_id, date, campaign_id)
    );
    `,
  },
  {
    // Çok platformlu reklamlar (Meta + Google Ads + TikTok Ads): yenileme jetonu, hesap ek bilgisi (ör. Google yönetici hesabı)
    // ve grup / reklam / anahtar kelime düzeyinde günlük metrikler
    id: 10,
    up: (d) => {
      addColumn(d, "ad_accounts", "refresh_token_enc", "TEXT");
      addColumn(d, "ad_accounts", "extra", "TEXT NOT NULL DEFAULT '{}'");
      d.exec(`
        CREATE TABLE IF NOT EXISTS ad_entity_insights (
          ad_account_id TEXT NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          level TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          name TEXT,
          parent_id TEXT,
          parent_name TEXT,
          extra TEXT NOT NULL DEFAULT '{}',
          metrics TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY (ad_account_id, date, level, entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ad_entity_level ON ad_entity_insights(ad_account_id, level, date);
      `);
    },
  },
  {
    // Gönderi kütüphanesi (Metricool "Posts library"): yeniden kullanılabilir gönderi şablonları ve hashtag grupları
    id: 11,
    sql: `
    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'post',
      content TEXT NOT NULL DEFAULT '',
      media_ids TEXT NOT NULL DEFAULT '[]',
      use_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_library_org ON library_items(org_id, type);
    `,
  },
  {
    // Hashtag takibi (Metricool "Hashtag Tracker"): Instagram hashtag araması, günlük hacim ve öne çıkan gönderiler
    id: 12,
    sql: `
    CREATE TABLE IF NOT EXISTS hashtag_tracks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      hashtag TEXT NOT NULL,
      ig_hashtag_id TEXT,
      top TEXT NOT NULL DEFAULT '[]',
      last_error TEXT,
      last_fetched_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (org_id, hashtag)
    );
    CREATE TABLE IF NOT EXISTS hashtag_snapshots (
      track_id TEXT NOT NULL REFERENCES hashtag_tracks(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      metrics TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (track_id, date)
    );
    `,
  },
  {
    // Studio (Metricool özel raporlar/panolar): sürükle-bırak pano düzeni (widgets JSON)
    id: 13,
    sql: `
    CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      days INTEGER NOT NULL DEFAULT 30,
      widgets TEXT NOT NULL DEFAULT '[]',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dashboards_org ON dashboards(org_id);
    `,
  },
  {
    // Otomatik listeler (Metricool "Autolists"): içerik kuyruğu seçilen gün/saatlerde sırayla, isterse döngüyle paylaşılır
    id: 14,
    sql: `
    CREATE TABLE IF NOT EXISTS autolists (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      channel_ids TEXT NOT NULL DEFAULT '[]',
      slots TEXT NOT NULL DEFAULT '[]',
      repeat INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      last_error TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_autolists_org ON autolists(org_id);
    CREATE TABLE IF NOT EXISTS autolist_items (
      id TEXT PRIMARY KEY,
      autolist_id TEXT NOT NULL REFERENCES autolists(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'post',
      content TEXT NOT NULL DEFAULT '',
      media_ids TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL DEFAULT 0,
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_autolist_items ON autolist_items(autolist_id, position);
    `,
  },
  {
    // Web sitesi analitiği (Metricool izleme kodu karşılığı): çerezsiz, günlük toplanmış sayaçlar
    id: 15,
    sql: `
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      last_hit_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (org_id, domain)
    );
    CREATE TABLE IF NOT EXISTS site_daily (
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      dim TEXT NOT NULL,
      key TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      entries INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, date, dim, key)
    );
    CREATE TABLE IF NOT EXISTS site_seen (
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (site_id, date, hash)
    );
    `,
  },
  {
    // Studio panosunu zamanlı e-postayla gönderme: { freq, recipients, lastSent }
    id: 16,
    up: (d) => {
      addColumn(d, "dashboards", "email", "TEXT NOT NULL DEFAULT '{}'");
    },
  },
  {
    // Anlık bildirim (Web Push) abonelikleri: cihaz başına uç nokta ve şifreleme anahtarları
    id: 17,
    sql: `
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'all',
      ua TEXT,
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
    `,
  },
  {
    // Bahsetme izleme (sosyal dinleme): marka/anahtar kelime sorguları ve haber, Reddit, Bluesky, YouTube, web bahsetmeleri
    id: 18,
    sql: `
    CREATE TABLE IF NOT EXISTS listen_queries (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      terms TEXT NOT NULL DEFAULT '[]',
      excludes TEXT NOT NULL DEFAULT '[]',
      sources TEXT NOT NULL DEFAULT '[]',
      lang TEXT NOT NULL DEFAULT 'tr',
      enabled INTEGER NOT NULL DEFAULT 1,
      notify INTEGER NOT NULL DEFAULT 1,
      ai_sentiment INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT '{}',
      last_run_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_listen_org ON listen_queries(org_id);
    CREATE TABLE IF NOT EXISTS mentions (
      id TEXT PRIMARY KEY,
      query_id TEXT NOT NULL REFERENCES listen_queries(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      snippet TEXT,
      author TEXT,
      site TEXT,
      lang TEXT,
      published_at TEXT NOT NULL,
      found_at TEXT NOT NULL,
      sentiment TEXT NOT NULL DEFAULT 'neutral',
      sentiment_by TEXT NOT NULL DEFAULT 'lexicon',
      reach INTEGER,
      engagement INTEGER,
      status TEXT NOT NULL DEFAULT 'new',
      starred INTEGER NOT NULL DEFAULT 0,
      UNIQUE (query_id, source, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mentions_org ON mentions(org_id, published_at);
    CREATE INDEX IF NOT EXISTS idx_mentions_query ON mentions(query_id, published_at);
    `,
  },
];

function hasColumn(d: DatabaseSync, table: string, column: string): boolean {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function addColumn(d: DatabaseSync, table: string, column: string, def: string): void {
  if (!hasColumn(d, table, column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

function count(d: DatabaseSync, table: string): number {
  return Number((d.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c ?? 0);
}

/**
 * Migration 2: tek kullanıcılı yapıdan çok kiracılı (SaaS) yapıya geçiş.
 * Eski veri varsa "org_default" çalışma alanına bağlanır ve ilk kullanıcı sahibi + süper admin olur.
 */
function migrateToMultiTenant(d: DatabaseSync): void {
  const now = new Date().toISOString();

  d.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL DEFAULT 'free',
      plan_expires_at TEXT,
      billing_ref TEXT,
      timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul',
      locale TEXT NOT NULL DEFAULT 'tr',
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'editor',
      created_at TEXT NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      token_hash TEXT NOT NULL UNIQUE,
      invited_by TEXT,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS org_settings (
      org_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6d5dfc',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6d5dfc',
      created_at TEXT NOT NULL,
      UNIQUE(org_id, name)
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      goal TEXT,
      brief TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'panel',
      created_by TEXT,
      starts_at TEXT,
      ends_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signatures (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      auto_add INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      channel_ids TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS post_notes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_user_id TEXT,
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'team',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_post_notes_post ON post_notes(post_id);
    CREATE TABLE IF NOT EXISTS preview_links (
      token TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_by TEXT,
      expires_at TEXT,
      allow_comments INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comment_jobs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      run_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      external_id TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comment_jobs_due ON comment_jobs(status, run_at);
    CREATE TABLE IF NOT EXISTS outbound_webhooks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_status INTEGER,
      last_error TEXT,
      last_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT,
      kind TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(org_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS usage_counters (
      org_id TEXT NOT NULL,
      period TEXT NOT NULL,
      metric TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (org_id, period, metric)
    );
    CREATE TABLE IF NOT EXISTS post_metrics (
      target_id TEXT PRIMARY KEY,
      metrics TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY,
      secret_hash TEXT,
      name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      client_uri TEXT,
      logo_uri TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      scope TEXT,
      resource TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id TEXT PRIMARY KEY,
      access_hash TEXT NOT NULL UNIQUE,
      refresh_hash TEXT UNIQUE,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      scope TEXT,
      resource TEXT,
      expires_at TEXT NOT NULL,
      refresh_expires_at TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_org ON oauth_tokens(org_id);
  `);

  // Kullanıcılar
  addColumn(d, "users", "name", "TEXT");
  addColumn(d, "users", "is_superadmin", "INTEGER NOT NULL DEFAULT 0");
  addColumn(d, "users", "email_verified_at", "TEXT");
  addColumn(d, "users", "last_login_at", "TEXT");
  addColumn(d, "users", "locale", "TEXT NOT NULL DEFAULT 'tr'");
  addColumn(d, "users", "disabled", "INTEGER NOT NULL DEFAULT 0");
  addColumn(d, "sessions", "org_id", "TEXT");

  // Org alanı olan tablolar
  addColumn(d, "posts", "org_id", "TEXT");
  addColumn(d, "posts", "created_by", "TEXT");
  addColumn(d, "posts", "campaign_id", "TEXT");
  addColumn(d, "posts", "tags", "TEXT NOT NULL DEFAULT '[]'");
  addColumn(d, "posts", "comments", "TEXT NOT NULL DEFAULT '[]'");
  addColumn(d, "posts", "recurrence", "TEXT");
  addColumn(d, "posts", "notes", "TEXT");
  addColumn(d, "posts", "rejection_reason", "TEXT");
  addColumn(d, "media", "org_id", "TEXT");
  addColumn(d, "media", "alt_text", "TEXT");
  addColumn(d, "conversations", "org_id", "TEXT");
  addColumn(d, "conversations", "assigned_to", "TEXT");
  addColumn(d, "auto_reply_rules", "org_id", "TEXT");
  addColumn(d, "api_keys", "org_id", "TEXT");
  addColumn(d, "api_keys", "created_by", "TEXT");
  addColumn(d, "activity_log", "org_id", "TEXT");
  addColumn(d, "oauth_states", "org_id", "TEXT");
  addColumn(d, "oauth_states", "user_id", "TEXT");

  // Kanallar: benzersizlik artık org başına (aynı hesap farklı çalışma alanlarına bağlanabilir)
  d.exec(`
    CREATE TABLE channels_v2 (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT,
      avatar_url TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at TEXT,
      scopes TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      last_error TEXT,
      customer_id TEXT,
      time_slots TEXT NOT NULL DEFAULT '[]',
      preferences TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(org_id, provider, external_id)
    );
  `);

  const hasLegacyData = count(d, "users") + count(d, "channels") + count(d, "posts") > 0;
  if (hasLegacyData) {
    d.prepare(
      "INSERT INTO organizations (id, name, slug, plan, timezone, locale, created_at, updated_at) VALUES ('org_default', 'Varsayılan', 'varsayilan', 'unlimited', 'Europe/Istanbul', 'tr', ?, ?)",
    ).run(now, now);
    d.exec(`
      INSERT INTO memberships (org_id, user_id, role, created_at) SELECT 'org_default', id, 'owner', created_at FROM users;
      UPDATE users SET is_superadmin = 1 WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1);
      UPDATE users SET email_verified_at = created_at;
      UPDATE posts SET org_id = 'org_default' WHERE org_id IS NULL;
      UPDATE media SET org_id = 'org_default' WHERE org_id IS NULL;
      UPDATE conversations SET org_id = 'org_default' WHERE org_id IS NULL;
      UPDATE auto_reply_rules SET org_id = 'org_default' WHERE org_id IS NULL;
      UPDATE api_keys SET org_id = 'org_default' WHERE org_id IS NULL;
      UPDATE activity_log SET org_id = 'org_default' WHERE org_id IS NULL;
    `);
    const legacy = d.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    if (legacy) d.prepare("INSERT INTO org_settings (org_id, value) VALUES ('org_default', ?)").run(legacy.value);
  }
  d.exec(`
    INSERT INTO channels_v2 (id, org_id, provider, external_id, name, username, avatar_url, access_token, refresh_token,
      token_expires_at, scopes, metadata, status, last_error, customer_id, time_slots, preferences, created_at, updated_at)
    SELECT id, 'org_default', provider, external_id, name, username, avatar_url, access_token, refresh_token,
      token_expires_at, scopes, metadata, status, last_error, NULL, '[]', '{}', created_at, updated_at FROM channels;
    DROP TABLE channels;
    ALTER TABLE channels_v2 RENAME TO channels;
    CREATE INDEX IF NOT EXISTS idx_channels_org ON channels(org_id);
    CREATE INDEX IF NOT EXISTS idx_channels_ext ON channels(provider, external_id);
    CREATE INDEX IF NOT EXISTS idx_posts_org ON posts(org_id, publish_at);
    CREATE INDEX IF NOT EXISTS idx_posts_campaign ON posts(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_media_org ON media(org_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conv_org ON conversations(org_id, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rules_org ON auto_reply_rules(org_id, priority);
    CREATE INDEX IF NOT EXISTS idx_activity_org ON activity_log(org_id, created_at DESC);
    DROP INDEX IF EXISTS idx_msg_external;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_conv_external ON messages(conversation_id, external_id) WHERE external_id IS NOT NULL;
  `);
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(d: DatabaseSync): void {
  d.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (d.prepare("SELECT id FROM _migrations").all() as Array<{ id: number }>).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    // Tablo yeniden kurulumunda (channels_v2) yabancı anahtar kontrolü geçici kapatılır
    d.exec("PRAGMA foreign_keys = OFF;");
    d.exec("BEGIN");
    try {
      if (m.sql) d.exec(m.sql);
      if (m.up) m.up(d);
      d.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(m.id, new Date().toISOString());
      d.exec("COMMIT");
      log.info("migration uygulandı", { id: m.id });
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    } finally {
      d.exec("PRAGMA foreign_keys = ON;");
    }
  }
}

/** Tüm veritabanının tutarlı bir kopyasını alır (çalışırken güvenli) */
export function backupTo(filePath: string): void {
  getDb().exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
}

/** Tek bir transaction içinde çalıştır */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** node:sqlite bind için: undefined -> null, boolean -> 0/1, nesne -> JSON */
export function bindable(v: unknown): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Güncelleme yamalarından undefined alanları çıkar ({...mevcut, ...yama} birleştirmesi mevcut değeri silmesin) */
export function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}
