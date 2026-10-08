import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, CheckCheck, Download, EyeOff, Eye, Globe2, Newspaper, Pause, Pencil, Play, Plus, RefreshCw, Search, Star, Trash2 } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Empty, Modal, PageHead, ProviderIcon, useLocalState, useToast } from "../components/ui";
import { BarList } from "../panel/charts/BarList";
import { ChartCard, SimpleTable } from "../panel/charts/ChartCard";
import { delta, fmtCompact, fmtDay, fmtNum } from "../panel/charts/format";
import { seriesVar } from "../panel/charts/palette";
import { StatTile } from "../panel/charts/StatTile";
import { TimeChart } from "../panel/charts/TimeChart";
import "../panel/charts/charts.css";
import "../panel/analytics/competitors.css";
import "../panel/analytics/mentions.css";

type Source = "news" | "reddit" | "bluesky" | "hn" | "youtube" | "web";
type Sentiment = "positive" | "neutral" | "negative";
const SOURCES: Source[] = ["news", "reddit", "bluesky", "hn", "youtube", "web"];
/** Kategorik sıra sabit: kaynak rengi süzgeçle değişmez */
const SOURCE_COLOR: Record<Source, string> = { news: seriesVar(1), reddit: seriesVar(2), bluesky: seriesVar(3), hn: seriesVar(4), youtube: seriesVar(5), web: seriesVar(6) };
/** Duygu iki kutuplu: mavi ↔ turuncu, nötr gri (renk körlüğünde de ayrışır; her yerde yazıyla birlikte) */
const SENT_COLOR: Record<Sentiment, string> = { positive: seriesVar(7), neutral: "var(--series-other)", negative: seriesVar(2) };

interface SourceInfo {
  id: Source;
  available: boolean;
  needs?: "platform" | "channel";
  interval: number;
}
interface ListenQuery {
  id: string;
  name: string;
  terms: string[];
  excludes: string[];
  sources: Source[];
  lang: "tr" | "en" | "any";
  enabled: boolean;
  notify: boolean;
  aiSentiment: boolean;
  state: Partial<Record<Source, { lastRun?: string; error?: string | null; added?: number }>>;
  lastRunAt: string | null;
  unread: number;
}
interface Mention {
  id: string;
  queryId: string;
  source: Source;
  url: string;
  title: string | null;
  snippet: string | null;
  author: string | null;
  site: string | null;
  publishedAt: string;
  sentiment: Sentiment;
  sentimentBy: "lexicon" | "ai" | "user";
  reach: number | null;
  engagement: number | null;
  status: "new" | "seen" | "hidden";
  starred: boolean;
}
interface Totals {
  mentions: number;
  positive: number;
  neutral: number;
  negative: number;
  net: number | null;
  engagement: number;
  sites: number;
}
interface Report {
  range: { from: string; to: string; days: number; tz: string };
  dates: string[];
  totals: Totals;
  prev: Totals;
  bySourceDaily: Partial<Record<Source, number[]>>;
  sentimentDaily: Record<Sentiment, number[]>;
  sources: Array<{ key: Source; count: number }>;
  sites: Array<{ key: string; count: number }>;
  authors: Array<{ key: string; count: number }>;
  shareOfVoice: Array<{ id: string; name: string; count: number; positive: number; negative: number }>;
}
type View = "inbox" | "new" | "starred" | "hidden";
const PAGE = 30;

export function SourceIcon({ source, size = 18 }: { source: Source; size?: number }) {
  if (source === "reddit" || source === "bluesky" || source === "youtube") return <ProviderIcon provider={source} size={size + 4} />;
  if (source === "hn")
    return (
      <span className="mn-hn" style={{ width: size + 4, height: size + 4 }} aria-hidden="true">
        Y
      </span>
    );
  return <span className="mn-ico">{source === "news" ? <Newspaper aria-hidden="true" /> : <Globe2 aria-hidden="true" />}</span>;
}

