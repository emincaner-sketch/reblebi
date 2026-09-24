/** Harici kütüphane olmadan IANA saat dilimi dönüşümleri (Intl ile) */

function partsIn(date: Date, timeZone: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const out: Record<string, number> = {};
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (const p of fmt.formatToParts(date)) {
    if (p.type === "weekday") out.weekday = wd[p.value] ?? 0;
    else if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** Verilen anda saat diliminin UTC'den farkı (dakika) */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** Saat dilimindeki yerel tarih/saati UTC Date'e çevir (yaz saati geçişlerine dayanıklı) */
export function zonedToUtc(year: number, month: number, day: number, minuteOfDay: number, timeZone: string): Date {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  const guess = Date.UTC(year, month - 1, day, h, m, 0);
  let offset = tzOffsetMinutes(new Date(guess), timeZone);
  let result = guess - offset * 60_000;
  const offset2 = tzOffsetMinutes(new Date(result), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset * 60_000;
  }
  return new Date(result);
}

/** Bir UTC anının saat dilimindeki yerel takvim günü */
export function localDate(date: Date, timeZone: string): { year: number; month: number; day: number; weekday: number; minuteOfDay: number } {
  const p = partsIn(date, timeZone);
  return { year: p.year, month: p.month, day: p.day, weekday: p.weekday, minuteOfDay: p.hour * 60 + p.minute };
}

/** Yerel takvimde N gün sonrası */
export function addLocalDays(y: number, m: number, d: number, n: number): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function formatLocal(date: Date, timeZone: string, locale: "tr" | "en" = "tr"): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function minutesToHHMM(n: number): string {
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Esnek tarih girişi: ISO, "now", "YYYY-MM-DD HH:mm" (org saat diliminde) */
export function parseFlexibleDate(input: string, timeZone: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  if (s.toLowerCase() === "now") return new Date();
  // Saat dilimi bilgisi olmayan yerel format: 2026-10-01 10:30 ya da 2026-10-01T10:30
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (local) {
    return zonedToUtc(Number(local[1]), Number(local[2]), Number(local[3]), Number(local[4]) * 60 + Number(local[5]), timeZone);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
