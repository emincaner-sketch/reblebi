import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Mail, Presentation, Printer, Save, Send } from "lucide-react";
import { api, errMsg, PROVIDER_NAME, type Campaign, type Media, type OrgSettings, type ProviderId, type ReportSection } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { ErrorBox, PageHead, ProviderIcon, useToast } from "../components/ui";
import type { AnalyticsReport } from "../panel/analytics/types";
import { BarList } from "../panel/charts/BarList";
import { delta, fmtCompact, fmtDay, fmtNum, fmtPct, fmtRange } from "../panel/charts/format";
import { Heatmap } from "../panel/charts/Heatmap";
import { PRIMARY_SERIES } from "../panel/charts/palette";
import { StatTile } from "../panel/charts/StatTile";
import { TimeChart } from "../panel/charts/TimeChart";
import "../panel/charts/charts.css";
import "../panel/analytics/report.css";

type Preset = "7" | "30" | "90" | "month" | "lastMonth" | "custom";
const ALL_SECTIONS: ReportSection[] = ["summary", "followers", "networks", "engagement", "kinds", "timing", "topPosts", "hashtags"];
const COLORS = ["#5b49f2", "#1a1726", "#eb6834", "#1baf7a", "#d9a441", "#e34948", "#2a78d6"];

function todayIn(tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Vurgu rengi üzerinde okunur yazı rengi (WCAG 4.5:1) */
function onColor(hex: string): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return 1.05 / (l + 0.05) >= 4.5 ? "#ffffff" : "#1a1726";
}

function Sec({ id, title, children, lead }: { id: string; title: string; children: ReactNode; lead?: string }) {
  return (
    <section className="rp-sec" aria-labelledby={`rp-${id}`}>
      <h2 id={`rp-${id}`} className="rp-h2">
        {title}
      </h2>
      {lead && <p className="rp-lead">{lead}</p>}
      {children}
    </section>
  );
}

/**
 * Markalı rapor (Metricool "Reports" karşılığı): logo + renk + seçili bölümler, A4 sayfa olarak yazdır / PDF kaydet.
 * Dönem ve süzgeçler Analitik ile aynı URL parametreleridir (p, from, to, network, campaign).
 */
