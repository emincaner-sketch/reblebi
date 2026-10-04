import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Hash, Heart, MessageCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Empty, PageHead, useLocalState, useToast } from "../components/ui";
import { ChartCard, SimpleTable } from "../panel/charts/ChartCard";
import { fmtDay, fmtNum } from "../panel/charts/format";
import { seriesVar } from "../panel/charts/palette";
import { TimeChart } from "../panel/charts/TimeChart";
import "../panel/charts/charts.css";
import "../panel/analytics/competitors.css";

type Num = number | null;
interface TopPost {
  id: string;
  caption: string;
  likes: Num;
  comments: Num;
  type: string;
  permalink: string | null;
  timestamp: string | null;
}
interface Item {
  id: string;
  hashtag: string;
  recentPosts: Num;
  recentCapped: boolean;
  avgLikes: Num;
  avgComments: Num;
  avgDaily: Num;
  series: Num[];
  top: TopPost[];
  lastFetchedAt: string | null;
  lastError: string | null;
}
interface Report {
  range: { from: string; to: string; days: number };
  dates: string[];
  items: Item[];
  max: number;
  canTrack: boolean;
}

/** Grafikte en fazla 7 etiket (kategorik palet sabit sırada) */
const CHART_LIMIT = 7;

/** Hashtag takibi (Metricool "Hashtag Tracker"): Instagram'da etiketin günlük hacmi, popüler gönderilerin etkileşimi */
export default function HashtagsPage() {
  const { t, intl } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useLocalState<number>("sp_htag_days", 30);
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["hashtag-tracks", days], queryFn: () => api.get<Report>(`/api/hashtag-tracks?days=${days}`) });
  const refreshList = () => qc.invalidateQueries({ queryKey: ["hashtag-tracks"] });
  const add = useMutation({
    mutationFn: () => api.post("/api/hashtag-tracks", { hashtag: tag }),
    onSuccess: () => {
      setTag("");
      toast(t("Hashtag eklendi"), "ok");
      refreshList();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/hashtag-tracks/${id}`), onSuccess: refreshList, onError: (e) => toast(errMsg(e), "err") });
  const reload = useMutation({ mutationFn: (id: string) => api.post(`/api/hashtag-tracks/${id}/refresh`), onSuccess: refreshList, onError: (e) => toast(errMsg(e), "err") });

  const d = q.data;
  const num = (n: Num) => fmtNum(n, intl);
  const chartItems = (d?.items ?? []).slice(0, CHART_LIMIT);
  const sel = d?.items.find((x) => x.id === selected) ?? d?.items[0] ?? null;

  return (
    <div className="cp">
      <PageHead
        title={t("Hashtag takibi")}
        sub={t("Instagram'da izlediğin etiketlerin günlük paylaşım hacmi ve en popüler gönderilerinin etkileşimi; günde bir güncellenir.")}
        actions={
          <div className="segmented" role="group" aria-label={t("Dönem")}>
            {[30, 90].map((n) => (
              <button key={n} className={days === n ? "active" : ""} aria-pressed={days === n} onClick={() => setDays(n)}>
                {t("{n} gün", { n })}
              </button>
            ))}
          </div>
        }
      />

      {d && !d.canTrack ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <Empty
            icon={<Hash />}
            title={t("Önce bir Instagram işletme hesabı bağla")}
            text={t("Hashtag araması bağlı Instagram işletme hesabının izniyle yapılır.")}
            action={
              <Link className="btn btn-primary" to="/app/channels">
                {t("Kanal bağla")}
              </Link>
            }
          />
        </div>
      ) : (
        s.can("editor") && (
          <form
            className="card cp-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (tag.trim()) add.mutate();
            }}
          >
            <label htmlFor="ht-tag" className="cp-add-l">
              {t("Hashtag ekle")}
            </label>
            <div className="cp-add-row">
              <span className="cp-at" aria-hidden="true">
                #
              </span>
              <input id="ht-tag" className="input" placeholder={t("ör. leblebi")} value={tag} onChange={(e) => setTag(e.target.value)} maxLength={100} />
              <button className="btn btn-primary" disabled={!tag.trim() || add.isPending || (d ? d.items.length >= d.max : false)}>
                <Plus aria-hidden="true" /> {add.isPending ? t("Aranıyor…") : t("Ekle")}
              </button>
            </div>
            <span className="help">{t("{n}/{max} hashtag · Instagram bir hesabın 7 günde en fazla 30 farklı etiket sorgulamasına izin verir.", { n: d?.items.length ?? 0, max: d?.max ?? 10 })}</span>
          </form>
        )
      )}

      {!d ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : !d.items.length ? (
        d.canTrack && (
          <div className="card">
            <Empty icon={<Hash />} title={t("Henüz hashtag takip etmiyorsun")} text={t("Markanı, sektörünü ya da kampanyanı temsil eden etiketleri ekle; hangi gün ne kadar paylaşıldığını ve popüler gönderileri gör.")} />
          </div>
        )
      ) : (
        <div className="cp-body">
          <ChartCard title={t("İzlenen hashtag'ler")} sub={t("Son ölçüm; ortalamalar etiketin en popüler gönderilerinden.")}>
            <div className="table-wrap">
              <table className="table cp-table">
                <caption className="sr-only">{t("İzlenen hashtag'ler")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("Hashtag")}</th>
                    <th scope="col">{t("Son 24 saat")}</th>
                    <th scope="col">{t("Günlük ort.")}</th>
                    <th scope="col">{t("Ort. beğeni")}</th>
                    <th scope="col">{t("Ort. yorum")}</th>
                    <th scope="col">
                      <span className="sr-only">{t("İşlemler")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((it) => (
                    <tr key={it.id}>
                      <th scope="row">
                        <a href={`https://www.instagram.com/explore/tags/${encodeURIComponent(it.hashtag)}/`} target="_blank" rel="noreferrer" className="cp-user">
                          #{it.hashtag}
                        </a>
                        {it.lastError && (
                          <span className="cp-err" title={it.lastError} style={{ marginLeft: 8 }}>
                            <AlertTriangle aria-hidden="true" /> {t("Son güncelleme başarısız")}
                          </span>
                        )}
                      </th>
                      <td>{it.recentPosts === null ? "—" : `${num(it.recentPosts)}${it.recentCapped ? "+" : ""}`}</td>
                      <td>{num(it.avgDaily)}</td>
                      <td>{num(it.avgLikes)}</td>
                      <td>{num(it.avgComments)}</td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        {s.can("editor") && (
                          <>
                            <button className="btn btn-ghost btn-sm" title={it.lastFetchedAt ? t("Son güncelleme: {d}", { d: f.short(it.lastFetchedAt) }) : t("Yenile")} aria-label={t("Yenile")} disabled={reload.isPending} onClick={() => reload.mutate(it.id)}>
                              <RefreshCw />
                            </button>
                            <button className="btn btn-ghost btn-sm" title={t("Takibi bırak")} aria-label={t("Takibi bırak")} onClick={() => confirm(t("#{tag} takibi bırakılsın mı? Geçmiş ölçümler de silinir.", { tag: it.hashtag })) && remove.mutate(it.id)}>
                              <Trash2 />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <ChartCard
            title={t("Son 24 saatte paylaşım")}
            sub={d.items.length > CHART_LIMIT ? t("Günlük ölçüm · ilk {n} etiket", { n: CHART_LIMIT }) : t("Günlük ölçüm")}
            note={t("Instagram son 24 saatteki gönderilerden en fazla 200'ünü listeler; üstü \"200+\" olarak gösterilir.")}
            table={() => (
              <SimpleTable
                caption={t("Son 24 saatte paylaşım")}
                head={[t("Gün"), ...chartItems.map((x) => `#${x.hashtag}`)]}
                rows={d.dates.map((date, i) => [fmtDay(date, intl), ...chartItems.map((x) => num(x.series[i]))])}
              />
            )}
          >
            <TimeChart kind="line" zeroBaseline dates={d.dates} format={(n) => fmtNum(n, intl)} ariaLabel={t("Son 24 saatte paylaşım")} height={190} series={chartItems.map((x, i) => ({ key: x.id, label: `#${x.hashtag}`, color: seriesVar(i + 1), values: x.series }))} />
          </ChartCard>

          {sel && (
            <ChartCard
              title={t("Popüler gönderiler")}
              sub={t("Instagram'ın etiket için öne çıkardığı gönderiler")}
              actions={
                d.items.length > 1 ? (
                  <select className="input select-sm" aria-label={t("Hashtag")} value={sel.id} onChange={(e) => setSelected(e.target.value)}>
                    {d.items.map((x) => (
                      <option key={x.id} value={x.id}>
                        #{x.hashtag}
                      </option>
                    ))}
                  </select>
                ) : undefined
              }
            >
              {sel.top.length ? (
                <ul className="cp-posts">
                  {sel.top.map((p) => (
                    <li key={p.id} className="cp-post">
                      <span className="cp-post-head">
                        #{sel.hashtag}
                        <span className="muted small">{p.timestamp ? f.day(p.timestamp) : ""}</span>
                      </span>
                      <p className="cp-cap">{p.caption || t("(metin yok)")}</p>
                      <span className="cp-stats">
                        <span>
                          <Heart aria-hidden="true" /> {p.likes === null ? t("gizli") : num(p.likes)}
                        </span>
                        <span>
                          <MessageCircle aria-hidden="true" /> {num(p.comments)}
                        </span>
                        {p.permalink && (
                          <a href={p.permalink} target="_blank" rel="noreferrer">
                            <ExternalLink aria-hidden="true" /> {t("Aç")}
                          </a>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">{t("Henüz ölçüm yok.")}</p>
              )}
            </ChartCard>
          )}
        </div>
      )}
    </div>
  );
}
