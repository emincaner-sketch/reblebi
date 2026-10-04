import type { ReactNode } from "react";
import { SiteShell } from "../site/components/SiteShell";
import "./landing.css";

/**
 * MCP rehberi, Gizlilik, Koşullar ve Veri silme sayfalarının kabuğu (src/pages/public/PublicPages.tsx).
 * Ana sayfayla aynı menü, footer ve açık tema; sayfa içeriği .lp kapsamında kalır (landing.css).
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <SiteShell>
      <div className="lp">{children}</div>
    </SiteShell>
  );
}
