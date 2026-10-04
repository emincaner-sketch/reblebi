import { getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";

type Row = Record<string, unknown>;

/** Pano kartı türleri (web/src/pages/Studio.tsx ile aynı) */
export const WIDGET_TYPES = ["kpi", "trend", "networks", "topPosts", "kinds", "hashtags", "heatmap", "audience", "ads", "competitors", "note"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  /** s: çeyrek, m: yarım, l: tam genişlik */
  size: "s" | "m" | "l";
  title?: string | null;
  /** Kapsam: ağ ya da tek kanal (yoksa tüm hesaplar) */
  provider?: string | null;
  channelId?: string | null;
  /** kpi / trend için ölçü */
  metric?: string | null;
  /** note için metin */
  text?: string | null;
}

/** Zamanlı e-posta: kapalı / haftalık (pazartesi) / aylık (ayın 1'i), çalışma alanı saatiyle 09:00 sonrası */
export interface DashboardEmail {
  freq: "off" | "weekly" | "monthly";
  /** Virgülle ayrılmış adresler; boşsa sahip ve yöneticiler */
  recipients: string;
  lastSent: string | null;
}

export interface Dashboard {
  id: string;
  orgId: string;
  name: string;
  days: number;
  widgets: DashboardWidget[];
  email: DashboardEmail;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const rowTo = (r: Row): Dashboard => ({
  id: r.id as string,
  orgId: r.org_id as string,
  name: r.name as string,
  days: Number(r.days ?? 30),
  widgets: parseJson<DashboardWidget[]>(r.widgets, []),
  email: { freq: "off", recipients: "", lastSent: null, ...parseJson<Partial<DashboardEmail>>(r.email, {}) },
  createdBy: (r.created_by as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export const dashboardsRepo = {
  list(orgId: string): Dashboard[] {
    return (getDb().prepare("SELECT * FROM dashboards WHERE org_id = ? ORDER BY created_at ASC").all(orgId) as Row[]).map(rowTo);
  },
  get(orgId: string, id: string): Dashboard | null {
    const r = getDb().prepare("SELECT * FROM dashboards WHERE id = ? AND org_id = ?").get(id, orgId) as Row | undefined;
    return r ? rowTo(r) : null;
  },
  create(orgId: string, input: { name: string; days?: number; widgets: DashboardWidget[]; createdBy?: string | null }): Dashboard {
    const id = randomId("dash");
    const now = nowIso();
    getDb()
      .prepare("INSERT INTO dashboards (id, org_id, name, days, widgets, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, orgId, input.name, input.days ?? 30, JSON.stringify(input.widgets), input.createdBy ?? null, now, now);
    return this.get(orgId, id)!;
  },
  update(orgId: string, id: string, patch: { name?: string; days?: number; widgets?: DashboardWidget[] }): Dashboard | null {
    const cur = this.get(orgId, id);
    if (!cur) return null;
    getDb()
      .prepare("UPDATE dashboards SET name = ?, days = ?, widgets = ?, updated_at = ? WHERE id = ? AND org_id = ?")
      .run(patch.name ?? cur.name, patch.days ?? cur.days, JSON.stringify(patch.widgets ?? cur.widgets), nowIso(), id, orgId);
    return this.get(orgId, id);
  },
  setEmail(orgId: string, id: string, email: DashboardEmail): void {
    getDb().prepare("UPDATE dashboards SET email = ? WHERE id = ? AND org_id = ?").run(JSON.stringify(email), id, orgId);
  },
  /** Zamanlayıcı: e-postası açık tüm panolar */
  listScheduled(): Dashboard[] {
    return (getDb().prepare("SELECT * FROM dashboards WHERE email LIKE '%\"freq\":\"weekly\"%' OR email LIKE '%\"freq\":\"monthly\"%'").all() as Row[]).map(rowTo);
  },
  remove(orgId: string, id: string): void {
    getDb().prepare("DELETE FROM dashboards WHERE id = ? AND org_id = ?").run(id, orgId);
  },
};
