import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { fmtPct, type Delta } from "./format";

/**
 * KPI kutusu: etiket · değer · önceki döneme göre fark (ikon + metin; renk tek başına anlam taşımaz).
 * upIsGood=false ise artış kötü sayılır (ör. hata oranı).
 */
export function StatTile({ label, value, delta, compare, note, icon, upIsGood = true }: { label: string; value: ReactNode; delta?: Delta | null; compare?: boolean; note?: ReactNode; icon?: ReactNode; upIsGood?: boolean }) {
  const { t, intl } = useI18n();
  const d = compare ? delta : null;
  const tone = !d || d.dir === null || d.dir === "flat" ? "flat" : (d.dir === "up") === upIsGood ? "good" : "bad";
  const Icon = d?.dir === "up" ? ArrowUpRight : d?.dir === "down" ? ArrowDownRight : ArrowRight;
  return (
    <div className="st">
      <div className="st-label">
        {icon}
        {label}
      </div>
      <div className="st-value">{value}</div>
      {d && d.dir !== null && (
        <div className={`st-delta st-delta--${tone}`}>
          <Icon aria-hidden="true" />
          <span>{d.pct !== null ? fmtPct(Math.abs(d.pct), intl) : d.dir === "flat" ? t("değişim yok") : d.abs !== null ? new Intl.NumberFormat(intl, { signDisplay: "always" }).format(d.abs) : ""}</span>
          <span className="st-vs">{t("önceki döneme göre")}</span>
        </div>
      )}
      {note && <div className="st-note">{note}</div>}
    </div>
  );
}
