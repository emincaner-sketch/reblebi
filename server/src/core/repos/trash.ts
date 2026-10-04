import { getDb, nowIso, parseJson, tx } from "../db.js";

type Row = Record<string, unknown>;

/** Silinen gönderiler bu kadar gün saklanır, sonra kalıcı olarak silinir */
export const TRASH_DAYS = 30;
const DAY = 86_400_000;

export interface DeletedPost {
  id: string;
  title: string | null;
  preview: string;
  kind: string;
  status: string;
  publishAt: string | null;
  channelIds: string[];
  campaignId: string | null;
  deletedBy: string | null;
  deletedAt: string;
  expiresAt: string;
}

/** Gönderinin silinmeden önceki ham satırları; geri alırken aynı kimliklerle yeniden yazılır */
interface Snapshot {
  post: Row;
  targets: Row[];
  notes: Row[];
}

const rowToDeleted = (r: Row): DeletedPost => ({
  id: r.id as string,
  title: (r.title as string) ?? null,
  preview: (r.preview as string) ?? "",
  kind: r.kind as string,
  status: r.status as string,
  publishAt: (r.publish_at as string) ?? null,
  channelIds: parseJson<string[]>(r.channel_ids, []),
  campaignId: (r.campaign_id as string) ?? null,
  deletedBy: (r.deleted_by as string) ?? null,
  deletedAt: r.deleted_at as string,
  expiresAt: new Date(new Date(r.deleted_at as string).getTime() + TRASH_DAYS * DAY).toISOString(),
});

/** Anlık görüntü eski bir şemadan kalmış olabilir: yalnızca tabloda bugün var olan sütunlar yazılır */
function insertRow(table: string, row: Row): void {
  const cols = new Set((getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
  const keys = Object.keys(row).filter((k) => cols.has(k));
  getDb()
    .prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...keys.map((k) => row[k] as string | number | null));
}

export const trashRepo = {
  /** Gönderiyi silmeden hemen önce çağrılır; silme işlemini kendisi yapmaz */
  capture(orgId: string, postId: string, deletedBy: string | null): void {
    const d = getDb();
    const post = d.prepare("SELECT * FROM posts WHERE id = ? AND org_id = ?").get(postId, orgId) as Row | undefined;
    if (!post) return;
    const targets = d.prepare("SELECT * FROM post_targets WHERE post_id = ?").all(postId) as Row[];
    const notes = d.prepare("SELECT * FROM post_notes WHERE post_id = ?").all(postId) as Row[];
    const snapshot: Snapshot = { post, targets, notes };
    const content = String(post.content ?? "").replace(/\s+/g, " ").trim();
    d.prepare(
      `INSERT OR REPLACE INTO deleted_posts (id, org_id, title, preview, kind, status, publish_at, channel_ids, campaign_id, snapshot, deleted_by, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      postId,
      orgId,
      (post.title as string) ?? null,
      content.slice(0, 280),
      (post.kind as string) ?? "post",
      post.status as string,
      (post.publish_at as string) ?? null,
      JSON.stringify([...new Set(targets.map((t) => t.channel_id as string))]),
      (post.campaign_id as string) ?? null,
      JSON.stringify(snapshot),
      deletedBy,
      nowIso(),
    );
  },

  list(orgId: string): DeletedPost[] {
    this.purgeExpired();
    return (getDb().prepare("SELECT * FROM deleted_posts WHERE org_id = ? ORDER BY deleted_at DESC LIMIT 500").all(orgId) as Row[]).map(rowToDeleted);
  },

  get(orgId: string, id: string): DeletedPost | null {
    const r = getDb().prepare("SELECT * FROM deleted_posts WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToDeleted(r) : null;
  },

  /**
   * Gönderiyi aynı kimlikle geri yazar. Kaldırılmış kanalların hedefleri ve silinmiş kampanya bağı düşer;
   * zamanı geçmiş planlı / onay bekleyen gönderi kendiliğinden yayınlanmasın diye taslağa döner.
   * Dönen değer: geri alınan gönderinin kimliği ve düşen hedef sayısı. Gönderi yoksa null.
   */
  restore(orgId: string, id: string): { postId: string; droppedTargets: number; toDraft: boolean; campaignId: string | null } | null {
    return tx(() => {
      const d = getDb();
      const r = d.prepare("SELECT snapshot FROM deleted_posts WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
      if (!r) return null;
      const snap = parseJson<Snapshot | null>(r.snapshot, null);
      if (!snap?.post) return null;
      if (d.prepare("SELECT 1 FROM posts WHERE id = ?").get(id)) {
        d.prepare("DELETE FROM deleted_posts WHERE id = ?").run(id);
        return null;
      }
      const post: Row = { ...snap.post, org_id: orgId, updated_at: nowIso() };
      const due = typeof post.publish_at === "string" && post.publish_at <= nowIso();
      const toDraft = (post.status === "scheduled" || post.status === "pending_approval") && due;
      if (toDraft) post.status = "draft";
      if (post.status === "publishing") post.status = "draft";
      if (post.campaign_id && !d.prepare("SELECT 1 FROM campaigns WHERE id = ? AND org_id = ?").get(post.campaign_id as string, orgId)) post.campaign_id = null;
      const channelIds = new Set((d.prepare("SELECT id FROM channels WHERE org_id = ?").all(orgId) as Row[]).map((c) => c.id as string));
      const targets = snap.targets.filter((t) => channelIds.has(t.channel_id as string));
      insertRow("posts", post);
      for (const t of targets) insertRow("post_targets", t.status === "publishing" || (toDraft && t.status !== "published") ? { ...t, status: "pending", next_attempt_at: null } : t);
      for (const n of snap.notes ?? []) insertRow("post_notes", n);
      d.prepare("DELETE FROM deleted_posts WHERE id = ?").run(id);
      return { postId: id, droppedTargets: snap.targets.length - targets.length, toDraft, campaignId: (post.campaign_id as string) ?? null };
    });
  },

  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM deleted_posts WHERE id = ? AND org_id = ?").run(id, orgId);
  },

  empty(orgId: string): number {
    return Number(getDb().prepare("DELETE FROM deleted_posts WHERE org_id = ?").run(orgId).changes);
  },

  purgeExpired(): void {
    getDb()
      .prepare("DELETE FROM deleted_posts WHERE deleted_at < ?")
      .run(new Date(Date.now() - TRASH_DAYS * DAY).toISOString());
  },
};
