import type { CSSProperties, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { PLATFORM_ICONS, PlatformIcon, platformName, type PlatformKey } from "../../../landing/PlatformIcon";
import { alternatePath } from "../../../seo/routes";
import { usePrimaryCta, useSite } from "../../lib/useSite";

/** Logodaki leblebi tanesi: sayfanın tek işaret öğesi (ilerleme, seçili saat, okunmamış mesaj) */
export function Dot({ className = "" }: { className?: string }) {
  return <span className={`s-dot ${className}`.trim()} aria-hidden="true" />;
}

/** Nokta ile biten başlıkta son noktayı leblebi tanesiyle çizer; metin anlamı değişmez */
export function DotTitle({ text }: { text: string }) {
  if (!text.endsWith(".")) return <>{text}</>;
  return (
    <>
      {text.slice(0, -1)}
      <span className="s-sr">.</span>
      <Dot className="s-dot--end" />
    </>
  );
}

/** Açık zeminde okunur platform rengi: siyah logolu markalar mürekkep rengine döner */
export function inkColor(p: PlatformKey): string {
  const hex = PLATFORM_ICONS[p].hex;
  return hex === "000000" ? "var(--color-ink)" : `#${hex}`;
}

export function Glyph({ p, size = 18, labelled = false }: { p: PlatformKey; size?: number; labelled?: boolean }) {
  return <PlatformIcon p={p} size={size} label={labelled} style={{ color: inkColor(p) }} />;
}

export { platformName };

/** Birincil dönüşüm: kayıt, giriş ya da panel (veriden) */
export function PrimaryCta({ size = "lg", block = false, tone = "light", className = "" }: { size?: "md" | "lg"; block?: boolean; tone?: "light" | "dark"; className?: string }) {
  const cta = usePrimaryCta();
  const cls = ["s-btn", "s-btn--primary", size === "lg" && "s-btn--lg", block && "s-btn--block", tone === "dark" && "s-btn--on-dark", className].filter(Boolean).join(" ");
  return (
    <Link to={cta.to} className={cls}>
      {cta.label}
    </Link>
  );
}

export function CtaNote({ className = "s-note" }: { className?: string }) {
  const cta = usePrimaryCta();
  return cta.note ? <p className={className}>{cta.note}</p> : null;
}

export function LangSwitch() {
  const { c, locale, setLocale } = useSite();
  const { pathname } = useLocation();
  return (
    <div className="s-lang" role="group" aria-label={c.nav.lang}>
      {(["tr", "en"] as const).map((l) => (
        <Link key={l} to={alternatePath(pathname, l)} hrefLang={l} lang={l} aria-current={locale === l ? "true" : undefined} onClick={() => setLocale(l)}>
          {l.toUpperCase()}
        </Link>
      ))}
    </div>
  );
}

export function SectionHead({ eyebrow, title, id, lead, align = "start", children }: { eyebrow: string; title: string; id: string; lead?: ReactNode; align?: "start" | "center"; children?: ReactNode }) {
  return (
    <div className={`s-head s-head--${align}`} data-reveal>
      <p className="s-eyebrow">{eyebrow}</p>
      <h2 id={id} className="s-h2">
        {title}
      </h2>
      {lead && <p className="s-lead">{lead}</p>}
      {children}
    </div>
  );
}

/** Gecikmeli giriş için CSS değişkeni */
export const delay = (ms: number): CSSProperties => ({ ["--d" as string]: `${ms}ms` });
