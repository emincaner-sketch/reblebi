import type { Locale, PublicConfig } from "../lib/api";
import { LOGO_PNG, SITE_NAME, SITE_URL } from "../config/site";
import type { FaqItem } from "../landing/faq-data";
import { PAGE_PATHS } from "./routes";

/**
 * Yapısal veri (SEO.md §5.6). aggregateRating ve review bilinçli olarak yok: gerçek, doğrulanabilir
 * yorum olmadan eklemek Google yönergelerine aykırı. sameAs: markanın sosyal hesapları netleşince eklenecek.
 */
type Json = Record<string, unknown>;

const ORG_ID = `${SITE_URL}/#org`;
const APP_ID = `${SITE_URL}/#app`;
const abs = (p: string) => (p === "/" ? `${SITE_URL}/` : `${SITE_URL}${p}`);

function organization(): Json {
  return { "@type": "Organization", "@id": ORG_ID, name: SITE_NAME, url: `${SITE_URL}/`, logo: { "@type": "ImageObject", url: `${SITE_URL}${LOGO_PNG}`, width: 512, height: 512 } };
}

function website(locale: Locale): Json {
  return { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: SITE_NAME, url: `${SITE_URL}/`, inLanguage: locale, publisher: { "@id": ORG_ID } };
}

function software(cfg: PublicConfig, locale: Locale, url: string): Json {
  return {
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: SITE_NAME,
    url,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: locale === "tr" ? "Sosyal medya yönetimi" : "Social media management",
    operatingSystem: "Web",
    inLanguage: ["tr", "en"],
    publisher: { "@id": ORG_ID },
    offers: cfg.plans.map((p) => ({
      "@type": "Offer",
      name: p.name[locale],
      price: String(p.priceMonthly),
      priceCurrency: p.currency || "USD",
      url: abs(PAGE_PATHS.pricing[locale]),
      ...(p.priceMonthly > 0 ? { priceSpecification: { "@type": "UnitPriceSpecification", price: p.priceMonthly, priceCurrency: p.currency || "USD", unitCode: "MON", referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" } } } : {}),
    })),
  };
}

function faqPage(items: FaqItem[]): Json {
  return { "@type": "FAQPage", mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
}

function breadcrumbs(trail: Array<{ name: string; path: string }>): Json {
  return { "@type": "BreadcrumbList", itemListElement: trail.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: abs(c.path) })) };
}

const graph = (...nodes: Json[]) => ({ "@context": "https://schema.org", "@graph": nodes });

export function homeJsonLd(cfg: PublicConfig, locale: Locale, faq: FaqItem[]) {
  return graph(organization(), website(locale), software(cfg, locale, abs(PAGE_PATHS.home[locale])), faqPage(faq));
}

export function pricingJsonLd(cfg: PublicConfig, locale: Locale) {
  const home = locale === "tr" ? "Ana sayfa" : "Home";
  return graph(organization(), software(cfg, locale, abs(PAGE_PATHS.home[locale])), breadcrumbs([{ name: home, path: PAGE_PATHS.home[locale] }, { name: locale === "tr" ? "Fiyatlar" : "Pricing", path: PAGE_PATHS.pricing[locale] }]));
}

export function mcpJsonLd(locale: Locale, title: string, description: string) {
  const home = locale === "tr" ? "Ana sayfa" : "Home";
  return graph(
    organization(),
    {
      "@type": "TechArticle",
      headline: title,
      description,
      inLanguage: locale,
      url: abs(PAGE_PATHS.mcp[locale]),
      author: { "@id": ORG_ID },
      publisher: { "@id": ORG_ID },
      about: [{ "@type": "Thing", name: "Model Context Protocol" }, { "@id": APP_ID }],
      proficiencyLevel: "Beginner",
    },
    breadcrumbs([{ name: home, path: PAGE_PATHS.home[locale] }, { name: locale === "tr" ? "AI bağlantı rehberi (MCP)" : "AI connection guide (MCP)", path: PAGE_PATHS.mcp[locale] }]),
  );
}

export function legalJsonLd(locale: Locale, name: string, path: string) {
  const home = locale === "tr" ? "Ana sayfa" : "Home";
  return graph(breadcrumbs([{ name: home, path: PAGE_PATHS.home[locale] }, { name, path }]));
}

/** <script type="application/ld+json"> içine güvenli yazım (</script> kaçışı) */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
