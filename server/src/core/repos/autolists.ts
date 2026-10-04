import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";
import type { PostKind } from "../types.js";

type Row = Record<string, unknown>;

/** Haftalık yayın saati: day 0 = Pazartesi … 6 = Pazar, time "HH:MM" (çalışma alanı saat dilimi) */
export interface AutolistSlot {
  day: number;
  time: string;
}

export interface Autolist {
  id: string;
  orgId: string;
  name: string;
  channelIds: string[];
  slots: AutolistSlot[];
  /** Liste bitince başa dön */
  repeat: boolean;
  enabled: boolean;
  /** Sıradaki öğenin sırası (0 tabanlı) */
  position: number;
  lastRunAt: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutolistItem {
  id: string;
  autolistId: string;
  kind: PostKind;
  content: string;
  mediaIds: string[];
  position: number;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

const rowTo = (r: Row): Autolist => ({
  id: r.id as string,
  orgId: r.org_id as string,
  name: r.name as string,
  channelIds: parseJson<string[]>(r.channel_ids, []),
  slots: parseJson<AutolistSlot[]>(r.slots, []),
  repeat: Number(r.repeat) === 1,
  enabled: Number(r.enabled) === 1,
  position: Number(r.position ?? 0),
  lastRunAt: (r.last_run_at as string) ?? null,
  lastError: (r.last_error as string) ?? null,
  createdBy: (r.created_by as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const itemTo = (r: Row): AutolistItem => ({
  id: r.id as string,
  autolistId: r.autolist_id as string,
  kind: ((r.kind as string) || "post") as PostKind,
  content: (r.content as string) ?? "",
  mediaIds: parseJson<string[]>(r.media_ids, []),
  position: Number(r.position ?? 0),
  useCount: Number(r.use_count ?? 0),
  lastUsedAt: (r.last_used_at as string) ?? null,
  createdAt: r.created_at as string,
});

export const autolistsRepo = {
  list(orgId: string): Autolist[] {
    return (getDb().prepare("SELECT * FROM autolists WHERE org_id = ? ORDER BY created_at ASC").all(orgId) as Row[]).map(rowTo);
  },
  listEnabled(): Autolist[] {
    return (getDb().prepare("SELECT * FROM autolists WHERE enabled = 1").all() as Row[]).map(rowTo);
  },
  get(orgId: string, id: string): Autolist | null {
    const r = getDb().prepare("SELECT * FROM autolists WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowTo(r) : null;
  },
  create(orgId: string, a: { name: string; channelIds: string[]; slots: AutolistSlot[]; repeat: boolean; createdBy: string | null }): Autolist {
    const id = randomId("alist");
    const now = nowIso();
    getDb()
      .prepare("INSERT INTO autolists (id, org_id, name, channel_ids, slots, repeat, enabled, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)")
      .run(id, orgId, a.name, JSON.stringify(a.channelIds), JSON.stringify(a.slots), a.repeat ? 1 : 0, a.createdBy, now, now);
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, patch: Partial<Pick<Autolist, "name" | "channelIds" | "slots" | "repeat" | "enabled" | "position">>): Autolist | null {
    const cur = this.get(orgId, id);
    if (!cur) return null;
    const n = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Autolist;
    getDb()
      .prepare("UPDATE autolists SET name = ?, channel_ids = ?, slots = ?, repeat = ?, enabled = ?, position = ?, last_error = CASE WHEN ? THEN NULL ELSE last_error END, updated_at = ? WHERE id = ? AND org_id = ?")
      .run(n.name, JSON.stringify(n.channelIds), JSON.stringify(n.slots), n.repeat ? 1 : 0, n.enabled ? 1 : 0, n.position, patch.enabled === true ? 1 : 0, nowIso(), id, orgId);
    return this.get(orgId, id);
  },
  /** Yayın sonrası: sıradaki öğe, son çalışma zamanı, (liste bittiyse) kapatma */
  advance(id: string, p: { position: number; lastRunAt: string; enabled: boolean; error: string | null }): void {
    getDb().prepare("UPDATE autolists SET position = ?, last_run_at = ?, enabled = ?, last_error = ? WHERE id = ?").run(p.position, p.lastRunAt, p.enabled ? 1 : 0, p.error, id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM autolists WHERE id = ? AND org_id = ?").run(id, orgId);
  },

  items(autolistId: string): AutolistItem[] {
    return (getDb().prepare("SELECT * FROM autolist_items WHERE autolist_id = ? ORDER BY position ASC, created_at ASC").all(autolistId) as Row[]).map(itemTo);
  },
  countItems(autolistId: string): number {
    return Number((getDb().prepare("SELECT COUNT(*) c FROM autolist_items WHERE autolist_id = ?").get(autolistId) as Row).c ?? 0);
  },
  getItem(autolistId: string, itemId: string): AutolistItem | null {
    const r = getDb().prepare("SELECT * FROM autolist_items WHERE id = ? AND autolist_id = ?").get(itemId, autolistId) as Row | undefined;
    return r ? itemTo(r) : null;
  },
  addItem(autolistId: string, i: { kind: PostKind; content: string; mediaIds: string[] }): AutolistItem {
    const id = randomId("aitem");
    const pos = Number((getDb().prepare("SELECT COALESCE(MAX(position), -1) + 1 p FROM autolist_items WHERE autolist_id = ?").get(autolistId) as Row).p ?? 0);
    getDb()
      .prepare("INSERT INTO autolist_items (id, autolist_id, kind, content, media_ids, position, use_count, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)")
      .run(id, autolistId, i.kind, i.content, JSON.stringify(i.mediaIds), pos, nowIso());
    return this.getItem(autolistId, id)!;
  },
  updateItem(autolistId: string, itemId: string, patch: { kind?: PostKind; content?: string; mediaIds?: string[] }): AutolistItem | null {
    const cur = this.getItem(autolistId, itemId);
    if (!cur) return null;
    getDb()
      .prepare("UPDATE autolist_items SET kind = ?, content = ?, media_ids = ? WHERE id = ? AND autolist_id = ?")
      .run(patch.kind ?? cur.kind, patch.content ?? cur.content, JSON.stringify(patch.mediaIds ?? cur.mediaIds), itemId, autolistId);
    return this.getItem(autolistId, itemId);
  },
  removeItem(autolistId: string, itemId: string): void {
    getDb().prepare("DELETE FROM autolist_items WHERE id = ? AND autolist_id = ?").run(itemId, autolistId);
    this.reorder(autolistId, this.items(autolistId).map((x) => x.id));
  },
  /** Verilen sırayı 0..n-1 olarak yazar; listede olmayan öğeler sona eklenir */
  reorder(autolistId: string, ids: string[]): void {
    const all = this.items(autolistId);
    const known = new Set(all.map((x) => x.id));
    const order = [...ids.filter((x) => known.has(x)), ...all.map((x) => x.id).filter((x) => !ids.includes(x))];
    const st = getDb().prepare("UPDATE autolist_items SET position = ? WHERE id = ? AND autolist_id = ?");
    [...new Set(order)].forEach((id, i) => st.run(i, id, autolistId));
  },
  markUsed(itemId: string, at: string): void {
    getDb().prepare("UPDATE autolist_items SET use_count = use_count + 1, last_used_at = ? WHERE id = ?").run(at, itemId);
  },
};
