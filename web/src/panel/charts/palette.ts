import type { ProviderId } from "../../lib/api";

/**
 * Grafik renkleri (docs/panel/03-PANEL-TASARIM.md §2). Değerler charts.css'te CSS değişkeni olarak (açık/koyu).
 * Kategorik sıra doğrulandı (validate_palette.js): açık ΔE 9.1, koyu ΔE 8.4.
 * Renk ağı izler, sırayı değil: süzgeç değişince bir ağın rengi değişmez. 8'den fazlası "diğer" (nötr).
 */
const PROVIDER_SLOT: Partial<Record<ProviderId, number>> = {
  instagram: 1,
  facebook: 2,
  tiktok: 3,
  youtube: 4,
  linkedin: 5,
  x: 6,
  threads: 7,
  telegram: 8,
};

export const seriesVar = (slot: number) => `var(--series-${slot})`;

export function providerColor(p: ProviderId | string | null | undefined): string {
  const slot = p ? PROVIDER_SLOT[p as ProviderId] : undefined;
  return slot ? seriesVar(slot) : "var(--series-other)";
}

/** Tek serili grafiklerin rengi (marka moru) */
export const PRIMARY_SERIES = seriesVar(1);
