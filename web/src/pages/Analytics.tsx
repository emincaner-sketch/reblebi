import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api, PROVIDER_LABEL, type ProviderId } from "../lib/api";
import { Avatar, Empty, ProviderIcon, Sparkline, Stat, useToast } from "../components/ui";

interface Overview {
  days: number;
  channels: Array<{ channelId: string; name: string; provider: ProviderId; avatarUrl: string | null; latest: Record<string, number>; followersDelta: number; series: Array<Record<string, number | string>>; supported: boolean }>;
  postsByProvider: Record<string, { published: number; failed: number }>;
  posts: { scheduled: number; published: number; failed: number; draft: number; publishedLast7: number };
  inbox: { open: number; unread: number; attention: number; inLast7: number; autoRepliedLast7: number };
}

const METRIC_LABEL: Record<string, string> = { followers: "Takipçi", posts: "İçerik", reach: "Erişim", engagement: "Etkileşim", likes: "Beğeni", views: "Görüntülenme", following: "Takip", replies: "Yanıt" };

export default function AnalyticsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["analytics", days], queryFn: () => api.get<Overview>(`/api/analytics/overview?days=${days}`) });
  const refresh = useMutation({
    mutationFn: () => api.post("/api/analytics/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["analytics"] });
      toast("Metrikler platformlardan yenilendi", "ok");
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Hata", "err"),
  });
  const d = q.data;
  const totalFollowers = d?.channels.reduce((a, c) => a + (c.latest.followers ?? 0), 0) ?? 0;
  const autoRate = d && d.inbox.inLast7 > 0 ? Math.round((d.inbox.autoRepliedLast7 / d.inbox.inLast7) * 100) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analitik</h1>
          <p>Takipçi büyümesi, yayın başarı oranı ve DM otomasyon performansı. Anlık görüntüler saatte bir alınır.</p>
        </div>
        <div className="page-actions">
          <div className="segmented">
            {[7, 30, 90].map((n) => <button key={n} className={days === n ? "active" : ""} onClick={() => setDays(n)}>{n} gün</button>)}
          </div>
          <button className="btn" onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshCw className={refresh.isPending ? "spin" : ""} /> Şimdi çek</button>
        </div>
      </div>

      {d && (
        <>
          <div className="grid grid-4">
            <Stat label="Toplam takipçi" value={totalFollowers.toLocaleString("tr-TR")} sub={`${d.channels.length} kanal`} />
            <Stat label="Yayınlanan" value={d.posts.published} sub={`${d.posts.publishedLast7} son 7 gün`} />
            <Stat label="Yayın hatası" value={d.posts.failed} sub={d.posts.failed ? "Gönderiler sayfasında detay" : "temiz"} />
            <Stat label="Otomatik yanıt oranı" value={`%${autoRate}`} sub={`${d.inbox.autoRepliedLast7}/${d.inbox.inLast7} mesaj (7 gün)`} />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title"><h2>Kanallar</h2></div>
            {d.channels.length === 0 ? (
              <Empty title="Kanal yok" />
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Kanal</th><th>Takipçi</th><th>Değişim</th><th>Diğer</th><th style={{ width: 220 }}>Trend</th></tr>
                </thead>
                <tbody>
                  {d.channels.map((c) => (
                    <tr key={c.channelId}>
                      <td>
                        <span className="row">
                          <span style={{ position: "relative" }}>
                            <Avatar name={c.name} url={c.avatarUrl} size={30} />
                            <span style={{ position: "absolute", right: -4, bottom: -4 }}><ProviderIcon provider={c.provider} size={14} /></span>
                          </span>
                          <span><div style={{ fontWeight: 600 }}>{c.name}</div><div className="muted small">{PROVIDER_LABEL[c.provider]}</div></span>
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, fontSize: 16 }}>{c.supported ? (c.latest.followers ?? 0).toLocaleString("tr-TR") : <span className="muted small">API vermiyor</span>}</td>
                      <td>{c.followersDelta !== 0 && <span className={`badge ${c.followersDelta > 0 ? "badge-ok" : "badge-err"}`}>{c.followersDelta > 0 ? "+" : ""}{c.followersDelta}</span>}</td>
                      <td className="small muted">
                        {Object.entries(c.latest).filter(([k]) => k !== "followers").map(([k, v]) => `${METRIC_LABEL[k] ?? k}: ${v.toLocaleString("tr-TR")}`).join(" · ") || "-"}
                      </td>
                      <td><Sparkline values={c.series.map((s) => Number(s.followers ?? 0))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title"><h2>Platform bazında yayın ({d.days} gün)</h2></div>
            {Object.keys(d.postsByProvider).length === 0 ? (
              <Empty title="Bu aralıkta yayın yok" />
            ) : (
              <div className="grid grid-3">
                {Object.entries(d.postsByProvider).map(([p, v]) => {
                  const total = v.published + v.failed;
                  const rate = total ? Math.round((v.published / total) * 100) : 0;
                  return (
                    <div key={p} className="preview">
                      <div className="preview-head"><ProviderIcon provider={p as ProviderId} size={22} /><strong>{PROVIDER_LABEL[p as ProviderId] ?? p}</strong><span className="badge" style={{ marginLeft: "auto" }}>%{rate} başarı</span></div>
                      <div style={{ height: 8, background: "var(--bg-3)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: `${rate}%`, height: "100%", background: rate >= 90 ? "var(--ok)" : rate >= 60 ? "var(--warn)" : "var(--err)" }} />
                      </div>
                      <div className="muted small" style={{ marginTop: 6 }}>{v.published} yayınlandı · {v.failed} hata</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
