import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Globe2,
  GripVertical,
  Hash,
  LayoutDashboard,
  LineChart,
  Mail,
  Megaphone,
  Plus,
  Printer,
  Settings2,
  Shapes,
  StickyNote,
  Table2,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { api, errMsg, PROVIDER_NAME, type Channel, type ProviderId } from "../lib/api";
import { useI18n, useLabels as usePostLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Empty, Modal, PageHead, ProviderIcon, useLocalState, useToast } from "../components/ui";
import { BarList } from "../panel/charts/BarList";
import { ChartCard, SimpleTable } from "../panel/charts/ChartCard";
import { delta, fmtCompact, fmtDay, fmtNum, fmtPct } from "../panel/charts/format";
import { Heatmap } from "../panel/charts/Heatmap";
import { seriesVar } from "../panel/charts/palette";
import { StatTile } from "../panel/charts/StatTile";
import { TimeChart } from "../panel/charts/TimeChart";
import type { AnalyticsReport, InsightKey } from "../panel/analytics/types";
import "../panel/charts/charts.css";
import "../panel/analytics/studio.css";

/* ---------------- Tipler (server/src/core/repos/dashboards.ts ile aynı) ---------------- */

type WType = "kpi" | "trend" | "networks" | "topPosts" | "kinds" | "hashtags" | "heatmap" | "audience" | "ads" | "competitors" | "note";
type Size = "s" | "m" | "l";
type Metric = "followers" | "followersDelta" | "posts" | "interactions" | "likes" | "comments" | "shares" | "views" | "engagementRate" | "incomingMessages" | `ins.${InsightKey}`;
interface Widget {
  id: string;
  type: WType;
  size: Size;
  title?: string | null;
  provider?: ProviderId | null;
  channelId?: string | null;
  metric?: Metric | null;
  text?: string | null;
}
interface Dashboard {
  id: string;
  name: string;
  days: 7 | 30 | 90;
  widgets: Widget[];
  email?: { freq: "off" | "weekly" | "monthly"; recipients: string; lastSent: string | null };
  updatedAt: string;
}
type Num = number | null;

const KPI_METRICS: Metric[] = [
  "followers",
  "followersDelta",
  "posts",
  "interactions",
  "likes",
  "comments",
  "shares",
  "views",
  "engagementRate",
  "incomingMessages",
  "ins.reach",
  "ins.views",
  "ins.profileViews",
  "ins.websiteClicks",
  "ins.follows",
  "ins.unfollows",
  "ins.clicks",
  "ins.saves",
  "ins.calls",
  "ins.directions",
  "ins.watchMinutes",
];
/** Günlük serisi olan ölçüler */
const TREND_METRICS: Metric[] = KPI_METRICS.filter((m) => !["followersDelta", "engagementRate", "incomingMessages"].includes(m));

const DEFAULT_SIZE: Record<WType, Size> = {
  kpi: "s",
  trend: "l",
  networks: "m",
  topPosts: "m",
  kinds: "m",
  hashtags: "m",
  heatmap: "l",
  audience: "m",
  ads: "m",
  competitors: "m",
  note: "m",
};
/** Kapsam (ağ/kanal) seçilebilen kartlar */
const SCOPED: WType[] = ["kpi", "trend", "networks", "topPosts", "kinds", "hashtags", "heatmap", "audience"];

const newId = () => Math.random().toString(36).slice(2, 10);

/* ---------------- Veri ---------------- */

