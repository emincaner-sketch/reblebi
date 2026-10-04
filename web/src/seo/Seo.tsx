import { useEffect } from "react";
import { useI18n } from "../lib/i18n";
import { usePublicConfig } from "../pages/public/AuthPages";
import { PUBLIC_SNAPSHOT } from "../lib/boot";
import { applyHead, notFoundMeta, pageMeta, type HeadMeta } from "./meta";
import { jsonLdString } from "./jsonld";
import type { PageKey } from "./routes";

/**
 * Sayfanın <head> etiketleri ve yapısal verisi.
 * İlk yüklemede etiketler ön-render HTML'inde zaten vardır; bu bileşen sayfa içi gezinmede onları günceller.
 * JSON-LD gövdede durur (Google iki konumu da okur) ve hidrasyonda birebir eşleşir.
 */
export function Seo({ page, jsonLd }: { page: PageKey | "404"; jsonLd?: unknown }) {
  const { locale } = useI18n();
  const cfg = usePublicConfig().data ?? PUBLIC_SNAPSHOT;
  const meta: HeadMeta = page === "404" ? notFoundMeta(locale) : pageMeta(page, locale, cfg);
  const key = `${meta.title}|${meta.description}|${meta.canonical}`;
  useEffect(() => {
    applyHead(meta);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} /> : null;
}
