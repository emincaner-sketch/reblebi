import { siFacebook, siInstagram, siTelegram, siThreads, siTiktok, siWhatsapp, siX, siYoutube } from "simple-icons";
import type { CSSProperties } from "react";

/**
 * Gerçek marka simgeleri (Simple Icons, CC0). LinkedIn paketten kaldırıldığı için yolu burada.
 * Siyah logolu markalar koyu zeminde beyaz gösterilir.
 */
interface Icon {
  title: string;
  hex: string;
  path: string;
}

const LINKEDIN: Icon = {
  title: "LinkedIn",
  hex: "0A66C2",
  path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
};

export const PLATFORM_ICONS = {
  instagram: siInstagram,
  facebook: siFacebook,
  threads: siThreads,
  whatsapp: siWhatsapp,
  x: siX,
  linkedin: LINKEDIN,
  tiktok: siTiktok,
  youtube: siYoutube,
  telegram: siTelegram,
} satisfies Record<string, Icon>;

export type PlatformKey = keyof typeof PLATFORM_ICONS;

/** Koyu zeminde okunur marka rengi */
export function brandColor(p: PlatformKey): string {
  const hex = PLATFORM_ICONS[p].hex;
  return hex === "000000" ? "#FFFFFF" : `#${hex}`;
}

export function platformName(p: PlatformKey): string {
  return p === "x" ? "X (Twitter)" : PLATFORM_ICONS[p].title;
}

export function PlatformIcon({ p, size = 20, label, style }: { p: PlatformKey; size?: number; label?: boolean; style?: CSSProperties }) {
  const icon = PLATFORM_ICONS[p];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} focusable="false" {...(label ? { role: "img", "aria-label": platformName(p) } : { "aria-hidden": true })}>
      {label && <title>{platformName(p)}</title>}
      <path d={icon.path} />
    </svg>
  );
}
