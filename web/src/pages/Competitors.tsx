import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Eye, Heart, MessageCircle, Plus, RefreshCw, Repeat2, Trash2, Users } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Empty, PageHead, ProviderIcon, useLocalState, useToast } from "../components/ui";
import { BarList } from "../panel/charts/BarList";
import { ChartCard, SimpleTable } from "../panel/charts/ChartCard";
import { fmtCompact, fmtDay, fmtNum, fmtPct } from "../panel/charts/format";
import { seriesVar } from "../panel/charts/palette";
import { TimeChart } from "../panel/charts/TimeChart";
import "../panel/charts/charts.css";
import "../panel/analytics/competitors.css";

type Num = number | null;
type Net = "instagram" | "facebook" | "youtube" | "twitch" | "bluesky";
const NETS: Net[] = ["instagram", "facebook", "youtube", "twitch", "bluesky"];
const NET_LABEL: Record<Net, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", twitch: "Twitch", bluesky: "Bluesky" };
interface Row {
  key: string;
  self: boolean;
  id?: string;
  provider: Net;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  followers: Num;
  followersDelta: Num;
  postsLast30: Num;
  avgLikes: Num;
  avgComments: Num;
  avgViews: Num;
  engagementRate: Num;
  series: Num[];
  lastFetchedAt?: string | null;
  lastError?: string | null;
}
interface Report {
  range: { from: string; to: string; days: number; tz: string };
  dates: string[];
  items: Array<
    Omit<Row, "key" | "self"> & {
      id: string;
      biography: string | null;
      topPosts: Array<{
        id: string;
        caption: string;
        likes: Num;
        comments: Num;
        views?: Num;
        shares?: Num;
        timestamp: string;
        type: string;
        permalink: string | null;
      }>;
    }
  >;
  self: Array<Omit<Row, "key" | "self"> & { channelId: string }>;
  max: number;
  canTrack: boolean;
  tracking?: Record<Net, boolean>;
}

/** Herkese açık profil adresi */
function profileUrl(provider: Net, u: string): string {
  if (provider === "youtube") return /^UC[\w-]{22}$/.test(u) ? `https://www.youtube.com/channel/${u}` : `https://www.youtube.com/@${u}`;
  if (provider === "bluesky") return `https://bsky.app/profile/${u}`;
  if (provider === "facebook") return `https://www.facebook.com/${u}`;
  if (provider === "twitch") return `https://www.twitch.tv/${u}`;
  return `https://www.instagram.com/${u}/`;
}

/** Grafikte en fazla 7 hesap (kategorik palet sabit sırada, renk üretilmez): sen + en büyük 6 rakip */
const CHART_LIMIT = 7;

