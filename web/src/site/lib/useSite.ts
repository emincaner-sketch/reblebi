import { useLocation } from "react-router-dom";
import { useI18n } from "../../lib/i18n";
import { useMeQuery } from "../../lib/session";
import { usePublicConfig } from "../../pages/public/AuthPages";
import { PUBLIC_SNAPSHOT } from "../../lib/boot";
import { SITE_NAME } from "../../config/site";
import { matchPublicRoute, pathFor, type PageKey } from "../../seo/routes";
import { SITE_CONTENT } from "../data/site-content";
import type { SectionId } from "../types/content";
import { fill } from "./fill";
import { hasFreePlan } from "./plans";

/** Geçerli dilin içeriği ve canlı genel yapılandırma (ön-render'da derleme anındaki anlık görüntü) */
export function useSite() {
  const { locale, setLocale } = useI18n();
  const cfg = usePublicConfig().data ?? PUBLIC_SNAPSHOT;
  return { c: SITE_CONTENT[locale], locale, setLocale, cfg, app: SITE_NAME };
}

/** Sayfa ve bölüm adresleri: ana sayfada çapa, diğer sayfalarda ana sayfanın çapası */
export function useLinks() {
  const { locale } = useI18n();
  const { pathname } = useLocation();
  const onHome = matchPublicRoute(pathname)?.key === "home";
  return {
    onHome,
    page: (key: PageKey, hash?: string) => pathFor(key, locale) + (hash ? `#${hash}` : ""),
    section: (id: SectionId) => (onHome ? `#${id}` : `${pathFor("home", locale)}#${id}`),
  };
}

export interface PrimaryCta {
  to: string;
  label: string;
  /** Kayıt CTA'sının altındaki kısa not; giriş/panel için yok */
  note: string | null;
}

/** Hero, bölüm sonları ve yapışkan alt çubuk aynı işe çıkar */
export function usePrimaryCta(): PrimaryCta {
  const { c, cfg } = useSite();
  const me = useMeQuery();
  if (me.data?.user) return { to: "/app", label: c.cta.panel, note: null };
  if (cfg.signupMode === "open") {
    return {
      to: "/signup",
      label: cfg.trialDays > 0 ? fill(c.cta.trial, { days: cfg.trialDays }) : c.cta.start,
      note: hasFreePlan(cfg) ? c.cta.note : c.cta.noteNoFree,
    };
  }
  return { to: "/login", label: c.cta.login, note: null };
}
