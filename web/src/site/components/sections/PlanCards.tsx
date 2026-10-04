import { useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import type { PlanFeature, PlanInfo } from "../../../lib/api";
import { useMeQuery } from "../../../lib/session";
import { fill } from "../../lib/fill";
import { formatLimit, highlightedPlanId, intlOf, limitRows, yearlyBadge } from "../../lib/plans";
import { useSite } from "../../lib/useSite";
import { delay } from "../ui/primitives";

/** Fiyat kartları: fiyat, limit ve özellikler yalnızca /api/public/config'ten. matchId: plan bulucunun önerisi. */
export function PlanCards({ plans, matchId, headingLevel = 3 }: { plans: PlanInfo[]; matchId?: string; headingLevel?: 2 | 3 }) {
  const { c, cfg, locale } = useSite();
  const me = useMeQuery();
  const k = c.pricing;
  const [yearly, setYearly] = useState(false);
  const open = cfg.signupMode === "open" && !me.data?.user;
  const badge = yearlyBadge(plans, k);
  const hasYearly = plans.some((p) => p.priceYearly > 0);
  const hl = highlightedPlanId(cfg);
  const H = headingLevel === 2 ? "h2" : "h3";
  const money = (n: number) => n.toLocaleString(intlOf(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const features = Object.keys(k.features) as PlanFeature[];

  return (
    <div className="s-plans-wrap">
      {hasYearly && (
        <div className="s-billing">
          <div className="s-switch" role="group" aria-label={k.billing.label}>
            <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>
              {k.billing.monthly}
            </button>
            <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>
              {k.billing.yearly}
            </button>
          </div>
          {badge && <span className="s-chip s-chip--ok">{badge}</span>}
        </div>
      )}
      <ul className="s-plans">
        {plans.map((p, i) => {
          const showYear = yearly && p.priceYearly > 0;
          const amount = showYear ? p.priceYearly : p.priceMonthly;
          const note = p.priceMonthly === 0 ? k.freeNote : showYear ? fill(k.yearlyAvg, { n: money(p.priceYearly / 12) }) : p.priceYearly > 0 ? fill(k.yearlyAlt, { n: p.priceYearly }) : "";
          const trial = p.id === cfg.trialPlan && cfg.trialDays > 0;
          const included = features.filter((f) => p.features[f]);
          const missing = features.filter((f) => !p.features[f]);
          const isHl = p.id === hl;
          const isMatch = p.id === matchId;
          return (
            <li key={p.id} id={`plan-${p.id}`} className="s-plan" data-hl={isHl || undefined} data-match={isMatch || undefined} data-reveal style={delay(i * 60)}>
              <div className="s-plan__top">
                <H className="s-plan__name">{p.name[locale]}</H>
                <span className="s-plan__badges">
                  {isMatch && <span className="s-chip s-chip--match">{k.match}</span>}
                  {isHl && <span className="s-chip">{k.recommended}</span>}
                </span>
              </div>
              {k.who[p.id] && <p className="s-plan__who">{k.who[p.id]}</p>}
              <p className="s-plan__price">
                <b>${amount}</b>
                <span>/ {showYear ? k.perYear : k.perMonth}</span>
              </p>
              <p className="s-plan__note">{note || " "}</p>
              {open && (
                <Link to="/signup" className={`s-btn s-btn--block ${isHl ? "s-btn--primary" : "s-btn--secondary"}`}>
                  {p.priceMonthly === 0 ? k.cardCta.free : trial ? fill(k.cardCta.trial, { days: cfg.trialDays }) : k.cardCta.other}
                </Link>
              )}
              <ul className="s-plan__list">
                {limitRows(p, k, locale).map((r) => (
                  <li key={r}>
                    <Check aria-hidden="true" />
                    {r}
                  </li>
                ))}
                {included.map((f) => (
                  <li key={f}>
                    <Check aria-hidden="true" />
                    {k.features[f]}
                  </li>
                ))}
              </ul>
              {missing.length > 0 && (
                <p className="s-plan__missing">
                  <span>{k.notIncluded}</span> {missing.map((f) => k.features[f]).join(", ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** /fiyatlar karşılaştırma tablosu: mobilde yatay kaydırma yalnızca tablo kabında */
export function CompareTable({ plans }: { plans: PlanInfo[] }) {
  const { c, locale } = useSite();
  const k = c.pricing;
  const t = c.pricingPage.table;
  const fmt = (n: number) => formatLimit(n, locale, k.limits.unlimited);
  const rows: Array<{ label: string; get: (p: PlanInfo) => string }> = [
    { label: t.channels, get: (p) => fmt(p.channels) },
    { label: t.members, get: (p) => fmt(p.members) },
    { label: t.posts, get: (p) => fmt(p.postsPerMonth) },
    { label: t.ai, get: (p) => fmt(p.aiPerMonth) },
    { label: t.storage, get: (p) => fmt(p.storageMb) },
  ];
  return (
    <div className="s-table-wrap" tabIndex={0} role="region" aria-label={c.pricingPage.compareTitle}>
      <table className="s-table">
        <caption className="s-sr">{c.pricingPage.compareTitle}</caption>
        <thead>
          <tr>
            <th scope="col">{t.feature}</th>
            {plans.map((p) => (
              <th key={p.id} scope="col">
                {p.name[locale]}
                <span>
                  ${p.priceMonthly} / {k.perMonth}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              {plans.map((p) => (
                <td key={p.id}>{r.get(p)}</td>
              ))}
            </tr>
          ))}
          {(Object.keys(k.features) as PlanFeature[]).map((f) => (
            <tr key={f}>
              <th scope="row">{k.features[f]}</th>
              {plans.map((p) => (
                <td key={p.id}>{p.features[f] ? <span className="s-yes">{t.yes}</span> : <span className="s-no">{t.no}</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
