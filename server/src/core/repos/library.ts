import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";
import type { PostKind } from "../types.js";

type Row = Record<string, unknown>;

export type LibraryType = "post" | "hashtags";

/** Kütüphane öğesi: gönderi şablonu (metin + medya + tür) ya da hashtag grubu (content = hashtag listesi) */
export interface LibraryItem {
  id: string;
  orgId: string;
  type: LibraryType;
  name: string;
  kind: PostKind;
  content: string;
  mediaIds: string[];
  useCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const rowTo = (r: Row): LibraryItem => ({
  id: r.id as string,
  orgId: r.org_id as string,
  type: r.type as LibraryType,
  name: r.name as string,
  kind: (r.kind as PostKind) ?? "post",
  content: (r.content as string) ?? "",
  mediaIds: parseJson<string[]>(r.media_ids, []),
  useCount: Number(r.use_count ?? 0),
  createdBy: (r.created_by as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export const libraryRepo = {
  list(orgId: string, type?: LibraryType): LibraryItem[] {
    const rows = type
      ? getDb().prepare("SELECT * FROM library_items WHERE org_id = ? AND type = ? ORDER BY use_count DESC, updated_at DESC").all(orgId, type)
      : getDb().prepare("SELECT * FROM library_items WHERE org_id = ? ORDER BY type, use_count DESC, updated_at DESC").all(orgId);
    return (rows as Row[]).map(rowTo);
  },
  get(orgId: string, id: string): LibraryItem | null {
    const r = getDb().prepare("SELECT * FROM library_items WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowTo(r) : null;
  },
  create(orgId: string, input: { type: LibraryType; name: string; kind?: PostKind; content: string; mediaIds?: string[]; createdBy?: string | null }): LibraryItem {
    const id = randomId("lib");
    const now = nowIso();
    getDb()
      .prepare("INSERT INTO library_items (id, org_id, type, name, kind, content, media_ids, use_count, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)")
      .run(id, orgId, input.type, input.name, input.kind ?? "post", input.content, JSON.stringify(input.mediaIds ?? []), input.createdBy ?? null, now, now);
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, patch: { name?: string; kind?: PostKind; content?: string; mediaIds?: string[] }): LibraryItem | null {
    const cur = this.get(orgId, id);
    if (!cur) return null;
    getDb()
      .prepare("UPDATE library_items SET name = ?, kind = ?, content = ?, media_ids = ?, updated_at = ? WHERE id = ? AND org_id = ?")
      .run(patch.name ?? cur.name, patch.kind ?? cur.kind, patch.content ?? cur.content, JSON.stringify(patch.mediaIds ?? cur.mediaIds), nowIso(), id, orgId);
    return this.get(orgId, id);
  },
  /** Kullanım sayacı: sık kullanılanlar listenin başına gelir */
  touch(orgId: string, id: string): void {
    getDb().prepare("UPDATE library_items SET use_count = use_count + 1 WHERE id = ? AND org_id = ?").run(id, orgId);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM library_items WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};
