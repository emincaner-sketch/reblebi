import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import { fmtDay, niceTicks } from "./format";
import { useWidth } from "./useSize";

export interface TimeSeries {
  key: string;
  label: string;
  color: string;
  /** null = veri yok (boşluk bırakılır, sıfır çizilmez) */
  values: Array<number | null>;
  icon?: ReactNode;
}

interface Props {
  dates: string[];
  series: TimeSeries[];
  kind: "line" | "bar";
  format: (n: number) => string;
  ariaLabel: string;
  height?: number;
  /** Tek serili çizgide %10 dolgu */
  area?: boolean;
  /** Çizgide sıfırdan başlama (takipçi gibi büyük tabanlı seriler) */
  zeroBaseline?: boolean;
  /** Sütunlarda serileri üst üste yığ (ör. kaynak başına günlük bahsetme); aradaki 2px yüzey boşluğu ayırır */
  stacked?: boolean;
}

const PAD = { top: 12, right: 14, bottom: 28 };
const X_BAND = PAD.bottom;

/**
 * Tek eksenli zaman grafiği (çizgi ya da sütun). Görselleştirme kuralları:
 * 2px çizgi, ≥8px son nokta + 2px yüzey halkası, sütun ≤24px ve 4px yuvarlak uç, kılçık ızgara,
 * dikey imleç + tek ipucu kutusu (tüm seriler), klavyeyle gezinme (← →), ≥2 seride gösterge.
 */
