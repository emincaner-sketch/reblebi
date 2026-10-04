import { useRef } from "react";
import { useJourney } from "../../motion/useJourney";
import { fill } from "../../lib/fill";
import { featurePlanNames } from "../../lib/plans";
import { useSite } from "../../lib/useSite";
import { SectionHead } from "../ui/primitives";
import { JOURNEY_SCENES } from "./JourneyScenes";

/**
 * İmza bölümü: bir gönderinin taslaktan yanıta yolculuğu.
 * Sunucu HTML'i sıralı bir listedir (her adım: metin + sahne). Canlı modda adımlar aynı hücrede üst üste durur,
 * yalnızca etkin olan görünür; diğerleri erişilebilirlik ağacında kalır (yalnızca opacity).
 * data-cta-zone: sahne tüm ekranı kullanırken mobildeki yapışkan CTA gizlenir (sahneyi örtmesin).
 */
export function Journey() {
  const { c, cfg, locale, app } = useSite();
  const j = c.journey;
  const track = useRef<HTMLDivElement>(null);
  const { live, step, goTo } = useJourney(track, j.steps.length);
  const inboxPlans = featurePlanNames(cfg, "inbox", locale);

  return (
    <section id="how" className="s-jr" aria-labelledby="how-title">
      <div className="s-container">
        <SectionHead eyebrow={j.eyebrow} title={j.title} id="how-title" lead={j.lead} />
      </div>
      <div ref={track} className="s-jr__track" data-live={live || undefined} data-cta-zone style={{ ["--n" as string]: j.steps.length }}>
        <div className="s-jr__stage s-container">
          {live && (
            <nav className="s-jr__rail" aria-label={j.rail}>
              <ol>
                {j.steps.map((s, i) => (
                  <li key={s.short}>
                    <button type="button" aria-current={i === step ? "step" : undefined} onClick={() => goTo(i)}>
                      <span className="s-jr__n">{String(i + 1).padStart(2, "0")}</span>
                      <span>{s.short}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <span className="s-jr__line" aria-hidden="true">
                <i className="s-jr__fill" />
                <i className="s-jr__marker" />
              </span>
            </nav>
          )}
          <ol className="s-jr__steps">
            {j.steps.map((s, i) => {
              const Scene = JOURNEY_SCENES[i];
              const pos = !live ? undefined : i === step ? "current" : i < step ? "before" : "after";
              return (
                <li key={s.title} className="s-jr__step" data-pos={pos} aria-current={live && i === step ? "step" : undefined}>
                  <div className="s-jr__copy">
                    <span className="s-jr__n" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="s-h3">{s.title}</h3>
                    <p>{fill(s.text, { app })}</p>
                    {i === 4 && inboxPlans && <p className="s-jr__note">{fill(j.inboxNote, { plans: inboxPlans })}</p>}
                  </div>
                  <div className="s-scene" aria-hidden="true">
                    <Scene />
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="s-caption s-caption--dark">{j.caption}</p>
        </div>
      </div>
    </section>
  );
}
