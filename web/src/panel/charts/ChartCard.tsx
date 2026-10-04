import { useState, type ReactNode } from "react";
import { Table2 } from "lucide-react";
import { useI18n } from "../../lib/i18n";

/**
 * Grafik kartı: başlık, alt başlık, "Tablo" geçişi (her grafiğin tablo karşılığı), not satırı.
 * Değerler ipucu kutusuna kilitli kalmaz: tablo görünümü ekran okuyucu ve renk körlüğü için eşdeğerdir.
 */
export function ChartCard({ title, sub, children, table, note, actions, className = "" }: { title: string; sub?: ReactNode; children: ReactNode; table?: () => ReactNode; note?: ReactNode; actions?: ReactNode; className?: string }) {
  const { t } = useI18n();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card cc ${className}`.trim()}>
      <header className="cc-head">
        <div>
          <h3 className="cc-title">{title}</h3>
          {sub && <p className="cc-sub">{sub}</p>}
        </div>
        <div className="cc-actions">
          {actions}
          {table && (
            <button type="button" className="btn btn-ghost btn-sm" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
              <Table2 aria-hidden="true" /> {asTable ? t("Grafik") : t("Tablo")}
            </button>
          )}
        </div>
      </header>
      <div className="cc-body">{asTable && table ? table() : children}</div>
      {note && <p className="cc-note">{note}</p>}
    </section>
  );
}

/** Grafiklerin tablo görünümü için sade tablo */
export function SimpleTable({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<ReactNode>> }) {
  return (
    <div className="table-wrap cc-table">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} style={{ textAlign: i === 0 ? "left" : "right" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? undefined : "num"} style={{ textAlign: j === 0 ? "left" : "right" }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
