/**
 * Marka ve alan adı sabitleri. Marka adı yalnızca buradan değiştirilir;
 * landing, SEO etiketleri, JSON-LD, OG görselleri ve sitemap bu dosyayı okur.
 * (Panelde görünen ad sunucudaki APP_NAME değişkeninden gelir; ikisi aynı tutulmalı.)
 */
// Türkçe eklerde ad ünlüyle (i) bitiyor varsayılır: Reblebi'ye, Reblebi'nin. Ad değişirse src/seo/meta.ts eklerini kontrol et.
export const SITE_NAME = "Reblebi";
export const SITE_URL = "https://reblebi.com";
export const SITE_DOMAIN = "reblebi.com";

/** Tarayıcı çubuğu ve PWA rengi (koyu zemin) */
export const THEME_COLOR = "#0B0D12";

export const OG_IMAGE = { tr: "/og/og-home.png", en: "/og/og-en.png", width: 1200, height: 630 } as const;
export const LOGO_PNG = "/logo-512.png";

/** Landing'de öne çıkan, resmî API ile bağlanan platformlar (panelde bağlanabilenlerle aynı) */
export const CORE_PLATFORMS = ["instagram", "facebook", "threads", "whatsapp", "x", "linkedin", "tiktok", "youtube", "telegram"] as const;
