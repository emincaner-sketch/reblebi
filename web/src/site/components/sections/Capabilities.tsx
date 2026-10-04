import type { PublicConfig, Locale } from "../../../lib/api";
import type { CapabilityItem } from "../../types/content";
import { fill } from "../../lib/fill";
import { featurePlanNames, joinNames } from "../../lib/plans";
import { useSite } from "../../lib/useSite";
import { SectionHead, delay } from "../ui/primitives";

/** Maddenin geçerli olduğu planlar: hepsiyse "" (tüm planlarda), hiçbiriyse null (madde gösterilmez) */
function planScope(item: CapabilityItem, cfg: PublicConfig, locale: Locale): string | null {
  const ok = item.feature ? cfg.plans.filter((p) => p.features[item.feature!]) : item.quota === "ai" ? cfg.plans.filter((p) => p.aiPerMonth > 0) : cfg.plans;
  if (!ok.length) return null;
  if (ok.length === cfg.plans.length) return "";
  return item.feature ? (featurePlanNames(cfg, item.feature, locale) ?? "") : joinNames(ok.map((p) => p.name[locale]), locale);
}

/** "Panelde ayrıca": kartsız, editoryal liste. Plan etiketi veriden üretilir; iddia planlarla çelişmez. */
export function Capabilities() {
  const { c, cfg, locale } = useSite();
  const k = c.capabilities;
  return (
    <section id="features" className="s-section s-caps" aria-labelledby="features-title">
      <div className="s-container s-caps__grid">
        <SectionHead eyebrow={k.eyebrow} title={k.title} id="features-title" />
        <ul className="s-caps__list">
          {k.items.map((item, i) => {
            const scope = planScope(item, cfg, locale);
            if (scope === null) return null;
            return (
              <li key={item.title} data-reveal style={delay((i % 2) * 60)}>
                <div className="s-caps__top">
                  <h3 className="s-h3">{item.title}</h3>
                  <span className="s-tag">{scope ? fill(k.inPlans, { plans: scope }) : k.allPlans}</span>
                </div>
                <p>{item.text}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
