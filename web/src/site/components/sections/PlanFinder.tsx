import { useId } from "react";
import type { PlanInfo } from "../../../lib/api";
import { fill } from "../../lib/fill";
import { recommendPlan, type FinderInput, type FinderReason } from "../../lib/plans";
import { useSite } from "../../lib/useSite";
import type { FinderRole } from "../../types/content";

const ROLES: FinderRole[] = ["creator", "ecommerce", "agency"];

/**
 * Plan bulucu (BRAND_DECISIONS.md §12): kimsin → kaç kanal → ekip kaç kişi.
 * Hesap yalnızca gerçek plan limitlerinden; sonuç fiyat kartını vurgular. Saf React state, ek kütüphane yok.
 */
export function PlanFinder({ value, onChange, plans }: { value: FinderInput; onChange: (v: FinderInput) => void; plans: PlanInfo[] }) {
  const { c, locale } = useSite();
  const f = c.finder;
  const uid = useId();
  const result = recommendPlan(plans, value);
  const maxChannels = Math.max(10, ...plans.map((p) => p.channels)) + 10;
  const maxMembers = Math.max(5, ...plans.map((p) => p.members)) + 5;
  const name = (p: PlanInfo) => p.name[locale];

  const reason = (r: FinderReason): string => {
    switch (r.kind) {
      case "channels":
        return fill(f.reasons.channels, { plan: name(r.plan), n: r.n });
      case "members":
        return fill(f.reasons.members, { plan: name(r.plan), n: r.n });
      case "inbox":
        return fill(f.reasons.inbox, { plan: name(r.plan) });
      case "customers":
        return fill(f.reasons.customers, { plan: name(r.plan) });
      case "fits":
        return fill(f.reasons.fits, { plan: name(r.plan), channels: value.channels, members: value.members });
      case "over":
        return fill(f.reasons.over, { plan: name(r.plan), n: r.plan.channels, m: r.plan.members });
    }
  };

  return (
    <div className="s-finder" data-reveal>
      <h3 className="s-h3">{f.title}</h3>
      <div className="s-finder__grid">
        <form className="s-finder__form" onSubmit={(e) => e.preventDefault()}>
          <fieldset className="s-seg">
            <legend>{f.roleLegend}</legend>
            <div className="s-seg__opts">
              {ROLES.map((r) => (
                <label key={r}>
                  <input type="radio" name={`${uid}-role`} value={r} checked={value.role === r} onChange={() => onChange({ ...value, role: r })} />
                  <span>{f.roles[r]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="s-range">
            <label htmlFor={`${uid}-ch`}>{f.channels}</label>
            <output htmlFor={`${uid}-ch`}>{value.channels}</output>
            <input id={`${uid}-ch`} type="range" min={1} max={maxChannels} value={value.channels} onChange={(e) => onChange({ ...value, channels: Number(e.target.value) })} style={{ ["--v" as string]: (value.channels - 1) / (maxChannels - 1) }} />
          </div>
          <div className="s-range">
            <label htmlFor={`${uid}-mem`}>{f.members}</label>
            <output htmlFor={`${uid}-mem`}>{value.members}</output>
            <input id={`${uid}-mem`} type="range" min={1} max={maxMembers} value={value.members} onChange={(e) => onChange({ ...value, members: Number(e.target.value) })} style={{ ["--v" as string]: (value.members - 1) / (maxMembers - 1) }} />
          </div>
        </form>
        {result && (
          <div className="s-finder__result" aria-live="polite" aria-atomic="true">
            <p className="s-eyebrow">{f.result}</p>
            <p className="s-finder__plan">
              {name(result.plan)}
              <span>
                ${result.plan.priceMonthly} / {c.pricing.perMonth}
              </span>
            </p>
            <ul>
              {result.reasons.map((r, i) => (
                <li key={i} data-kind={r.kind}>
                  {reason(r)}
                </li>
              ))}
            </ul>
            <a className="s-link" href={`#plan-${result.plan.id}`}>
              {f.seeCard}
            </a>
            <p className="s-small">{f.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}
