import { useState } from "react";
import { useI18n } from "../../lib/i18n";

export interface HeatCell {
  weekday: number; // 0 = Pazartesi
  hour: number;
  posts: number;
  avgInteractions: number | null;
}

const STEPS = 6;

/**
 * Gün × saat ısı haritası. Tek renk (mor) açıktan koyuya, ölçek göstergesiyle; hücre başına ipucu.
 * Gönderisi olmayan hücre boş (kılçık çerçeve), metriği olmayan gönderili hücre noktalı.
 */
export function Heatmap({ cells, maxAvg, format }: { cells: HeatCell[]; maxAvg: number; format: (n: number) => string }) {
  const { t, intl } = useI18n();
  const [hover, setHover] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))));
  const map = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c]));
  const step = (v: number) => Math.max(1, Math.min(STEPS, Math.ceil((v / (maxAvg || 1)) * STEPS)));
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const active = hover ? map.get(hover) : undefined;
  const [hd, hh2] = hover ? hover.split("-").map(Number) : [0, 0];

  return (
    <div className="hm">
      <div className="hm-scroll">
        <div className="hm-grid" role="grid" aria-label={t("Gün ve saate göre ortalama etkileşim")}>
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="hm-hour" aria-hidden="true">
              {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
            </span>
          ))}
          {days.map((d, wd) => (
            <div key={d} className="hm-row" role="row">
              <span className="hm-day" role="rowheader">
                {d}
              </span>
              {Array.from({ length: 24 }, (_, h) => {
                const c = map.get(`${wd}-${h}`);
                const label = c ? `${d} ${hh(h)} · ${t("{n} gönderi", { n: c.posts })} · ${c.avgInteractions === null ? t("metrik yok") : t("ort. {v} etkileşim", { v: format(c.avgInteractions) })}` : `${d} ${hh(h)} · ${t("gönderi yok")}`;
                return (
                  <button
                    key={h}
                    type="button"
                    role="gridcell"
                    className={`hm-cell${c ? (c.avgInteractions === null ? " hm-cell--na" : "") : " hm-cell--empty"}`}
                    style={c && c.avgInteractions !== null ? { background: `var(--heat-${step(c.avgInteractions)})` } : undefined}
                    aria-label={label}
                    onPointerEnter={() => setHover(`${wd}-${h}`)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(`${wd}-${h}`)}
                    onBlur={() => setHover(null)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="hm-foot">
        <p className="hm-readout" aria-live="polite">
          {hover ? (
            <>
              <strong>
                {days[hd]} {hh(hh2)}
              </strong>{" "}
              · {active ? `${t("{n} gönderi", { n: active.posts })} · ${active.avgInteractions === null ? t("metrik yok") : t("ort. {v} etkileşim", { v: format(active.avgInteractions) })}` : t("gönderi yok")}
            </>
          ) : (
            t("Bir hücrenin üzerine gel ya da Tab ile gez.")
          )}
        </p>
        <div className="hm-scale" aria-hidden="true">
          <span>{t("Az")}</span>
          {Array.from({ length: STEPS }, (_, i) => (
            <i key={i} style={{ background: `var(--heat-${i + 1})` }} />
          ))}
          <span>{t("Çok")}</span>
        </div>
      </div>
    </div>
  );
}
