import { Info } from "lucide-react";
import type { ProviderId } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { BalanceChart } from "../charts/BalanceChart";
import { BarList } from "../charts/BarList";
import { ChartCard, SimpleTable } from "../charts/ChartCard";
import { delta, fmtCompact, fmtDay, fmtNum } from "../charts/format";
import { seriesVar } from "../charts/palette";
import { StatTile } from "../charts/StatTile";
import { TimeChart } from "../charts/TimeChart";
import type { AnalyticsReport, InsightKey } from "./types";

/** Bu ağlar hesap insights verir (Meta izinleri: instagram_manage_insights, read_insights) */
const INSIGHT_NETWORKS: ProviderId[] = ["instagram", "facebook", "threads", "youtube", "linkedin", "pinterest", "gmb"];

/**
 * Hesap insights (Metricool: Reach, Impressions, Profile visits, Website clicks, Balance of followers, Demographics).
 * Veriler tamamlanmış günler içindir; bugün boş kalır.
 */
export function InsightsSection({ d, network, compare }: { d: AnalyticsReport; network: ProviderId | null; compare: boolean }) {
  const { t, intl } = useI18n();
  const num = (n: number) => fmtNum(n, intl);
  const compact = (n: number) => fmtCompact(n, intl);
  const ins = d.insights;
  const a = d.audience;
  const relevant = network ? INSIGHT_NETWORKS.includes(network) : d.networks.some((n) => INSIGHT_NETWORKS.includes(n.provider));
  if (!ins.available && !a) {
    if (!relevant) return null;
    return (
      <section id="an-insights" className="an-section" aria-labelledby="an-insights-h">
        <h2 id="an-insights-h" className="an-h2">
          {t("Hesap insights")}
        </h2>
        <div className="an-notes">
          <p>
            <Info aria-hidden="true" />
            {network === "gmb"
              ? t("Haritalar ve Arama görüntülenmesi, web sitesi tıklaması, arama ve yol tarifi Google Business Profile'dan günlük çekilir; Google veriyi birkaç gün gecikmeli verir. Konumu Google hesabınla (OAuth) bağlaman gerekir.")
              : network === "threads"
              ? t("Görüntülenme, bağlantı tıklaması ve takipçi kitlesi Threads hesap insights'ından günlük çekilir (threads_manage_insights izni). Kitle kırılımı en az 100 takipçide gelir.")
              : network === "pinterest"
              ? t("Gösterim, kaydetme, pin ve bağlantı tıklamaları Pinterest hesap analitiğinden günlük çekilir.")
              : network === "linkedin"
              ? t("Gösterim, tekil erişim, içerik tıklaması, sayfa ziyareti ve yeni takipçi LinkedIn şirket sayfaları için günlük çekilir (Community Management API izni gerekir); kişisel profillerde LinkedIn bu verileri vermez.")
              : network === "youtube"
              ? t("İzlenme, izlenme süresi, abone kazanımı/kaybı ve izleyici kitlesi YouTube Analytics'ten günlük çekilir; YouTube veriyi 2-3 gün gecikmeli verir. Bu izinden önce bağlanan kanalı bir kez yeniden bağlaman gerekir.")
              : t("Erişim, profil ziyareti, takip/takipten çıkma ve kitle verileri Instagram ve Facebook'tan günlük çekilir; ilk veriler kanal bağlandıktan sonraki gün görünür. Meta izinleri (instagram_manage_insights, read_insights) gerekir.")}
          </p>
        </div>
      </section>
    );
  }

  const k = ins.kpis;
  const dates = d.daily.map((x) => x.date);
  const tile = (key: InsightKey, label: string, note?: string, upIsGood = true) =>
    k[key].value === null ? null : <StatTile key={key} label={label} value={compact(k[key].value!)} delta={delta(k[key].value, k[key].prev)} compare={compare} note={note} upIsGood={upIsGood} />;
  const total = (rows: Array<{ value: number }>) => rows.reduce((s, r) => s + r.value, 0);
  const pct = (v: number, of: number) => (of ? `${new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format((v / of) * 100)}%` : "—");
  const regionName = (() => {
    try {
      const dn = new Intl.DisplayNames([intl], { type: "region" });
      return (code: string) => (/^[A-Z]{2}$/.test(code) ? (dn.of(code) ?? code) : code);
    } catch {
      return (code: string) => code;
    }
  })();
  const genderName: Record<string, string> = { F: t("Kadın"), M: t("Erkek"), U: t("Belirtilmemiş") };

  return (
    <section id="an-insights" className="an-section" aria-labelledby="an-insights-h">
      <h2 id="an-insights-h" className="an-h2">
        {t("Hesap insights")}
      </h2>
      <p className="an-lead">{t("Platformun hesap düzeyinde verdiği günlük değerler (tamamlanmış günler). Erişim tekil hesap sayısıdır; günler toplanınca aynı kişi birden çok sayılabilir.")}</p>

      {ins.available && (
        <>
          <div className="an-kpis">
            {tile("reach", t("Erişim"), t("günlük erişimlerin toplamı"))}
            {tile("views", t("Görüntülenme"), t("içeriklerin görülme sayısı"))}
            {tile("profileViews", t("Profil ziyareti"))}
            {tile("websiteClicks", t("Web sitesi tıklaması"))}
            {tile("clicks", t("İçerik tıklaması"))}
            {tile("saves", t("Kaydetme"))}
            {tile("calls", t("Telefon araması"), t("işletmeyi arayanlar"))}
            {tile("directions", t("Yol tarifi"), t("yol tarifi isteyenler"))}
            {tile("follows", t("Yeni takip"))}
            {tile("unfollows", t("Takibi bırakan"), undefined, false)}
            {k.watchMinutes.value !== null && (
              <StatTile
                label={t("İzlenme süresi")}
                value={t("{n} sa", { n: compact(Math.round(k.watchMinutes.value / 60)) })}
                delta={delta(k.watchMinutes.value, k.watchMinutes.prev)}
                compare={compare}
                note={k.views.value ? t("ort. {s} sn / izlenme", { s: num(Math.round((k.watchMinutes.value * 60) / k.views.value)) }) : undefined}
              />
            )}
          </div>

          <div className="an-grid">
            {(k.reach.value !== null || k.views.value !== null) && (
              <ChartCard
                title={k.reach.value !== null ? t("Erişim ve görüntülenme") : t("Günlük görüntülenme")}
                sub={t("Günlük")}
                table={() => (
                  <SimpleTable
                    caption={t("Erişim ve görüntülenme")}
                    head={[t("Gün"), t("Erişim"), t("Görüntülenme")]}
                    rows={dates.map((x, i) => [fmtDay(x, intl), ins.daily.reach[i] === null ? "—" : num(ins.daily.reach[i]!), ins.daily.views[i] === null ? "—" : num(ins.daily.views[i]!)])}
                  />
                )}
              >
                <TimeChart
                  kind="line"
                  zeroBaseline
                  dates={dates}
                  format={compact}
                  ariaLabel={t("Günlük erişim ve görüntülenme")}
                  height={180}
                  series={[
                    { key: "reach", label: t("Erişim"), color: seriesVar(1), values: ins.daily.reach },
                    { key: "views", label: t("Görüntülenme"), color: seriesVar(7), values: ins.daily.views },
                  ].filter((s) => s.values.some((v) => v !== null))}
                />
              </ChartCard>
            )}
            {(k.follows.value !== null || k.unfollows.value !== null) && (
              <ChartCard
                title={t("Takipçi dengesi")}
                sub={k.follows.value !== null && k.unfollows.value !== null ? t("Net: {n}", { n: new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(k.follows.value - k.unfollows.value) }) : t("Günlük")}
                table={() => (
                  <SimpleTable
                    caption={t("Takipçi dengesi")}
                    head={[t("Gün"), t("Yeni takip"), t("Takibi bırakan"), t("Net")]}
                    rows={dates.map((x, i) => {
                      const f = ins.daily.follows[i];
                      const u = ins.daily.unfollows[i];
                      return [fmtDay(x, intl), f === null ? "—" : num(f), u === null ? "—" : num(u), f === null || u === null ? "—" : new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(f - u)];
                    })}
                  />
                )}
              >
                <BalanceChart
                  dates={dates}
                  up={{ label: t("Yeni takip"), color: seriesVar(1), values: ins.daily.follows }}
                  down={{ label: t("Takibi bırakan"), color: seriesVar(2), values: ins.daily.unfollows }}
                  netLabel={t("Net")}
                  format={num}
                  ariaLabel={t("Günlük yeni takip ve takibi bırakan")}
                />
              </ChartCard>
            )}
            {k.profileViews.value !== null && (
              <ChartCard
                title={t("Profil ziyareti")}
                sub={t("Günlük")}
                table={() => <SimpleTable caption={t("Profil ziyareti")} head={[t("Gün"), t("Profil ziyareti")]} rows={dates.map((x, i) => [fmtDay(x, intl), ins.daily.profileViews[i] === null ? "—" : num(ins.daily.profileViews[i]!)])} />}
              >
                <TimeChart kind="bar" dates={dates} format={num} ariaLabel={t("Günlük profil ziyareti")} height={150} series={[{ key: "pv", label: t("Profil ziyareti"), color: seriesVar(3), values: ins.daily.profileViews }]} />
              </ChartCard>
            )}
          </div>
        </>
      )}

      {a && (
        <ChartCard
          title={t("Kitle")}
          sub={t(a.basis === "viewers" ? "{list} izleyicileri · {date} itibarıyla" : "{list} takipçileri · {date} itibarıyla", { list: a.channels.join(", "), date: a.fetchedAt ? new Intl.DateTimeFormat(intl, { day: "numeric", month: "short" }).format(new Date(a.fetchedAt)) : "—" })}
          note={t("Platform, kitle kırılımını yalnızca en az 100 takipçili hesaplar için verir; küçük gruplar gizlenebilir. Haftada bir yenilenir.")}
        >
          <div className="an-aud">
            {a.country.length > 0 && (
              <div>
                <h3 className="an-h3">{t("Ülkeler")}</h3>
                <BarList format={num} rows={a.country.map((r) => ({ key: r.key, label: regionName(r.key), value: r.value, meta: pct(r.value, total(a.country)) }))} />
              </div>
            )}
            {a.city.length > 0 && (
              <div>
                <h3 className="an-h3">{t("Şehirler")}</h3>
                <BarList format={num} color="var(--series-7)" rows={a.city.map((r) => ({ key: r.key, label: r.key.split(",")[0], value: r.value, meta: pct(r.value, total(a.city)) }))} />
              </div>
            )}
            {a.age.length > 0 && (
              <div>
                <h3 className="an-h3">{t("Yaş")}</h3>
                <BarList
                  format={a.percent ? (n) => `%${new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(n)}` : num}
                  color="var(--series-3)"
                  rows={a.age.map((r) => ({ key: r.key, label: r.key, value: r.value, meta: a.percent ? undefined : pct(r.value, total(a.age)) }))}
                />
                {a.gender.length > 0 && (
                  <p className="an-gender">
                    {a.gender.map((g) => (
                      <span key={g.key}>
                        <strong>{pct(g.value, total(a.gender))}</strong> {genderName[g.key] ?? g.key}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>
        </ChartCard>
      )}
    </section>
  );
}
