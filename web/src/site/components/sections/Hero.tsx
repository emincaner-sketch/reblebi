import { ArrowDown } from "lucide-react";
import { useSite } from "../../lib/useSite";
import { Composer } from "../ui/Composer";
import { CtaNote, DotTitle, PrimaryCta } from "../ui/primitives";

/** Üst satır, vaat, tek cümle, iki CTA, tek görsel varlık. Giriş hareketi yalnızca CSS; başlık ve CTA ilk karede görünür. */
export function Hero() {
  const { c } = useSite();
  const h = c.hero;
  return (
    <section className="s-hero" aria-labelledby="hero-title">
      <div className="s-container s-hero__grid">
        <div className="s-hero__copy">
          <p className="s-eyebrow">{h.eyebrow}</p>
          <h1 id="hero-title" className="s-h1">
            <DotTitle text={h.title} />
          </h1>
          <p className="s-lead s-hero__lead">{h.lead}</p>
          <div className="s-hero__ctas" data-cta-zone>
            <PrimaryCta />
            <a href="#how" className="s-btn s-btn--quiet s-btn--lg">
              {h.secondary}
              <ArrowDown aria-hidden="true" />
            </a>
          </div>
          <CtaNote />
        </div>
        <figure className="s-hero__visual">
          <Composer variant="hero" />
          <figcaption className="s-caption">{h.caption}</figcaption>
        </figure>
      </div>
    </section>
  );
}
