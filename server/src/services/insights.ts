import { createLogger } from "../core/logger.js";
import { insightsRepo } from "../core/repos/insights.js";
import { orgsRepo } from "../core/repos/orgs.js";
import type { Channel } from "../core/types.js";
import { getProvider } from "../providers/index.js";
import { addDays, localYmd, zonedMidnight } from "./analytics-report.js";

const log = createLogger("insights");

/** Geriye dönük doldurulan en fazla gün (platformlar günlük insights'ı ~30 gün tutar) */
export const INSIGHT_BACKFILL_DAYS = 7;
/** Kitle kırılımı haftada bir yenilenir */
const AUDIENCE_MAX_AGE_MS = 7 * 86_400_000;

/**
 * Kanalın tamamlanmış günlerine ait hesap insights'ını (erişim, görüntülenme, profil ziyareti, takip/takipten çıkma…)
 * çalışma alanı saatine göre gün gün çeker ve o günün anlık görüntüsüne yazar; kitleyi haftada bir yeniler.
 * Platform izin vermiyorsa sessizce geçer (temel takipçi metrikleri etkilenmez).
 */
export async function collectChannelInsights(channel: Channel, now = Date.now()): Promise<{ days: number; audience: boolean }> {
  const provider = getProvider(channel.provider);
  let days = 0;
  let audience = false;
  const tz = orgsRepo.get(channel.orgId)?.timezone || "Europe/Istanbul";
  const today = localYmd(now, tz);

  if (provider.fetchDailyInsights) {
    const from = addDays(today, -INSIGHT_BACKFILL_DAYS);
    const to = addDays(today, -1);
    const have = insightsRepo.daysWithInsights(channel.id, from, to);
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (have.has(d)) continue;
      const since = Math.floor(zonedMidnight(d, tz) / 1000);
      const until = Math.floor(zonedMidnight(addDays(d, 1), tz) / 1000);
      try {
        const values = await provider.fetchDailyInsights(channel, { since, until });
        if (Object.keys(values).length) {
          insightsRepo.mergeDay(channel.id, d, values);
          days++;
        } else if (d <= addDays(today, -4)) insightsRepo.markChecked(channel.id, d);
        // Son 3 gün boşsa işaretlenmez: platformlar (özellikle YouTube) veriyi 2-3 gün gecikmeyle verir, sonra tekrar denenir
      } catch (e) {
        log.debug("günlük insights alınamadı", { channel: channel.id, day: d, msg: e instanceof Error ? e.message : e });
        break;
      }
    }
  }

  if (provider.fetchAudience) {
    const cur = insightsRepo.audience(channel.id);
    if (!cur || now - Date.parse(cur.fetchedAt) > AUDIENCE_MAX_AGE_MS) {
      try {
        const data = await provider.fetchAudience(channel);
        // Boş sonuç da kaydedilir: haftada bir yeniden denenir
        insightsRepo.setAudience(channel.id, data);
        audience = Object.keys(data).length > 0;
      } catch (e) {
        log.debug("kitle alınamadı", { channel: channel.id, msg: e instanceof Error ? e.message : e });
      }
    }
  }
  return { days, audience };
}
