import type { ReactNode } from "react";

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number | null;
  /** Değerin yanında ikincil bilgi (ör. "35 gönderi") */
  meta?: ReactNode;
  color?: string;
}

/** Sıralı yatay çubuklar: değer çubuğun ucunda, metin mürekkep renginde, renk yalnızca çubukta */
export function BarList({ rows, format, color = "var(--series-1)" }: { rows: BarRow[]; format: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="bl">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="bl-label">{r.label}</div>
          <div className="bl-track">
            {r.value !== null && r.value > 0 && <span className="bl-bar" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: r.color ?? color }} />}
            <strong className="bl-value">{r.value === null ? "—" : format(r.value)}</strong>
          </div>
          {r.meta && <div className="bl-meta">{r.meta}</div>}
        </li>
      ))}
    </ul>
  );
}
