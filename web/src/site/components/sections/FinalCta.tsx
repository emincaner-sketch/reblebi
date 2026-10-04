import { fill } from "../../lib/fill";
import { trialPlanName } from "../../lib/plans";
import { useSite } from "../../lib/useSite";
import { CtaNote, Dot, DotTitle, PrimaryCta, delay } from "../ui/primitives";

/** Dönüşüm: üç başlangıç adımı ve aynı birincil CTA. Koyu yüzey = panelin içi. */
export function FinalCta() {
  const { c, cfg, locale } = useSite();
  const f = c.final;
  const lead = cfg.trialDays > 0 ? fill(f.leadTrial, { days: cfg.trialDays, plan: trialPlanName(cfg, locale) }) : f.lead;
  return (
    <section className="s-final" aria-labelledby="final-title" data-cta-zone>
      <div className="s-container">
        <div className="s-final__head" data-reveal>
          <h2 id="final-title" className="s-h2">
            <DotTitle text={f.title} />
          </h2>
          <p className="s-lead">{lead}</p>
        </div>
        <ol className="s-final__steps">
          {f.steps.map((s, i) => (
            <li key={s.title} data-reveal style={delay(i * 80)}>
              <Dot />
              <span className="s-final__n" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="s-h4">{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
        <div className="s-final__cta" data-reveal>
          <PrimaryCta tone="dark" />
          <CtaNote className="s-note s-note--dark" />
        </div>
      </div>
    </section>
  );
}
