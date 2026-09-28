/** Çalışma alanının saat diliminde tarih işlemleri (tarayıcının saat dilimi farklı olabilir) */

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function wallClock(date: Date | string, tz: string): WallClock {
  const d = typeof date === "string" ? new Date(date) : date;
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(d)) {
    if (p.type === "weekday") out.weekday = WD[p.value] ?? 0;
    else if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, weekday: out.weekday };
}

function offsetMinutes(date: Date, tz: string): number {
  const w = wallClock(date, tz);
  const s = Number(formatter(tz).formatToParts(date).find((p) => p.type === "second")?.value ?? 0);
  return Math.round((Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, s) - date.getTime()) / 60_000);
}

/** Saat dilimindeki yerel duvar saatini UTC Date'e çevir */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let off = offsetMinutes(new Date(guess), tz);
  let result = guess - off * 60_000;
  const off2 = offsetMinutes(new Date(result), tz);
  if (off2 !== off) {
    off = off2;
    result = guess - off * 60_000;
  }
  return new Date(result);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" anahtarı (takvim günleri için) */
export function dayKey(date: Date | string, tz: string): string {
  const w = wallClock(date, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function keyOf(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** datetime-local input değeri: "YYYY-MM-DDTHH:mm" (çalışma alanı saatinde) */
export function toInputValue(iso: string | null, tz: string): string {
  if (!iso) return "";
  const w = wallClock(iso, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** Sunucuya gönderilecek yerel saat: "YYYY-MM-DD HH:mm" (sunucu çalışma alanı saat dilimiyle çözer) */
export function inputToServer(v: string): string | null {
  return v ? v.replace("T", " ") : null;
}

/** Takvim günü aritmetiği (saat diliminden bağımsız) */
export function addDays(y: number, m: number, d: number, n: number): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function fmt(iso: string | null | undefined, tz: string, intl: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat(intl, { ...opts, timeZone: tz }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function fmtTime(iso: string | null | undefined, tz: string, intl: string): string {
  return fmt(iso, tz, intl, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export const BROWSER_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Istanbul";
  } catch {
    return "Europe/Istanbul";
  }
})();

export function timeAgo(iso: string, locale: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale === "en" ? "en" : "tr", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(-Math.round(diff), "second");
  if (abs < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(-Math.round(diff / 86400), "day");
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { dateStyle: "medium" }).format(new Date(iso));
}

export function todayIn(tz: string): { year: number; month: number; day: number } {
  const w = wallClock(new Date(), tz);
  return { year: w.year, month: w.month, day: w.day };
}