/** Bahsetme izleme: marka ve rakiplerin haber, Reddit, Bluesky, Hacker News, YouTube ve web'deki bahsetmeleri */
export default function MentionsPage() {
  const { t, intl } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = s.can("editor");
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useLocalState<number>("sp_mn_days", 30);
  const [view, setView] = useState<View>("inbox");
  const [source, setSource] = useState<Source | "">("");
  const [sentiment, setSentiment] = useState<Sentiment | "">("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<ListenQuery | "new" | null>(null);
  const rawQuery = params.get("query") ?? "";

  const SOURCE_NAME: Record<Source, string> = { news: t("Haber"), reddit: "Reddit", bluesky: "Bluesky", hn: "Hacker News", youtube: "YouTube", web: t("Web") };
  const SENT_NAME: Record<Sentiment, string> = { positive: t("Olumlu"), neutral: t("Nötr"), negative: t("Olumsuz") };

  const queries = useQuery({ queryKey: ["listen-queries"], queryFn: () => api.get<{ items: ListenQuery[]; sources: SourceInfo[]; max: number; ai: boolean }>("/api/listening/queries"), refetchInterval: 60_000 });
  const list = queries.data?.items ?? [];
  const current = list.find((q) => q.id === rawQuery) ?? null;
  // Silinmiş ya da eski bir bağlantıdaki sorgu kimliği: "Tümü" gösterilir
  const queryId = current?.id ?? "";
  const qs = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") p.set(k, String(v));
    return p.toString();
  };
  const report = useQuery({
    queryKey: ["listen-report", queryId, days],
    queryFn: () => api.get<Report>(`/api/listening/report?${qs({ query: queryId, days })}`),
    enabled: list.length > 0 && !queries.isFetching,
  });
  const mentionQs = qs({ query: queryId, view, source, sentiment, q: term, days, limit });
  const mentions = useQuery({
    queryKey: ["mentions", mentionQs],
    queryFn: () => api.get<{ items: Mention[]; total: number }>(`/api/listening/mentions?${mentionQs}`),
    enabled: list.length > 0,
    placeholderData: (prev) => prev,
  });
  useEffect(() => setLimit(PAGE), [queryId, view, source, sentiment, term, days]);
  useEffect(() => {
    const id = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["listen-queries"] });
    qc.invalidateQueries({ queryKey: ["listen-report"] });
    qc.invalidateQueries({ queryKey: ["mentions"] });
  };
  const onErr = (e: unknown) => toast(errMsg(e), "err");
  const run = useMutation({
    mutationFn: (id: string) => api.post<{ added: number; bySource: Partial<Record<Source, { added: number; error: string | null }>> }>(`/api/listening/queries/${id}/run`),
    onSuccess: (r) => {
      const errs = Object.values(r.bySource).filter((x) => x?.error).length;
      toast(errs ? t("{n} yeni bahsetme; {e} kaynakta hata var", { n: r.added, e: errs }) : t("{n} yeni bahsetme", { n: r.added }), errs ? "info" : "ok");
      refresh();
    },
    onError: onErr,
  });
  const toggle = useMutation({ mutationFn: (q: ListenQuery) => api.patch(`/api/listening/queries/${q.id}`, { enabled: !q.enabled }), onSuccess: refresh, onError: onErr });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/listening/queries/${id}`),
    onSuccess: () => {
      setParams({});
      refresh();
    },
    onError: onErr,
  });
  const patch = useMutation({
    mutationFn: (x: { id: string; body: Partial<Pick<Mention, "status" | "starred" | "sentiment">> }) => api.patch<Mention>(`/api/listening/mentions/${x.id}`, x.body),
    onSuccess: refresh,
    onError: onErr,
  });
  const seenAll = useMutation({ mutationFn: () => api.post("/api/listening/mentions/seen", { query: queryId || undefined }), onSuccess: refresh, onError: onErr });

  const d = report.data;
  const num = (n: number | null) => fmtNum(n, intl);
  const compact = (n: number) => fmtCompact(n, intl);
  const pct = (part: number, of: number) => (of ? `${new Intl.NumberFormat(intl, { maximumFractionDigits: 0 }).format((part / of) * 100)}%` : "—");
  const names = new Map(list.map((q) => [q.id, q.name]));
  const terms = useMemo(() => (current ? current.terms : list.flatMap((q) => q.terms)), [current, list]);
  const unreadAll = list.reduce((a, q) => a + q.unread, 0);
  const sourcesInfo = new Map((queries.data?.sources ?? []).map((x) => [x.id, x]));

  const pickQuery = (id: string) => setParams(id ? { query: id } : {});

  return (
    <div className="cp mn">
      <PageHead
        title={t("Bahsetmeler")}
        sub={t("Markanın, ürünlerinin ve rakiplerinin haber siteleri, Reddit, Bluesky, YouTube ve web'de nerede konuşulduğunu izle; duygu ve hacim değişimini gör.")}
        actions={
          <>
            {list.length > 0 && (
              <div className="segmented" role="group" aria-label={t("Dönem")}>
                {[7, 30, 90].map((n) => (
                  <button key={n} className={days === n ? "active" : ""} aria-pressed={days === n} onClick={() => setDays(n)}>
                    {t("{n} gün", { n })}
                  </button>
                ))}
              </div>
            )}
            {canEdit && list.length < (queries.data?.max ?? 5) && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                <Plus aria-hidden="true" /> {t("Yeni izleme")}
              </button>
            )}
          </>
        }
      />

      {queries.isLoading ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : !list.length ? (
        <div className="card">
          <Empty
            icon={<AtSign />}
            title={t("Markan nerede konuşuluyor?")}
            text={t("Marka adını, ürünlerini ya da rakiplerini terim olarak ekle; haber siteleri, Reddit, Bluesky, Hacker News, YouTube ve web saatlik taransın. Olumsuz bahsetmeler için bildirim al.")}
            action={
              canEdit ? (
                <button className="btn btn-primary" onClick={() => setEditing("new")}>
                  <Plus aria-hidden="true" /> {t("İlk izlemeyi oluştur")}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="cp-body">
          <div className="card mn-bar">
            <div className="mn-chips" role="tablist" aria-label={t("İzleme sorguları")}>
              <button role="tab" aria-selected={!current} className={`mn-chip ${!current ? "on" : ""}`} onClick={() => pickQuery("")}>
                {t("Tümü")}
                {unreadAll > 0 && <span className="mn-badge">{unreadAll}</span>}
              </button>
              {list.map((q) => (
                <button key={q.id} role="tab" aria-selected={current?.id === q.id} className={`mn-chip ${current?.id === q.id ? "on" : ""} ${q.enabled ? "" : "off"}`} onClick={() => pickQuery(q.id)}>
                  {q.name}
                  {!q.enabled && <Pause aria-label={t("Duraklatıldı")} />}
                  {q.unread > 0 && <span className="mn-badge">{q.unread}</span>}
                </button>
              ))}
            </div>
            {current && (
              <div className="mn-qinfo">
                <span className="small muted">
                  {current.terms.map((x) => `“${x}”`).join(" · ")}
                  {current.excludes.length > 0 && ` · ${t("hariç")}: ${current.excludes.join(", ")}`}
                </span>
                {canEdit && (
                  <span className="ws-actions">
                    <button className="btn btn-sm" disabled={run.isPending} onClick={() => run.mutate(current.id)}>
                      <RefreshCw className={run.isPending ? "spin" : ""} aria-hidden="true" /> {t("Şimdi tara")}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(current)}>
                      <Pencil aria-hidden="true" /> {t("Düzenle")}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => toggle.mutate(current)}>
                      {current.enabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {current.enabled ? t("Duraklat") : t("Devam ettir")}
                    </button>
                    <button className="btn btn-sm btn-ghost cp-down" onClick={() => confirm(t("“{name}” izlemesi ve tüm bahsetmeleri silinsin mi?", { name: current.name })) && remove.mutate(current.id)}>
                      <Trash2 aria-hidden="true" /> {t("Sil")}
                    </button>
                  </span>
                )}
                <ul className="mn-status">
                  {current.sources.map((src) => {
                    const st = current.state[src];
                    const info = sourcesInfo.get(src);
                    return (
                      <li key={src} className={st?.error ? "err" : !info?.available ? "off" : ""}>
                        <SourceIcon source={src} size={14} />
                        <span>{SOURCE_NAME[src]}</span>
                        <span className="muted">
                          {!info?.available
                            ? info?.needs === "channel"
                              ? t("kanal bağlanınca")
                              : t("platform ayarı bekliyor")
                            : st?.error
                              ? t("hata")
                              : st?.lastRun
                                ? f.ago(st.lastRun)
                                : t("sırada")}
                        </span>
                        {st?.error && <span className="sr-only">{st.error}</span>}
                      </li>
                    );
                  })}
                </ul>
                {current.sources.some((src) => current.state[src]?.error) && (
                  <p className="small mn-err">
                    {current.sources
                      .filter((src) => current.state[src]?.error)
                      .map((src) => `${SOURCE_NAME[src]}: ${current.state[src]!.error}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
            )}
          </div>

          {d && (
            <>
              <div className="an-kpis">
                <StatTile label={t("Bahsetme")} value={compact(d.totals.mentions)} delta={delta(d.totals.mentions, d.prev.mentions)} compare note={t("{n} farklı kaynak", { n: d.totals.sites })} />
                <StatTile label={t("Olumlu")} value={pct(d.totals.positive, d.totals.mentions)} note={t("{n} bahsetme", { n: num(d.totals.positive) })} />
                <StatTile label={t("Olumsuz")} value={pct(d.totals.negative, d.totals.mentions)} delta={delta(d.totals.negative, d.prev.negative)} compare upIsGood={false} note={t("{n} bahsetme", { n: num(d.totals.negative) })} />
                <StatTile label={t("Net duygu")} value={d.totals.net === null ? "—" : new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(d.totals.net)} note={t("−100 (hep olumsuz) … +100 (hep olumlu)")} />
                <StatTile label={t("Etkileşim")} value={compact(d.totals.engagement)} delta={delta(d.totals.engagement, d.prev.engagement)} compare note={t("beğeni, yorum, oy (destekleyen kaynaklarda)")} />
              </div>

              <ChartCard
                title={t("Günlük bahsetme")}
                sub={t("Kaynağa göre")}
                table={() => (
                  <SimpleTable
                    caption={t("Günlük bahsetme")}
                    head={[t("Gün"), ...SOURCES.filter((x) => d.bySourceDaily[x]).map((x) => SOURCE_NAME[x])]}
                    rows={d.dates.map((date, i) => [fmtDay(date, intl), ...SOURCES.filter((x) => d.bySourceDaily[x]).map((x) => num(d.bySourceDaily[x]![i]))])}
                  />
                )}
              >
                <TimeChart
                  kind="bar"
                  stacked
                  dates={d.dates}
                  format={num}
                  ariaLabel={t("Kaynağa göre günlük bahsetme")}
                  height={180}
                  series={SOURCES.filter((x) => d.bySourceDaily[x]).map((x) => ({ key: x, label: SOURCE_NAME[x], color: SOURCE_COLOR[x], values: d.bySourceDaily[x]! }))}
                />
              </ChartCard>

              <div className="an-grid">
                <ChartCard title={t("Duygu")} sub={t("Gizlenenler hariç")}>
                  <div className="mn-sentbar" role="img" aria-label={(["positive", "neutral", "negative"] as Sentiment[]).map((x) => `${SENT_NAME[x]} ${pct(d.totals[x], d.totals.mentions)}`).join(", ")}>
                    {(["positive", "neutral", "negative"] as Sentiment[]).map((x) => (d.totals[x] > 0 ? <span key={x} style={{ flexGrow: d.totals[x], background: SENT_COLOR[x] }} /> : null))}
                  </div>
                  <BarList format={num} rows={(["positive", "neutral", "negative"] as Sentiment[]).map((x) => ({ key: x, label: SENT_NAME[x], value: d.totals[x], meta: pct(d.totals[x], d.totals.mentions), color: SENT_COLOR[x] }))} />
                </ChartCard>
                {d.shareOfVoice.length > 1 && (
                  <ChartCard title={t("Ses payı")} sub={t("İzlemeler arasında bahsetme dağılımı (marka ve rakipler)")}>
                    <BarList
                      format={num}
                      rows={d.shareOfVoice.map((x) => ({
                        key: x.id,
                        label: x.name,
                        value: x.count,
                        meta: `${pct(x.count, d.shareOfVoice.reduce((a, y) => a + y.count, 0))} · ${t("{p} olumlu, {n} olumsuz", { p: x.positive, n: x.negative })}`,
                        color: x.id === current?.id ? "var(--series-1)" : "var(--series-other)",
                      }))}
                    />
                  </ChartCard>
                )}
                <ChartCard title={t("Kaynaklar")} sub={t("Bahsetme sayısı")}>
                  {d.sources.length ? (
                    <BarList format={num} rows={d.sources.map((x) => ({ key: x.key, label: SOURCE_NAME[x.key], value: x.count, meta: pct(x.count, d.totals.mentions), color: SOURCE_COLOR[x.key] }))} />
                  ) : (
                    <p className="muted small">{t("Bu dönemde bahsetme yok.")}</p>
                  )}
                </ChartCard>
                <ChartCard title={t("En çok bahseden siteler")} sub={t("Haber sitesi, subreddit ya da alan adı")}>
                  {d.sites.length ? <BarList format={num} color="var(--series-7)" rows={d.sites.map((x) => ({ key: x.key, label: x.key, value: x.count }))} /> : <p className="muted small">{t("Bu dönemde bahsetme yok.")}</p>}
                </ChartCard>
                <ChartCard title={t("En çok bahseden hesaplar")} sub={t("Reddit, Bluesky, YouTube ve Hacker News")}>
                  {d.authors.length ? <BarList format={num} color="var(--series-5)" rows={d.authors.map((x) => ({ key: x.key, label: x.key, value: x.count }))} /> : <p className="muted small">{t("Bu dönemde hesap bilgisi olan bahsetme yok.")}</p>}
                </ChartCard>
              </div>
            </>
          )}

          <section className="card mn-feed" aria-labelledby="mn-feed-h">
            <div className="mn-feed-head">
              <h2 id="mn-feed-h" className="cc-title">
                {t("Bahsetmeler")} {mentions.data && <span className="muted small">({num(mentions.data.total)})</span>}
              </h2>
              <div className="segmented seg-scroll" role="group" aria-label={t("Görünüm")}>
                {(
                  [
                    ["inbox", t("Tümü")],
                    ["new", t("Yeni")],
                    ["starred", t("Yıldızlı")],
                    ["hidden", t("Gizlenen")],
                  ] as Array<[View, string]>
                ).map(([v, label]) => (
                  <button key={v} className={view === v ? "active" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mn-filters">
              <label className="input-icon">
                <Search aria-hidden="true" />
                <span className="sr-only">{t("Bahsetmelerde ara")}</span>
                <input className="input" placeholder={t("Bahsetmelerde ara…")} value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
              </label>
              <select className="select" value={source} onChange={(e) => setSource(e.target.value as Source | "")} aria-label={t("Kaynak")}>
                <option value="">{t("Tüm kaynaklar")}</option>
                {SOURCES.map((x) => (
                  <option key={x} value={x}>
                    {SOURCE_NAME[x]}
                  </option>
                ))}
              </select>
              <select className="select" value={sentiment} onChange={(e) => setSentiment(e.target.value as Sentiment | "")} aria-label={t("Duygu")}>
                <option value="">{t("Tüm duygular")}</option>
                {(["positive", "neutral", "negative"] as Sentiment[]).map((x) => (
                  <option key={x} value={x}>
                    {SENT_NAME[x]}
                  </option>
                ))}
              </select>
              <span className="mn-filter-actions">
                {canEdit && (
                  <button className="btn btn-sm btn-ghost" disabled={seenAll.isPending || !(current ? current.unread : unreadAll)} onClick={() => seenAll.mutate()}>
                    <CheckCheck aria-hidden="true" /> {t("Tümünü okundu say")}
                  </button>
                )}
                <a className="btn btn-sm btn-ghost" href={`/api/listening/mentions?${qs({ query: queryId, view, source, sentiment, q: term, days, format: "csv" })}`}>
                  <Download aria-hidden="true" /> CSV
                </a>
              </span>
            </div>

            {!mentions.data ? (
              <p className="muted small">{t("Yükleniyor…")}</p>
            ) : !mentions.data.items.length ? (
              <p className="muted small mn-none">
                {list.every((q) => !q.lastRunAt) ? t("İlk tarama sürüyor; sonuçlar birkaç dakika içinde gelir.") : t("Bu süzgeçle bahsetme yok.")}
              </p>
            ) : (
              <ul className="mn-list">
                {mentions.data.items.map((m) => (
                  <li key={m.id} className={`mn-item ${m.status === "new" ? "is-new" : ""}`}>
                    <SourceIcon source={m.source} />
                    <div className="mn-body">
                      <div className="mn-meta small">
                        <strong>{m.site ?? SOURCE_NAME[m.source]}</strong>
                        {m.author && <span>{m.author}</span>}
                        <time dateTime={m.publishedAt} title={f.short(m.publishedAt)}>
                          {f.ago(m.publishedAt)}
                        </time>
                        {!current && names.get(m.queryId) && <span className="mn-qtag">{names.get(m.queryId)}</span>}
                        {m.status === "new" && <span className="mn-newtag">{t("Yeni")}</span>}
                      </div>
                      <a className="mn-title" href={m.url} target="_blank" rel="noopener noreferrer" onClick={() => m.status === "new" && canEdit && patch.mutate({ id: m.id, body: { status: "seen" } })}>
                        <Highlight text={m.title ?? m.snippet ?? m.url} terms={terms} />
                      </a>
                      {m.title && m.snippet && m.snippet !== m.title && (
                        <p className="mn-snippet">
                          <Highlight text={m.snippet} terms={terms} />
                        </p>
                      )}
                      <div className="mn-foot">
                        <span className={`mn-sent mn-sent--${m.sentiment}`} title={m.sentimentBy === "ai" ? t("AI ile sınıflandırıldı") : m.sentimentBy === "user" ? t("Elle düzeltildi") : t("Sözlükle tahmin edildi")}>
                          <i style={{ background: SENT_COLOR[m.sentiment] }} aria-hidden="true" />
                          {canEdit ? (
                            <select className="mn-sent-select" value={m.sentiment} aria-label={t("Duygu")} onChange={(e) => patch.mutate({ id: m.id, body: { sentiment: e.target.value as Sentiment } })}>
                              {(["positive", "neutral", "negative"] as Sentiment[]).map((x) => (
                                <option key={x} value={x}>
                                  {SENT_NAME[x]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            SENT_NAME[m.sentiment]
                          )}
                        </span>
                        {(m.engagement ?? 0) + Math.max(0, m.reach ?? 0) > 0 && <span className="small muted">{t("{n} etkileşim", { n: num((m.engagement ?? 0) + Math.max(0, m.reach ?? 0)) })}</span>}
                        {canEdit && (
                          <span className="mn-actions">
                            <IconBtn label={m.starred ? t("Yıldızı kaldır") : t("Yıldızla")} on={m.starred} onClick={() => patch.mutate({ id: m.id, body: { starred: !m.starred } })}>
                              <Star aria-hidden="true" />
                            </IconBtn>
                            {m.status === "hidden" ? (
                              <IconBtn label={t("Geri getir")} onClick={() => patch.mutate({ id: m.id, body: { status: "seen" } })}>
                                <Eye aria-hidden="true" />
                              </IconBtn>
                            ) : (
                              <IconBtn label={t("Gizle (alakasız)")} onClick={() => patch.mutate({ id: m.id, body: { status: "hidden" } })}>
                                <EyeOff aria-hidden="true" />
                              </IconBtn>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {mentions.data && mentions.data.items.length < mentions.data.total && (
              <button className="btn mn-more" disabled={mentions.isFetching} onClick={() => setLimit((n) => Math.min(200, n + PAGE))}>
                {limit >= 200 ? t("İlk 200 gösteriliyor; daha fazlası için CSV indir") : t("Daha fazla göster")}
              </button>
            )}
          </section>
          <p className="small muted">{t("Haberler yayıncıların RSS akışlarından ve GDELT Projesi'nden (gdeltproject.org), Hacker News Algolia aramasından gelir. Yalnızca herkese açık içerik izlenir; özel hesaplar ve kapalı gruplar görünmez. Duygu sözlükle tahmin edilir; yanlışsa bahsetmenin üzerinden düzeltebilirsin.")}</p>
        </div>
      )}

      {editing && (
        <QueryModal
          initial={editing === "new" ? null : editing}
          sources={queries.data?.sources ?? []}
          ai={queries.data?.ai ?? false}
          sourceName={SOURCE_NAME}
          onClose={() => setEditing(null)}
          onSaved={(q) => {
            setEditing(null);
            pickQuery(q.id);
            refresh();
            // İlk tarama arka planda: birkaç saniye sonra yeniden çek
            setTimeout(refresh, 8000);
            setTimeout(refresh, 25000);
          }}
        />
      )}
    </div>
  );
}

function IconBtn({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`btn btn-ghost btn-sm mn-ib ${on ? "on" : ""}`} aria-label={label} aria-pressed={on} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** Aranan terimleri metinde vurgula (büyük/küçük harf duyarsız) */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => {
    const clean = terms.filter((x) => x.trim().length >= 2);
    if (!clean.length) return [text];
    const re = new RegExp(`(${clean.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
    return text.split(re);
  }, [text, terms]);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

function QueryModal({
  initial,
  sources,
  ai,
  sourceName,
  onClose,
  onSaved,
}: {
  initial: ListenQuery | null;
  sources: SourceInfo[];
  ai: boolean;
  sourceName: Record<Source, string>;
  onClose: () => void;
  onSaved: (q: ListenQuery) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const defaults = sources.filter((x) => x.available && x.id !== "hn").map((x) => x.id);
  const [name, setName] = useState(initial?.name ?? "");
  const [terms, setTerms] = useState((initial?.terms ?? []).join("\n"));
  const [excludes, setExcludes] = useState((initial?.excludes ?? []).join("\n"));
  const [picked, setPicked] = useState<Source[]>(initial?.sources ?? defaults);
  const [lang, setLang] = useState<ListenQuery["lang"]>(initial?.lang ?? "tr");
  const [notifyOn, setNotify] = useState(initial?.notify ?? true);
  const [aiOn, setAi] = useState(initial?.aiSentiment ?? false);
  const lines = (s: string) =>
    s
      .split(/[\n,]/)
      .map((x) => x.trim().replace(/"/g, ""))
      .filter(Boolean);
  const termList = lines(terms);
  const short = termList.filter((x) => x.length < 3);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim() || termList[0], terms: termList, excludes: lines(excludes), sources: picked, lang, notify: notifyOn, aiSentiment: aiOn };
      return initial ? api.patch<ListenQuery>(`/api/listening/queries/${initial.id}`, body) : api.post<ListenQuery>("/api/listening/queries", body);
    },
    onSuccess: onSaved,
    onError: (e) => toast(errMsg(e), "err"),
  });
  const valid = termList.length > 0 && termList.length <= 10 && !short.length && picked.length > 0;
  const needText = (x: SourceInfo) => (x.needs === "channel" ? t("Bir YouTube kanalı bağlayınca açılır") : t("Platform yöneticisinin bu kaynağı açması gerekiyor"));
  return (
    <Modal
      title={initial ? t("İzlemeyi düzenle") : t("Yeni izleme")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button className="btn btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {initial ? t("Kaydet") : t("İzlemeyi başlat")}
          </button>
        </>
      }
    >
      <div className="mn-form">
        <div className="field">
          <label htmlFor="mn-name">{t("Ad")}</label>
          <input id="mn-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("Ör. Markamız, Rakip A, Yeni ürün")} />
        </div>
        <div className="field">
          <label htmlFor="mn-terms">{t("Aranacak terimler")}</label>
          <textarea id="mn-terms" className="textarea" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={t("Her satıra bir terim: marka adı, ürün adı, kampanya etiketi…")} />
          <span className="help">
            {short.length ? <span className="mn-err">{t("En az 3 karakter: {list}", { list: short.join(", ") })}</span> : t("Birden çok kelimeli terimler tam ifade olarak aranır. En fazla 10 terim; herhangi biri geçerse sayılır.")}
          </span>
        </div>
        <div className="field">
          <label htmlFor="mn-excludes">{t("Hariç tutulacaklar (isteğe bağlı)")}</label>
          <textarea id="mn-excludes" className="textarea" rows={2} value={excludes} onChange={(e) => setExcludes(e.target.value)} placeholder={t("Ör. aynı adı taşıyan başka bir şey: tarif, şarkı…")} />
        </div>
        <fieldset className="field mn-fieldset">
          <legend>{t("Kaynaklar")}</legend>
          <div className="mn-srcs">
            {sources.map((x) => (
              <label key={x.id} className={`mn-src ${x.available ? "" : "off"}`} title={x.available ? undefined : needText(x)}>
                <input
                  type="checkbox"
                  disabled={!x.available}
                  checked={x.available && picked.includes(x.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((y) => y !== x.id))}
                />
                <SourceIcon source={x.id} size={14} />
                <span>{sourceName[x.id]}</span>
                {!x.available && <span className="help">{needText(x)}</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="mn-lang">{t("Dil")}</label>
          <select id="mn-lang" className="select" value={lang} onChange={(e) => setLang(e.target.value as ListenQuery["lang"])}>
            <option value="tr">{t("Türkçe")}</option>
            <option value="en">{t("İngilizce")}</option>
            <option value="any">{t("Tüm diller")}</option>
          </select>
        </div>
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={notifyOn} onChange={(e) => setNotify(e.target.checked)} />
          {t("Yeni bahsetmede bildirim gönder (olumsuzlar ayrıca belirtilir)")}
        </label>
        <label className="row small" style={{ gap: 8 }} title={ai ? undefined : t("AI kapalı")}>
          <input type="checkbox" checked={aiOn && ai} disabled={!ai} onChange={(e) => setAi(e.target.checked)} />
          {t("Duyguyu AI ile sınıflandır (her taramada bir AI kullanımı)")}
        </label>
      </div>
    </Modal>
  );
}
