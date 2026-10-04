import { useRef, type ReactNode } from "react";
import { useReveal } from "../motion/useReveal";
import { useSite } from "../lib/useSite";
import { SiteNav } from "./navigation/SiteNav";
import { SiteFooter } from "./navigation/SiteFooter";
import { StickyCta } from "./navigation/StickyCta";
import "../site.css";

/** Yeni herkese açık kabuk: ana sayfa, fiyat sayfası ve 404. Panel ve eski PublicShell'den bağımsız (.s-root kapsamı). */
export function SiteShell({ children }: { children: ReactNode }) {
  const { c } = useSite();
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <div ref={root} className="s-root">
      <a className="s-skip" href="#main">
        {c.nav.skip}
      </a>
      <SiteNav />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
      <StickyCta />
    </div>
  );
}
