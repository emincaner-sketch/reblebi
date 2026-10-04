import { EyeOff, KeyRound, Lock, Trash2 } from "lucide-react";
import { CORE_PLATFORMS } from "../../../config/site";
import { useSite } from "../../lib/useSite";
import { Glyph, SectionHead, delay } from "../ui/primitives";

const ICONS = [KeyRound, Lock, EyeOff, Trash2];

/** Kanıt: sayı ve yorum yok; yalnızca doğrulanabilir güven maddeleri ve gerçek platform listesi */
export function Trust() {
  const { c } = useSite();
  const t = c.trust;
  return (
    <section className="s-section s-trust" aria-labelledby="trust-title">
      <div className="s-container">
        <div className="s-trust__head">
          <SectionHead eyebrow={t.eyebrow} title={t.title} id="trust-title" />
          <ul className="s-trust__platforms" aria-label={t.platforms} data-reveal>
            {CORE_PLATFORMS.map((p) => (
              <li key={p}>
                <Glyph p={p} size={22} labelled />
              </li>
            ))}
          </ul>
        </div>
        <ul className="s-trust__list">
          {t.items.map((item, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <li key={item.title} data-reveal style={delay(i * 60)}>
                <Icon aria-hidden="true" />
                <h3 className="s-h4">{item.title}</h3>
                <p>{item.text}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