function reportQs(days: number, w: Pick<Widget, "provider" | "channelId">): string {
  const p = new URLSearchParams({ days: String(days) });
  if (w.channelId) p.set("channelId", w.channelId);
  else if (w.provider) p.set("provider", w.provider);
  return p.toString();
}
function useReport(days: number, w: Pick<Widget, "provider" | "channelId">, enabled = true) {
  const qs = reportQs(days, w);
  return useQuery({
    queryKey: ["analytics-report", qs],
    queryFn: () => api.get<AnalyticsReport>(`/api/analytics/report?${qs}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}

/* ---------------- Sayfa ---------------- */

export default function StudioPage() {
  const { t } = useI18n();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = s.can("editor");
  const list = useQuery({
    queryKey: ["dashboards"],
    queryFn: () => api.get<{ items: Dashboard[]; max: number; maxWidgets: number }>("/api/dashboards"),
  });
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get<Channel[]>("/api/channels"),
    staleTime: 60_000,
  });
  const [activeId, setActiveId] = useLocalState<string>("sp_studio_active", "");
  const items = list.data?.items ?? [];
  const active = items.find((d) => d.id === activeId) ?? items[0] ?? null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Dashboard | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [adding, setAdding] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mailing, setMailing] = useState(false);
  const [announce, setAnnounce] = useState("");
  const view = editing && draft ? draft : active;

  // Düzenleme: her değişiklik kısa gecikmeyle kaydedilir (tek PATCH)
  const lastSaved = useRef<string>("");
  useEffect(() => {
    if (!editing || !draft) return;
    const body = JSON.stringify({
      name: draft.name,
      days: draft.days,
      widgets: draft.widgets,
    });
    if (body === lastSaved.current) return;
    setSaving("saving");
    const h = setTimeout(() => {
      api
        .patch<Dashboard>(`/api/dashboards/${draft.id}`, JSON.parse(body))
        .then((d) => {
          lastSaved.current = body;
          setSaving("saved");
          qc.setQueryData<{
            items: Dashboard[];
            max: number;
            maxWidgets: number;
          }>(["dashboards"], (old) => (old ? { ...old, items: old.items.map((x) => (x.id === d.id ? d : x)) } : old));
        })
        .catch((e) => {
          setSaving("error");
          toast(errMsg(e), "err");
        });
    }, 500);
    return () => clearTimeout(h);
  }, [draft, editing, qc, toast]);

  const startEdit = () => {
    if (!active) return;
    setDraft(structuredClone(active));
    lastSaved.current = JSON.stringify({
      name: active.name,
      days: active.days,
      widgets: active.widgets,
    });
    setSaving("idle");
    setEditing(true);
  };
  const stopEdit = () => {
    setEditing(false);
    setDraft(null);
    setConfigId(null);
  };
  const patchDraft = (fn: (d: Dashboard) => Dashboard) => setDraft((d) => (d ? fn(d) : d));
  const setWidgets = (fn: (ws: Widget[]) => Widget[]) => patchDraft((d) => ({ ...d, widgets: fn(d.widgets) }));
  const move = (id: string, to: number) =>
    setWidgets((ws) => {
      const from = ws.findIndex((w) => w.id === id);
      if (from < 0) return ws;
      const next = [...ws];
      const [w] = next.splice(from, 1);
      const at = Math.max(0, Math.min(next.length, to > from ? to - 1 : to));
      next.splice(at, 0, w);
      setAnnounce(
        t("Kart {n}/{total} konumuna taşındı", {
          n: at + 1,
          total: next.length,
        }),
      );
      return next;
    });

  const create = useMutation({
    mutationFn: (v: { name: string; template: "overview" | "blank" }) => api.post<Dashboard>("/api/dashboards", v),
    onSuccess: (d) => {
      qc.setQueryData<{ items: Dashboard[]; max: number; maxWidgets: number }>(["dashboards"], (old) => (old ? { ...old, items: [...old.items, d] } : old));
      setActiveId(d.id);
      setCreating(false);
      stopEdit();
      if (!d.widgets.length) {
        setDraft(structuredClone(d));
        lastSaved.current = JSON.stringify({
          name: d.name,
          days: d.days,
          widgets: d.widgets,
        });
        setEditing(true);
        setAdding(true);
      }
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/dashboards/${id}`),
    onSuccess: () => {
      stopEdit();
      setActiveId("");
      qc.invalidateQueries({ queryKey: ["dashboards"] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  // Dönem: düzenleme yetkisi olan değiştirince panoya kaydedilir; izleyici yalnızca kendi ekranında değiştirir
  const [localDays, setLocalDays] = useState<Dashboard["days"] | null>(null);
  const days: Dashboard["days"] = editing && draft ? draft.days : (localDays ?? active?.days ?? 30);
  const setDays = (n: Dashboard["days"]) => {
    if (editing) patchDraft((d) => ({ ...d, days: n }));
    else if (canEdit && active) {
      setLocalDays(null);
      api.patch<Dashboard>(`/api/dashboards/${active.id}`, { days: n }).then(() => qc.invalidateQueries({ queryKey: ["dashboards"] }));
      qc.setQueryData<{ items: Dashboard[]; max: number; maxWidgets: number }>(["dashboards"], (old) =>
        old
          ? {
              ...old,
              items: old.items.map((x) => (x.id === active.id ? { ...x, days: n } : x)),
            }
          : old,
      );
    } else setLocalDays(n);
  };

  const chans = channels.data ?? [];
  const configW = configId && draft ? draft.widgets.find((w) => w.id === configId) : null;

  return (
    <div className="studio">
      <PageHead
        title={t("Studio")}
        sub={t("Kendi analitik panolarını kur: kartları ekle, sürükleyerek sırala, boyutlandır ve ağ ya da kanala göre süz. Panolar çalışma alanındaki herkesle paylaşılır.")}
        actions={
          view && (
            <div className="segmented" role="group" aria-label={t("Dönem")}>
              {([7, 30, 90] as const).map((n) => (
                <button key={n} className={days === n ? "active" : ""} aria-pressed={days === n} onClick={() => setDays(n)}>
                  {t("{n} gün", { n })}
                </button>
              ))}
            </div>
          )
        }
      />

      {list.isLoading ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : !items.length ? (
        <div className="card">
          <Empty
            icon={<LayoutDashboard />}
            title={t("Henüz panon yok")}
            text={t("Hazır özet panosuyla başla ya da boş bir panoya istediğin kartları ekle.")}
            action={
              canEdit ? (
                <div className="st-empty-actions">
                  <button
                    className="btn btn-primary"
                    disabled={create.isPending}
                    onClick={() =>
                      create.mutate({
                        name: t("Genel bakış"),
                        template: "overview",
                      })
                    }
                  >
                    <LayoutDashboard aria-hidden="true" /> {t("Hazır özet panosu")}
                  </button>
                  <button className="btn" disabled={create.isPending} onClick={() => create.mutate({ name: t("Yeni pano"), template: "blank" })}>
                    <Plus aria-hidden="true" /> {t("Boş pano")}
                  </button>
                </div>
              ) : undefined
            }
          />
        </div>
      ) : (
        view && (
          <>
            <h2 className="st-print-title">
              {view.name} · {t("son {n} gün", { n: days })}
            </h2>
            <div className="card st-bar">
              {editing && draft ? (
                <label className="st-name">
                  <span className="sr-only">{t("Pano adı")}</span>
                  <input
                    className="input"
                    value={draft.name}
                    maxLength={80}
                    onChange={(e) => patchDraft((d) => ({ ...d, name: e.target.value }))}
                    onBlur={() => !draft.name.trim() && patchDraft((d) => ({ ...d, name: t("Adsız pano") }))}
                  />
                </label>
              ) : (
                <label className="st-pick">
                  <span className="sr-only">{t("Pano")}</span>
                  <select className="select" value={active?.id ?? ""} onChange={(e) => (setActiveId(e.target.value), setLocalDays(null))}>
                    {items.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span className="st-status muted small" aria-live="polite">
                {editing
                  ? saving === "saving"
                    ? t("Kaydediliyor…")
                    : saving === "saved"
                      ? t("Kaydedildi")
                      : saving === "error"
                        ? t("Kaydedilemedi")
                        : t("Değişiklikler otomatik kaydedilir")
                  : t("{n} kart", { n: view.widgets.length })}
              </span>
              <span className="st-bar-actions">
                {!editing && (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => window.print()} title={t("Tarayıcının yazdır penceresinde \"PDF olarak kaydet\"i seç")}>
                      <Printer aria-hidden="true" /> {t("PDF / Yazdır")}
                    </button>
                    {canEdit && active && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setMailing(true)} aria-pressed={active.email?.freq === "weekly" || active.email?.freq === "monthly"}>
                        <Mail aria-hidden="true" /> {active.email?.freq === "weekly" ? t("E-posta: haftalık") : active.email?.freq === "monthly" ? t("E-posta: aylık") : t("E-posta")}
                      </button>
                    )}
                  </>
                )}
                {canEdit && !editing && (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => setCreating(true)} disabled={items.length >= (list.data?.max ?? 20)}>
                      <Plus aria-hidden="true" /> {t("Yeni pano")}
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={startEdit}>
                      <Settings2 aria-hidden="true" /> {t("Düzenle")}
                    </button>
                  </>
                )}
                {editing && draft && (
                  <>
                    <button className="btn btn-sm" onClick={() => setAdding(true)} disabled={draft.widgets.length >= (list.data?.maxWidgets ?? 30)}>
                      <Plus aria-hidden="true" /> {t("Kart ekle")}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm st-danger"
                      onClick={() =>
                        confirm(
                          t("“{name}” panosu silinsin mi?", {
                            name: draft.name,
                          }),
                        ) && remove.mutate(draft.id)
                      }
                    >
                      <Trash2 aria-hidden="true" /> {t("Panoyu sil")}
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={stopEdit}>
                      {t("Bitti")}
                    </button>
                  </>
                )}
              </span>
            </div>

            <p className="sr-only" aria-live="assertive">
              {announce}
            </p>

            {!view.widgets.length ? (
              <div className="card">
                <Empty icon={<Shapes />} title={t("Bu pano boş")} text={canEdit ? t("“Düzenle” ile kart ekle.") : t("Düzenleme yetkisi olan bir ekip üyesi kart ekleyebilir.")} />
              </div>
            ) : (
              <Grid
                widgets={view.widgets}
                days={days}
                editing={editing}
                channels={chans}
                onMove={move}
                onResize={(id, size) => setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, size } : w)))}
                onConfig={setConfigId}
                onRemove={(id) => setWidgets((ws) => ws.filter((w) => w.id !== id))}
              />
            )}
          </>
        )
      )}

      {adding && draft && (
        <AddWidget
          onClose={() => setAdding(false)}
          onAdd={(type) => {
            const w: Widget = {
              id: newId(),
              type,
              size: DEFAULT_SIZE[type],
              metric: type === "kpi" || type === "trend" ? "followers" : null,
              text: type === "note" ? "" : null,
            };
            setWidgets((ws) => [...ws, w]);
            setAdding(false);
            if (type === "note" || type === "kpi") setConfigId(w.id);
            setAnnounce(t("Kart eklendi"));
          }}
        />
      )}
      {configW && <ConfigWidget w={configW} channels={chans} onClose={() => setConfigId(null)} onChange={(patch) => setWidgets((ws) => ws.map((x) => (x.id === configW.id ? { ...x, ...patch } : x)))} />}
      {mailing && active && <EmailDashboard d={active} onClose={() => setMailing(false)} onSaved={(d) => qc.setQueryData<{ items: Dashboard[]; max: number; maxWidgets: number }>(["dashboards"], (old) => (old ? { ...old, items: old.items.map((x) => (x.id === d.id ? d : x)) } : old))} />}
      {creating && <CreateDashboard pending={create.isPending} onClose={() => setCreating(false)} onCreate={(name, template) => create.mutate({ name, template })} />}
    </div>
  );
}

