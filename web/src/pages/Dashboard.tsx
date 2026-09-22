import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, Inbox, Sparkles } from "lucide-react";
import { api, fmtDate, KIND_LABEL, timeAgo, type Channel, type Dashboard } from "../lib/api";
import { Empty, ProviderIcon, Stat, StatusBadge } from "../components/ui";

export default function DashboardPage() {
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/api/dashboard"), refetchInterval: 30_000 });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const d = dash.data;
  const chMap = new Map((channels.data ?? []).map((c) => [c.id, c]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Panel</h1>
          <p>Bugün ne oluyor: planlanan gönderiler, gelen mesajlar ve kanal sağlığı.</p>
        </div>
        <div className="page-actions">
          <Link to="/gonderiler/yeni" className="btn btn-primary"><CalendarPlus /> Yeni gönderi</Link>
          <Link to="/gelen-kutusu" className="btn"><Inbox /> Gelen kutusu</Link>
        </div>
      </div>

      {!d ? (
        <div className="grid grid-4">{[0, 1, 2, 3].map((i) => <div key={i} className="card"><div className="skeleton" /></div>)}</div>
      ) : (
        <>
          {!d.ai && (
            <div className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
              <Sparkles style={{ color: "var(--warn)" }} />
              <div>
                <strong>AI kapalı.</strong> <span className="muted">.env dosyasına <code>ANTHROPIC_API_KEY</code> ekleyince içerik üretimi ve AI DM yanıtları açılır.</span>
              </div>
            </div>
          )}
          {d.channels.problem > 0 && (
            <div className="card" style={{ borderColor: "var(--err)", marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
              <AlertTriangle style={{ color: "var(--err)" }} />
              <div>
                <strong>{d.channels.problem} kanalda bağlantı sorunu var.</strong> <Link to="/kanallar">Kanallar sayfasından</Link> yeniden bağla.
              </div>
            </div>
          )}
          <div className="grid grid-4">
            <Stat label="Bağlı kanal" value={d.channels.total} sub={`${d.channels.active} aktif`} />
            <Stat label="Planlanan" value={d.posts.scheduled} sub={`${d.posts.draft} taslak`} />
            <Stat label="Son 7 gün yayın" value={d.posts.publishedLast7} sub={d.posts.failed > 0 ? <span style={{ color: "var(--err)" }}>{d.posts.failed} başarısız</span> : "sorunsuz"} />
            <Stat label="Okunmamış DM" value={d.inbox.unread} sub={d.inbox.attention > 0 ? <span style={{ color: "var(--warn)" }}>{d.inbox.attention} dikkat bekliyor</span> : `${d.inbox.autoRepliedLast7} otomatik yanıt / 7 gün`} />
          </div>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="card-title">
                <h2>Önümüzdeki 24 saat</h2>
                <Link to="/gonderiler" className="small">Takvim →</Link>
              </div>
              {d.upcoming.length === 0 ? (
                <Empty title="Planlı gönderi yok" text="Yeni gönderi oluşturup tarih seç." />
              ) : (
                <table className="table">
                  <tbody>
                    {d.upcoming.map((p) => (
                      <tr key={p.id}>
                        <td style={{ width: 120 }} className="muted small">{fmtDate(p.publishAt, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</td>
                        <td>
                          <Link to={`/gonderiler/${p.id}`} className="truncate" style={{ display: "block", maxWidth: 320, color: "inherit" }}>
                            <span className="badge" style={{ marginRight: 6 }}>{KIND_LABEL[p.kind]}</span>
                            {p.title || p.content || "(metin yok)"}
                          </Link>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                            {p.targets.map((t) => {
                              const c = chMap.get(t.channelId);
                              return c ? <ProviderIcon key={t.id} provider={c.provider} size={20} /> : null;
                            })}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card">
              <div className="card-title">
                <h2>Son yayınlar</h2>
              </div>
              {d.recent.length === 0 ? (
                <Empty title="Henüz yayın yok" />
              ) : (
                <table className="table">
                  <tbody>
                    {d.recent.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link to={`/gonderiler/${p.id}`} className="truncate" style={{ display: "block", maxWidth: 300, color: "inherit" }}>{p.title || p.content || "(metin yok)"}</Link>
                          <div className="muted small">{fmtDate(p.publishedAt ?? p.updatedAt)}</div>
                        </td>
                        <td style={{ textAlign: "right" }}><StatusBadge status={p.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title"><h2>Son aktivite</h2></div>
            {d.activity.length === 0 ? (
              <Empty title="Henüz aktivite yok" />
            ) : (
              <div className="activity">
                {d.activity.map((a) => (
                  <div key={a.id} className="activity-item">
                    <span className="dot" style={{ color: a.level === "error" ? "var(--err)" : a.level === "warn" ? "var(--warn)" : "var(--ok)" }} />
                    <div>
                      <div>{a.message}</div>
                      <div className="when">{a.source} · {timeAgo(a.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
