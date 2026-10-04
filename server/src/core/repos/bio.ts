import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";

type Row = Record<string, unknown>;

export interface BioLink {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
}

export interface BioSocial {
  /** BIO_ICONS anahtarı: instagram, tiktok, website, email… */
  network: string;
  url: string;
}

/** Gönderi ızgarası öğesi (Metricool SmartLinks): yayınlanmış bir gönderinin görseli, tıklayınca url'ye gider */
export interface BioGridItem {
  id: string;
  postId: string;
  url: string;
}

export interface BioTheme {
  /** Vurgu rengi (#rrggbb) */
  accent: string;
  /** Zemin: açık, krem ya da koyu */
  background: "light" | "cream" | "dark";
  /** Düğme biçimi */
  buttons: "rounded" | "pill" | "square";
}

export interface BioPage {
  id: string;
  orgId: string;
  slug: string;
  title: string;
  bio: string | null;
  avatarUrl: string | null;
  theme: BioTheme;
  links: BioLink[];
  socials: BioSocial[];
  grid: BioGridItem[];
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_THEME: BioTheme = { accent: "#5b49f2", background: "cream", buttons: "rounded" };

/** Adres kısaltıcılar ya da sistem yollarıyla karışmasın */
export const RESERVED_SLUGS = new Set(["app", "api", "admin", "login", "signup", "giris", "kayit", "reblebi", "destek", "support", "help", "yardim", "mcp", "media", "static", "assets", "l", "www", "fiyatlar", "pricing"]);

const rowToPage = (r: Row): BioPage => ({
  id: r.id as string,
  orgId: r.org_id as string,
  slug: r.slug as string,
  title: r.title as string,
  bio: (r.bio as string) ?? null,
  avatarUrl: (r.avatar_url as string) ?? null,
  theme: { ...DEFAULT_THEME, ...parseJson<Partial<BioTheme>>(r.theme, {}) },
  links: parseJson<BioLink[]>(r.links, []),
  socials: parseJson<BioSocial[]>(r.socials, []),
  grid: parseJson<BioGridItem[]>(r.grid, []),
  published: Number(r.published) === 1,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export type BioPatch = Partial<Pick<BioPage, "slug" | "title" | "bio" | "avatarUrl" | "theme" | "links" | "socials" | "grid" | "published">>;

export const bioRepo = {
  list(orgId: string): BioPage[] {
    return (getDb().prepare("SELECT * FROM bio_pages WHERE org_id = ? ORDER BY created_at ASC").all(orgId) as Row[]).map(rowToPage);
  },
  get(orgId: string, id: string): BioPage | null {
    const r = getDb().prepare("SELECT * FROM bio_pages WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowToPage(r) : null;
  },
  bySlug(slug: string): BioPage | null {
    const r = getDb().prepare("SELECT * FROM bio_pages WHERE slug = ?").get(slug.toLowerCase()) as Row | undefined;
    return r ? rowToPage(r) : null;
  },
  slugTaken(slug: string, exceptId?: string): boolean {
    const r = getDb().prepare("SELECT id FROM bio_pages WHERE slug = ?").get(slug.toLowerCase()) as Row | undefined;
    return Boolean(r && r.id !== exceptId);
  },
  create(orgId: string, input: { slug: string; title: string; bio?: string | null; avatarUrl?: string | null; links?: BioLink[]; socials?: BioSocial[] }): BioPage {
    const id = randomId("bio");
    const now = nowIso();
    getDb()
      .prepare("INSERT INTO bio_pages (id, org_id, slug, title, bio, avatar_url, theme, links, socials, grid, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .run(id, orgId, input.slug.toLowerCase(), input.title, input.bio ?? null, input.avatarUrl ?? null, JSON.stringify(DEFAULT_THEME), JSON.stringify(input.links ?? []), JSON.stringify(input.socials ?? []), now, now);
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, patch: BioPatch): BioPage | null {
    const p = this.get(orgId, id);
    if (!p) return null;
    const m = { ...p, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as BioPage;
    getDb()
      .prepare("UPDATE bio_pages SET slug=?, title=?, bio=?, avatar_url=?, theme=?, links=?, socials=?, grid=?, published=?, updated_at=? WHERE id=? AND org_id=?")
      .run(m.slug.toLowerCase(), m.title, m.bio ?? null, m.avatarUrl ?? null, JSON.stringify(m.theme), JSON.stringify(m.links), JSON.stringify(m.socials), JSON.stringify(m.grid), m.published ? 1 : 0, nowIso(), id, orgId);
    return this.get(orgId, id);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM bio_pages WHERE id = ? AND org_id = ?").run(id, orgId);
  },

  /** Sayaç: aynı gün, aynı kaynak ve aynı bağlantı için tek satır (kişisel veri saklanmaz) */
  track(pageId: string, linkId: string, day: string, source: string): void {
    getDb()
      .prepare("INSERT INTO bio_events (page_id, link_id, day, source, count) VALUES (?, ?, ?, ?, 1) ON CONFLICT(page_id, link_id, day, source) DO UPDATE SET count = count + 1")
      .run(pageId, linkId, day, source);
  },
  events(pageId: string, fromDay: string, toDay: string): Array<{ linkId: string; day: string; source: string; count: number }> {
    return (getDb().prepare("SELECT link_id, day, source, count FROM bio_events WHERE page_id = ? AND day >= ? AND day <= ?").all(pageId, fromDay, toDay) as Row[]).map((r) => ({
      linkId: r.link_id as string,
      day: r.day as string,
      source: r.source as string,
      count: Number(r.count),
    }));
  },
};
