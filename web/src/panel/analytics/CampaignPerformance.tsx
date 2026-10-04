import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { api, type Campaign } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useFmt } from "../../lib/session";
import { fmtCompact, fmtNum, fmtPct } from "../charts/format";
import { PRIMARY_SERIES } from "../charts/palette";
import { StatTile } from "../charts/StatTile";
import { TimeChart } from "../charts/TimeChart";
import type { AnalyticsReport } from "./types";
import "../charts/charts.css";

/** Çalışma alanı saat dilimindeki "YYYY-MM-DD" */
function ymdIn(iso: string | number, tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Kampanya panosu (Metricool "Campaign dashboards" karşılığı): kampanyanın yayınlanan gönderilerinin
 * toplam etkileşimi, görüntülenmesi ve günlük gidişi. Aralık: kampanya başlangıcı (yoksa oluşturulma) → bitiş ya da bugün.
 */
export function CampaignPerformance({ campaign }: { campaign: Campaign }) {
  const { t, intl } = useI18n();
  const f = useFmt();
  const today = ymdIn(Date.now(), f.tz);
  const from = ymdIn(campaign.startsAt ?? campaign.createdAt, f.tz);
  const endRaw = campaign.endsAt ? ymdIn(campaign.endsAt, f.tz) : today;
  const to = endRaw > today ? today : endRaw < from ? from : endRaw;
  const qs = new URLSearchParams({ campaignId: campaign.id, from, to }).toString();
  const q = useQuery({ queryKey: ["campaign-report", campaign.id, from, to], queryFn: () => api.get<AnalyticsReport>(`/api/analytics/report?${qs}`) });
  const d = q.data;
  const k = d?.kpis;
  const link = `/app/analytics?${new URLSearchParams({ campaign: campaign.id, p: "custom", from, to }).toString()}`;

  return (
    <section className="card cc" aria-labelledby={`cp-${campaign.id}`} style={{ marginBottom: 16 }}>
      <header className="cc-head">
        <div>
          <h2 id={`cp-${campaign.id}`} className="cc-title">
            {t("Kampanya performansı")}
          </h2>
          <p className="cc-sub">{t("Yayınlanan gönderilerin son çekilen metrikleri")}</p>
        </div>
        <Link to={link} className="btn btn-sm">
          {t("Analitikte aç")} <ArrowRight aria-hidden="true" />
        </Link>
      </header>
      {!d ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : k!.posts.value === 0 ? (
        <p className="muted small">{t("Bu kampanyada henüz yayınlanmış gönderi yok. Yayınlandıkça metrikler burada toplanır.")}</p>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <div className="an-kpis">
            <StatTile label={t("Yayınlanan gönderi")} value={fmtNum(k!.posts.value, intl)} note={t("{a}/{b} gönderinin metriği var", { a: k!.postsWithMetrics.value ?? 0, b: k!.posts.value ?? 0 })} />
            <StatTile label={t("Etkileşim")} value={fmtCompact(k!.interactions.value, intl)} note={t("beğeni + yorum + paylaşım + kaydetme")} />
            <StatTile label={t("Görüntülenme")} value={fmtCompact(k!.views.value, intl)} note={t("destekleyen ağlarda")} />
            <StatTile label={t("Etkileşim oranı")} value={fmtPct(k!.engagementRate.value, intl)} note={t("etkileşim / görüntülenme")} />
          </div>
          <TimeChart
            kind="bar"
            dates={d.daily.map((x) => x.date)}
            format={(n) => fmtCompact(n, intl)}
            ariaLabel={t("Günlük etkileşim")}
            height={150}
            series={[{ key: "i", label: t("Etkileşim"), color: PRIMARY_SERIES, values: d.daily.map((x) => x.interactions) }]}
          />
        </div>
      )}
    </section>
  );
}