function Avatar({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  return url && !broken ? (
    <img className="cp-av" src={url} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" />
  ) : (
    <span className="cp-av cp-av-i" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Rakip takibi (Metricool "Competitors"): Instagram işletme hesaplarının herkese açık metrikleri */
export default function CompetitorsPage() {
  const { t, intl } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useLocalState<number>("sp_cmp_days", 30);
  const [netRaw, setNet] = useLocalState<Net>("sp_cmp_net", "instagram");
  const net: Net = NETS.includes(netRaw) ? netRaw : "instagram";
  const [username, setUsername] = useState("");
  const q = useQuery({
    queryKey: ["competitors", days],
    queryFn: () => api.get<Report>(`/api/competitors?days=${days}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["competitors"] });
  const add = useMutation({
    mutationFn: () => api.post("/api/competitors", { username, provider: net }),
    onSuccess: () => {
      setUsername("");
      toast(t("Rakip eklendi"), "ok");
      refresh();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/competitors/${id}`),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), "err"),
  });
  const reload = useMutation({
    mutationFn: (id: string) => api.post(`/api/competitors/${id}/refresh`),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), "err"),
  });

  const d = q.data;
  const num = (n: Num) => fmtNum(n, intl);
  const compact = (n: number) => fmtCompact(n, intl);
  const prov = (p: Net | undefined) => p ?? "instagram";
  const items = d ? d.items.filter((x) => prov(x.provider) === net) : [];
  const rows: Row[] = d
    ? [
        ...d.self
          .filter((x) => prov(x.provider) === net)
          .map((x) => ({
            ...x,
            provider: net,
            avgViews: x.avgViews ?? null,
            key: `self-${x.channelId}`,
            self: true,
          })),
        ...items.map((x) => ({
          ...x,
          provider: net,
          avgViews: x.avgViews ?? null,
          key: x.id,
          self: false,
        })),
      ]
    : [];
  const tracking: Record<Net, boolean> = d?.tracking ?? {
    instagram: Boolean(d?.canTrack),
    facebook: false,
    youtube: false,
    twitch: false,
    bluesky: true,
  };
  const canTrack = tracking[net];
  const yt = net === "youtube";
  /** Video ağları: ortalama izlenme sütunu ve izlenmeye göre sıralama */
  const vids = net === "youtube" || net === "twitch";
  /** Twitch'te beğeni/yorum yok: etkileşim sütunları gizlenir */
  const eng = net !== "twitch";
  /** Tanıtıcı değilse (kendi kanal adı, UC… kimliği) @ eklenmez */
  const isHandle = (u: string) => !/\s/.test(u) && !/^UC[\w-]{22}$/.test(u) && !(net === "facebook" && /^\d+$/.test(u));
  const handle = (u: string) => (isHandle(u) ? `@${u}` : u);
  const followersLabel = yt ? t("Abone") : t("Takipçi");
  const postsLabel = vids ? t("Video (30 gün)") : t("Gönderi (30 gün)");
  const commentsLabel = net === "bluesky" ? t("Ort. yanıt") : t("Ort. yorum");
  const addCopy: Record<
    Net,
    {
      placeholder: string;
      help: string;
      empty: string;
      emptyText: string;
      sub: string;
    }
  > = {
    instagram: {
      placeholder: t("kullaniciadi ya da instagram.com/… adresi"),
      help: t("{n}/{max} rakip · yalnızca işletme ve içerik üreticisi hesapları (kişisel ya da gizli hesaplar desteklenmez)", { n: items.length, max: d?.max ?? 20 }),
      empty: t("Önce bir Instagram işletme hesabı bağla"),
      emptyText: t("Rakip verileri, bağlı Instagram hesabının izniyle herkese açık işletme hesaplarından okunur."),
      sub: t("Instagram işletme ve içerik üreticisi hesaplarının herkese açık takipçi ve etkileşim ortalamaları; günde bir güncellenir ve kendi hesabınla karşılaştırılır."),
    },
    youtube: {
      placeholder: t("@kanal, youtube.com/@… adresi ya da UC… kimliği"),
      help: t("{n}/{max} kanal · abone sayısını gizleyen kanallarda abone ve etkileşim oranı boş kalır", { n: items.length, max: d?.max ?? 20 }),
      empty: t("Önce bir YouTube kanalı bağla"),
      emptyText: t("Rakip kanalların herkese açık istatistikleri, bağlı YouTube kanalının izniyle YouTube Data API'den okunur."),
      sub: t("YouTube kanallarının herkese açık abone, video ve izlenme ortalamaları; günde bir güncellenir ve kendi kanalınla karşılaştırılır."),
    },
    facebook: {
      placeholder: t("facebook.com/… sayfa adresi, kullanıcı adı ya da sayfa kimliği"),
      help: t("{n}/{max} sayfa · yalnızca herkese açık Sayfalar; gönderi okuma izni yoksa yalnızca takipçi görünür", { n: items.length, max: d?.max ?? 20 }),
      empty: t("Önce bir Facebook Sayfası bağla"),
      emptyText: t("Rakip Sayfaların herkese açık verileri, bağlı Sayfanın izniyle Meta Graph API'den okunur."),
      sub: t("Facebook Sayfalarının herkese açık takipçi ve etkileşim ortalamaları; günde bir güncellenir ve kendi Sayfanla karşılaştırılır."),
    },
    twitch: {
      placeholder: t("kanaladi ya da twitch.tv/… adresi"),
      help: t("{n}/{max} kanal · takipçi ve son videoların izlenmesi; Twitch beğeni/yorum vermez", { n: items.length, max: d?.max ?? 20 }),
      empty: t("Önce bir Twitch kanalı bağla"),
      emptyText: t("Rakip kanalların herkese açık verileri, bağlı Twitch kanalının jetonuyla Twitch API'den okunur."),
      sub: t("Twitch kanallarının takipçi ve video izlenme ortalamaları; günde bir güncellenir ve kendi kanalınla karşılaştırılır."),
    },
    bluesky: {
      placeholder: t("ad.bsky.social ya da bsky.app/profile/… adresi"),
      help: t("{n}/{max} hesap · Bluesky verileri herkese açıktır, hesap bağlaman gerekmez", { n: items.length, max: d?.max ?? 20 }),
      empty: "",
      emptyText: "",
      sub: t("Bluesky hesaplarının herkese açık takipçi ve etkileşim ortalamaları; günde bir güncellenir ve kendi hesabınla karşılaştırılır."),
    },
  };
  const copy = addCopy[net];
  // Takipçi değişimi %: herkes dönem başında 0'dan başlar (farklı büyüklükteki hesaplar tek eksende karşılaştırılır)
  const chartRows = [...rows.filter((r) => r.self), ...rows.filter((r) => !r.self).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))].slice(0, CHART_LIMIT);
  const indexed = (series: Num[]) => {
    const base = series.find((v) => v !== null && v > 0);
    return series.map((v) => (v === null || !base ? null : Math.round(((v - base) / base) * 1000) / 10));
  };
  const pctFmt = (n: number) => `${n > 0 ? "+" : ""}${new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(n)}%`;
  const signed = (n: Num) => (n === null ? "—" : new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(n));
  const score = (p: { likes: Num; comments: Num; views?: Num; shares?: Num }) => (vids ? (p.views ?? 0) : (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0));
  const topPosts = items
    .flatMap((c) =>
      c.topPosts.map((p) => ({
        ...p,
        username: c.username,
        followers: c.followers,
      })),
    )
    .sort((a, b) => score(b) - score(a))
    .slice(0, 6);

  return (
    <div className="cp">
      <PageHead
        title={t("Rakipler")}
        sub={copy.sub}
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

      <div className="tabs cp-tabs" role="tablist" aria-label={t("Ağ")}>
        {NETS.map((n) => {
          const count = d ? d.items.filter((x) => prov(x.provider) === n).length : 0;
          return (
            <button key={n} role="tab" aria-selected={net === n} className={`tab ${net === n ? "active" : ""}`} onClick={() => setNet(n)}>
              <ProviderIcon provider={n} size={18} /> {NET_LABEL[n]}
              {count > 0 && <span className="ads-tabnum">{count}</span>}
            </button>
          );
        })}
      </div>

      {d && !canTrack ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <Empty
            icon={<Users />}
            title={copy.empty}
            text={copy.emptyText}
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
              if (username.trim()) add.mutate();
            }}
          >
            <label htmlFor="cp-user" className="cp-add-l">
              {t("Rakip ekle")}
            </label>
            <div className="cp-add-row">
              <span className="cp-at" aria-hidden="true">
                @
              </span>
              <input id="cp-user" className="input" placeholder={copy.placeholder} value={username} onChange={(e) => setUsername(e.target.value)} maxLength={200} />
              <button className="btn btn-primary" disabled={!username.trim() || add.isPending || (d ? items.length >= d.max : false)}>
                <Plus aria-hidden="true" /> {add.isPending ? t("Kontrol ediliyor…") : t("Ekle")}
              </button>
            </div>
            <span className="help">{copy.help}</span>
          </form>
        )
      )}

      {!d ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : !items.length ? (
        canTrack && (
          <div className="card">
            <Empty icon={<Users />} title={t("Henüz rakip eklemedin")} text={t("Sektöründeki 3–5 hesabı ekle; takipçi büyümesi, gönderi sıklığı ve etkileşim oranını yan yana gör.")} />
          </div>
        )
      ) : (
        <div className="cp-body">
          <ChartCard
            title={t("Karşılaştırma")}
            sub={!eng ? t("Ortalamalar son 25 videodan (izlenme).") : yt ? t("Ortalamalar son 25 videodan; etkileşim oranı = (ort. beğeni + ort. yorum) / abone.") : t("Ortalamalar son 25 gönderiden; etkileşim oranı = (ort. beğeni + ort. yorum) / takipçi.")}
            table={() => (
              <SimpleTable
                caption={t("Karşılaştırma")}
                head={[t("Hesap"), followersLabel, t("Değişim"), postsLabel, ...(vids ? [t("Ort. izlenme")] : []), ...(eng ? [t("Ort. beğeni"), commentsLabel, t("Etkileşim oranı")] : [])]}
                rows={rows.map((r) => [
                  `${handle(r.username)}${r.self ? ` (${t("sen")})` : ""}`,
                  num(r.followers),
                  signed(r.followersDelta),
                  num(r.postsLast30),
                  ...(vids ? [num(r.avgViews)] : []),
                  ...(eng ? [num(r.avgLikes), num(r.avgComments), fmtPct(r.engagementRate, intl)] : []),
                ])}
              />
            )}
          >
            <div className="table-wrap">
              <table className="table cp-table">
                <caption className="sr-only">{t("Karşılaştırma")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("Hesap")}</th>
                    <th scope="col">{followersLabel}</th>
                    <th scope="col">{t("Değişim")}</th>
                    <th scope="col">{postsLabel}</th>
                    {vids && <th scope="col">{t("Ort. izlenme")}</th>}
                    {eng && <th scope="col">{t("Ort. beğeni")}</th>}
                    {eng && <th scope="col">{commentsLabel}</th>}
                    {eng && <th scope="col">{t("Etkileşim oranı")}</th>}
                    <th scope="col">
                      <span className="sr-only">{t("İşlemler")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={r.self ? "cp-self" : ""}>
                      <th scope="row">
                        <span className="cp-acc">
                          <Avatar url={r.avatarUrl} name={r.username} />
                          <span>
                            {r.self && !isHandle(r.username) ? (
                              <span className="cp-user">{r.username}</span>
                            ) : (
                              <a href={profileUrl(r.provider, r.username)} target="_blank" rel="noreferrer" className="cp-user">
                                {handle(r.username)}
                              </a>
                            )}
                            {r.self && <span className="badge cp-badge">{t("sen")}</span>}
                            <span className="cp-name">{r.name}</span>
                            {r.lastError && (
                              <span className="cp-err" title={r.lastError}>
                                <AlertTriangle aria-hidden="true" /> {t("Son güncelleme başarısız")}
                              </span>
                            )}
                          </span>
                        </span>
                      </th>
                      <td>{num(r.followers)}</td>
                      <td className={r.followersDelta && r.followersDelta > 0 ? "cp-up" : r.followersDelta && r.followersDelta < 0 ? "cp-down" : ""}>{signed(r.followersDelta)}</td>
                      <td>{num(r.postsLast30)}</td>
                      {vids && <td>{num(r.avgViews)}</td>}
                      {eng && <td>{num(r.avgLikes)}</td>}
                      {eng && <td>{num(r.avgComments)}</td>}
                      {eng && <td>{fmtPct(r.engagementRate, intl)}</td>}
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        {!r.self && r.id && s.can("editor") && (
                          <>
                            <button
                              className="btn btn-ghost btn-sm"
                              title={
                                r.lastFetchedAt
                                  ? t("Son güncelleme: {d}", {
                                      d: f.short(r.lastFetchedAt),
                                    })
                                  : t("Yenile")
                              }
                              aria-label={t("Yenile")}
                              disabled={reload.isPending}
                              onClick={() => reload.mutate(r.id!)}
                            >
                              <RefreshCw />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              title={t("Takibi bırak")}
                              aria-label={t("Takibi bırak")}
                              onClick={() => confirm(t("{u} rakip listesinden çıkarılsın mı? Geçmiş verisi de silinir.", { u: handle(r.username) })) && remove.mutate(r.id!)}
                            >
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

          <div className="an-grid">
            <ChartCard
              title={yt ? t("Abone değişimi (%)") : t("Takipçi değişimi (%)")}
              sub={
                rows.length > CHART_LIMIT
                  ? t("Dönem başına göre; sen ve en büyük {n} rakip", {
                      n: CHART_LIMIT - 1,
                    })
                  : t("Dönem başına göre")
              }
              table={() => (
                <SimpleTable
                  caption={t("Takipçi değişimi (%)")}
                  head={[t("Gün"), ...chartRows.map((r) => handle(r.username))]}
                  rows={d.dates.map((date, i) => [
                    fmtDay(date, intl),
                    ...chartRows.map((r) => {
                      const v = indexed(r.series)[i];
                      return v === null ? "—" : pctFmt(v);
                    }),
                  ])}
                />
              )}
            >
              <TimeChart
                kind="line"
                dates={d.dates}
                format={pctFmt}
                ariaLabel={t("Takipçi değişimi, dönem başına göre yüzde")}
                height={200}
                series={chartRows.map((r, i) => ({
                  key: r.key,
                  label: `${handle(r.username)}${r.self ? ` (${t("sen")})` : ""}`,
                  color: seriesVar(i + 1),
                  values: indexed(r.series),
                }))}
              />
            </ChartCard>
            <ChartCard title={eng ? t("Etkileşim oranı") : t("Ortalama izlenme")} sub={eng ? t("Gönderi başına, takipçiye göre") : t("Video başına")}>
              <BarList
                format={(n) => (eng ? fmtPct(n, intl) : compact(n))}
                rows={[...rows]
                  .sort((a, b) => (eng ? (b.engagementRate ?? -1) - (a.engagementRate ?? -1) : (b.avgViews ?? -1) - (a.avgViews ?? -1)))
                  .map((r) => ({
                    key: r.key,
                    label: `${handle(r.username)}${r.self ? ` (${t("sen")})` : ""}`,
                    value: eng ? r.engagementRate : r.avgViews,
                    color: r.self ? "var(--series-1)" : "var(--series-other)",
                    meta: r.followers !== null ? (yt ? t("{n} abone", { n: compact(r.followers) }) : t("{n} takipçi", { n: compact(r.followers) })) : undefined,
                  }))}
              />
            </ChartCard>
          </div>

          {topPosts.length > 0 && (
            <ChartCard title={vids ? t("Rakiplerin öne çıkan videoları") : t("Rakiplerin öne çıkan gönderileri")} sub={vids ? t("Son 25 video içinde izlenmeye göre") : t("Son 25 gönderi içinde etkileşime göre")}>
              <ul className="cp-posts">
                {topPosts.map((p) => (
                  <li key={`${p.username}-${p.id}`} className="cp-post">
                    <span className="cp-post-head">
                      <ProviderIcon provider={net} size={18} /> {handle(p.username)}
                      <span className="muted small">{p.timestamp ? f.day(p.timestamp) : ""}</span>
                    </span>
                    <p className="cp-cap">{p.caption || t("(metin yok)")}</p>
                    <span className="cp-stats">
                      {p.views !== undefined && p.views !== null && (
                        <span>
                          <Eye aria-hidden="true" /> {num(p.views)}
                        </span>
                      )}
                      {eng && (
                        <span>
                          <Heart aria-hidden="true" /> {p.likes === null ? t("gizli") : num(p.likes)}
                        </span>
                      )}
                      {eng && (
                        <span>
                          <MessageCircle aria-hidden="true" /> {num(p.comments)}
                        </span>
                      )}
                      {p.shares !== undefined && p.shares !== null && (
                        <span>
                          <Repeat2 aria-hidden="true" /> {num(p.shares)}
                        </span>
                      )}
                      {p.permalink && (
                        <a href={p.permalink} target="_blank" rel="noreferrer">
                          <ExternalLink aria-hidden="true" /> {t("Aç")}
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </ChartCard>
          )}
        </div>
      )}
    </div>
  );
}
