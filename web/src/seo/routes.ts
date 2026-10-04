import type { Locale } from "../lib/api";

/**
 * Herkese açık, ön-render edilen sayfalar. Türkçe kök yolda, İngilizce /en altında.
 * Bu tablo dil seçimini (URL'den), hreflang/canonical etiketlerini, sitemap'i ve
 * sunucunun hangi yolları statik HTML olarak vereceğini belirler.
 */
export type PageKey = "home" | "pricing" | "mcp" | "privacy" | "terms" | "deletion";

export const PAGE_PATHS: Record<PageKey, Record<Locale, string>> = {
  home: { tr: "/", en: "/en" },
  pricing: { tr: "/fiyatlar", en: "/en/pricing" },
  mcp: { tr: "/docs/mcp", en: "/en/docs/mcp" },
  privacy: { tr: "/privacy", en: "/en/privacy" },
  terms: { tr: "/terms", en: "/en/terms" },
  deletion: { tr: "/data-deletion", en: "/en/data-deletion" },
};

export interface PublicRoute {
  key: PageKey;
  locale: Locale;
  path: string;
}

export const PUBLIC_ROUTES: PublicRoute[] = (Object.keys(PAGE_PATHS) as PageKey[]).flatMap((key) =>
  (["tr", "en"] as Locale[]).map((locale) => ({ key, locale, path: PAGE_PATHS[key][locale] })),
);

/** Sitemap önceliği */
export const PAGE_PRIORITY: Record<PageKey, string> = { home: "1.0", pricing: "0.9", mcp: "0.8", privacy: "0.3", terms: "0.3", deletion: "0.2" };

function normalize(pathname: string): string {
  const p = pathname.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

export function matchPublicRoute(pathname: string): PublicRoute | null {
  const p = normalize(pathname);
  return PUBLIC_ROUTES.find((r) => r.path === p) ?? null;
}

/** Panel ve hesap ekranları: dil kullanıcının tercihinden gelir (sunucudaki SPA_PATHS ile aynı kökler) */
const APP_PREFIXES = ["/app", "/login", "/signup", "/forgot", "/reset-password", "/verify", "/invite", "/consent", "/preview", "/pricing", "/kanallar", "/gonderiler", "/gelen-kutusu", "/otomasyon", "/analitik", "/ayarlar", "/l/"];

/** Herkese açık içerik sayfalarında dil URL'den gelir; panel yollarında null (kullanıcı tercihi geçerli) */
export function localeFromPath(pathname: string): Locale | null {
  const r = matchPublicRoute(pathname);
  if (r) return r.locale;
  // /en altındaki bilinmeyen adresler (404) de İngilizce; panel yolları /en altında değil
  if (pathname === "/en" || pathname.startsWith("/en/")) return "en";
  if (APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`))) return null;
  // Diğer bilinmeyen adresler sunucuda Türkçe 404 (dist/404.html) olarak çizilir: istemci de Türkçe kalmalı
  return "tr";
}

export function pathFor(key: PageKey, locale: Locale): string {
  return PAGE_PATHS[key][locale];
}

/** Aynı sayfanın diğer dildeki karşılığı; içerik sayfası değilse dilin ana sayfası */
export function alternatePath(pathname: string, locale: Locale): string {
  const r = matchPublicRoute(pathname);
  return r ? PAGE_PATHS[r.key][locale] : PAGE_PATHS.home[locale];
}