export default function ReportPage() {
  const { t, intl } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const network = (params.get("network") as ProviderId | null) || null;
  const campaignId = params.get("campaign") || null;
  const preset = (params.get("p") as Preset | null) ?? "30";
  const today = todayIn(f.tz);
  const [customFrom, setCustomFrom] = useState(params.get("from") ?? addDays(today, -29));
  const [customTo, setCustomTo] = useState(params.get("to") ?? today);

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<OrgSettings>("/api/settings") });
  const media = useQuery({ queryKey: ["media", "image"], queryFn: () => api.get<Media[]>("/api/media?kind=image&limit=60") });
  const campaign = useQuery({ queryKey: ["campaign", campaignId], queryFn: () => api.get<Campaign>(`/api/campaigns/${campaignId}`), enabled: Boolean(campaignId) });

  // Rapora özel görünüm: kayıtlı varsayılanlardan başlar, değişiklik yalnızca "Varsayılan yap" ile kaydedilir
  const [sections, setSections] = useState<ReportSection[]>(ALL_SECTIONS);
  const [logo, setLogo] = useState("");
  const [color, setColor] = useState("#5b49f2");
  const [intro, setIntro] = useState("");
  const [emailFreq, setEmailFreq] = useState<OrgSettings["reportEmail"]>("off");
  const [recipients, setRecipients] = useState("");
  useEffect(() => {
    const d = settings.data;
    if (!d) return;
    setSections(d.reportSections?.length ? d.reportSections : ALL_SECTIONS);
    setLogo(d.reportLogoUrl ?? "");
    setColor(d.reportColor || "#5b49f2");
    setIntro(d.reportIntro ?? "");
    setEmailFreq(d.reportEmail ?? "off");
    setRecipients(d.reportRecipients ?? "");
  }, [settings.data]);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (preset === "custom") {
      q.set("from", params.get("from") ?? customFrom);
      q.set("to", params.get("to") ?? customTo);
    } else if (preset === "month") {
      q.set("from", today.slice(0, 8) + "01");
      q.set("to", today);
    } else if (preset === "lastMonth") {
      const end = addDays(today.slice(0, 8) + "01", -1);
      q.set("from", end.slice(0, 8) + "01");
      q.set("to", end);
    } else q.set("days", preset);
    if (network) q.set("provider", network);
    if (campaignId) q.set("campaignId", campaignId);
    return q.toString();
  }, [preset, params, network, campaignId, today, customFrom, customTo]);
  const rq = useQuery({ queryKey: ["analytics-report", query], queryFn: () => api.get<AnalyticsReport>(`/api/analytics/report?${query}`), placeholderData: keepPreviousData });

  const saveDefaults = useMutation({
    mutationFn: (patch: Partial<OrgSettings>) => api.put<OrgSettings>("/api/settings", patch),
    onSuccess: (d) => {
      qc.setQueryData(["settings"], d);
      toast(t("Kaydedildi"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const testMail = useMutation({
    mutationFn: () => api.post<{ sent: boolean; to: string }>("/api/reports/email/test"),
    onSuccess: (r) => toast(r.sent ? t("Test e-postası gönderildi: {to}", { to: r.to }) : t("E-posta sunucusu ayarlı değil; içerik sunucu günlüğüne yazıldı."), r.sent ? "ok" : "info"),
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
  const toggleSection = (k: ReportSection) => setSections((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : ALL_SECTIONS.filter((x) => x === k || cur.includes(x))));
  const has = (k: ReportSection) => sections.includes(k);

  const d = rq.data;
  if (rq.isError && !d) return <ErrorBox error={rq.error} />;
  const num = (n: number) => fmtNum(n, intl);
  const compact = (n: number) => fmtCompact(n, intl);
  const k = d?.kpis;
  const brand = settings.data?.brandName?.trim() || s.org.name;
  const accent = /^#[0-9a-f]{6}$/i.test(color) ? color : "#5b49f2";
  const ink = onColor(accent);
  const scope = campaignId ? t("Kampanya: {name}", { name: campaign.data?.name ?? "…" }) : network ? PROVIDER_NAME[network] : t("Tüm ağlar");
  const presetLabel: Record<Preset, string> = { "7": t("7 gün"), "30": t("30 gün"), "90": t("90 gün"), month: t("Bu ay"), lastMonth: t("Geçen ay"), custom: t("Özel") };
  const sectionLabel: Record<ReportSection, string> = {
    summary: t("Özet ve öne çıkanlar"),
    followers: t("Takipçi gelişimi"),
    networks: t("Ağlara göre"),
    engagement: t("Etkileşim ve görüntülenme"),
    kinds: t("İçerik türleri"),
    timing: t("En iyi gün ve saatler"),
    topPosts: t("En iyi gönderiler"),
    hashtags: t("Hashtag'ler"),
  };

  // Öne çıkanlar: veriden kendiliğinden yazılan kısa cümleler (yalnızca veri varsa)
  const highlights: string[] = [];
  if (d && k) {
    const di = delta(k.interactions.value, k.interactions.prev);
    if (di.pct !== null && Math.abs(di.pct) >= 1) highlights.push(di.pct > 0 ? t("Etkileşim önceki döneme göre %{p} arttı.", { p: fmtNum(Math.round(di.pct), intl) }) : t("Etkileşim önceki döneme göre %{p} azaldı.", { p: fmtNum(Math.round(Math.abs(di.pct)), intl) }));
    if (k.followersDelta.value !== null && k.followersDelta.value !== 0)
      highlights.push(k.followersDelta.value > 0 ? t("Bu dönemde {n} yeni takipçi kazanıldı.", { n: num(k.followersDelta.value) }) : t("Takipçi sayısı bu dönemde {n} azaldı.", { n: num(Math.abs(k.followersDelta.value)) }));
    const top = [...d.posts].filter((p) => p.interactions !== null).sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0))[0];
    if (top) highlights.push(t("En çok etkileşim alan gönderi: “{text}” ({channel}, {n} etkileşim).", { text: (top.preview || L.kind(top.kind)).slice(0, 70), channel: top.channel, n: num(top.interactions ?? 0) }));
    const bestNet = d.byProvider.filter((p) => p.engagementRate !== null && p.postsWithMetrics >= 2).sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))[0];
    if (bestNet && d.byProvider.length > 1) highlights.push(t("En yüksek etkileşim oranı: {net} (%{r}).", { net: PROVIDER_NAME[bestNet.provider], r: fmtNum(bestNet.engagementRate, intl) }));
    const bestCell = d.heatmap.cells.filter((c) => c.withMetrics >= 2 && c.avgInteractions !== null).sort((a, b) => (b.avgInteractions ?? 0) - (a.avgInteractions ?? 0))[0];
    if (bestCell) highlights.push(t("En iyi paylaşım zamanı: {day} {hour}:00.", { day: new Intl.DateTimeFormat(intl, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + bestCell.weekday))), hour: String(bestCell.hour).padStart(2, "0") }));
  }
  const topPosts = d ? [...d.posts].filter((p) => p.interactions !== null).sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0)).slice(0, 10) : [];
  const isAdmin = s.can("admin");

  // PowerPoint: aynı bölümler, PowerPoint'in düzenlenebilir grafikleriyle
  const [pptxBusy, setPptxBusy] = useState(false);
  const downloadPptx = async () => {
    if (!d || !k) return;
    setPptxBusy(true);
    try {
      const day = (x: string) => fmtDay(x, intl);
      const sign = (n: number | null) => (n === null ? "—" : new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(n));
      const dl = (v: number | null, prev: number | null) => {
        const x = delta(v, prev);
        return x.pct === null ? null : `${x.pct >= 0 ? "▲" : "▼"} %${fmtNum(Math.abs(Math.round(x.pct * 10) / 10), intl)} ${t("önceki döneme göre")}`;
      };
      const kp = (label: string, value: string, v: number | null, prev: number | null, upGood = true) => {
        const x = delta(v, prev);
        return { label, value, delta: dl(v, prev), good: x.pct === null || x.pct === 0 ? null : (x.pct > 0) === upGood };
      };
      const blocks: Parameters<typeof import("../panel/analytics/pptx").exportPptx>[0]["blocks"] = [];
      if (has("followers"))
        blocks.push({ type: "chart", chart: { title: t("Takipçi gelişimi"), lead: t("Günlük toplam; kanal bağlandığı günden itibaren."), kind: "line", labels: d.daily.map((x) => day(x.date)), series: [{ name: t("Takipçi"), values: d.daily.map((x) => x.followers) }] } });
      if (has("networks") && d.byProvider.length)
        blocks.push({
          type: "table",
          table: {
            title: t("Ağlara göre"),
            head: [t("Ağ"), t("Takipçi"), t("Değişim"), t("Gönderi"), t("Etkileşim"), t("Görüntülenme"), t("Oran")],
            numeric: [1, 2, 3, 4, 5, 6],
            rows: d.byProvider.map((p) => [PROVIDER_NAME[p.provider], p.followers === null ? "—" : num(p.followers), sign(p.followersDelta), num(p.posts), num(p.interactions), num(p.views), fmtPct(p.engagementRate, intl)]),
          },
        });
      if (has("engagement"))
        blocks.push({
          type: "charts2",
          charts: [
            { title: t("Günlük etkileşim"), lead: t("Yayınlanan gönderilerin son çekilen metrikleri, yayın gününe göre."), kind: "bar", labels: d.daily.map((x) => day(x.date)), series: [{ name: t("Etkileşim"), values: d.daily.map((x) => x.interactions) }] },
            { title: t("Günlük görüntülenme"), kind: "line", labels: d.daily.map((x) => day(x.date)), series: [{ name: t("Görüntülenme"), values: d.daily.map((x) => x.views) }] },
          ],
        });
      if (has("kinds") && d.kinds.length)
        blocks.push({ type: "chart", chart: { title: t("İçerik türleri"), lead: t("Gönderi başına ortalama etkileşim"), kind: "bar", labels: d.kinds.map((x) => L.kind(x.kind)), series: [{ name: t("Ort. etkileşim"), values: d.kinds.map((x) => x.avgInteractions) }] } });
      if (has("timing")) {
        const cells = d.heatmap.cells.filter((c) => c.avgInteractions !== null && c.withMetrics > 0).sort((a, b) => (b.avgInteractions ?? 0) - (a.avgInteractions ?? 0)).slice(0, 10);
        if (cells.length)
          blocks.push({
            type: "table",
            table: {
              title: t("En iyi gün ve saatler"),
              lead: t("Kendi gönderilerinin ortalama etkileşimi · {tz}", { tz: d.range.tz }),
              head: [t("Gün ve saat"), t("Gönderi"), t("Ort. etkileşim")],
              numeric: [1, 2],
              rows: cells.map((c) => [`${new Intl.DateTimeFormat(intl, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + c.weekday)))} ${String(c.hour).padStart(2, "0")}:00`, num(c.posts), c.avgInteractions === null ? "—" : num(c.avgInteractions)]),
            },
          });
      }
      if (has("topPosts") && topPosts.length)
        blocks.push({
          type: "table",
          table: {
            title: t("En iyi gönderiler"),
            lead: t("Etkileşime göre ilk 10"),
            head: ["#", t("İçerik"), t("Kanal"), t("Tarih"), t("Görüntülenme"), t("Etkileşim"), t("Oran")],
            numeric: [0, 4, 5, 6],
            rows: topPosts.map((p, i) => [String(i + 1), (p.preview || L.kind(p.kind)).slice(0, 90), p.channel, f.short(p.publishedAt), fmtNum(p.views, intl), fmtNum(p.interactions, intl), fmtPct(p.engagementRate, intl)]),
          },
        });
      if (has("hashtags") && d.hashtags.length)
        blocks.push({
          type: "table",
          table: {
            title: t("Hashtag'ler"),
            lead: t("Etkileşime göre ilk 10"),
            head: [t("Hashtag"), t("Gönderi"), t("Etkileşim"), t("Gönderi başına")],
            numeric: [1, 2, 3],
            rows: [...d.hashtags].sort((a, b) => b.interactions - a.interactions).slice(0, 10).map((h) => [h.tag, num(h.posts), num(h.interactions), num(Math.round(h.interactions / Math.max(1, h.posts)))]),
          },
        });
      const { exportPptx } = await import("../panel/analytics/pptx");
      await exportPptx({
        fileName: `${brand.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "rapor"}-${d.range.from}_${d.range.to}.pptx`,
        brand,
        color: accent,
        logo: logo || null,
        kicker: t("Sosyal medya raporu"),
        title: scope,
        period: fmtRange(d.range.from, d.range.to, intl),
        compare: t("karşılaştırma: {r}", { r: fmtRange(d.range.prevFrom, d.range.prevTo, intl) }),
        prepared: t("Hazırlayan: {name} · {date}", { name: s.user?.name || s.user?.email || brand, date: fmtDay(today, intl, { day: "numeric", month: "long", year: "numeric" }) }),
        intro: intro.trim(),
        summaryTitle: t("Özet"),
        kpis: has("summary")
          ? [
              kp(t("Takipçi"), compact(k.followers.value ?? 0), k.followers.value, k.followers.prev),
              kp(t("Yayınlanan gönderi"), num(k.posts.value ?? 0), k.posts.value, k.posts.prev),
              kp(t("Etkileşim"), compact(k.interactions.value ?? 0), k.interactions.value, k.interactions.prev),
              kp(t("Görüntülenme"), compact(k.views.value ?? 0), k.views.value, k.views.prev),
              kp(t("Etkileşim oranı"), fmtPct(k.engagementRate.value, intl), k.engagementRate.value, k.engagementRate.prev),
              kp(t("Otomatik yanıt oranı"), fmtPct(k.autoReplyRate.value, intl), k.autoReplyRate.value, k.autoReplyRate.prev),
            ]
          : [],
        highlightsTitle: t("Öne çıkanlar"),
        highlights: has("summary") ? highlights : [],
        blocks,
        footer: `${brand} · ${fmtRange(d.range.from, d.range.to, intl)} · ${t("Kaynak: platform API'leri, Reblebi ile hazırlandı")}`,
      });
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setPptxBusy(false);
    }
  };

  return (
    <div className="rp">
      <div className="rp-noprint">
        <PageHead
          title={t("Markalı rapor")}
          sub={t("Logonu ve rengini ekle, bölümleri seç; tarayıcının yazdır penceresinden PDF olarak kaydet ya da müşterine gönder.")}
          actions={
            <>
              <Link className="btn" to={`/app/analytics?${params}`}>
                <ArrowLeft aria-hidden="true" /> {t("Analitiğe dön")}
              </Link>
              <button className="btn" onClick={() => void downloadPptx()} disabled={!d || pptxBusy}>
                <Presentation aria-hidden="true" /> {pptxBusy ? t("Hazırlanıyor…") : t("PowerPoint")}
              </button>
              <button className="btn btn-primary" onClick={() => window.print()} disabled={!d}>
                <Printer aria-hidden="true" /> {t("Yazdır / PDF")}
              </button>
            </>
          }
        />

        <div className="rp-tools">
          <section className="card form" aria-labelledby="rp-t-period">
            <h2 id="rp-t-period" className="rp-th">
              {t("Dönem")}
            </h2>
            <div className="segmented rp-seg" role="group" aria-label={t("Dönem")}>
              {(["7", "30", "90", "month", "lastMonth", "custom"] as Preset[]).map((p) => (
                <button key={p} className={preset === p ? "active" : ""} aria-pressed={preset === p} onClick={() => set(p === "custom" ? { p, from: customFrom, to: customTo } : { p, from: null, to: null })}>
                  {presetLabel[p]}
                </button>
              ))}
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
            <p className="small muted" style={{ margin: 0 }}>
              {t("Kapsam: {scope}. Ağ ya da kampanya seçmek için sol menüyü ya da Analitik'teki süzgeçleri kullan.", { scope })}
            </p>
          </section>

          <section className="card form" aria-labelledby="rp-t-sec">
            <h2 id="rp-t-sec" className="rp-th">
              {t("Bölümler")}
            </h2>
            <div className="rp-checks">
              {ALL_SECTIONS.map((x) => (
                <label key={x} className="row small" style={{ gap: 8 }}>
                  <input type="checkbox" checked={has(x)} onChange={() => toggleSection(x)} /> {sectionLabel[x]}
                </label>
              ))}
            </div>
          </section>

          <section className="card form" aria-labelledby="rp-t-brand">
            <h2 id="rp-t-brand" className="rp-th">
              {t("Marka")}
            </h2>
            <div className="field">
              <label htmlFor="rp-logo">{t("Logo")}</label>
              <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                <input id="rp-logo" className="input" placeholder="https://…" value={logo} onChange={(e) => setLogo(e.target.value)} />
                {(media.data?.length ?? 0) > 0 && (
                  <select className="input select-sm" aria-label={t("Medyadan seç")} value="" onChange={(e) => e.target.value && setLogo(e.target.value)}>
                    <option value="">{t("Medyadan seç…")}</option>
                    {media.data!.map((m) => (
                      <option key={m.id} value={m.url}>
                        {m.originalName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="field">
              <span className="rp-lbl" id="rp-color-l">
                {t("Rapor rengi")}
              </span>
              <div className="rp-swatches" role="group" aria-labelledby="rp-color-l">
                {COLORS.map((c) => (
                  <button key={c} className={`rp-sw ${accent === c ? "on" : ""}`} style={{ background: c }} aria-label={c} aria-pressed={accent === c} onClick={() => setColor(c)} />
                ))}
                <input type="color" aria-label={t("Özel renk")} value={accent} onChange={(e) => setColor(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="rp-intro">{t("Giriş notu")}</label>
              <textarea id="rp-intro" className="input" rows={3} maxLength={1500} value={intro} onChange={(e) => setIntro(e.target.value)} placeholder={t("Örn. Bu ay kampanya haftasında etkileşim rekor kırdı; gelecek ay Reels sayısını artırıyoruz.")} />
            </div>
            {isAdmin && (
              <button
                className="btn btn-sm"
                disabled={saveDefaults.isPending}
                onClick={() => saveDefaults.mutate({ reportLogoUrl: logo.trim(), reportColor: accent, reportSections: sections, reportIntro: intro })}
                title={t("Bu çalışma alanındaki herkes ve e-posta özetleri bu görünümü kullanır")}
              >
                <Save aria-hidden="true" /> {t("Varsayılan yap")}
              </button>
            )}
          </section>

          <section className="card form" aria-labelledby="rp-t-mail">
            <h2 id="rp-t-mail" className="rp-th">
              <Mail aria-hidden="true" /> {t("E-posta özeti")}
            </h2>
            <div className="segmented" role="group" aria-label={t("Sıklık")}>
              {(
                [
                  ["off", t("Kapalı")],
                  ["weekly", t("Haftalık")],
                  ["monthly", t("Aylık")],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={emailFreq === v ? "active" : ""} aria-pressed={emailFreq === v} disabled={!isAdmin} onClick={() => setEmailFreq(v)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {emailFreq === "weekly" ? t("Her pazartesi 09:00'da geçen haftanın özeti.") : emailFreq === "monthly" ? t("Her ayın ilk günü 09:00'da geçen ayın özeti.") : t("Özet e-postası gönderilmez.")}
            </p>
            <div className="field">
              <label htmlFor="rp-rcpt">{t("Alıcılar")}</label>
              <input id="rp-rcpt" className="input" placeholder={t("Boşsa sahip ve yöneticiler")} value={recipients} disabled={!isAdmin} onChange={(e) => setRecipients(e.target.value)} />
              <span className="help">{t("Virgülle ayır; en fazla 10 adres.")}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {isAdmin && (
                <button className="btn btn-sm btn-primary" disabled={saveDefaults.isPending} onClick={() => saveDefaults.mutate({ reportEmail: emailFreq, reportRecipients: recipients.trim() })}>
                  <Save aria-hidden="true" /> {t("Kaydet")}
                </button>
              )}
              <button className="btn btn-sm" disabled={testMail.isPending} onClick={() => testMail.mutate()}>
                <Send aria-hidden="true" /> {t("Bana test e-postası gönder")}
              </button>
            </div>
          </section>

          <section className="card form" aria-labelledby="rp-t-export">
            <h2 id="rp-t-export" className="rp-th">
              <Download aria-hidden="true" /> {t("Dışa aktar")}
            </h2>
            <p className="small muted" style={{ margin: 0 }}>
              {t("Kanal × gün tablosu: takipçi, gönderi, etkileşim, erişim, profil ziyareti… Excel, Google Sheets ya da kendi panon için.")}
            </p>
            {d && (
              <a className="btn btn-sm" href={`/api/export/daily?${new URLSearchParams({ format: "csv", from: d.range.from, to: d.range.to })}`}>
                <Download aria-hidden="true" /> {t("Günlük CSV indir")}
              </a>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              {t("Looker Studio: Ayarlar > API anahtarları'ndan bir anahtar oluştur; bağlayıcı dosyalarını script.google.com'da yeni bir projeye yapıştırıp Looker Studio bağlayıcısı olarak dağıt, sonra bu anahtarla bağlan.")}
            </p>
            <p className="small row" style={{ margin: 0, gap: 12, flexWrap: "wrap" }}>
              <a href="/integrations/looker-studio/Code.gs" download>
                Code.gs
              </a>
              <a href="/integrations/looker-studio/appsscript.json" download>
                appsscript.json
              </a>
            </p>
          </section>
        </div>
      </div>

      {/* ---------------- A4 sayfa ---------------- */}
      <div className="rp-stage">
        {!d || !k ? (
          <div className="rp-paper rp-loading">{t("Yükleniyor…")}</div>
        ) : (
          <article className="rp-paper" style={{ ["--rp-accent" as string]: accent, ["--rp-ink" as string]: ink }} aria-label={t("Rapor önizlemesi")}>
            <header className="rp-cover">
              <div className="rp-brand">
                {logo ? (
                  <img src={logo} alt="" className="rp-logo" />
                ) : (
                  <span className="rp-logo rp-logo-i" aria-hidden="true">
                    {brand.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div>
                  <div className="rp-brandname">{brand}</div>
                  <div className="rp-kicker">{t("Sosyal medya raporu")}</div>
                </div>
              </div>
              <h1 className="rp-title">{scope}</h1>
              <p className="rp-period">
                {fmtRange(d.range.from, d.range.to, intl)}
                <span>
                  {" · "}
                  {t("karşılaştırma: {r}", { r: fmtRange(d.range.prevFrom, d.range.prevTo, intl) })}
                </span>
              </p>
              <p className="rp-meta">
                {t("Hazırlayan: {name} · {date}", { name: s.user?.name || s.user?.email || brand, date: fmtDay(today, intl, { day: "numeric", month: "long", year: "numeric" }) })}
              </p>
            </header>

            {intro.trim() && <p className="rp-intro">{intro.trim()}</p>}

            {has("summary") && (
              <Sec id="summary" title={t("Özet")}>
                <div className="rp-kpis">
                  <StatTile label={t("Takipçi")} value={compact(k.followers.value ?? 0)} delta={delta(k.followers.value, k.followers.prev)} compare note={k.followersDelta.value !== null ? t("{n} bu dönemde", { n: new Intl.NumberFormat(intl, { signDisplay: "always" }).format(k.followersDelta.value) }) : undefined} />
                  <StatTile label={t("Yayınlanan gönderi")} value={num(k.posts.value ?? 0)} delta={delta(k.posts.value, k.posts.prev)} compare />
                  <StatTile label={t("Etkileşim")} value={compact(k.interactions.value ?? 0)} delta={delta(k.interactions.value, k.interactions.prev)} compare />
                  <StatTile label={t("Görüntülenme")} value={compact(k.views.value ?? 0)} delta={delta(k.views.value, k.views.prev)} compare />
                  <StatTile label={t("Etkileşim oranı")} value={fmtPct(k.engagementRate.value, intl)} delta={delta(k.engagementRate.value, k.engagementRate.prev)} compare />
                  <StatTile label={t("Otomatik yanıt oranı")} value={fmtPct(k.autoReplyRate.value, intl)} delta={delta(k.autoReplyRate.value, k.autoReplyRate.prev)} compare note={t("{n} gelen DM", { n: k.incomingMessages.value ?? 0 })} />
                </div>
                {highlights.length > 0 && (
                  <div className="rp-hl">
                    <h3>{t("Öne çıkanlar")}</h3>
                    <ul>
                      {highlights.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Sec>
            )}

            {has("followers") && (
              <Sec id="followers" title={t("Takipçi gelişimi")} lead={t("Günlük toplam; kanal bağlandığı günden itibaren.")}>
                <TimeChart kind="line" area dates={d.daily.map((x) => x.date)} format={compact} ariaLabel={t("Günlük takipçi")} height={170} series={[{ key: "f", label: t("Takipçi"), color: PRIMARY_SERIES, values: d.daily.map((x) => x.followers) }]} />
              </Sec>
            )}

            {has("networks") && d.byProvider.length > 0 && (
              <Sec id="networks" title={t("Ağlara göre")}>
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("Ağ")}</th>
                      <th scope="col">{t("Takipçi")}</th>
                      <th scope="col">{t("Değişim")}</th>
                      <th scope="col">{t("Gönderi")}</th>
                      <th scope="col">{t("Etkileşim")}</th>
                      <th scope="col">{t("Görüntülenme")}</th>
                      <th scope="col">{t("Oran")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byProvider.map((p) => (
                      <tr key={p.provider}>
                        <th scope="row">
                          <span className="rp-net">
                            <ProviderIcon provider={p.provider} size={18} /> {PROVIDER_NAME[p.provider]}
                          </span>
                        </th>
                        <td>{p.followers === null ? "—" : num(p.followers)}</td>
                        <td>{p.followersDelta === null ? "—" : new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(p.followersDelta)}</td>
                        <td>{num(p.posts)}</td>
                        <td>{num(p.interactions)}</td>
                        <td>{num(p.views)}</td>
                        <td>{fmtPct(p.engagementRate, intl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Sec>
            )}

            {has("engagement") && (
              <Sec id="engagement" title={t("Etkileşim ve görüntülenme")} lead={t("Yayınlanan gönderilerin son çekilen metrikleri, yayın gününe göre.")}>
                <div className="rp-two">
                  <div>
                    <h3 className="rp-h3">{t("Günlük etkileşim")}</h3>
                    <TimeChart kind="bar" dates={d.daily.map((x) => x.date)} format={compact} ariaLabel={t("Günlük etkileşim")} height={150} series={[{ key: "i", label: t("Etkileşim"), color: PRIMARY_SERIES, values: d.daily.map((x) => x.interactions) }]} />
                  </div>
                  <div>
                    <h3 className="rp-h3">{t("Günlük görüntülenme")}</h3>
                    <TimeChart kind="line" area zeroBaseline dates={d.daily.map((x) => x.date)} format={compact} ariaLabel={t("Günlük görüntülenme")} height={150} series={[{ key: "v", label: t("Görüntülenme"), color: "var(--series-7)", values: d.daily.map((x) => x.views) }]} />
                  </div>
                </div>
              </Sec>
            )}

            {has("kinds") && d.kinds.length > 0 && (
              <Sec id="kinds" title={t("İçerik türleri")} lead={t("Gönderi başına ortalama etkileşim")}>
                <BarList format={num} rows={d.kinds.map((x) => ({ key: x.kind, label: L.kind(x.kind), value: x.avgInteractions, meta: t("{n} gönderi · {v} görüntülenme", { n: x.posts, v: compact(x.views) }) }))} />
              </Sec>
            )}

            {has("timing") && (
              <Sec id="timing" title={t("En iyi gün ve saatler")} lead={t("Kendi gönderilerinin ortalama etkileşimi · {tz}", { tz: d.range.tz })}>
                <Heatmap cells={d.heatmap.cells} maxAvg={d.heatmap.maxAvg} format={num} />
              </Sec>
            )}

            {has("topPosts") && (
              <Sec id="top" title={t("En iyi gönderiler")} lead={t("Etkileşime göre ilk 10")}>
                {topPosts.length ? (
                  <table className="rp-table rp-posts">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">{t("İçerik")}</th>
                        <th scope="col">{t("Tarih")}</th>
                        <th scope="col">{t("Görüntülenme")}</th>
                        <th scope="col">{t("Etkileşim")}</th>
                        <th scope="col">{t("Oran")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topPosts.map((p, i) => (
                        <tr key={p.targetId}>
                          <td>{i + 1}</td>
                          <td className="rp-postcell">
                            <span className="rp-net">
                              {p.provider && <ProviderIcon provider={p.provider} size={16} />}
                              <span className="rp-post-text">{p.preview || L.kind(p.kind)}</span>
                            </span>
                            <span className="rp-sub">
                              {p.channel} · {L.kind(p.kind)}
                            </span>
                          </td>
                          <td>{f.short(p.publishedAt)}</td>
                          <td>{fmtNum(p.views, intl)}</td>
                          <td>{fmtNum(p.interactions, intl)}</td>
                          <td>{fmtPct(p.engagementRate, intl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="rp-lead">{t("Bu dönemde metriği olan gönderi yok.")}</p>
                )}
              </Sec>
            )}

            {has("hashtags") && d.hashtags.length > 0 && (
              <Sec id="tags" title={t("Hashtag'ler")} lead={t("Etkileşime göre ilk 10")}>
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("Hashtag")}</th>
                      <th scope="col">{t("Gönderi")}</th>
                      <th scope="col">{t("Etkileşim")}</th>
                      <th scope="col">{t("Gönderi başına")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.hashtags]
                      .sort((a, b) => b.interactions - a.interactions)
                      .slice(0, 10)
                      .map((h) => (
                        <tr key={h.tag}>
                          <th scope="row">{h.tag}</th>
                          <td>{num(h.posts)}</td>
                          <td>{num(h.interactions)}</td>
                          <td>{num(Math.round(h.interactions / Math.max(1, h.posts)))}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </Sec>
            )}

            <footer className="rp-foot">
              <span>
                {brand} · {fmtRange(d.range.from, d.range.to, intl)}
              </span>
              <span>{t("Kaynak: platform API'leri, Reblebi ile hazırlandı")}</span>
            </footer>
          </article>
        )}
      </div>
    </div>
  );
}
