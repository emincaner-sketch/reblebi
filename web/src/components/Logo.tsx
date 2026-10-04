import { useId } from "react";
import { SITE_NAME } from "../config/site";

/**
 * Reblebi işareti: yuvarlak gövdeli küçük "r" ve ucundaki leblebi tanesi.
 * Aynı çizim public/favicon.svg ve scripts/brand-assets.mjs içinde de kullanılır; değişirse üçü birlikte güncellenir.
 */
export const MARK_STEM = "M9.2 22.4V15.8c0-3.5 2.5-6 6-6";
export const MARK_DOT = { cx: 21.7, cy: 11, r: 3.3 };

export function LogoMark({ size = 32, mono = false, title }: { size?: number; mono?: boolean; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      {!mono && (
        <defs>
          <linearGradient id={`rb${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8B7DFF" />
            <stop offset="1" stopColor="#5B49F2" />
          </linearGradient>
        </defs>
      )}
      <rect width="32" height="32" rx="9" fill={mono ? "currentColor" : `url(#rb${id})`} />
      <path d={MARK_STEM} stroke={mono ? "var(--logo-ink, #0B0D12)" : "#fff"} strokeWidth="4.4" strokeLinecap="round" fill="none" />
      <circle {...MARK_DOT} fill={mono ? "var(--logo-ink, #0B0D12)" : "#fff"} />
    </svg>
  );
}

/** İşaret + kelime. Kelime metin olarak kalır (erişilebilirlik ve ön-render için). */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={className ?? "rb-logo"}>
      <LogoMark size={size} />
      <span className="rb-logo-word">{SITE_NAME}</span>
    </span>
  );
}
