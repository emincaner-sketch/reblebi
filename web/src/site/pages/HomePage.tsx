import { useI18n } from "../../lib/i18n";
import { Seo } from "../../seo/Seo";
import { homeJsonLd } from "../../seo/jsonld";
import { homeFaq } from "../../landing/faq-data";
import { useSite } from "../lib/useSite";
import { SiteShell } from "../components/SiteShell";
import { Hero } from "../components/sections/Hero";
import { Journey } from "../components/sections/Journey";
import { AiAssistant } from "../components/sections/AiAssistant";
import { Capabilities } from "../components/sections/Capabilities";
import { Trust } from "../components/sections/Trust";
import { Pricing } from "../components/sections/Pricing";
import { Faq } from "../components/sections/Faq";
import { FinalCta } from "../components/sections/FinalCta";

/**
 * Ana sayfa (/ ve /en). Yalnızca bölüm sırasını kurar; hareket bileşenlerin içinde.
 * Elenen bölümler (ekip/mekân, sosyal, yorumlar, lead formu): BRAND_DECISIONS.md §13.
 */
export default function HomePage() {
  const { t } = useI18n();
  const { c, cfg, locale } = useSite();
  // SSS metni JSON-LD ile aynı diziden: sayfadaki soru ve cevaplar yapısal veriyle birebir
  const faq = homeFaq(t, cfg, locale);
  return (
    <SiteShell>
      <Seo page="home" jsonLd={homeJsonLd(cfg, locale, faq)} />
      <Hero />
      <Journey />
      <AiAssistant />
      <Capabilities />
      <Trust />
      <Pricing />
      <Faq items={faq} eyebrow={c.faq.eyebrow} title={c.faq.title} />
      <FinalCta />
    </SiteShell>
  );
}
