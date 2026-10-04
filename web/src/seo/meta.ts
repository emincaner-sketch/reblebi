import type { Locale, PublicConfig } from "../lib/api";
import { OG_IMAGE, SITE_NAME, SITE_URL, THEME_COLOR } from "../config/site";
import { PAGE_PATHS, type PageKey } from "./routes";

/**
 * Sayfa başına <head> etiketleri (SEO.md §4). Hem ön-render betiği (HTML dizesi) hem tarayıcı
 * (sayfa içi gezinmede document.head güncellemesi) aynı tanımı kullanır.
 */
export interface HeadMeta {
  lang: Locale;
  title: string;
  description: string;
  robots: string;
  canonical: string | null;
  alternates: Array<{ hreflang: string; href: string }>;
  og: { type: string; title: string; description: string; url: string; image: string; locale: string } | null;
  /** Tarayıcı çubuğu rengi; verilmezse index.html'deki koyu renk (THEME_COLOR) */
  themeColor?: string;
  /** Yalnızca ilk yüklemede anlamlı kaynaklar: ön-render HTML'ine yazılır, sayfa içi gezinmede eklenmez */
  preload?: Array<{ href: string; as: "font"; type: string }>;
}

const INDEX = "index, follow, max-image-preview:large";

/** Herkese açık sayfaların hepsi yeni kabukta (src/site/): açık zemin, başlık fontu önceden yüklenir */
const SITE_SHELL: Pick<HeadMeta, "themeColor" | "preload"> = {
  themeColor: "#F6F2EA",
  preload: [{ href: "/fonts/bricolage-latin.woff2", as: "font", type: "font/woff2" }],
};
const NOINDEX = "noindex, nofollow";

const abs = (p: string) => (p === "/" ? `${SITE_URL}/` : `${SITE_URL}${p}`);

function price(cfg: PublicConfig, id: string): string {
  const p = cfg.plans.find((x) => x.id === id);
  return p ? `$${p.priceMonthly}` : "";
}

function copy(key: PageKey, locale: Locale, cfg: PublicConfig): { title: string; description: string; ogTitle?: string; ogDescription?: string } {
  const days = cfg.trialDays;
  const trialPlan = cfg.plans.find((p) => p.id === cfg.trialPlan)?.name[locale] ?? "Pro";
  const tr = locale === "tr";
  switch (key) {
    case "home":
      return tr
        ? {
            title: `Sosyal Medya Yönetim Paneli – AI ile Planla | ${SITE_NAME}`,
            description: `Bir kez yaz; Instagram, TikTok, LinkedIn ve 6 platformda planla. DM'ler tek kutuda, Claude ve ChatGPT bağlantısı.${days > 0 ? ` ${days} gün ücretsiz dene.` : ""}`,
            ogTitle: "Bir kez yaz, dokuz platformda yayında",
            ogDescription: "Planla, yayınla, gelen mesajları tek kutuda yanıtla. AI asistanını MCP ile bağla.",
          }
        : {
            title: `Social Media Management Tool with AI | ${SITE_NAME}`,
            description: `Write once, schedule across Instagram, TikTok, LinkedIn and 6 more. One inbox for DMs, plus Claude or ChatGPT via MCP.${days > 0 ? ` ${days}-day free trial.` : ""}`,
            ogTitle: "Write once. Publish on nine platforms.",
            ogDescription: "Plan, publish and answer messages from one inbox. Connect your AI assistant via MCP.",
          };
    case "pricing":
      return tr
        ? {
            title: `Fiyatlar – Ücretsiz, Pro ve Ajans Planları | ${SITE_NAME}`,
            description: `Ücretsiz planla başla, Pro ${price(cfg, "pro")}/ay, Ajans ${price(cfg, "agency")}/ay.${days > 0 ? ` Her yeni hesap ${days} gün ${trialPlan} ile açılır.` : ""} Kredi kartı gerekmez.`,
          }
        : {
            title: `Pricing – Free, Pro and Agency Plans | ${SITE_NAME}`,
            description: `Start on the free plan. Pro is ${price(cfg, "pro")}/mo, Agency ${price(cfg, "agency")}/mo.${days > 0 ? ` Every new account gets ${days} days of ${trialPlan}.` : ""} No credit card required.`,
          };
    case "mcp":
      return tr
        ? {
            title: `Claude ve ChatGPT ile Sosyal Medya Yönetimi (MCP) | ${SITE_NAME}`,
            description: `AI asistanını ${SITE_NAME}'ye bağla; içerik takvimi kursun, gönderileri planlasın, gelen kutunu özetlesin. Adım adım MCP kurulumu.`,
          }
        : {
            title: `Manage Social Media with Claude & ChatGPT (MCP) | ${SITE_NAME}`,
            description: `Connect your AI assistant to ${SITE_NAME} to build a content calendar, schedule posts and summarize your inbox. Step-by-step MCP setup.`,
          };
    case "privacy":
      return tr
        ? { title: `Gizlilik Politikası | ${SITE_NAME}`, description: `${SITE_NAME}'nin topladığı veriler, kullanım amacı, saklama ve silme koşulları ile güvenlik önlemleri.` }
        : { title: `Privacy Policy | ${SITE_NAME}`, description: `What data ${SITE_NAME} collects, how it is used, how long it is kept and how it is protected.` };
    case "terms":
      return tr
        ? { title: `Kullanım Koşulları | ${SITE_NAME}`, description: `${SITE_NAME} hizmetinin kullanım koşulları: hesabın, kabul edilebilir kullanım, planlar ve sorumluluk.` }
        : { title: `Terms of Service | ${SITE_NAME}`, description: `The terms for using ${SITE_NAME}: your account, acceptable use, plans and liability.` };
    case "deletion":
      return tr
        ? { title: `Veri Silme Talebi | ${SITE_NAME}`, description: "Hesabını ve bağlı sosyal medya hesaplarının verilerini nasıl sileceğini öğren, silme talebinin durumunu gör." }
        : { title: `Data Deletion Request | ${SITE_NAME}`, description: "How to delete your account and the data of your connected social accounts, and check the status of a request." };
  }
}

