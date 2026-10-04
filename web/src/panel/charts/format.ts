/** Sayı, yüzde ve tarih biçimleri (tr-TR / en-GB). Büyük sayılar kısaltılır: 12,9 B / 12.9K */

export function fmtNum(n: number | null | undefined, intl: string): string {
  return n === null || n === undefined ? "—" : new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(n);
}

export function fmtCompact(n: number | null | undefined, intl: string): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) < 10_000) return fmtNum(n, intl);
  return new Intl.NumberFormat(intl, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** 6.8 → "%6,8" (tr) / "6.8%" (en) */
export function fmtPct(n: number | null | undefined, intl: string): string {
  return n === null || n === undefined ? "—" : new Intl.NumberFormat(intl, { style: "percent", maximumFractionDigits: 1 }).format(n / 100);
}

export interface Delta {
  /** Mutlak fark */
  abs: number | null;
  /** Yüzde fark; önceki değer 0 ya da yoksa null */
  pct: number | null;
  dir: "up" | "down" | "flat" | null;
}

export function delta(value: number | null | undefined, prev: number | null | undefined): Delta {
  if (value === null || value === undefined || prev === null || prev === undefined) return { abs: null, pct: null, dir: null };
  const abs = value - prev;
  return { abs, pct: prev !== 0 ? (abs / Math.abs(prev)) * 100 : null, dir: abs > 0 ? "up" : abs < 0 ? "down" : "flat" };
}

/** "2026-09-04" → "4 Eyl" (UTC gün, saat dilimi kayması yok) */
export function fmtDay(ymd: string, intl: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat(intl, { ...opts, timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
}

export function fmtRange(from: string, to: string, intl: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const a = fmtDay(from, intl, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  const b = fmtDay(to, intl, { day: "numeric", month: "short", year: "numeric" });
  return `${a} – ${b}`;
}

/** Eksen için "yuvarlak" adım: 1, 2, 2.5, 5 × 10^n */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max === min) max = min + (min === 0 ? 1 : Math.abs(min) * 0.1);
  const raw = (max - min) / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** CSV: Türkçede ondalık virgül olduğu için ayraç noktalı virgül; Excel için BOM */
export function toCsv(rows: Array<Array<string | number | null>>, locale: "tr" | "en"): string {
  const sep = locale === "tr" ? ";" : ",";
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? (locale === "tr" ? String(v).replace(".", ",") : String(v)) : v;
    return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(sep)).join("\r\n");
}

export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
