import { defined, getDb, nowIso, parseJson } from "../db.js";
import { randomId, randomToken } from "../crypto.js";
import type {
  Campaign,
  Customer,
  Notification,
  OutboundWebhook,
  PostNote,
  PostSource,
  Preset,
  PreviewLink,
  Signature,
  Tag,
  WebhookEvent,
} from "../types.js";

type Row = Record<string, unknown>;

/* ---------------- Müşteriler (ajans modu: kanalları müşteriye göre grupla) ---------------- */

const rowToCustomer = (r: Row): Customer => ({
  id: r.id as string,
  orgId: r.org_id as string,
  name: r.name as string,
  color: r.color as string,
  createdAt: r.created_at as string,
});

export const customersRepo = {
  list(orgId: string): Customer[] {
    return (getDb().prepare("SELECT * FROM customers WHERE org_id = ? ORDER BY name").all(orgId) as Row[]).map(rowToCustomer);
  },
  get(orgId: string, id: string): Customer | null {
    const r = getDb().prepare("SELECT * FROM customers WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToCustomer(r) : null;
  },
  create(orgId: string, name: string, color = "#6d5dfc"): Customer {
    const id = randomId("cus");
    getDb().prepare("INSERT INTO customers (id, org_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)").run(id, orgId, name, color, nowIso());
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, patch: { name?: string; color?: string }): Customer | null {
    const c = this.get(orgId, id);
    if (!c) return null;
    getDb().prepare("UPDATE customers SET name = ?, color = ? WHERE id = ? AND org_id = ?").run(patch.name ?? c.name, patch.color ?? c.color, id, orgId);
    return this.get(orgId, id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("UPDATE channels SET customer_id = NULL WHERE customer_id = ? AND org_id = ?").run(id, orgId);
    getDb().prepare("DELETE FROM customers WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};

/* ---------------- Etiketler ---------------- */

const rowToTag = (r: Row): Tag => ({ id: r.id as string, orgId: r.org_id as string, name: r.name as string, color: r.color as string, createdAt: r.created_at as string });

export const tagsRepo = {
  list(orgId: string): Tag[] {
    return (getDb().prepare("SELECT * FROM tags WHERE org_id = ? ORDER BY name").all(orgId) as Row[]).map(rowToTag);
  },
  get(orgId: string, id: string): Tag | null {
    const r = getDb().prepare("SELECT * FROM tags WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToTag(r) : null;
  },
  /** İsimle bul ya da oluştur (AI/MCP etiket adıyla çalışır) */
  ensure(orgId: string, name: string, color?: string): Tag {
    const clean = name.trim().slice(0, 40);
    const r = getDb().prepare("SELECT * FROM tags WHERE org_id = ? AND lower(name) = lower(?)").get(orgId, clean) as Row | undefined;
    if (r) return rowToTag(r);
    const palette = ["#6d5dfc", "#e1306c", "#34d399", "#fbbf24", "#60a5fa", "#f87171", "#a78bfa", "#22d3ee"];
    const id = randomId("tag");
    getDb()
      .prepare("INSERT INTO tags (id, org_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, orgId, clean, color ?? palette[Math.floor(Math.random() * palette.length)], nowIso());
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, patch: { name?: string; color?: string }): Tag | null {
    const t = this.get(orgId, id);
    if (!t) return null;
    getDb().prepare("UPDATE tags SET name = ?, color = ? WHERE id = ? AND org_id = ?").run(patch.name ?? t.name, patch.color ?? t.color, id, orgId);
    return this.get(orgId, id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM tags WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};

/* ---------------- Kampanyalar (AI planları dahil) ---------------- */

const rowToCampaign = (r: Row): Campaign => ({
  id: r.id as string,
  orgId: r.org_id as string,
  name: r.name as string,
  goal: (r.goal as string) ?? null,
  brief: (r.brief as string) ?? null,
  status: r.status as Campaign["status"],
  source: r.source as PostSource,
  createdBy: (r.created_by as string) ?? null,
  startsAt: (r.starts_at as string) ?? null,
  endsAt: (r.ends_at as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export const campaignsRepo = {
  list(orgId: string): Array<Campaign & { postCount: number; publishedCount: number; nextAt: string | null }> {
    const rows = getDb()
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.campaign_id = c.id) AS post_count,
          (SELECT COUNT(*) FROM posts p WHERE p.campaign_id = c.id AND p.status = 'published') AS published_count,
          (SELECT MIN(publish_at) FROM posts p WHERE p.campaign_id = c.id AND p.status IN ('scheduled','pending_approval')) AS next_at
         FROM campaigns c WHERE c.org_id = ? ORDER BY c.created_at DESC`,
      )
      .all(orgId) as Row[];
    return rows.map((r) => ({ ...rowToCampaign(r), postCount: Number(r.post_count), publishedCount: Number(r.published_count), nextAt: (r.next_at as string) ?? null }));
  },
  get(orgId: string, id: string): Campaign | null {
    const r = getDb().prepare("SELECT * FROM campaigns WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToCampaign(r) : null;
  },
  create(
    orgId: string,
    input: { name: string; goal?: string | null; brief?: string | null; source: PostSource; createdBy?: string | null; startsAt?: string | null; endsAt?: string | null; status?: Campaign["status"] },
  ): Campaign {
    const id = randomId("cmp");
    const now = nowIso();
    getDb()
      .prepare(
        "INSERT INTO campaigns (id, org_id, name, goal, brief, status, source, created_by, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, orgId, input.name, input.goal ?? null, input.brief ?? null, input.status ?? "active", input.source, input.createdBy ?? null, input.startsAt ?? null, input.endsAt ?? null, now, now);
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, patch: Partial<Pick<Campaign, "name" | "goal" | "brief" | "status" | "startsAt" | "endsAt">>): Campaign | null {
    const c = this.get(orgId, id);
    if (!c) return null;
    const m = { ...c, ...defined(patch) };
    getDb()
      .prepare("UPDATE campaigns SET name=?, goal=?, brief=?, status=?, starts_at=?, ends_at=?, updated_at=? WHERE id=? AND org_id=?")
      .run(m.name, m.goal ?? null, m.brief ?? null, m.status, m.startsAt ?? null, m.endsAt ?? null, nowIso(), id, orgId);
    return this.get(orgId, id);
  },
  /** Kampanyadaki planlı gönderilerin zaman aralığını güncelle */
  refreshRange(orgId: string, id: string): void {
    const r = getDb().prepare("SELECT MIN(publish_at) a, MAX(publish_at) b FROM posts WHERE campaign_id = ? AND org_id = ?").get(id, orgId) as Row;
    getDb().prepare("UPDATE campaigns SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?").run((r.a as string) ?? null, (r.b as string) ?? null, nowIso(), id);
  },
  remove(orgId: string, id: string, deletePosts: boolean): void {
    if (deletePosts) {
      getDb().prepare("DELETE FROM posts WHERE campaign_id = ? AND org_id = ? AND status NOT IN ('published','partial')").run(id, orgId);
    }
    getDb().prepare("UPDATE posts SET campaign_id = NULL WHERE campaign_id = ? AND org_id = ?").run(id, orgId);
    getDb().prepare("DELETE FROM campaigns WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};

/* ---------------- İmzalar ---------------- */

const rowToSignature = (r: Row): Signature => ({
  id: r.id as string,
  orgId: r.org_id as string,
  name: r.name as string,
  content: r.content as string,
  autoAdd: Number(r.auto_add ?? 0),
  createdAt: r.created_at as string,
});

export const signaturesRepo = {
  list(orgId: string): Signature[] {
    return (getDb().prepare("SELECT * FROM signatures WHERE org_id = ? ORDER BY name").all(orgId) as Row[]).map(rowToSignature);
  },
  get(orgId: string, id: string): Signature | null {
    const r = getDb().prepare("SELECT * FROM signatures WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToSignature(r) : null;
  },
  autoAdd(orgId: string): Signature | null {
    const r = getDb().prepare("SELECT * FROM signatures WHERE org_id = ? AND auto_add = 1 LIMIT 1").get(orgId) as Row | undefined;
    return r ? rowToSignature(r) : null;
  },
  create(orgId: string, input: { name: string; content: string; autoAdd?: boolean }): Signature {
    const id = randomId("sig");
    if (input.autoAdd) getDb().prepare("UPDATE signatures SET auto_add = 0 WHERE org_id = ?").run(orgId);
    getDb().prepare("INSERT INTO signatures (id, org_id, name, content, auto_add, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, orgId, input.name, input.content, input.autoAdd ? 1 : 0, nowIso());
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, patch: { name?: string; content?: string; autoAdd?: boolean }): Signature | null {
    const s = this.get(orgId, id);
    if (!s) return null;
    if (patch.autoAdd) getDb().prepare("UPDATE signatures SET auto_add = 0 WHERE org_id = ?").run(orgId);
    getDb()
      .prepare("UPDATE signatures SET name = ?, content = ?, auto_add = ? WHERE id = ? AND org_id = ?")
      .run(patch.name ?? s.name, patch.content ?? s.content, patch.autoAdd === undefined ? s.autoAdd : patch.autoAdd ? 1 : 0, id, orgId);
    return this.get(orgId, id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM signatures WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};

/* ---------------- Hazır ayarlar (kanal seçimi + ayarlar) ---------------- */

const rowToPreset = (r: Row): Preset => ({
  id: r.id as string,
  orgId: r.org_id as string,
  name: r.name as string,
  channelIds: parseJson<string[]>(r.channel_ids, []),
  settings: parseJson<Record<string, Record<string, unknown>>>(r.settings, {}),
  createdAt: r.created_at as string,
});

export const presetsRepo = {
  list(orgId: string): Preset[] {
    return (getDb().prepare("SELECT * FROM presets WHERE org_id = ? ORDER BY name").all(orgId) as Row[]).map(rowToPreset);
  },
  get(orgId: string, id: string): Preset | null {
    const r = getDb().prepare("SELECT * FROM presets WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToPreset(r) : null;
  },
  create(orgId: string, input: { name: string; channelIds: string[]; settings?: Record<string, Record<string, unknown>> }): Preset {
    const id = randomId("pre");
    getDb()
      .prepare("INSERT INTO presets (id, org_id, name, channel_ids, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, orgId, input.name, JSON.stringify(input.channelIds), JSON.stringify(input.settings ?? {}), nowIso());
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, patch: { name?: string; channelIds?: string[]; settings?: Record<string, Record<string, unknown>> }): Preset | null {
    const p = this.get(orgId, id);
    if (!p) return null;
    getDb()
      .prepare("UPDATE presets SET name = ?, channel_ids = ?, settings = ? WHERE id = ? AND org_id = ?")
      .run(patch.name ?? p.name, JSON.stringify(patch.channelIds ?? p.channelIds), JSON.stringify(patch.settings ?? p.settings), id, orgId);
    return this.get(orgId, id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM presets WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};

/* ---------------- Gönderi notları (ekip + müşteri önizleme yorumları) ---------------- */

const rowToNote = (r: Row): PostNote => ({
  id: r.id as string,
  postId: r.post_id as string,
  authorUserId: (r.author_user_id as string) ?? null,
  authorName: r.author_name as string,
  text: r.text as string,
  source: r.source as PostNote["source"],
  createdAt: r.created_at as string,
});

export const postNotesRepo = {
  list(postId: string): PostNote[] {
    return (getDb().prepare("SELECT * FROM post_notes WHERE post_id = ? ORDER BY created_at ASC").all(postId) as Row[]).map(rowToNote);
  },
  add(postId: string, input: { authorUserId: string | null; authorName: string; text: string; source: PostNote["source"] }): PostNote {
    const id = randomId("note");
    getDb()
      .prepare("INSERT INTO post_notes (id, post_id, author_user_id, author_name, text, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, postId, input.authorUserId, input.authorName.slice(0, 80), input.text.slice(0, 4000), input.source, nowIso());
    return rowToNote(getDb().prepare("SELECT * FROM post_notes WHERE id = ?").get(id) as Row);
  },
  counts(postIds: string[]): Map<string, number> {
    const m = new Map<string, number>();
    if (!postIds.length) return m;
    for (let i = 0; i < postIds.length; i += 500) {
      const chunk = postIds.slice(i, i + 500);
      const rows = getDb().prepare(`SELECT post_id, COUNT(*) c FROM post_notes WHERE post_id IN (${chunk.map(() => "?").join(",")}) GROUP BY post_id`).all(...chunk) as Row[];
      for (const r of rows) m.set(r.post_id as string, Number(r.c));
    }
    return m;
  },
  remove(postId: string, id: string): void {
    getDb().prepare("DELETE FROM post_notes WHERE id = ? AND post_id = ?").run(id, postId);
  },
};

/* ---------------- Önizleme linkleri (müşteriye onay için paylaşılabilir) ---------------- */

const rowToPreview = (r: Row): PreviewLink => ({
  token: r.token as string,
  orgId: r.org_id as string,
  postId: r.post_id as string,
  createdBy: (r.created_by as string) ?? null,
  expiresAt: (r.expires_at as string) ?? null,
  allowComments: Number(r.allow_comments ?? 1),
  createdAt: r.created_at as string,
});

export const previewLinksRepo = {
  create(orgId: string, postId: string, createdBy: string | null, days = 14): PreviewLink {
    const token = randomToken(18);
    getDb()
      .prepare("INSERT INTO preview_links (token, org_id, post_id, created_by, expires_at, allow_comments, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
      .run(token, orgId, postId, createdBy, new Date(Date.now() + days * 86400_000).toISOString(), nowIso());
    return rowToPreview(getDb().prepare("SELECT * FROM preview_links WHERE token = ?").get(token) as Row);
  },
  resolve(token: string): PreviewLink | null {
    const r = getDb().prepare("SELECT * FROM preview_links WHERE token = ?").get(token) as Row | undefined;
    if (!r) return null;
    const p = rowToPreview(r);
    if (p.expiresAt && new Date(p.expiresAt).getTime() < Date.now()) return null;
    return p;
  },
  forPost(orgId: string, postId: string): PreviewLink[] {
    return (getDb().prepare("SELECT * FROM preview_links WHERE org_id = ? AND post_id = ? ORDER BY created_at DESC").all(orgId, postId) as Row[]).map(rowToPreview);
  },
  revoke(orgId: string, token: string): void {
    getDb().prepare("DELETE FROM preview_links WHERE token = ? AND org_id = ?").run(token, orgId);
  },
};

/* ---------------- Giden webhook'lar ---------------- */

const rowToWebhook = (r: Row): OutboundWebhook => ({
  id: r.id as string,
  orgId: r.org_id as string,
  name: r.name as string,
  url: r.url as string,
  secret: r.secret as string,
  events: parseJson<WebhookEvent[]>(r.events, []),
  enabled: Number(r.enabled ?? 1),
  lastStatus: r.last_status === null || r.last_status === undefined ? null : Number(r.last_status),
  lastError: (r.last_error as string) ?? null,
  lastAt: (r.last_at as string) ?? null,
  createdAt: r.created_at as string,
});

export const webhooksRepo = {
  list(orgId: string): OutboundWebhook[] {
    return (getDb().prepare("SELECT * FROM outbound_webhooks WHERE org_id = ? ORDER BY created_at DESC").all(orgId) as Row[]).map(rowToWebhook);
  },
  forEvent(orgId: string, event: WebhookEvent): OutboundWebhook[] {
    return this.list(orgId).filter((w) => w.enabled && w.events.includes(event));
  },
  get(orgId: string, id: string): OutboundWebhook | null {
    const r = getDb().prepare("SELECT * FROM outbound_webhooks WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToWebhook(r) : null;
  },
  create(orgId: string, input: { name: string; url: string; events: WebhookEvent[] }): OutboundWebhook {
    const id = randomId("hook");
    getDb()
      .prepare("INSERT INTO outbound_webhooks (id, org_id, name, url, secret, events, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
      .run(id, orgId, input.name, input.url, "whsec_" + randomToken(24), JSON.stringify(input.events), nowIso());
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, patch: { name?: string; url?: string; events?: WebhookEvent[]; enabled?: boolean }): OutboundWebhook | null {
    const w = this.get(orgId, id);
    if (!w) return null;
    getDb()
      .prepare("UPDATE outbound_webhooks SET name = ?, url = ?, events = ?, enabled = ? WHERE id = ? AND org_id = ?")
      .run(patch.name ?? w.name, patch.url ?? w.url, JSON.stringify(patch.events ?? w.events), patch.enabled === undefined ? w.enabled : patch.enabled ? 1 : 0, id, orgId);
    return this.get(orgId, id);
  },
  recordDelivery(id: string, status: number | null, error: string | null): void {
    getDb().prepare("UPDATE outbound_webhooks SET last_status = ?, last_error = ?, last_at = ? WHERE id = ?").run(status, error, nowIso(), id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM outbound_webhooks WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};

/* ---------------- Uygulama içi bildirimler ---------------- */

const rowToNotification = (r: Row): Notification => ({
  id: r.id as string,
  orgId: r.org_id as string,
  userId: (r.user_id as string) ?? null,
  kind: r.kind as Notification["kind"],
  title: r.title as string,
  body: (r.body as string) ?? null,
  link: (r.link as string) ?? null,
  readAt: (r.read_at as string) ?? null,
  createdAt: r.created_at as string,
});

export const notificationsRepo = {
  add(orgId: string, input: { userId?: string | null; kind: Notification["kind"]; title: string; body?: string | null; link?: string | null }): void {
    getDb()
      .prepare("INSERT INTO notifications (id, org_id, user_id, kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomId("ntf"), orgId, input.userId ?? null, input.kind, input.title.slice(0, 200), input.body?.slice(0, 1000) ?? null, input.link ?? null, nowIso());
    // Org başına en fazla 300 bildirim tut
    getDb()
      .prepare("DELETE FROM notifications WHERE org_id = ? AND id IN (SELECT id FROM notifications WHERE org_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 300)")
      .run(orgId, orgId);
  },
  list(orgId: string, userId: string | null, limit = 30): Notification[] {
    return (
      getDb()
        .prepare("SELECT * FROM notifications WHERE org_id = ? AND (user_id IS NULL OR user_id = ?) ORDER BY created_at DESC LIMIT ?")
        .all(orgId, userId ?? "", limit) as Row[]
    ).map(rowToNotification);
  },
  unreadCount(orgId: string, userId: string | null): number {
    return Number(
      (getDb().prepare("SELECT COUNT(*) c FROM notifications WHERE org_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL").get(orgId, userId ?? "") as Row).c ?? 0,
    );
  },
  markAllRead(orgId: string, userId: string | null): void {
    getDb().prepare("UPDATE notifications SET read_at = ? WHERE org_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL").run(nowIso(), orgId, userId ?? "");
  },
};
