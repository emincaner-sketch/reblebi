import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n";
import { Seo } from "../../seo/Seo";
import { pricingJsonLd } from "../../seo/jsonld";
import { pricingFaq } from "../../landing/faq-data";
import { fill } from "../lib/fill";
import { joinNames, trialPlanName } from "../lib/plans";
import { useLinks, useSite } from "../lib/useSite";
import { SiteShell } from "../components/SiteShell";
import { PlanPicker, PriceFoot } from "../components/sections/Pricing";
import { CompareTable } from "../components/sections/PlanCards";
import { Faq } from "../components/sections/Faq";
import { FinalCta } from "../components/sections/FinalCta";

/** /fiyatlar ve /en/pricing: tek H1, plan bulucu, kartlar, karşılaştırma tablosu, fiyat SSS'i */
export default function PricingPage() {
  const { t } = useI18n();
  const { c, cfg, locale } = useSite();
  const links = useLinks();
  const k = c.pricingPage;
  const title = fill(k.title, { plans: joinNames(cfg.plans.map((p) => p.name[locale]), locale) });
  const lead = cfg.trialDays > 0 ? fill(k.leadTrial, { days: cfg.trialDays, plan: trialPlanName(cfg, locale) }) : k.lead;
  return (
    <SiteShell>
      <Seo page="pricing" jsonLd={pricingJsonLd(cfg, locale)} />
      <section className="s-section s-pricing s-pricing--page" aria-labelledby="pricing-page-title">
        <div className="s-container">
          <header className="s-page-head">
            <nav aria-label={k.crumbs}>
              <ol className="s-crumbs">
                <li>
                  <Link to={links.page("home")}>{k.home}</Link>
                </li>
                <li aria-current="page">{k.current}</li>
              </ol>
            </nav>
            <h1 id="pricing-page-title" className="s-h1 s-h1--page">
              {title}
            </h1>
            <p className="s-lead">{lead}</p>
          </header>
          <PlanPicker />
          <PriceFoot />
        </div>
      </section>
      <section id="compare" className="s-section s-compare" aria-labelledby="compare-title">
        <div className="s-container">
          <h2 id="compare-title" className="s-h2" data-reveal>
            {k.compareTitle}
          </h2>
          <CompareTable plans={cfg.plans} />
        </div>
      </section>
      <Faq items={pricingFaq(t, cfg, locale)} eyebrow={c.faq.eyebrow} title={k.faqTitle} id="pricing-faq" />
      <FinalCta />
    </SiteShell>
  );
}
