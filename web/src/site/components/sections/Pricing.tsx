import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { fill } from "../../lib/fill";
import { recommendPlan, trialPlanName, type FinderInput } from "../../lib/plans";
import { useLinks, useSite } from "../../lib/useSite";
import { PlanFinder } from "./PlanFinder";
import { PlanCards } from "./PlanCards";

/** Varsayılan: tek başına, 4 kanal. Öneri ilk çizimde (ön-render) de hesaplanır. */
const DEFAULT_INPUT: FinderInput = { role: "creator", channels: 4, members: 1 };

/** Plan bulucu ve kartlar birlikte: bulucunun önerisi kartta "Sana uygun" olarak işaretlenir */
export function PlanPicker() {
  const { cfg } = useSite();
  const [input, setInput] = useState<FinderInput>(DEFAULT_INPUT);
  const match = recommendPlan(cfg.plans, input)?.plan.id;
  return (
    <>
      <PlanFinder value={input} onChange={setInput} plans={cfg.plans} />
      <PlanCards plans={cfg.plans} matchId={match} />
    </>
  );
}

export function PriceFoot() {
  const { c } = useSite();
  const links = useLinks();
  return (
    <div className="s-price-foot">
      <p className="s-small">{c.pricing.foot}</p>
      <Link to={links.page("pricing", "compare")} className="s-link">
        {c.pricing.compare}
        <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

/** Ana sayfadaki fiyat bölümü: "Fiyatlar" H2, plan adları H3 */
export function Pricing() {
  const { c, cfg, locale } = useSite();
  const k = c.pricing;
  const lead = cfg.trialDays > 0 ? fill(k.leadTrial, { days: cfg.trialDays, plan: trialPlanName(cfg, locale) }) : k.lead;
  return (
    <section id="pricing" className="s-section s-pricing" aria-labelledby="pricing-title">
      <div className="s-container">
        <div className="s-head s-head--center" data-reveal>
          <p className="s-eyebrow">{k.eyebrow}</p>
          <h2 id="pricing-title" className="s-h2">
            {k.title}
          </h2>
          <p className="s-lead">{lead}</p>
        </div>
        <PlanPicker />
        <PriceFoot />
      </div>
    </section>
  );
}
