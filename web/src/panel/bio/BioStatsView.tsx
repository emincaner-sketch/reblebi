import { useQuery } from "@tanstack/react-query";
import { Globe, Link2, MousePointerClick } from "lucide-react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useLocalState } from "../../components/ui";
import { BrandSvg } from "../../components/BrandIcons";
import { BarList } from "../charts/BarList";
import { ChartCard, SimpleTable } from "../charts/ChartCard";
import { delta, fmtDay, fmtNum, fmtPct } from "../charts/format";
import { seriesVar } from "../charts/palette";
import { StatTile } from "../charts/StatTile";
import { TimeChart } from "../charts/TimeChart";
import "../charts/charts.css";
import { BIO_NETWORKS, type BioPage, type BioStats } from "./types";

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(BIO_NETWORKS.map((n) => [n.id, n.label]));

/** Link in bio istatistikleri: görüntülenme, tıklama, tıklama oranı, bağlantı ve kaynak kırılımı */
export function BioStatsView({ page }: { page: BioPage }) {
  const { t, intl } = useI18n();
  const [days, setDays] = useLocalState<number>("sp_bio_days", 30);
  const q = useQuery({ queryKey: ["bio-stats", page.id, days], queryFn: () => api.get<BioStats>(`/api/bio/${page.id}/stats?days=${days}`) });
  const d = q.data;
  const num = (n: number) => fmtNum(n, intl);
  const sourceName = (s: string) => (s === "direct" ? t("Doğrudan") : s === "other" ? t("Diğer siteler") : s === "google" ? "Google" : (SOURCE_LABEL[s] ?? s));
  const linkName = (l: BioStats["links"][number]) =>
    l.removed ? t("Kaldırılmış bağlantı") : l.kind === "social" ? (SOURCE_LABEL[l.label ?? ""] ?? l.label ?? "") : l.kind === "grid" ? `${t("Izgara")}: ${l.label ?? ""}` : (l.label ?? "");

  return (
    <div className="bio-stats">
      <div className="row-between">
        <div className="segmented" role="group" aria-label={t("Dönem")}>
          {[7, 30, 90].map((n) => (
            <button key={n} className={days === n ? "active" : ""} aria-pressed={days === n} onClick={() => setDays(n)}>
              {t("{n} gün", { n })}
            </button>
          ))}
        </div>
        {d && <span className="small muted">{`${fmtDay(d.range.from, intl)} – ${fmtDay(d.range.to, intl, { day: "numeric", month: "short", year: "numeric" })}`}</span>}
      </div>

      {!d ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : (
        <>
          <div className="an-kpis">
            <StatTile label={t("Görüntülenme")} icon={<Globe aria-hidden="true" />} value={num(d.totals.views)} delta={delta(d.totals.views, d.prev.views)} compare note={t("sayfanın açılma sayısı")} />
            <StatTile label={t("Tıklama")} icon={<MousePointerClick aria-hidden="true" />} value={num(d.totals.clicks)} delta={delta(d.totals.clicks, d.prev.clicks)} compare note={t("bağlantı, ikon ve ızgara tıklamaları")} />
            <StatTile
              label={t("Tıklama oranı")}
              icon={<Link2 aria-hidden="true" />}
              value={fmtPct(d.totals.ctr, intl)}
              delta={delta(d.totals.ctr, d.prev.views ? Math.round((d.prev.clicks / d.prev.views) * 1000) / 10 : null)}
              compare
              note={t("tıklama / görüntülenme")}
            />
          </div>

          <ChartCard
            title={t("Günlük görüntülenme ve tıklama")}
            sub={t("Botlar ve çalışma alanı üyelerinin ziyaretleri sayılmaz.")}
            table={() => (
              <SimpleTable
                caption={t("Günlük görüntülenme ve tıklama")}
                head={[t("Gün"), t("Görüntülenme"), t("Tıklama")]}
                rows={d.daily.map((x) => [fmtDay(x.date, intl, { day: "numeric", month: "short", year: "numeric" }), num(x.views), num(x.clicks)])}
              />
            )}
          >
            <TimeChart
              kind="line"
              area
              zeroBaseline
              dates={d.daily.map((x) => x.date)}
              format={num}
              ariaLabel={t("Günlük görüntülenme ve tıklama")}
              height={220}
              series={[
                { key: "v", label: t("Görüntülenme"), color: seriesVar(1), values: d.daily.map((x) => x.views) },
                { key: "c", label: t("Tıklama"), color: seriesVar(2), values: d.daily.map((x) => x.clicks) },
              ]}
            />
          </ChartCard>

          <div className="bio-stats-2">
            <ChartCard
              title={t("Bağlantılara göre tıklama")}
              table={() => (
                <SimpleTable
                  caption={t("Bağlantılara göre tıklama")}
                  head={[t("Bağlantı"), t("Tıklama"), t("Tıklama oranı")]}
                  rows={d.links.map((l) => [linkName(l), num(l.clicks), fmtPct(l.ctr, intl)])}
                />
              )}
            >
              {d.links.length ? (
                <BarList
                  rows={d.links.map((l) => ({
                    key: l.id,
                    label: (
                      <span title={l.url ?? undefined}>
                        {linkName(l)}
                      </span>
                    ),
                    value: l.clicks,
                    meta: l.ctr !== null ? fmtPct(l.ctr, intl) : undefined,
                  }))}
                  format={num}
                />
              ) : (
                <p className="muted small">{t("Henüz bağlantı yok.")}</p>
              )}
            </ChartCard>
            <ChartCard
              title={t("Ziyaretlerin kaynağı")}
              sub={t("Uygulama içi tarayıcıdan ya da adresin sonundaki ?src= ekinden anlaşılır.")}
              table={() => (
                <SimpleTable caption={t("Ziyaretlerin kaynağı")} head={[t("Kaynak"), t("Görüntülenme"), t("Tıklama")]} rows={d.sources.map((x) => [sourceName(x.source), num(x.views), num(x.clicks)])} />
              )}
            >
              {d.sources.length ? (
                <BarList
                  rows={d.sources.map((x) => ({
                    key: x.source,
                    label: (
                      <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        {SOURCE_LABEL[x.source] && x.source !== "website" && x.source !== "email" ? <BrandSvg id={x.source} size={14} /> : <Globe aria-hidden="true" style={{ width: 14, height: 14 }} />}
                        {sourceName(x.source)}
                      </span>
                    ),
                    value: x.views,
                    meta: t("{n} tıklama", { n: num(x.clicks) }),
                  }))}
                  format={num}
                />
              ) : (
                <p className="muted small">{t("Bu dönemde ziyaret yok.")}</p>
              )}
            </ChartCard>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {t("Sayaçlar çerez ya da kişisel veri kullanmaz; yalnızca günlük toplamlar tutulur. Kaynağı ayırmak için adresin sonuna ?src=tiktok gibi bir ek koyabilirsin.")}
          </p>
        </>
      )}
    </div>
  );
}
