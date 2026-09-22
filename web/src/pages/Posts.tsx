import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, Copy, Play, Trash2, XCircle, ExternalLink } from "lucide-react";
import { api, fmtDate, KIND_LABEL, STATUS_LABEL, type Channel, type Post, type PostStatus } from "../lib/api";
import { Empty, ProviderIcon, StatusBadge, useLocalState, useToast } from "../components/ui";

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

function monthRange(base: Date): { start: Date; end: Date; cells: Date[] } {
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7; // Pazartesi başlangıç
  const start = new Date(first);
  start.setDate(first.getDate() - startOffset);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return { start, end: cells[41], cells };
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function PostsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [view, setView] = useLocalState<"calendar" | "list">("sp_posts_view", "calendar");
  const [month, setMonth] = useState(() => new Date());
  const [filter, setFilter] = useState<PostStatus | "all">("all");
  const { start, end, cells } = useMemo(() => monthRange(month), [month]);

  const posts = useQuery({
    queryKey: ["posts", view, view === "calendar" ? start.toISOString() : filter],
    queryFn: () =>
      api.get<Post[]>(
        view === "calendar"
          ? `/api/posts?from=${start.toISOString()}&to=${new Date(end.getTime() + 86400_000).toISOString()}&limit=500`
          : `/api/posts?limit=300${filter !== "all" ? `&status=${filter}` : ""}`,
      ),
    refetchInterval: 20_000,
  });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const chMap = new Map((channels.data ?? []).map((c) => [c.id, c]));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["posts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const publishNow = useMutation({
    mutationFn: (id: string) => api.post<Post>(`/api/posts/${id}/publish`),
    onSuccess: (p) => {
      toast(p.status === "published" ? "Yayınlandı" : p.status === "partial" ? "Kısmen yayınlandı, detaya bak" : "Yayın başarısız, detaya bak", p.status === "published" ? "ok" : "err");
      invalidate();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Hata", "err"),
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/api/posts/${id}/cancel`), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/posts/${id}`), onSuccess: invalidate });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<Post>(`/api/posts/${id}/duplicate`),
    onSuccess: (p) => nav(`/gonderiler/${p.id}`),
  });

  const today = new Date();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Gönderiler & Takvim</h1>
          <p>Planlanan, yayınlanan ve taslak içerikler. Bir öğeye tıklayarak düzenle.</p>
        </div>
        <div className="page-actions">
          <div className="segmented">
            <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>Takvim</button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Liste</button>
          </div>
          <Link to="/gonderiler/yeni" className="btn btn-primary"><CalendarPlus /> Yeni gönderi</Link>
        </div>
      </div>

      {view === "calendar" ? (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <div className="row">
              <button className="btn btn-icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></button>
              <h2 style={{ minWidth: 160, textAlign: "center" }}>{new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(month)}</h2>
              <button className="btn btn-icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></button>
              <button className="btn btn-sm" onClick={() => setMonth(new Date())}>Bugün</button>
            </div>
            <div className="row small muted">
              <span className="row" style={{ gap: 4 }}><span className="dot" style={{ color: "var(--accent)" }} /> Planlı</span>
              <span className="row" style={{ gap: 4 }}><span className="dot" style={{ color: "var(--ok)" }} /> Yayınlandı</span>
              <span className="row" style={{ gap: 4 }}><span className="dot" style={{ color: "var(--err)" }} /> Hatalı</span>
            </div>
          </div>
          <div className="cal-head">{DAYS.map((d) => <div key={d}>{d}</div>)}</div>
          <div className="cal-grid">
            {cells.map((d) => {
              const items = (posts.data ?? []).filter((p) => sameDay(new Date(p.publishAt ?? p.createdAt), d));
              return (
                <div
                  key={d.toISOString()}
                  className={`cal-day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${sameDay(d, today) ? "today" : ""}`}
                  onDoubleClick={() => nav(`/gonderiler/yeni?tarih=${new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0).toISOString()}`)}
                  title="Çift tık: bu güne gönderi planla"
                >
                  <span className="num">{d.getDate()}</span>
                  {items.slice(0, 4).map((p) => (
                    <div key={p.id} className={`cal-item ${p.status}`} onClick={() => nav(`/gonderiler/${p.id}`)}>
                      <span className="t">{fmtDate(p.publishAt ?? p.createdAt, { hour: "2-digit", minute: "2-digit" })}</span>
                      {p.targets.slice(0, 3).map((t) => {
                        const c = chMap.get(t.channelId);
                        return c ? <span key={t.id} style={{ marginRight: 3 }}><ProviderIcon provider={c.provider} size={13} /></span> : null;
                      })}
                      <span className="truncate" style={{ display: "block" }}>{p.title || p.content || KIND_LABEL[p.kind]}</span>
                    </div>
                  ))}
                  {items.length > 4 && <span className="small muted">+{items.length - 4} daha</span>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <select className="select" style={{ width: 200 }} value={filter} onChange={(e) => setFilter(e.target.value as PostStatus | "all")}>
              <option value="all">Tüm durumlar</option>
              {(Object.keys(STATUS_LABEL) as PostStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          {posts.data?.length === 0 ? (
            <Empty title="Gönderi yok" action={<Link to="/gonderiler/yeni" className="btn btn-primary">Yeni gönderi</Link>} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>İçerik</th>
                  <th>Kanallar</th>
                  <th>Tarih</th>
                  <th>Durum</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {posts.data?.map((p) => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 380 }}>
                      <Link to={`/gonderiler/${p.id}`} className="truncate" style={{ display: "block", color: "inherit", fontWeight: 500 }}>{p.title || p.content || "(metin yok)"}</Link>
                      <span className="muted small">{KIND_LABEL[p.kind]}{p.mediaIds.length ? ` · ${p.mediaIds.length} medya` : ""}</span>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 4 }}>
                        {p.targets.map((t) => {
                          const c = chMap.get(t.channelId);
                          if (!c) return null;
                          return (
                            <span key={t.id} title={`${c.name}: ${t.status}${t.error ? " - " + t.error : ""}`} style={{ position: "relative" }}>
                              <ProviderIcon provider={c.provider} size={20} />
                              {t.status === "published" && t.externalUrl && (
                                <a href={t.externalUrl} target="_blank" rel="noreferrer" style={{ position: "absolute", right: -5, top: -5 }}><ExternalLink style={{ width: 10, color: "var(--ok)" }} /></a>
                              )}
                              {t.status === "failed" && <span className="dot" style={{ position: "absolute", right: -3, top: -3, color: "var(--err)", width: 7, height: 7 }} />}
                            </span>
                          );
                        })}
                      </span>
                    </td>
                    <td className="small muted">{fmtDate(p.publishAt ?? p.createdAt)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {(p.status === "draft" || p.status === "scheduled" || p.status === "failed" || p.status === "partial") && (
                        <button className="btn btn-ghost btn-sm" title="Şimdi yayınla" onClick={() => confirm("Şimdi yayınlansın mı?") && publishNow.mutate(p.id)}><Play /></button>
                      )}
                      {p.status === "scheduled" && <button className="btn btn-ghost btn-sm" title="Planı iptal et" onClick={() => cancel.mutate(p.id)}><XCircle /></button>}
                      <button className="btn btn-ghost btn-sm" title="Kopyala" onClick={() => duplicate.mutate(p.id)}><Copy /></button>
                      <button className="btn btn-ghost btn-sm" title="Sil" onClick={() => confirm("Silinsin mi?") && remove.mutate(p.id)}><Trash2 /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
