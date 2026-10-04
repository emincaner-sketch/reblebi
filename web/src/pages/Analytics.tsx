import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Flag, Info, RefreshCw, X } from "lucide-react";
import { api, errMsg, PROVIDER_NAME, type Campaign, type ProviderId } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt } from "../lib/session";
import { Empty, ErrorBox, PageHead, ProviderIcon, useToast } from "../components/ui";
import type { AnalyticsReport } from "../panel/analytics/types";
import { InsightsSection } from "../panel/analytics/InsightsSection";
import { BarList } from "../panel/charts/BarList";
import { ChartCard, SimpleTable } from "../panel/charts/ChartCard";
import { DataTable, type Column } from "../panel/charts/DataTable";
import { delta, fmtCompact, fmtDay, fmtNum, fmtPct, fmtRange } from "../panel/charts/format";
import { Heatmap } from "../panel/charts/Heatmap";
import { PRIMARY_SERIES, providerColor } from "../panel/charts/palette";
import { StatTile } from "../panel/charts/StatTile";
import { TimeChart } from "../panel/charts/TimeChart";
import "../panel/charts/charts.css";

type Preset = "7" | "30" | "90" | "month" | "custom";
const PRESETS: Preset[] = ["7", "30", "90", "month"];

/** Çalışma alanı saat dilimindeki bugünün tarihi */
function todayIn(tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Analitik: Özet (tüm ağlar) ve ağ görünümü (?network=instagram). docs/panel/03-PANEL-TASARIM.md §5.
 * Filtreler URL'de durur (paylaşılabilir, geri tuşu çalışır); altındaki her şey aynı dilimi gösterir.
 */
export default function AnalyticsPage() {
  const { t, intl } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const network = (params.get("network") as ProviderId | null) || null;
  const campaignId = params.get("campaign") || null;
  const campaign = useQuery({ queryKey: ["campaign", campaignId], queryFn: () => api.get<Campaign>(`/api/campaigns/${campaignId}`), enabled: Boolean(campaignId) });
  const preset = (params.get("p") as Preset | null) ?? "30";
  const compare = params.get("cmp") !== "0";
  const today = todayIn(f.tz);
  const [customFrom, setCustomFrom] = useState(params.get("from") ?? today.slice(0, 8) + "01");
  const [customTo, setCustomTo] = useState(params.get("to") ?? today);
  const [followersMode, setFollowersMode] = useState<"total" | "network">("total");

  const query = useMemo(() => {
    const s = new URLSearchParams();
    if (preset === "custom") {
      s.set("from", params.get("from") ?? customFrom);
      s.set("to", params.get("to") ?? customTo);
    } else if (preset === "month") {
      s.set("from", today.slice(0, 8) + "01");
      s.set("to", today);
    } else s.set("days", preset);
    if (network) s.set("provider", network);
    if (campaignId) s.set("campaignId", campaignId);
    return s.toString();
  }, [preset, params, network, campaignId, today, customFrom, customTo]);

  const q = useQuery({ queryKey: ["analytics-report", query], queryFn: () => api.get<AnalyticsReport>(`/api/analytics/report?${query}`), placeholderData: keepPreviousData });
  const refresh = useMutation({
    mutationFn: () => api.post("/api/analytics/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["analytics-report"] });
      toast(t("Metrikler platformlardan yenilendi"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const d = q.data;
  const num = (n: number) => fmtNum(n, intl);
  const compact = (n: number) => fmtCompact(n, intl);
  const presetLabel: Record<Preset, string> = { "7": t("7 gün"), "30": t("30 gün"), "90": t("90 gün"), month: t("Bu ay"), custom: t("Özel") };
  const title = campaignId ? t("Kampanya: {name}", { name: campaign.data?.name ?? "…" }) : network ? PROVIDER_NAME[network] : t("Özet");

  if (q.isError && !d) return <ErrorBox error={q.error} />;

  const dates = d?.daily.map((x) => x.date) ?? [];
  const unsupported = d?.networks.filter((n) => !n.supported && (!network || n.provider === network)) ?? [];
  const k = d?.kpis;

  return (
    <div className={`an${q.isFetching && d ? " an--refetch" : ""}`}>
      <PageHead
        title={
          <span className="row" style={{ gap: 10 }}>
            {network && <ProviderIcon provider={network} size={30} />}
            {title}
          </span>
        }
        sub={d ? `${fmtRange(d.range.from, d.range.to, intl)}${compare ? ` · ${t("karşılaştırma: {r}", { r: fmtRange(d.range.prevFrom, d.range.prevTo, intl) })}` : ""} · ${d.range.tz}` : " "}
        actions={
          <>
            <button className="btn" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              <RefreshCw className={refresh.isPending ? "spin" : ""} /> {t("Şimdi çek")}
            </button>
            <Link className="btn" to={`/app/analytics/report?${params}`}>
              <FileText aria-hidden="true" /> {t("Rapor / PDF")}
            </Link>
          </>
        }
      />

      {/* Tek filtre satırı: altındaki her şey aynı dilimi gösterir */}
      <div className="an-filters" role="group" aria-label={t("Dönem")}>
        <div className="segmented">
          {PRESETS.map((p) => (
            <button key={p} className={preset === p ? "active" : ""} aria-pressed={preset === p} onClick={() => set({ p, from: null, to: null })}>
              {presetLabel[p]}
            </button>
          ))}
          <button className={preset === "custom" ? "active" : ""} aria-pressed={preset === "custom"} onClick={() => set({ p: "custom", from: customFrom, to: customTo })}>
            {presetLabel.custom}
          </button>
        </div>
        {preset === "custom" && (
          <form
            className="an-range"
            onSubmit={(e) => {
              e.preventDefault();
              set({ p: "custom", from: customFrom, to: customTo });
            }}
          >
            <label>
              <span className="sr-only">{t("Başlangıç")}</span>
              <input className="input" type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <span aria-hidden="true">–</span>
            <label>
              <span className="sr-only">{t("Bitiş")}</span>
              <input className="input" type="date" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
            <button className="btn btn-sm" type="submit">
              {t("Uygula")}
            </button>
          </form>
        )}
        {campaignId && (
          <span className="an-chip">
            <Flag aria-hidden="true" />
            {campaign.data?.name ?? "…"}
            <button type="button" aria-label={t("Kampanya süzgecini kaldır")} onClick={() => set({ campaign: null })}>
              <X aria-hidden="true" />
            </button>
          </span>
        )}
        <label className="an-toggle">
          <input type="checkbox" checked={compare} onChange={(e) => set({ cmp: e.target.checked ? null : "0" })} />
          {t("Önceki dönemle karşılaştır")}
        </label>
      </div>

      {!d ? (
        <div className="an-skeleton card" aria-busy="true">
          {t("Yükleniyor…")}
        </div>
      ) : d.networks.length === 0 ? (
        <Empty
          title={t("Henüz kanal yok")}
          text={t("Analitik, kanal bağlandığı günden itibaren toplanır.")}
          action={
            <Link className="btn btn-primary" to="/app/channels">
              {t("Kanal bağla")}
            </Link>
          }
        />
      ) : (
        <>
          <nav className="an-tabs" aria-label={t("Bölümler")}>
            <a href="#an-community">{t("Topluluk")}</a>
            {(d.insights.available || d.audience) && <a href="#an-insights">{t("Hesap insights")}</a>}
            <a href="#an-posts">{t("Gönderiler")}</a>
            <a href="#an-timing">{t("Zamanlama")}</a>
            <a href="#an-list">{t("Gönderi listesi")}</a>
          </nav>

          <div className="an-kpis">
            <StatTile label={t("Takipçi")} value={compact(k!.followers.value ?? 0)} delta={delta(k!.followers.value, k!.followers.prev)} compare={compare} note={k!.followersDelta.value !== null ? t("{n} bu dönemde", { n: new Intl.NumberFormat(intl, { signDisplay: "always" }).format(k!.followersDelta.value) }) : t("takipçi verisi yok")} />
            <StatTile label={t("Yayınlanan gönderi")} value={num(k!.posts.value ?? 0)} delta={delta(k!.posts.value, k!.posts.prev)} compare={compare} note={t("{a}/{b} gönderinin metriği var", { a: k!.postsWithMetrics.value ?? 0, b: k!.posts.value ?? 0 })} />
            <StatTile label={t("Etkileşim")} value={compact(k!.interactions.value ?? 0)} delta={delta(k!.interactions.value, k!.interactions.prev)} compare={compare} note={t("beğeni + yorum + paylaşım + kaydetme")} />
            <StatTile label={t("Görüntülenme")} value={compact(k!.views.value ?? 0)} delta={delta(k!.views.value, k!.views.prev)} compare={compare} note={t("destekleyen ağlarda")} />
            <StatTile label={t("Etkileşim oranı")} value={fmtPct(k!.engagementRate.value, intl)} delta={delta(k!.engagementRate.value, k!.engagementRate.prev)} compare={compare} note={t("etkileşim / görüntülenme")} />
            <StatTile label={t("Otomatik yanıt oranı")} value={fmtPct(k!.autoReplyRate.value, intl)} delta={delta(k!.autoReplyRate.value, k!.autoReplyRate.prev)} compare={compare} note={t("{n} gelen DM · tüm kanallar", { n: k!.incomingMessages.value ?? 0 })} />
          </div>

          {(unsupported.length > 0 || d.truncated) && (
            <div className="an-notes">
              {unsupported.length > 0 && (
                <p>
                  <Info aria-hidden="true" />
                  {t("{list}: platform API'si takipçi metriği vermiyor; yalnızca gönderi metrikleri gösterilir.", { list: unsupported.map((n) => PROVIDER_NAME[n.provider]).join(", ") })}
                </p>
              )}
              {d.truncated && (
                <p>
                  <Info aria-hidden="true" />
                  {t("Bu aralıkta çok gönderi var; hesaplar ilk 2.000 gönderiyle yapıldı. Daha kısa bir aralık seç.")}
                </p>
              )}
            </div>
          )}

          {/* ---------------- Topluluk ---------------- */}
          <section id="an-community" className="an-section" aria-labelledby="an-community-h">
            <h2 id="an-community-h" className="an-h2">
              {t("Topluluk")}
            </h2>
            <ChartCard
              title={t("Takipçi gelişimi")}
              sub={t("Günlük toplam; kanal bağlandığı günden itibaren.")}
              actions={
                !network && Object.keys(d.followersByProvider).length > 1 ? (
                  <div className="segmented segmented-sm" role="group" aria-label={t("Görünüm")}>
                    <button className={followersMode === "total" ? "active" : ""} aria-pressed={followersMode === "total"} onClick={() => setFollowersMode("total")}>
                      {t("Toplam")}
                    </button>
                    <button className={followersMode === "network" ? "active" : ""} aria-pressed={followersMode === "network"} onClick={() => setFollowersMode("network")}>
                      {t("Ağ başına")}
                    </button>
                  </div>
                ) : undefined
              }
              table={() => (
                <SimpleTable
                  caption={t("Takipçi gelişimi")}
                  head={[t("Gün"), t("Toplam"), ...Object.keys(d.followersByProvider).map((p) => PROVIDER_NAME[p as ProviderId])]}
                  rows={d.daily.map((x, i) => [fmtDay(x.date, intl), x.followers === null ? "—" : num(x.followers), ...Object.values(d.followersByProvider).map((vals) => (vals?.[i] === null || vals?.[i] === undefined ? "—" : num(vals[i] as number)))])}
                />
              )}
            >
              <div className="an-followers">
                <div className="an-followers-sum">
                  <span className="an-big">{k!.followers.value === null ? "—" : num(k!.followers.value)}</span>
                  <ul className="an-chips">
                    {d.byProvider.map((p) => (
                      <li key={p.provider}>
                        <i className="ch-key ch-key--rect" style={{ background: providerColor(p.provider) }} aria-hidden="true" />
                        <ProviderIcon provider={p.provider} size={18} />
                        <span>{PROVIDER_NAME[p.provider]}</span>
                        <strong>{p.followers === null ? "—" : compact(p.followers)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
                <TimeChart
                  kind="line"
                  dates={dates}
                  format={compact}
                  ariaLabel={t("Günlük takipçi")}
                  area={followersMode === "total" || Boolean(network)}
                  series={
                    followersMode === "network" && !network
                      ? Object.entries(d.followersByProvider).map(([p, vals]) => ({ key: p, label: PROVIDER_NAME[p as ProviderId], color: providerColor(p), values: vals ?? [], icon: <ProviderIcon provider={p as ProviderId} size={14} /> }))
                      : [{ key: "followers", label: t("Takipçi"), color: network ? providerColor(network) : PRIMARY_SERIES, values: d.daily.map((x) => x.followers) }]
                  }
                />
              </div>
            </ChartCard>

            <ChartCard title={network ? t("Hesaplar") : t("Ağlara göre")} sub={t("Seçili dönemde yayınlanan gönderilere göre.")}>
              <DataTable
                caption={network ? t("Hesaplar") : t("Ağlara göre")}
                rows={network ? d.channels.map((c) => ({ ...c, key: c.channelId })) : d.byProvider.map((p) => ({ ...p, key: p.provider, name: PROVIDER_NAME[p.provider], channelId: p.provider }))}
                rowKey={(r) => r.key}
                pageSizes={[50]}
                initialSort={{ key: "followers", dir: "desc" }}
                columns={[
                  {
                    key: "name",
                    label: network ? t("Hesap") : t("Ağ"),
                    locked: true,
                    render: (r) => (
                      <span className="row" style={{ gap: 8 }}>
                        <i className="ch-key ch-key--rect" style={{ background: providerColor(r.provider) }} aria-hidden="true" />
                        <ProviderIcon provider={r.provider} size={20} />
                        {network ? r.name : <Link to={`/app/analytics?${new URLSearchParams({ ...Object.fromEntries(params), network: r.provider })}`}>{r.name}</Link>}
                      </span>
                    ),
                    sort: (r) => r.name,
                    csv: (r) => r.name,
                  },
                  { key: "followers", label: t("Takipçi"), align: "right", render: (r) => (r.followers === null ? <span className="muted">{r.supported ? "—" : t("API vermiyor")}</span> : num(r.followers)), sort: (r) => r.followers },
                  { key: "delta", label: t("Değişim"), align: "right", render: (r) => (r.followersDelta === null ? "—" : new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(r.followersDelta)), sort: (r) => r.followersDelta },
                  { key: "posts", label: t("Gönderi"), align: "right", render: (r) => num(r.posts), sort: (r) => r.posts },
                  { key: "interactions", label: t("Etkileşim"), align: "right", render: (r) => num(r.interactions), sort: (r) => r.interactions },
                  { key: "views", label: t("Görüntülenme"), align: "right", render: (r) => num(r.views), sort: (r) => r.views },
                  { key: "rate", label: t("Oran"), align: "right", render: (r) => fmtPct(r.engagementRate, intl), sort: (r) => r.engagementRate },
                ] satisfies Column<{ key: string; name: string; provider: ProviderId; followers: number | null; followersDelta: number | null; posts: number; interactions: number; views: number; engagementRate: number | null; supported: boolean }>[]}
              />
            </ChartCard>
          </section>

          {/* ---------------- Hesap insights ve kitle ---------------- */}
          <InsightsSection d={d} network={network} compare={compare} />

          {/* ---------------- Gönderiler ---------------- */}
          <section id="an-posts" className="an-section" aria-labelledby="an-posts-h">
            <h2 id="an-posts-h" className="an-h2">
              {t("Gönderiler")}
            </h2>
            <p className="an-lead">{t("Bu dönemde yayınlanan gönderilerin son çekilen metrikleri, yayın gününe göre.")}</p>
            <div className="an-grid">
              <ChartCard
                title={t("Günlük etkileşim")}
                table={() => <SimpleTable caption={t("Günlük etkileşim")} head={[t("Gün"), t("Etkileşim"), t("Beğeni"), t("Yorum"), t("Paylaşım")]} rows={d.daily.map((x) => [fmtDay(x.date, intl), num(x.interactions), num(x.likes), num(x.comments), num(x.shares)])} />}
              >
                <TimeChart kind="bar" dates={dates} format={compact} ariaLabel={t("Günlük etkileşim")} series={[{ key: "i", label: t("Etkileşim"), color: PRIMARY_SERIES, values: d.daily.map((x) => x.interactions) }]} height={180} />
              </ChartCard>
              <ChartCard title={t("Günlük görüntülenme")} table={() => <SimpleTable caption={t("Günlük görüntülenme")} head={[t("Gün"), t("Görüntülenme")]} rows={d.daily.map((x) => [fmtDay(x.date, intl), num(x.views)])} />}>
                <TimeChart kind="line" area zeroBaseline dates={dates} format={compact} ariaLabel={t("Günlük görüntülenme")} series={[{ key: "v", label: t("Görüntülenme"), color: "var(--series-7)", values: d.daily.map((x) => x.views) }]} height={180} />
              </ChartCard>
              <ChartCard title={t("Yayınlanan gönderi")} sub={t("Günlük")} table={() => <SimpleTable caption={t("Yayınlanan gönderi")} head={[t("Gün"), t("Gönderi")]} rows={d.daily.map((x) => [fmtDay(x.date, intl), num(x.posts)])} />}>
                <TimeChart kind="bar" dates={dates} format={num} ariaLabel={t("Günlük gönderi sayısı")} series={[{ key: "p", label: t("Gönderi"), color: "var(--series-2)", values: d.daily.map((x) => x.posts) }]} height={150} />
              </ChartCard>
              <ChartCard title={t("İçerik türleri")} sub={t("Gönderi başına ortalama etkileşim")}>
                {d.kinds.length ? (
                  <BarList
                    format={num}
                    rows={d.kinds.map((x) => ({ key: x.kind, label: L.kind(x.kind), value: x.avgInteractions, meta: t("{n} gönderi · {v} görüntülenme", { n: x.posts, v: compact(x.views) }) }))}
                  />
                ) : (
                  <p className="muted small">{t("Bu dönemde gönderi yok.")}</p>
                )}
              </ChartCard>
            </div>
            <ChartCard title={t("Hashtag'ler")} sub={t("Gönderi metinlerindeki etiketler; etkileşime göre.")}>
              <DataTable
                caption={t("Hashtag'ler")}
                rows={d.hashtags}
                rowKey={(r) => r.tag}
                search={(r, qq) => r.tag.toLocaleLowerCase().includes(qq)}
                csvName={`reblebi-hashtag-${d.range.from}_${d.range.to}`}
                initialSort={{ key: "interactions", dir: "desc" }}
                columns={[
                  { key: "tag", label: t("Hashtag"), locked: true, render: (r) => <strong>{r.tag}</strong>, sort: (r) => r.tag, csv: (r) => r.tag },
                  { key: "posts", label: t("Gönderi"), align: "right", render: (r) => num(r.posts), sort: (r) => r.posts },
                  { key: "interactions", label: t("Etkileşim"), align: "right", render: (r) => num(r.interactions), sort: (r) => r.interactions },
                  { key: "avg", label: t("Gönderi başına"), align: "right", render: (r) => num(Math.round(r.interactions / Math.max(1, r.posts))), sort: (r) => r.interactions / Math.max(1, r.posts) },
                  { key: "likes", label: t("Beğeni"), align: "right", render: (r) => num(r.likes), sort: (r) => r.likes, hidden: true },
                  { key: "comments", label: t("Yorum"), align: "right", render: (r) => num(r.comments), sort: (r) => r.comments, hidden: true },
                  { key: "views", label: t("Görüntülenme"), align: "right", render: (r) => num(r.views), sort: (r) => r.views },
                ]}
              />
            </ChartCard>
          </section>

          {/* ---------------- Zamanlama ---------------- */}
          <section id="an-timing" className="an-section" aria-labelledby="an-timing-h">
            <h2 id="an-timing-h" className="an-h2">
              {t("Zamanlama")}
            </h2>
            <ChartCard
              title={t("En iyi gün ve saatler")}
              sub={t("Kendi gönderilerinin ortalama etkileşimi · {tz}", { tz: d.range.tz })}
              note={t("Kaynak: bu dönemde yayınladığın gönderiler. Hücre koyulaştıkça ortalama etkileşim artar; boş hücrede o saatte gönderi yok. Bu saatleri kanal ayarlarındaki paylaşım saatlerine ekleyebilirsin.")}
              table={() => (
                <SimpleTable
                  caption={t("En iyi gün ve saatler")}
                  head={[t("Gün ve saat"), t("Gönderi"), t("Ort. etkileşim")]}
                  rows={[...d.heatmap.cells]
                    .sort((a, b) => (b.avgInteractions ?? -1) - (a.avgInteractions ?? -1))
                    .map((c) => [`${new Intl.DateTimeFormat(intl, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + c.weekday)))} ${String(c.hour).padStart(2, "0")}:00`, num(c.posts), c.avgInteractions === null ? "—" : num(c.avgInteractions)])}
                />
              )}
            >
              <Heatmap cells={d.heatmap.cells} maxAvg={d.heatmap.maxAvg} format={num} />
            </ChartCard>
          </section>

          {/* ---------------- Gönderi listesi ---------------- */}
          <section id="an-list" className="an-section" aria-labelledby="an-list-h">
            <h2 id="an-list-h" className="an-h2">
              {t("Gönderi listesi")}
            </h2>
            <div className="card">
              <DataTable
                caption={t("Gönderi listesi")}
                rows={d.posts}
                rowKey={(r) => r.targetId}
                search={(r, qq) => r.preview.toLocaleLowerCase().includes(qq) || r.channel.toLocaleLowerCase().includes(qq)}
                csvName={`reblebi-gonderiler-${d.range.from}_${d.range.to}`}
                initialSort={{ key: "date", dir: "desc" }}
                empty={t("Bu dönemde yayınlanmış gönderi yok.")}
                columns={[
                  {
                    key: "content",
                    label: t("İçerik"),
                    locked: true,
                    width: "38%",
                    render: (r) => (
                      <div className="an-post">
                        {r.provider && <ProviderIcon provider={r.provider} size={22} />}
                        <div>
                          <Link to={`/app/posts/${r.postId}`} className="an-post-text">
                            {r.preview || L.kind(r.kind)}
                          </Link>
                          <div className="muted small">
                            {r.channel}
                            {!r.hasMetrics && ` · ${t("metrik henüz yok")}`}
                          </div>
                        </div>
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-icon btn-sm" aria-label={t("Yayını aç")}>
                            <ExternalLink />
                          </a>
                        )}
                      </div>
                    ),
                    csv: (r) => r.preview,
                  },
                  { key: "network", label: t("Ağ"), render: (r) => (r.provider ? PROVIDER_NAME[r.provider] : "—"), sort: (r) => r.provider ?? "", hidden: true },
                  { key: "kind", label: t("Tür"), render: (r) => L.kind(r.kind), sort: (r) => r.kind },
                  { key: "date", label: t("Tarih"), render: (r) => f.short(r.publishedAt), sort: (r) => r.publishedAt ?? "", csv: (r) => r.publishedAt },
                  { key: "views", label: t("Görüntülenme"), align: "right", render: (r) => fmtNum(r.views, intl), sort: (r) => r.views },
                  { key: "interactions", label: t("Etkileşim"), align: "right", render: (r) => fmtNum(r.interactions, intl), sort: (r) => r.interactions },
                  { key: "likes", label: t("Beğeni"), align: "right", render: (r) => fmtNum(r.likes, intl), sort: (r) => r.likes, hidden: true },
                  { key: "comments", label: t("Yorum"), align: "right", render: (r) => fmtNum(r.comments, intl), sort: (r) => r.comments, hidden: true },
                  { key: "shares", label: t("Paylaşım"), align: "right", render: (r) => fmtNum(r.shares, intl), sort: (r) => r.shares, hidden: true },
                  { key: "rate", label: t("Oran"), align: "right", render: (r) => fmtPct(r.engagementRate, intl), sort: (r) => r.engagementRate },
                ]}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
