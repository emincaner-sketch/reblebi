import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api, errMsg, PROVIDER_NAME, type AnalyticsOverview, type ProviderId } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt } from "../lib/session";
import { Avatar, Empty, Loading, PageHead, ProviderIcon, Sparkline, Stat, useToast } from "../components/ui";

const METRIC_LABEL: Record<string, string> = { followers: "Takipçi", posts: "İçerik", reach: "Erişim", engagement: "Etkileşim", likes: "Beğeni", views: "Görüntülenme", following: "Takip", replies: "Yanıt", comments: "Yorum", shares: "Paylaşım" };

export default function AnalyticsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["analytics", days], queryFn: () => api.get<AnalyticsOverview>(`/api/analytics/overview?days=${days}`) });
  const refresh = useMutation({
    mutationFn: () => api.post("/api/analytics/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["analytics"] });
      toast(t("Metrikler platformlardan yenilendi"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const d = q.data;
  const totalFollowers = d?.channels.reduce((a, c) => a + (c.latest.followers ?? 0), 0) ?? 0;
  const autoRate = d && d.inbox.inLast7 > 0 ? Math.round((d.inbox.autoRepliedLast7 / d.inbox.inLast7) * 100) : 0;
  const localHour = (h: number) => new Intl.DateTimeFormat(f.intl, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: f.tz }).format(new Date(Date.UTC(2025, 0, 15, h)));
  const ml = (k: string) => (METRIC_LABEL[k] ? t(METRIC_LABEL[k]) : k);

  return (
    <>
      <PageHead
        title={t("Analitik")}
        sub={t("Takipçi büyümesi, yayın başarı oranı, etkileşim ve DM otomasyon performansı. Anlık görüntüler saatte bir alınır.")}
        actions={
          <>
            <div className="segmented">
              {[7, 30, 90].map((n) => (
                <button key={n} className={days === n ? "active" : ""} onClick={() => setDays(n)}>
                  {t("{n} gün", { n })}
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              <RefreshCw className={refresh.isPending ? "spin" : ""} /> {t("Şimdi çek")}
            </button>
          </>
        }
      />

      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-4">
            <Stat label={t("Toplam takipçi")} value={f.num(totalFollowers)} sub={t("{n} kanal", { n: d.channels.length })} />
            <Stat label={t("Yayınlanan")} value={d.posts.published} sub={t("{n} son 7 gün", { n: d.posts.publishedLast7 })} />
            <Stat label={t("Yayın hatası")} value={d.posts.failed} sub={d.posts.failed ? t("Gönderiler sayfasında detay") : t("temiz")} />
            <Stat label={t("Otomatik yanıt oranı")} value={`%${autoRate}`} sub={t("{a}/{b} mesaj (7 gün)", { a: d.inbox.autoRepliedLast7, b: d.inbox.inLast7 })} />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title">
              <h2>{t("Kanallar")}</h2>
            </div>
            {d.channels.length === 0 ? (
              <Empty title={t("Kanal yok")} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("Kanal")}</th>
                      <th>{t("Takipçi")}</th>
                      <th>{t("Değişim")}</th>
                      <th>{t("Yayın")}</th>
                      <th>{t("Etkileşim")}</th>
                      <th style={{ width: 200 }}>{t("Trend")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.channels.map((c) => (
                      <tr key={c.channelId}>
                        <td>
                          <span className="row">
                            <span style={{ position: "relative" }}>
                              <Avatar name={c.name} url={c.avatarUrl} size={30} />
                              <span style={{ position: "absolute", right: -4, bottom: -4 }}>
                                <ProviderIcon provider={c.provider} size={14} />
                              </span>
                            </span>
                            <span>
                              <div style={{ fontWeight: 600 }}>{c.name}</div>
                              <div className="muted small">{PROVIDER_NAME[c.provider]}</div>
                            </span>
                          </span>
                        </td>
                        <td style={{ fontWeight: 600, fontSize: 16 }}>{c.supported ? f.num(c.latest.followers ?? 0) : <span className="muted small">{t("API vermiyor")}</span>}</td>
                        <td>
                          {c.followersDelta !== 0 && (
                            <span className={`badge ${c.followersDelta > 0 ? "badge-ok" : "badge-err"}`}>
                              {c.followersDelta > 0 ? "+" : ""}
                              {c.followersDelta}
                            </span>
                          )}
                        </td>
                        <td className="small">
                          {c.published} <span className="muted">✓</span>
                          {c.failed > 0 && <span style={{ color: "var(--err)" }}> · {c.failed} ✗</span>}
                        </td>
                        <td className="small muted">
                          ♥ {f.num(c.engagement.likes)} · 💬 {f.num(c.engagement.comments)} · ↗ {f.num(c.engagement.shares)}
                          {c.engagement.views > 0 && ` · 👁 ${f.num(c.engagement.views)}`}
                        </td>
                        <td>
                          <Sparkline values={c.series.map((x) => Number(x.followers ?? 0))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-2" style={{ marginTop: 16, alignItems: "start" }}>
            <div className="card">
              <div className="card-title">
                <h2>{t("En iyi gönderiler")}</h2>
              </div>
              {d.top.length === 0 ? (
                <Empty title={t("Henüz metrik yok")} text={t("Yayınlanan gönderilerin etkileşim verisi toplandıkça burada sıralanır.")} />
              ) : (
                <table className="table">
                  <tbody>
                    {d.top.map((x) => (
                      <tr key={x.targetId}>
                        <td style={{ width: 28 }}>{x.provider && <ProviderIcon provider={x.provider as ProviderId} size={20} />}</td>
                        <td>
                          <Link to={`/app/posts/${x.postId}`} className="truncate" style={{ display: "block", maxWidth: 300, color: "inherit" }}>
                            {x.preview || L.kind(x.kind)}
                          </Link>
                          <div className="muted small">
                            {x.channel} · {f.day(x.publishedAt)} · {Object.entries(x.metrics).map(([k, v]) => `${ml(k)} ${f.num(v)}`).join(" · ")}
                          </div>
                        </td>
                        <td>
                          {x.url && (
                            <a href={x.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" aria-label={t("Yayını aç")}>
                              <ExternalLink />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card">
              <div className="card-title">
                <h2>{t("En verimli saatler")}</h2>
                <span className="muted small">{f.tz}</span>
              </div>
              {d.bestHoursUtc.length === 0 ? (
                <Empty title={t("Yeterli veri yok")} text={t("Her saat diliminde en az 2 yayın olunca hesaplanır.")} />
              ) : (
                <div className="form">
                  {d.bestHoursUtc.map((h, i) => {
                    const max = d.bestHoursUtc[0].avgScore || 1;
                    return (
                      <div key={h.hourUtc}>
                        <div className="row-between small">
                          <strong>
                            {i + 1}. {localHour(h.hourUtc)}
                          </strong>
                          <span className="muted">{t("ort. skor {s} · {n} yayın", { s: h.avgScore, n: h.posts })}</span>
                        </div>
                        <div className="bar">
                          <div style={{ width: `${Math.round((h.avgScore / max) * 100)}%`, background: "var(--accent)" }} />
                        </div>
                      </div>
                    );
                  })}
                  <p className="muted small">{t("Skor = beğeni + 2×yorum + 3×paylaşım. Bu saatleri kanal ayarlarındaki paylaşım saatlerine ekleyebilirsin.")}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
