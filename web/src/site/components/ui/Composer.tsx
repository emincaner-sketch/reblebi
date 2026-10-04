import { Check, Clock, PenLine } from "lucide-react";
import { CORE_PLATFORMS } from "../../../config/site";
import { platformName } from "../../../landing/PlatformIcon";
import { fill } from "../../lib/fill";
import { useSite } from "../../lib/useSite";
import { Dot, Glyph } from "./primitives";

/**
 * Panelin gönderi düzenleyicisinin temsilî çizimi: tek metin, dokuz kanal, sonraki boş saat.
 * Hero'nun tek görsel varlığıdır ve imza bölümünün 1. adımında aynı kart olarak devam eder.
 * hero: role="img" ve açıklayıcı etiket; scene: imza sahnesinde dekoratif (aria-hidden üst öğeden gelir).
 */
export function Composer({ variant }: { variant: "hero" | "scene" }) {
  const { c, app } = useSite();
  const k = c.hero.composer;
  const a11y = variant === "hero" ? { role: "img", "aria-label": fill(k.aria, { app }) } : {};
  return (
    <div className={`s-composer s-composer--${variant}`} {...a11y}>
      <div className="s-composer__top" aria-hidden="true">
        <span className="s-composer__label">
          <PenLine />
          {k.label}
        </span>
        <span className="s-chip">{k.status}</span>
      </div>
      <p className="s-composer__text" aria-hidden="true">
        {k.text}
        <span className="s-composer__caret" />
      </p>
      <div className="s-composer__channels" aria-hidden="true">
        <ul>
          {CORE_PLATFORMS.map((p, i) => (
            <li key={p} className="s-composer__ch" style={{ ["--i" as string]: i }} title={platformName(p)}>
              <Glyph p={p} size={16} />
              <Check className="s-composer__tick" />
            </li>
          ))}
        </ul>
        <span className="s-composer__count">{k.channels}</span>
      </div>
      <div className="s-composer__foot" aria-hidden="true">
        <span className="s-composer__slot">
          <Clock />
          {k.slot}
          <Dot />
        </span>
        <span className="s-composer__btn">{k.action}</span>
      </div>
    </div>
  );
}