export function pageMeta(key: PageKey, locale: Locale, cfg: PublicConfig): HeadMeta {
  const c = copy(key, locale, cfg);
  const url = abs(PAGE_PATHS[key][locale]);
  return {
    lang: locale,
    title: c.title,
    description: c.description,
    robots: INDEX,
    canonical: url,
    alternates: [
      { hreflang: "tr", href: abs(PAGE_PATHS[key].tr) },
      { hreflang: "en", href: abs(PAGE_PATHS[key].en) },
      { hreflang: "x-default", href: abs(PAGE_PATHS[key].tr) },
    ],
    og: {
      type: key === "mcp" ? "article" : "website",
      title: c.ogTitle ?? c.title,
      description: c.ogDescription ?? c.description,
      url,
      image: `${SITE_URL}${OG_IMAGE[locale]}`,
      locale: locale === "tr" ? "tr_TR" : "en_US",
    },
    ...SITE_SHELL,
  };
}

export function notFoundMeta(locale: Locale): HeadMeta {
  return {
    lang: locale,
    title: locale === "tr" ? `Sayfa bulunamadı | ${SITE_NAME}` : `Page not found | ${SITE_NAME}`,
    description: locale === "tr" ? "Aradığın sayfa taşınmış ya da hiç var olmamış olabilir." : "The page you are looking for may have moved or never existed.",
    robots: NOINDEX,
    canonical: null,
    alternates: [],
    og: null,
    ...SITE_SHELL,
  };
}

/** Panel, giriş/kayıt ve önizleme gibi dizine eklenmeyecek sayfalar */
export function privateMeta(locale: Locale): HeadMeta {
  return { lang: locale, title: SITE_NAME, description: "", robots: NOINDEX, canonical: null, alternates: [], og: null };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Ön-render için HTML dizesi */
export function headHtml(m: HeadMeta): string {
  const out = [`<title>${esc(m.title)}</title>`];
  if (m.themeColor) out.push(`<meta name="theme-color" content="${m.themeColor}" />`);
  for (const p of m.preload ?? []) out.push(`<link rel="preload" href="${p.href}" as="${p.as}" type="${p.type}" crossorigin />`);
  if (m.description) out.push(`<meta name="description" content="${esc(m.description)}" />`);
  out.push(`<meta name="robots" content="${m.robots}" />`);
  if (m.canonical) out.push(`<link rel="canonical" href="${m.canonical}" />`);
  for (const a of m.alternates) out.push(`<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`);
  if (m.og) {
    out.push(
      `<meta property="og:type" content="${m.og.type}" />`,
      `<meta property="og:site_name" content="${SITE_NAME}" />`,
      `<meta property="og:locale" content="${m.og.locale}" />`,
      `<meta property="og:locale:alternate" content="${m.og.locale === "tr_TR" ? "en_US" : "tr_TR"}" />`,
      `<meta property="og:url" content="${m.og.url}" />`,
      `<meta property="og:title" content="${esc(m.og.title)}" />`,
      `<meta property="og:description" content="${esc(m.og.description)}" />`,
      `<meta property="og:image" content="${m.og.image}" />`,
      `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
      `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
      `<meta property="og:image:alt" content="${esc(m.og.title)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${esc(m.og.title)}" />`,
      `<meta name="twitter:description" content="${esc(m.og.description)}" />`,
      `<meta name="twitter:image" content="${m.og.image}" />`,
    );
  }
  return out.map((l) => `    ${l}`).join("\n");
}

/** Sayfa içi gezinmede <head>'i günceller. Ön-render'ın yazdığı etiketlerin yerine geçer (data-seo ile işaretli). */
export function applyHead(m: HeadMeta): void {
  if (typeof document === "undefined") return;
  document.title = m.title;
  document.documentElement.lang = m.lang;
  const head = document.head;
  head.querySelectorAll('[data-seo], meta[name="description"], meta[name="robots"], link[rel="canonical"], link[rel="alternate"][hreflang], meta[property^="og:"], meta[name^="twitter:"]').forEach((el) => el.remove());
  const tpl = document.createElement("template");
  tpl.innerHTML = headHtml(m).replace(/<title>.*?<\/title>/, "");
  tpl.content.querySelectorAll("meta, link").forEach((el) => {
    // theme-color aşağıda yerinde güncellenir; önyükleme yalnızca ilk yüklemede anlamlı
    if (el.matches('meta[name="theme-color"], link[rel="preload"]')) return;
    el.setAttribute("data-seo", "");
    head.appendChild(el);
  });
  // Tarayıcı ilk theme-color etiketini kullanır: hepsini aynı renge çek (yeni kabuk açık, diğer sayfalar koyu)
  head.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.setAttribute("content", m.themeColor ?? THEME_COLOR));
}

