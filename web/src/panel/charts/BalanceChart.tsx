import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "../../lib/i18n";
import { fmtDay, niceTicks } from "./format";
import { useWidth } from "./useSize";

interface Props {
  dates: string[];
  /** Sıfırın üstü (ör. yeni takip) */
  up: { label: string; color: string; values: Array<number | null> };
  /** Sıfırın altı (ör. takibi bırakan), pozitif sayılar verilir */
  down: { label: string; color: string; values: Array<number | null> };
  netLabel: string;
  format: (n: number) => string;
  ariaLabel: string;
  height?: number;
}

const PAD = { top: 10, right: 14, bottom: 28 };

/**
 * Ayrışan sütunlar (Metricool "Balance of followers"): kazanılan yukarı, kaybedilen aşağı, tek eksen ve sıfır çizgisi.
 * İki kategorik renk (durum renkleri değil), gösterge, imleç + ipucu (net değerle) ve klavyeyle gezinme.
 */
export function BalanceChart({ dates, up, down, netLabel, format, ariaLabel, height = 180 }: Props) {
  const { intl } = useI18n();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const maxUp = Math.max(0, ...up.values.map((v) => v ?? 0));
  const maxDown = Math.max(0, ...down.values.map((v) => v ?? 0));
  const hasData = up.values.some((v) => v !== null) || down.values.some((v) => v !== null);
  const ticks = useMemo(() => niceTicks(-Math.max(1, maxDown), Math.max(1, maxUp), 4), [maxUp, maxDown]);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const left = Math.max(32, ...ticks.map((t) => format(Math.abs(t)).length * 7 + 14));
  const plotW = Math.max(40, width - left - PAD.right);
  const n = Math.max(1, dates.length);
  const step = plotW / n;
  const x = (i: number) => left + step * (i + 0.5);
  const y = (v: number) => PAD.top + height - ((v - yMin) / (yMax - yMin || 1)) * height;
  const barW = Math.max(2, Math.min(20, step * 0.66));
  const zero = y(0);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 84))));

  const bar = (i: number, v: number, dir: 1 | -1, color: string) => {
    const end = y(dir * v);
    const h = Math.abs(end - zero);
    if (h < 0.5) return null;
    const r = Math.min(4, barW / 2, h);
    const bx = x(i) - barW / 2;
    // Yuvarlak uç sıfırdan uzak tarafta
    const d =
      dir === 1
        ? `M${bx},${zero} V${end + r} Q${bx},${end} ${bx + r},${end} H${bx + barW - r} Q${bx + barW},${end} ${bx + barW},${end + r} V${zero} Z`
        : `M${bx},${zero} V${end - r} Q${bx},${end} ${bx + r},${end} H${bx + barW - r} Q${bx + barW},${end} ${bx + barW},${end - r} V${zero} Z`;
    return <path key={`${dir}-${i}`} d={d} fill={color} opacity={hover !== null && hover !== i ? 0.5 : 1} />;
  };

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    setHover(Math.min(n - 1, Math.max(0, Math.floor((e.clientX - box.left - left) / step))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setHover((h) => Math.min(n - 1, Math.max(0, (h ?? n - 1) + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Escape") setHover(null);
  };
  const tip = hover !== null && dates[hover] ? { i: hover, u: up.values[hover], dn: down.values[hover] } : null;
  const flip = tip ? x(tip.i) + 200 > width : false;

  return (
    <div className="ch" ref={ref}>
      <ul className="ch-legend">
        <li>
          <i className="ch-key ch-key--rect" style={{ background: up.color }} aria-hidden="true" />
          {up.label}
        </li>
        <li>
          <i className="ch-key ch-key--rect" style={{ background: down.color }} aria-hidden="true" />
          {down.label}
        </li>
      </ul>
      <div className="ch-plot" style={{ height: height + PAD.top + PAD.bottom }}>
        <svg width={width} height={height + PAD.top + PAD.bottom} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey} onFocus={() => setHover((h) => h ?? n - 1)} onBlur={() => setHover(null)} className="ch-svg">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? "ch-base" : "ch-grid"} />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="ch-tick">
                {t < 0 ? `−${format(-t)}` : format(t)}
              </text>
            </g>
          ))}
          {dates.map((d, i) =>
            i % every === 0 || i === n - 1 ? (
              <text key={d} x={x(i)} y={PAD.top + height + 18} textAnchor="middle" className="ch-tick">
                {fmtDay(d, intl)}
              </text>
            ) : null,
          )}
          {hasData && (
            <g>
              {up.values.map((v, i) => (v ? bar(i, v, 1, up.color) : null))}
              {down.values.map((v, i) => (v ? bar(i, v, -1, down.color) : null))}
            </g>
          )}
          {tip && <line x1={x(tip.i)} x2={x(tip.i)} y1={PAD.top} y2={PAD.top + height} className="ch-cross" pointerEvents="none" />}
          <rect x={left} y={PAD.top} width={plotW} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {!hasData && <p className="ch-empty">—</p>}
        {tip && (
          <div className="ch-tip" style={{ left: flip ? undefined : Math.min(Math.max(x(tip.i) + 12, 8), width - 190), right: flip ? Math.max(8, width - x(tip.i) + 12) : undefined, top: 4 }} role="status" aria-live="polite">
            <div className="ch-tip-date">{fmtDay(dates[tip.i], intl, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</div>
            <div className="ch-tip-row">
              <i className="ch-key" style={{ background: up.color }} aria-hidden="true" />
              <strong>{tip.u === null ? "—" : format(tip.u)}</strong>
              <span>{up.label}</span>
            </div>
            <div className="ch-tip-row">
              <i className="ch-key" style={{ background: down.color }} aria-hidden="true" />
              <strong>{tip.dn === null ? "—" : format(tip.dn)}</strong>
              <span>{down.label}</span>
            </div>
            {tip.u !== null && tip.dn !== null && (
              <div className="ch-tip-row">
                <i aria-hidden="true" />
                <strong>{new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(tip.u - tip.dn)}</strong>
                <span>{netLabel}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