export function TimeChart({ dates, series, kind, format, ariaLabel, height = 200, area = false, zeroBaseline = kind === "bar", stacked = false }: Props) {
  const { intl, t } = useI18n();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId().replace(/:/g, "");

  const stack = kind === "bar" && stacked;
  const sums = stack ? dates.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0)) : [];
  const all = stack ? sums.filter((v) => v > 0) : series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const hasData = all.length > 0;
  const lo = zeroBaseline ? 0 : Math.min(...all);
  const hi = Math.max(...all, zeroBaseline ? 1 : -Infinity);
  const ticks = useMemo(() => (hasData ? niceTicks(Math.min(lo, hi), hi, 4) : [0, 1]), [hasData, lo, hi]);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const labelW = Math.max(28, ...ticks.map((t) => format(t).length * 7 + 10));
  const left = labelW;
  const plotW = Math.max(40, width - left - PAD.right);
  const plotH = height;
  const n = Math.max(1, dates.length);
  const step = plotW / n;
  const x = (i: number) => left + step * (i + 0.5);
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const barW = Math.max(2, Math.min(24, step * 0.66));

  // X ekseni etiketleri: en fazla ~7, ilk ve son dahil
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 84))));
  const xLabels = dates.map((d, i) => (i % every === 0 || i === n - 1 ? { i, d } : null)).filter(Boolean) as Array<{ i: number; d: string }>;
  if (xLabels.length > 1 && xLabels[xLabels.length - 1].i - xLabels[xLabels.length - 2].i < every / 2) xLabels.splice(xLabels.length - 2, 1);

  const paths = series.map((s) => {
    const segs: string[] = [];
    let cur = "";
    s.values.forEach((v, i) => {
      if (v === null) {
        if (cur) segs.push(cur);
        cur = "";
        return;
      }
      cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    if (cur) segs.push(cur);
    const lastIdx = s.values.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
    return { s, d: segs.join(" "), segs, lastIdx };
  });

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - box.left;
    setHover(Math.min(n - 1, Math.max(0, Math.floor((px - left) / step))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setHover((h) => Math.min(n - 1, Math.max(0, (h ?? n - 1) + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Escape") setHover(null);
  };

  const tip = hover !== null && dates[hover] ? { i: hover, date: dates[hover], rows: series.map((s) => ({ s, v: s.values[hover] })) } : null;
  const tipLeft = tip ? Math.min(Math.max(x(tip.i) + 12, 8), width - 190) : 0;
  const flip = tip ? x(tip.i) + 200 > width : false;

  return (
    <div className="ch" ref={ref}>
      {series.length > 1 && (
        <ul className="ch-legend">
          {series.map((s) => (
            <li key={s.key}>
              <i className={kind === "bar" ? "ch-key ch-key--rect" : "ch-key"} style={{ background: s.color }} aria-hidden="true" />
              {s.icon}
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="ch-plot" style={{ height: plotH + PAD.top + X_BAND }}>
        <svg
          width={width}
          height={plotH + PAD.top + X_BAND}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setHover((h) => h ?? n - 1)}
          onBlur={() => setHover(null)}
          className="ch-svg"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={left} y={PAD.top - 6} width={plotW} height={plotH + 12} />
            </clipPath>
          </defs>
          {/* Izgara ve y ekseni */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} className={t === yMin ? "ch-base" : "ch-grid"} />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="ch-tick">
                {format(t)}
              </text>
            </g>
          ))}
          {/* X ekseni */}
          {xLabels.map(({ i, d }) => (
            <text key={d} x={x(i)} y={PAD.top + plotH + 18} textAnchor={i === 0 && step < 30 ? "start" : i === n - 1 && step < 30 ? "end" : "middle"} className="ch-tick">
              {fmtDay(d, intl)}
            </text>
          ))}
          {hasData && (
            <g clipPath={`url(#${clipId})`}>
              {stack
                ? dates.map((_, i) => {
                    // Alttan üste: her dilim 2px yüzey boşluğuyla ayrılır, yalnızca en üstteki dilimin ucu yuvarlak
                    const bottom = PAD.top + plotH;
                    const bx = x(i) - barW / 2;
                    let acc = 0;
                    const segs = series.flatMap((s) => {
                      const v = s.values[i] ?? 0;
                      if (v <= 0) return [];
                      const from = acc;
                      acc += v;
                      return [{ s, from, to: acc }];
                    });
                    return (
                      <g key={i} opacity={hover !== null && hover !== i ? 0.55 : 1}>
                        {segs.map(({ s, from, to }, k) => {
                          const top = y(to);
                          const base = y(from) - (k > 0 ? 2 : 0);
                          if (base - top < 0.5) return null;
                          const last = k === segs.length - 1;
                          const r = last ? Math.min(4, barW / 2, base - top) : 0;
                          return (
                            <path
                              key={s.key}
                              d={`M${bx},${k === 0 ? bottom : base} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${k === 0 ? bottom : base} Z`}
                              fill={s.color}
                            />
                          );
                        })}
                      </g>
                    );
                  })
                : kind === "bar"
                ? series.slice(0, 1).map((s) =>
                    s.values.map((v, i) => {
                      if (v === null || v <= 0) return null;
                      const top = y(v);
                      const h = PAD.top + plotH - top;
                      const r = Math.min(4, barW / 2, h);
                      const bx = x(i) - barW / 2;
                      const bottom = PAD.top + plotH;
                      return (
                        <path
                          key={i}
                          d={`M${bx},${bottom} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${bottom} Z`}
                          fill={s.color}
                          opacity={hover !== null && hover !== i ? 0.55 : 1}
                        />
                      );
                    }),
                  )
                : paths.map(({ s, d, segs }) => (
                    <g key={s.key}>
                      {area && series.length === 1 &&
                        segs.map((seg, k) => {
                          const pts = seg.slice(1).split("L");
                          const first = pts[0].split(",")[0];
                          const last = pts[pts.length - 1].split(",")[0];
                          return <path key={k} d={`${seg} L${last},${PAD.top + plotH} L${first},${PAD.top + plotH} Z`} fill={s.color} opacity={0.1} />;
                        })}
                      <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    </g>
                  ))}
              {kind === "line" &&
                paths.map(({ s, lastIdx }) =>
                  lastIdx >= 0 && hover === null ? <circle key={s.key} cx={x(lastIdx)} cy={y(s.values[lastIdx] as number)} r={4} fill={s.color} className="ch-dot" /> : null,
                )}
            </g>
          )}
          {/* İmleç */}
          {tip && (
            <g pointerEvents="none">
              <line x1={x(tip.i)} x2={x(tip.i)} y1={PAD.top} y2={PAD.top + plotH} className="ch-cross" />
              {kind === "line" && tip.rows.map(({ s, v }) => (v !== null ? <circle key={s.key} cx={x(tip.i)} cy={y(v)} r={4} fill={s.color} className="ch-dot" /> : null))}
            </g>
          )}
          <rect x={left} y={PAD.top} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {!hasData && <p className="ch-empty">—</p>}
        {tip && (
          <div className="ch-tip" style={{ left: flip ? undefined : tipLeft, right: flip ? Math.max(8, width - x(tip.i) + 12) : undefined, top: 4 }} role="status" aria-live="polite">
            <div className="ch-tip-date">{fmtDay(tip.date, intl, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</div>
            {stack && (
              <div className="ch-tip-row">
                <strong>{format(sums[tip.i] ?? 0)}</strong>
                <span>{t("Toplam")}</span>
              </div>
            )}
            {tip.rows.map(({ s, v }) => (
              <div key={s.key} className="ch-tip-row">
                <i className="ch-key" style={{ background: s.color }} aria-hidden="true" />
                <strong>{v === null ? "—" : format(v)}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