/* ---------------- Izgara + sürükle-bırak ---------------- */

function Grid({
  widgets,
  days,
  editing,
  channels,
  onMove,
  onResize,
  onConfig,
  onRemove,
}: {
  widgets: Widget[];
  days: number;
  editing: boolean;
  channels: Channel[];
  onMove: (id: string, to: number) => void;
  onResize: (id: string, size: Size) => void;
  onConfig: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const [dragId, setDragId] = useState<string | null>(null);
  const [handleId, setHandleId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);

  return (
    <div className={`st-grid${editing ? " st-grid--edit" : ""}`}>
      {widgets.map((w, i) => {
        const indicator = over && over.id === w.id && dragId && dragId !== w.id ? (over.after ? " st-drop-after" : " st-drop-before") : "";
        return (
          <div
            key={w.id}
            className={`st-cell st-${w.size}${dragId === w.id ? " st-dragging" : ""}${indicator}`}
            draggable={editing && handleId === w.id}
            onDragStart={(e) => {
              setDragId(w.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", w.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setHandleId(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              if (!dragId || dragId === w.id) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              // Aynı satırdaysa yatay, değilse dikey yarıya göre önce/sonra
              const after = r.width > r.height * 1.6 ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
              if (!over || over.id !== w.id || over.after !== after) setOver({ id: w.id, after });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && over) onMove(dragId, i + (over.after ? 1 : 0));
              setDragId(null);
              setHandleId(null);
              setOver(null);
            }}
          >
            {editing && (
              <div className="st-tools" role="group" aria-label={t("Kart düzenleme")}>
                <button
                  type="button"
                  className="st-handle"
                  aria-label={t("Taşı (ok tuşlarıyla)")}
                  title={t("Sürükle ya da ok tuşlarıyla taşı")}
                  onPointerDown={() => setHandleId(w.id)}
                  onPointerUp={() => !dragId && setHandleId(null)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                      e.preventDefault();
                      if (i > 0) onMove(w.id, i - 1);
                    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                      e.preventDefault();
                      if (i < widgets.length - 1) onMove(w.id, i + 2);
                    }
                  }}
                >
                  <GripVertical aria-hidden="true" />
                </button>
                <button type="button" className="st-tool" aria-label={t("Öne taşı")} title={t("Öne taşı")} disabled={i === 0} onClick={() => onMove(w.id, i - 1)}>
                  <ChevronLeft aria-hidden="true" />
                </button>
                <button type="button" className="st-tool" aria-label={t("Arkaya taşı")} title={t("Arkaya taşı")} disabled={i === widgets.length - 1} onClick={() => onMove(w.id, i + 2)}>
                  <ChevronRight aria-hidden="true" />
                </button>
                <span className="st-sizes" role="group" aria-label={t("Genişlik")}>
                  {(["s", "m", "l"] as const).map((z) => (
                    <button key={z} type="button" aria-pressed={w.size === z} title={z === "s" ? t("Çeyrek") : z === "m" ? t("Yarım") : t("Tam genişlik")} onClick={() => onResize(w.id, z)}>
                      {z === "s" ? "¼" : z === "m" ? "½" : "1"}
                    </button>
                  ))}
                </span>
                <button type="button" className="st-tool" aria-label={t("Kart ayarları")} title={t("Kart ayarları")} onClick={() => onConfig(w.id)}>
                  <Settings2 aria-hidden="true" />
                </button>
                <button type="button" className="st-tool st-danger" aria-label={t("Kartı kaldır")} title={t("Kartı kaldır")} onClick={() => onRemove(w.id)}>
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            )}
            <WidgetView w={w} days={days} channels={channels} />
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Kart içerikleri ---------------- */

function useStudioLabels() {
  const { t } = useI18n();
  return useMemo(() => {
    const metric: Record<Metric, string> = {
      followers: t("Takipçi"),
      followersDelta: t("Takipçi değişimi"),
      posts: t("Gönderi"),
      interactions: t("Etkileşim"),
      likes: t("Beğeni"),
      comments: t("Yorum"),
      shares: t("Paylaşım"),
      views: t("Gönderi görüntülenmesi"),
      engagementRate: t("Etkileşim oranı"),
      incomingMessages: t("Gelen mesaj"),
      "ins.reach": t("Erişim"),
      "ins.views": t("Hesap görüntülenmesi"),
      "ins.profileViews": t("Profil ziyareti"),
      "ins.websiteClicks": t("Web sitesi tıklaması"),
      "ins.follows": t("Yeni takip"),
      "ins.unfollows": t("Takibi bırakan"),
      "ins.clicks": t("İçerik tıklaması"),
      "ins.saves": t("Kaydetme"),
      "ins.calls": t("Telefon araması"),
      "ins.directions": t("Yol tarifi"),
      "ins.watchMinutes": t("İzlenme süresi (dk)"),
      "ins.engaged": t("Etkileşen hesap"),
    };
    const type: Record<WType, { name: string; desc: string; icon: ReactNode }> = {
      kpi: {
        name: t("Tek ölçü"),
        desc: t("Takipçi, etkileşim, erişim gibi bir değer ve önceki döneme göre fark"),
        icon: <TrendingUp />,
      },
      trend: {
        name: t("Günlük grafik"),
        desc: t("Seçtiğin ölçünün gün gün seyri"),
        icon: <LineChart />,
      },
      networks: {
        name: t("Ağlara göre"),
        desc: t("Her ağın takipçi, gönderi ve etkileşimi"),
        icon: <Table2 />,
      },
      topPosts: {
        name: t("En iyi gönderiler"),
        desc: t("Dönemin en çok etkileşim alan 5 gönderisi"),
        icon: <FileText />,
      },
      kinds: {
        name: t("İçerik türleri"),
        desc: t("Gönderi, reel, video… başına ortalama etkileşim"),
        icon: <BarChart3 />,
      },
      hashtags: {
        name: t("Hashtag'ler"),
        desc: t("En çok etkileşim getiren hashtag'ler"),
        icon: <Hash />,
      },
      heatmap: {
        name: t("En iyi saatler"),
        desc: t("Gün ve saate göre ortalama etkileşim ısı haritası"),
        icon: <Clock />,
      },
      audience: {
        name: t("Kitle"),
        desc: t("Takipçilerin ülkelere göre dağılımı"),
        icon: <Globe2 />,
      },
      ads: {
        name: t("Reklamlar"),
        desc: t("Bağlı reklam hesabının harcama, tıklama ve dönüşümü"),
        icon: <Megaphone />,
      },
      competitors: {
        name: t("Rakipler"),
        desc: t("Takip ettiğin hesapların etkileşim oranı karşılaştırması"),
        icon: <Users />,
      },
      note: {
        name: t("Not"),
        desc: t("Hedef, yorum ya da ekip için açıklama"),
        icon: <StickyNote />,
      },
    };
    return { metric, type };
  }, [t]);
}

function WidgetView({ w, days, channels }: { w: Widget; days: number; channels: Channel[] }) {
  const { t } = useI18n();
  const L = useStudioLabels();
  const scope = w.channelId ? (channels.find((c) => c.id === w.channelId)?.name ?? t("Kanal")) : w.provider ? PROVIDER_NAME[w.provider] : t("Tüm hesaplar");
  const title = w.title || (w.type === "kpi" || w.type === "trend" ? L.metric[w.metric ?? "followers"] : L.type[w.type].name);
  const sub = SCOPED.includes(w.type) ? `${scope} · ${t("son {n} gün", { n: days })}` : w.type === "note" ? undefined : t("son {n} gün", { n: days });
  if (w.type === "note") return <NoteWidget title={w.title || ""} text={w.text ?? ""} />;
  if (w.type === "ads") return <AdsWidget title={title} sub={sub} days={days} />;
  if (w.type === "competitors") return <CompetitorsWidget title={title} sub={sub} days={days} provider={w.provider} />;
  return <ReportWidget w={w} days={days} title={title} sub={sub!} />;
}

function Loading({ title, sub }: { title: string; sub?: string }) {
  const { t } = useI18n();
  return (
    <ChartCard title={title} sub={sub}>
      <p className="muted small">{t("Yükleniyor…")}</p>
    </ChartCard>
  );
}

function ReportWidget({ w, days, title, sub }: { w: Widget; days: number; title: string; sub: string }) {
  const { t, intl } = useI18n();
  const { kind } = usePostLabels();
  const f = useFmt();
  const q = useReport(days, w);
  const d = q.data;
  const num = (n: Num) => fmtNum(n, intl);
  const compact = (n: number) => fmtCompact(n, intl);
  if (!d) return w.type === "kpi" ? <div className="st st-loading">{title}</div> : <Loading title={title} sub={sub} />;
  const dates = d.daily.map((x) => x.date);
  const nothing = (msg = t("Bu kapsamda veri yok.")) => (
    <ChartCard title={title} sub={sub}>
      <p className="muted small">{msg}</p>
    </ChartCard>
  );

  if (w.type === "kpi") {
    const m = w.metric ?? "followers";
    const k = m.startsWith("ins.") ? d.insights.kpis[m.slice(4) as InsightKey] : d.kpis[m as keyof AnalyticsReport["kpis"]];
    const v = k?.value ?? null;
    const value = v === null ? "—" : m === "engagementRate" ? fmtPct(v, intl) : m === "followersDelta" ? new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(v) : compact(v);
    return <StatTile label={title} value={value} delta={k ? delta(k.value, k.prev) : null} compare note={sub} upIsGood={m !== "ins.unfollows"} />;
  }

  if (w.type === "trend") {
    const m = w.metric ?? "followers";
    const values: Num[] = m.startsWith("ins.")
      ? (d.insights.daily[m.slice(4) as InsightKey] ?? [])
      : m === "followers"
        ? d.daily.map((x) => x.followers)
        : d.daily.map((x) => (x as unknown as Record<string, number>)[m] ?? null);
    if (!values.some((v) => v !== null && v !== 0)) return nothing();
    const bar = m === "posts";
    return (
      <ChartCard title={title} sub={sub} table={() => <SimpleTable caption={title} head={[t("Gün"), title]} rows={dates.map((x, i) => [fmtDay(x, intl), num(values[i] ?? null)])} />}>
        <TimeChart
          kind={bar ? "bar" : "line"}
          area={!bar}
          zeroBaseline={m !== "followers"}
          dates={dates}
          format={compact}
          ariaLabel={t("{m}, günlük", { m: title })}
          height={w.size === "l" ? 220 : 180}
          series={[{ key: m, label: title, color: seriesVar(1), values }]}
        />
      </ChartCard>
    );
  }

  if (w.type === "networks") {
    const rows = d.byProvider.filter((p) => p.channels > 0);
    if (!rows.length) return nothing();
    return (
      <ChartCard title={title} sub={sub}>
        <div className="table-wrap">
          <table className="table st-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Ağ")}</th>
                <th scope="col">{t("Takipçi")}</th>
                <th scope="col">{t("Değişim")}</th>
                <th scope="col">{t("Gönderi")}</th>
                <th scope="col">{t("Etkileşim")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.provider}>
                  <th scope="row">
                    <span className="st-net">
                      <ProviderIcon provider={p.provider} size={20} /> {PROVIDER_NAME[p.provider]}
                    </span>
                  </th>
                  <td>{num(p.followers)}</td>
                  <td>
                    {p.followersDelta === null
                      ? "—"
                      : new Intl.NumberFormat(intl, {
                          signDisplay: "exceptZero",
                        }).format(p.followersDelta)}
                  </td>
                  <td>{num(p.posts)}</td>
                  <td>{num(p.interactions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    );
  }

  if (w.type === "topPosts") {
    const top = d.posts
      .filter((p) => p.interactions !== null)
      .sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0))
      .slice(0, 5);
    if (!top.length) return nothing(t("Bu dönemde metriği olan gönderi yok."));
    return (
      <ChartCard title={title} sub={sub}>
        <ol className="st-posts">
          {top.map((p) => (
            <li key={p.targetId}>
              {p.provider && <ProviderIcon provider={p.provider} size={22} />}
              <span className="st-post-main">
                <span className="st-post-text">{p.preview || t("(metin yok)")}</span>
                <span className="muted small">
                  {kind(p.kind)} · {p.publishedAt ? f.day(p.publishedAt) : "—"}
                </span>
              </span>
              <span className="st-post-num">
                <strong>{compact(p.interactions ?? 0)}</strong>
                <span className="muted small">{t("etkileşim")}</span>
              </span>
              {p.url && (
                <a href={p.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" aria-label={t("Gönderiyi aç")}>
                  <ExternalLink aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ol>
      </ChartCard>
    );
  }

  if (w.type === "kinds") {
    const rows = d.kinds.filter((k) => k.withMetrics > 0);
    if (!rows.length) return nothing();
    return (
      <ChartCard title={title} sub={sub} table={() => <SimpleTable caption={title} head={[t("Tür"), t("Gönderi"), t("Ort. etkileşim")]} rows={rows.map((k) => [kind(k.kind), num(k.posts), num(k.avgInteractions)])} />}>
        <BarList
          format={num}
          rows={[...rows]
            .sort((a, b) => (b.avgInteractions ?? 0) - (a.avgInteractions ?? 0))
            .map((k) => ({
              key: k.kind,
              label: kind(k.kind),
              value: k.avgInteractions,
              meta: t("{n} gönderi", { n: k.posts }),
            }))}
        />
      </ChartCard>
    );
  }

  if (w.type === "hashtags") {
    const rows = [...d.hashtags].sort((a, b) => b.interactions - a.interactions).slice(0, 8);
    if (!rows.length) return nothing(t("Bu dönemde hashtag'li gönderi yok."));
    return (
      <ChartCard title={title} sub={sub} table={() => <SimpleTable caption={title} head={[t("Hashtag"), t("Gönderi"), t("Etkileşim")]} rows={rows.map((h) => [h.tag, num(h.posts), num(h.interactions)])} />}>
        <BarList
          format={compact}
          color="var(--series-3)"
          rows={rows.map((h) => ({
            key: h.tag,
            label: h.tag,
            value: h.interactions,
            meta: t("{n} gönderi", { n: h.posts }),
          }))}
        />
      </ChartCard>
    );
  }

  if (w.type === "heatmap") {
    if (!d.heatmap.cells.some((c) => c.posts > 0)) return nothing();
    return (
      <ChartCard title={title} sub={sub}>
        <Heatmap cells={d.heatmap.cells} maxAvg={d.heatmap.maxAvg} format={num} />
      </ChartCard>
    );
  }

  if (w.type === "audience") {
    const a = d.audience;
    if (!a || !a.country.length) return nothing(t("Kitle verisi yok (Instagram, Facebook ya da YouTube insights izni gerekir)."));
    const total = a.country.reduce((s2, r) => s2 + r.value, 0);
    let regionName = (c: string) => c;
    try {
      const dn = new Intl.DisplayNames([intl], { type: "region" });
      regionName = (c: string) => (/^[A-Z]{2}$/.test(c) ? (dn.of(c) ?? c) : c);
    } catch {
      /* eski tarayıcı */
    }
    return (
      <ChartCard title={title} sub={sub}>
        <BarList
          format={num}
          rows={a.country.slice(0, 6).map((r) => ({
            key: r.key,
            label: regionName(r.key),
            value: r.value,
            meta: total ? fmtPct((r.value / total) * 100, intl) : undefined,
          }))}
        />
      </ChartCard>
    );
  }
  return null;
}

function NoteWidget({ title, text }: { title: string; text: string }) {
  const { t } = useI18n();
  return (
    <section className="card cc st-note-card">
      {title && <h3 className="cc-title">{title}</h3>}
      <p className={text ? "st-note-text" : "st-note-text muted"}>{text || t("Boş not: kart ayarlarından metin yaz.")}</p>
    </section>
  );
}

interface AdsMini {
  accounts: Array<{ id: string; name: string; currency: string | null }>;
  account: { id: string; name: string; currency: string | null } | null;
  totals: Record<string, Num> | null;
  prev: Record<string, Num> | null;
  daily: Array<{ date: string; spend: Num }>;
}
function AdsWidget({ title, sub, days }: { title: string; sub?: string; days: number }) {
  const { t, intl } = useI18n();
  const q = useQuery({
    queryKey: ["ads", days, null],
    queryFn: () => api.get<AdsMini>(`/api/ads/report?days=${days}`),
    staleTime: 60_000,
  });
  const d = q.data;
  if (!d) return <Loading title={title} sub={sub} />;
  if (!d.account || !d.totals)
    return (
      <ChartCard title={title} sub={sub}>
        <p className="muted small">
          {t("Bağlı reklam hesabı yok.")} <Link to="/app/analytics/ads">{t("Reklam hesabı bağla")}</Link>
        </p>
      </ChartCard>
    );
  const money = (n: Num) =>
    n === null
      ? "—"
      : new Intl.NumberFormat(intl, {
          style: "currency",
          currency: d.account?.currency || "TRY",
          maximumFractionDigits: 0,
        }).format(n);
  const k = d.totals;
  const p = d.prev ?? {};
  const cells: Array<[string, string, Num, Num, boolean]> = [
    [t("Harcama"), money(k.spend), k.spend, p.spend ?? null, false],
    [t("Tıklama"), fmtCompact(k.clicks, intl), k.clicks, p.clicks ?? null, true],
    [t("TO (CTR)"), fmtPct(k.ctr, intl), k.ctr, p.ctr ?? null, true],
    [t("Dönüşüm"), fmtCompact(k.conversions, intl), k.conversions, p.conversions ?? null, true],
  ];
  return (
    <ChartCard
      title={title}
      sub={`${d.account.name} · ${sub ?? ""}`}
      actions={
        <Link className="btn btn-ghost btn-sm" to="/app/analytics/ads">
          {t("Ayrıntı")}
        </Link>
      }
    >
      <div className="st-mini">
        {cells.map(([label, value, v, pv, up]) => (
          <StatTile key={label} label={label} value={value} delta={delta(v, pv)} compare upIsGood={up} />
        ))}
      </div>
      <TimeChart
        kind="bar"
        dates={d.daily.map((x) => x.date)}
        format={(n) => money(n)}
        ariaLabel={t("Günlük harcama")}
        height={140}
        series={[
          {
            key: "spend",
            label: t("Harcama"),
            color: seriesVar(1),
            values: d.daily.map((x) => x.spend),
          },
        ]}
      />
    </ChartCard>
  );
}

interface CmpMini {
  items: Array<{
    id: string;
    provider?: string;
    username: string;
    followers: Num;
    engagementRate: Num;
    avgViews?: Num;
  }>;
  self: Array<{
    channelId: string;
    provider?: string;
    username: string;
    followers: Num;
    engagementRate: Num;
    avgViews?: Num;
  }>;
}
function CompetitorsWidget({ title, sub, days, provider }: { title: string; sub?: string; days: number; provider?: ProviderId | null }) {
  const { t, intl } = useI18n();
  const net = provider === "youtube" || provider === "bluesky" || provider === "facebook" || provider === "twitch" ? provider : "instagram";
  const q = useQuery({
    queryKey: ["competitors", days],
    queryFn: () => api.get<CmpMini>(`/api/competitors?days=${days}`),
    staleTime: 60_000,
  });
  const d = q.data;
  if (!d) return <Loading title={title} sub={sub} />;
  const own = (x: { provider?: string }) => (x.provider ?? "instagram") === net;
  // Twitch beğeni/yorum vermez: ortalama izlenme karşılaştırılır
  const views = net === "twitch";
  const val = (x: { engagementRate: Num; avgViews?: Num }) => (views ? (x.avgViews ?? null) : x.engagementRate);
  const rows = [
    ...d.self.filter(own).map((x) => ({
      key: `s-${x.channelId}`,
      label: `${x.username} (${t("sen")})`,
      value: val(x),
      self: true,
      followers: x.followers,
    })),
    ...d.items.filter(own).map((x) => ({
      key: x.id,
      label: `@${x.username}`,
      value: val(x),
      self: false,
      followers: x.followers,
    })),
  ].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  if (!d.items.some(own))
    return (
      <ChartCard title={title} sub={sub}>
        <p className="muted small">
          {t("Bu ağda takip edilen rakip yok.")} <Link to="/app/analytics/competitors">{t("Rakip ekle")}</Link>
        </p>
      </ChartCard>
    );
  return (
    <ChartCard title={title} sub={`${PROVIDER_NAME[net as ProviderId]} · ${views ? t("ortalama izlenme") : t("etkileşim oranı")}`}>
      <BarList
        format={(n) => (views ? fmtCompact(n, intl) : fmtPct(n, intl))}
        rows={rows.slice(0, 7).map((r) => ({
          key: r.key,
          label: r.label,
          value: r.value,
          color: r.self ? "var(--series-1)" : "var(--series-other)",
          meta: r.followers !== null ? t("{n} takipçi", { n: fmtCompact(r.followers, intl) }) : undefined,
        }))}
      />
    </ChartCard>
  );
}

/* ---------------- Diyaloglar ---------------- */

function AddWidget({ onClose, onAdd }: { onClose: () => void; onAdd: (type: WType) => void }) {
  const { t } = useI18n();
  const L = useStudioLabels();
  return (
    <Modal title={t("Kart ekle")} onClose={onClose} large>
      <ul className="st-catalog">
        {(Object.keys(L.type) as WType[]).map((k) => (
          <li key={k}>
            <button type="button" className="st-cat" onClick={() => onAdd(k)}>
              <span className="st-cat-icon" aria-hidden="true">
                {L.type[k].icon}
              </span>
              <span>
                <strong>{L.type[k].name}</strong>
                <span className="muted small">{L.type[k].desc}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ConfigWidget({ w, channels, onClose, onChange }: { w: Widget; channels: Channel[]; onClose: () => void; onChange: (patch: Partial<Widget>) => void }) {
  const { t } = useI18n();
  const L = useStudioLabels();
  const providers = [...new Set(channels.map((c) => c.provider))] as ProviderId[];
  const scope = w.channelId ? `c:${w.channelId}` : w.provider ? `p:${w.provider}` : "";
  const metrics = w.type === "kpi" ? KPI_METRICS : TREND_METRICS;
  return (
    <Modal
      title={t("{type} kartı", { type: L.type[w.type].name })}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          {t("Tamam")}
        </button>
      }
    >
      <div className="st-form">
        <div className="field">
          <label htmlFor="stw-title">{t("Başlık")}</label>
          <input
            id="stw-title"
            className="input"
            value={w.title ?? ""}
            maxLength={80}
            placeholder={w.type === "kpi" || w.type === "trend" ? L.metric[w.metric ?? "followers"] : L.type[w.type].name}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
        {(w.type === "kpi" || w.type === "trend") && (
          <div className="field">
            <label htmlFor="stw-metric">{t("Ölçü")}</label>
            <select id="stw-metric" className="select" value={w.metric ?? "followers"} onChange={(e) => onChange({ metric: e.target.value as Metric })}>
              <optgroup label={t("Gönderi ve takipçi")}>
                {metrics
                  .filter((m) => !m.startsWith("ins."))
                  .map((m) => (
                    <option key={m} value={m}>
                      {L.metric[m]}
                    </option>
                  ))}
              </optgroup>
              <optgroup label={t("Hesap insights")}>
                {metrics
                  .filter((m) => m.startsWith("ins."))
                  .map((m) => (
                    <option key={m} value={m}>
                      {L.metric[m]}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
        )}
        {SCOPED.includes(w.type) && (
          <div className="field">
            <label htmlFor="stw-scope">{t("Kapsam")}</label>
            <select
              id="stw-scope"
              className="select"
              value={scope}
              onChange={(e) => {
                const v = e.target.value;
                onChange(v.startsWith("c:") ? { channelId: v.slice(2), provider: null } : v.startsWith("p:") ? { provider: v.slice(2) as ProviderId, channelId: null } : { provider: null, channelId: null });
              }}
            >
              <option value="">{t("Tüm hesaplar")}</option>
              <optgroup label={t("Ağ")}>
                {providers.map((p) => (
                  <option key={p} value={`p:${p}`}>
                    {PROVIDER_NAME[p]}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("Kanal")}>
                {channels.map((c) => (
                  <option key={c.id} value={`c:${c.id}`}>
                    {PROVIDER_NAME[c.provider]} · {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        )}
        {w.type === "competitors" && (
          <div className="field">
            <label htmlFor="stw-net">{t("Ağ")}</label>
            <select id="stw-net" className="select" value={w.provider ?? "instagram"} onChange={(e) => onChange({ provider: e.target.value as ProviderId })}>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="youtube">YouTube</option>
              <option value="twitch">Twitch</option>
              <option value="bluesky">Bluesky</option>
            </select>
          </div>
        )}
        {w.type === "note" && (
          <div className="field">
            <label htmlFor="stw-text">{t("Metin")}</label>
            <textarea id="stw-text" className="input" rows={6} maxLength={2000} value={w.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function CreateDashboard({ pending, onClose, onCreate }: { pending: boolean; onClose: () => void; onCreate: (name: string, template: "overview" | "blank") => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<"overview" | "blank">("blank");
  return (
    <Modal
      title={t("Yeni pano")}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button className="btn btn-primary" disabled={!name.trim() || pending} onClick={() => onCreate(name.trim(), template)}>
            {t("Oluştur")}
          </button>
        </>
      }
    >
      <div className="st-form">
        <div className="field">
          <label htmlFor="st-new-name">{t("Pano adı")}</label>
          <input id="st-new-name" className="input" autoFocus value={name} maxLength={80} placeholder={t("ör. Aylık müşteri raporu")} onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset className="st-radios">
          <legend>{t("Başlangıç")}</legend>
          <label>
            <input type="radio" name="tpl" checked={template === "blank"} onChange={() => setTemplate("blank")} /> {t("Boş pano")}
          </label>
          <label>
            <input type="radio" name="tpl" checked={template === "overview"} onChange={() => setTemplate("overview")} /> {t("Hazır özet (4 ölçü, takipçi grafiği, ağlar, en iyi gönderiler)")}
          </label>
        </fieldset>
      </div>
    </Modal>
  );
}

/** Panoyu zamanlı e-postayla gönderme ayarı + test e-postası */
function EmailDashboard({ d, onClose, onSaved }: { d: Dashboard; onClose: () => void; onSaved: (d: Dashboard) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [freq, setFreq] = useState<"off" | "weekly" | "monthly">(d.email?.freq ?? "off");
  const [recipients, setRecipients] = useState(d.email?.recipients ?? "");
  const save = useMutation({
    mutationFn: () => api.patch<Dashboard>(`/api/dashboards/${d.id}`, { email: { freq, recipients } }),
    onSuccess: (x) => {
      onSaved(x);
      toast(t("E-posta ayarı kaydedildi"), "ok");
      onClose();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ sent: boolean; to: string }>(`/api/dashboards/${d.id}/test-email`),
    onSuccess: (r) => toast(r.sent ? t("Test e-postası {to} adresine gönderildi", { to: r.to }) : t("E-posta sunucusu tanımlı değil; içerik sunucu günlüğüne yazıldı"), r.sent ? "ok" : "err"),
    onError: (e) => toast(errMsg(e), "err"),
  });
  return (
    <Modal
      title={t("“{name}” panosunu e-postayla gönder", { name: d.name })}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => test.mutate()} disabled={test.isPending}>
            {t("Bana test e-postası gönder")}
          </button>
          <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {t("Kaydet")}
          </button>
        </>
      }
    >
      <div className="st-form">
        <div className="field">
          <span className="st-radios-l" id="st-freq">
            {t("Sıklık")}
          </span>
          <div className="segmented" role="group" aria-labelledby="st-freq">
            {(["off", "weekly", "monthly"] as const).map((f) => (
              <button key={f} type="button" className={freq === f ? "active" : ""} aria-pressed={freq === f} onClick={() => setFreq(f)}>
                {f === "off" ? t("Kapalı") : f === "weekly" ? t("Haftalık") : t("Aylık")}
              </button>
            ))}
          </div>
          <span className="help">{t("Haftalık: her pazartesi önceki haftayı; aylık: her ayın 1'inde önceki ayı gönderir (çalışma alanı saatiyle 09:00'dan sonra).")}</span>
        </div>
        <div className="field">
          <label htmlFor="st-rcpt">{t("Alıcılar")}</label>
          <input id="st-rcpt" className="input" value={recipients} maxLength={1000} placeholder={t("ornek@firma.com, musteri@firma.com")} onChange={(e) => setRecipients(e.target.value)} />
          <span className="help">{t("Virgülle ayır, en fazla 10 adres. Boş bırakırsan çalışma alanının sahip ve yöneticilerine gider.")}</span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {t("E-postada kartların dönem değerleri, önceki döneme göre değişim ve listeler yer alır; grafiklerin tamamı panoya verilen bağlantıda görünür. Marka rengi ve logo Analitik > Rapor ayarlarından gelir.")}
        </p>
      </div>
    </Modal>
  );
}
