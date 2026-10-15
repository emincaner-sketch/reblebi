import { getDb, nowIso, parseJson } from "../db.js";
import type { DmProfile, DmProfileItem } from "../types.js";

type Row = Record<string, unknown>;

function rowToProfile(r: Row): DmProfile {
  return {
    channelId: r.channel_id as string,
    orgId: r.org_id as string,
    iceBreakers: parseJson<DmProfileItem[]>(r.ice_breakers, []),
    menu: parseJson<DmProfileItem[]>(r.menu, []),
    syncedAt: (r.synced_at as string) ?? null,
    syncError: (r.sync_error as string) ?? null,
    updatedAt: (r.updated_at as string) ?? null,
  };
}

export const dmProfilesRepo = {
  get(channelId: string): DmProfile | null {
    const r = getDb().prepare("SELECT * FROM dm_profiles WHERE channel_id = ?").get(channelId) as Row | undefined;
    return r ? rowToProfile(r) : null;
  },
  save(orgId: string, channelId: string, input: { iceBreakers: DmProfileItem[]; menu: DmProfileItem[] }): DmProfile {
    getDb()
      .prepare(
        `INSERT INTO dm_profiles (channel_id, org_id, ice_breakers, menu, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET ice_breakers = excluded.ice_breakers, menu = excluded.menu, updated_at = excluded.updated_at`,
      )
      .run(channelId, orgId, JSON.stringify(input.iceBreakers), JSON.stringify(input.menu), nowIso());
    return this.get(channelId)!;
  },
  /** Meta'ya gönderim sonucu: başarılıysa zaman, değilse hata yazılır (son başarılı zaman korunur) */
  markSynced(channelId: string, result: { at: string } | { error: string }): DmProfile | null {
    if ("at" in result) getDb().prepare("UPDATE dm_profiles SET synced_at = ?, sync_error = NULL WHERE channel_id = ?").run(result.at, channelId);
    else getDb().prepare("UPDATE dm_profiles SET sync_error = ? WHERE channel_id = ?").run(result.error.slice(0, 500), channelId);
    return this.get(channelId);
  },
};
