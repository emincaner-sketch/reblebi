import { channelsRepo } from "../core/repos/channels.js";
import { postsRepo } from "../core/repos/posts.js";
import { orgSettingsRepo, orgsRepo } from "../core/repos/orgs.js";
import { addLocalDays, formatLocal, localDate, minutesToHHMM, zonedToUtc } from "./time.js";

/**
 * Boş saat bulucu (Postiz "time slots" karşılığı).
 * Her kanalın tercih ettiği paylaşım saatleri (dakika cinsinden) vardır; yoksa çalışma alanı varsayılanı kullanılır.
 * Bir aday saat, seçili TÜM kanallarda minGap dakika içinde başka gönderi yoksa uygundur.
 */

export interface SlotQuery {
  orgId: string;
  channelIds: string[];
  /** Bu andan sonrası (varsayılan: şimdi + 10 dk) */
  from?: Date;
  /** Kaç gün ileri bakılsın (varsayılan 30) */
  days?: number;
  count?: number;
  /** Sadece bu hafta günleri (0=Pazar ... 6=Cumartesi) */
  weekdays?: number[];
  minGapMinutes?: number;
}

export interface FreeSlot {
  at: string;
  local: string;
  weekday: number;
}

/** Aynı istek içinde art arda slot ayırırken çakışmayı önlemek için bellek içi dolu saat haritası */
export class SlotAllocator {
  private busy = new Map<string, number[]>();
  private loaded = new Set<string>();

  constructor(
    private readonly orgId: string,
    private readonly horizonDays = 60,
  ) {}

  private ensureLoaded(channelIds: string[]): void {
    const missing = channelIds.filter((c) => !this.loaded.has(c));
    if (!missing.length) return;
    const from = new Date(Date.now() - 86400_000).toISOString();
    const to = new Date(Date.now() + this.horizonDays * 86400_000).toISOString();
    for (const row of postsRepo.scheduledTimesForChannels(this.orgId, missing, from, to)) {
      const arr = this.busy.get(row.channelId) ?? [];
      arr.push(new Date(row.at).getTime());
      this.busy.set(row.channelId, arr);
    }
    for (const c of missing) this.loaded.add(c);
  }

  isFree(channelIds: string[], at: number, gapMs: number): boolean {
    this.ensureLoaded(channelIds);
    return channelIds.every((c) => !(this.busy.get(c) ?? []).some((t) => Math.abs(t - at) < gapMs));
  }

  reserve(channelIds: string[], at: number): void {
    for (const c of channelIds) {
      const arr = this.busy.get(c) ?? [];
      arr.push(at);
      this.busy.set(c, arr);
    }
  }

  find(q: Omit<SlotQuery, "orgId">): FreeSlot[] {
    const org = orgsRepo.get(this.orgId);
    const tz = org?.timezone ?? "Europe/Istanbul";
    const settings = orgSettingsRepo.get(this.orgId);
    const gapMs = (q.minGapMinutes ?? settings.minGapMinutes ?? 60) * 60_000;
    const count = Math.max(1, Math.min(q.count ?? 5, 200));
    const days = Math.max(1, Math.min(q.days ?? 30, this.horizonDays));
    const earliest = Math.max((q.from ?? new Date()).getTime(), Date.now() + 10 * 60_000);

    // Kanalların tercih ettiği saatlerin birleşimi
    const minuteSet = new Set<number>();
    for (const id of q.channelIds) {
      const ch = channelsRepo.get(this.orgId, id);
      const slots = ch?.timeSlots?.length ? ch.timeSlots : settings.defaultTimeSlots;
      for (const s of slots) minuteSet.add(s);
    }
    if (!minuteSet.size) for (const s of settings.defaultTimeSlots.length ? settings.defaultTimeSlots : [600, 780, 1140]) minuteSet.add(s);
    const minutes = [...minuteSet].sort((a, b) => a - b);

    const start = localDate(new Date(earliest), tz);
    const out: FreeSlot[] = [];
    for (let i = 0; i <= days && out.length < count; i++) {
      const day = addLocalDays(start.year, start.month, start.day, i);
      for (const m of minutes) {
        if (out.length >= count) break;
        const at = zonedToUtc(day.year, day.month, day.day, m, tz);
        const ts = at.getTime();
        if (ts < earliest) continue;
        const ld = localDate(at, tz);
        if (q.weekdays?.length && !q.weekdays.includes(ld.weekday)) continue;
        if (!this.isFree(q.channelIds, ts, gapMs)) continue;
        out.push({ at: at.toISOString(), local: formatLocal(at, tz, org?.locale ?? "tr"), weekday: ld.weekday });
        // Aynı sonuç listesinde de aralık korunsun
        this.reserve(q.channelIds, ts);
      }
    }
    return out;
  }
}

export function findFreeSlots(q: SlotQuery): FreeSlot[] {
  return new SlotAllocator(q.orgId).find(q);
}

/** Panel ve MCP için okunabilir saat listesi */
export function describeSlots(minutes: number[]): string[] {
  return [...minutes].sort((a, b) => a - b).map(minutesToHHMM);
}
