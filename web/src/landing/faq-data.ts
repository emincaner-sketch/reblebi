import type { Locale, PlanFeature, PlanInfo, PublicConfig } from "../lib/api";
import { SITE_NAME } from "../config/site";

/**
 * SSS metinleri tek yerden üretilir: sayfadaki akordeon ve JSON-LD FAQPage birebir aynı metni kullanır.
 * Her cevap koddaki gerçek davranışa dayanır (plans.ts, providers, gizlilik metni). Plan adları ve sayılar veriden gelir.
 */
export interface FaqItem {
  q: string;
  a: string;
}

type T = (s: string, vars?: Record<string, string | number>) => string;

function names(plans: PlanInfo[], locale: Locale): string {
  const n = plans.map((p) => p.name[locale]);
  if (n.length <= 1) return n.join("");
  return `${n.slice(0, -1).join(", ")} ${locale === "en" ? "and" : "ve"} ${n[n.length - 1]}`;
}

function withFeature(cfg: PublicConfig, f: PlanFeature) {
  return cfg.plans.filter((p) => p.features[f]);
}

function trialItem(t: T, cfg: PublicConfig, locale: Locale): FaqItem | null {
  if (cfg.trialDays <= 0) return null;
  const plan = cfg.plans.find((p) => p.id === cfg.trialPlan)?.name[locale] ?? cfg.trialPlan;
  return {
    q: t("Deneme süresi bitince ne olur?"),
    a: t("Her yeni hesap {days} gün {plan} planıyla açılır. Süre dolduğunda çalışma alanın Ücretsiz plan limitlerine geçer. Verilerin, kanalların ve gönderilerin silinmez; istediğin zaman ücretli plana geçebilirsin.", { days: cfg.trialDays, plan }),
  };
}

function cardItem(t: T): FaqItem {
  return {
    q: t("Kredi kartı gerekiyor mu?"),
    a: t("Hayır. Kayıt olmak ve denemeyi kullanmak için kart bilgisi istemiyoruz. Ücretli plana geçmek istediğinde panelin Plan & kullanım sayfasından talep gönderirsin."),
  };
}

function byokItem(t: T, cfg: PublicConfig, locale: Locale): FaqItem | null {
  const plans = withFeature(cfg, "byokAi");
  if (!plans.length) return null;
  return {
    q: t("Kendi AI anahtarımı kullanabilir miyim?"),
    a: t("Evet, {plans} planlarında. Ayarlar > AI bölümüne Anthropic, OpenAI, xAI, Gemini, OpenRouter ya da OpenAI uyumlu bir uç noktanın anahtarını eklersin. Kendi anahtarınla yaptığın üretimler aylık AI kotandan düşmez.", { plans: names(plans, locale) }),
  };
}

export function homeFaq(t: T, cfg: PublicConfig, locale: Locale): FaqItem[] {
  const mcpEverywhere = cfg.plans.length > 0 && cfg.plans.every((p) => p.features.mcp);
  const agency = cfg.plans.find((p) => p.features.customers);
  const items: Array<FaqItem | null> = [
    {
      q: t("Hangi platformları destekliyorsunuz?"),
      a: t("Instagram, Facebook, Threads, WhatsApp, X (Twitter), LinkedIn, TikTok, YouTube ve Telegram. Hepsi platformların resmî API'leri üzerinden bağlanır. Gönderi, hikaye, reel, video ve zincir türleri, platformun izin verdiği ölçüde desteklenir."),
    },
    {
      q: t("Şifremi vermem gerekiyor mu?"),
      a: t("Hayır. Instagram, Facebook, Threads, X, LinkedIn, TikTok ve YouTube hesaplarını platformun kendi giriş ve izin ekranından (OAuth) bağlarsın. Telegram için bot token'ı, WhatsApp için Business API bilgileri girilir. Hesap şifreni hiçbir zaman istemeyiz; erişim token'ları AES-256-GCM ile şifrelenerek saklanır."),
    },
    trialItem(t, cfg, locale),
    cardItem(t),
    {
      q: t("Verilerim nerede ve nasıl saklanıyor?"),
      a: t("Hesap bilgilerin, bağlı kanalların ve içeriklerin {app} sunucularında tutulur. Erişim token'ları AES-256-GCM ile şifrelenir, tüm bağlantılar HTTPS üzerinden yapılır. Verilerini satmayız ve reklam için kullanmayız. Bir kanalı kaldırdığında ona ait token ve konuşmalar silinir.", { app: SITE_NAME }),
    },
    {
      q: t("MCP nedir, hangi AI asistanlarıyla çalışır?"),
      a:
        t("MCP (Model Context Protocol), AI asistanlarının dış uygulamalara güvenli biçimde bağlanmasını sağlayan açık bir standarttır. {app} hesabını Claude, ChatGPT, Gemini, Grok veya Cursor'a bağladığında asistanın içerik takvimi kurabilir, gönderileri boş saatlere planlayabilir ve gelen kutunu özetleyebilir. Asistan yalnızca rolünün izin verdiği işlemleri yapar.", { app: SITE_NAME }) +
        (mcpEverywhere ? " " + t("MCP bağlantısı Ücretsiz plan dahil tüm planlarda var.") : ""),
    },
    agency
      ? {
          q: t("Ajans modu nasıl çalışır?"),
          a: t("{plan} planında kanallarını müşterilerine göre gruplarsın. Ekip üyelerine yönetici, editör ya da izleyici rolü verirsin ve gönderiler onay akışından geçer. Müşterine giriş gerektirmeyen bir önizleme linki gönderip yorumlarını aynı ekranda toplarsın. Plan {channels} kanal ve {members} ekip üyesi içerir.", {
            plan: agency.name[locale],
            channels: agency.channels.toLocaleString(locale === "en" ? "en-GB" : "tr-TR"),
            members: agency.members,
          }),
        }
      : null,
    byokItem(t, cfg, locale),
  ];
  return items.filter((x): x is FaqItem => Boolean(x));
}

export function pricingFaq(t: T, cfg: PublicConfig, locale: Locale): FaqItem[] {
  const yearly = cfg.plans.filter((p) => p.priceYearly > 0);
  const items: Array<FaqItem | null> = [
    trialItem(t, cfg, locale),
    cardItem(t),
    yearly.length
      ? {
          q: t("Yıllık ödemede indirim var mı?"),
          a: t("Evet. Yıllık ödemede {list}. Yıllık fiyat, aylık fiyatın 10 katıdır; yani yılda 2 ay ücretsiz kullanırsın.", {
            list: yearly.map((p) => `${p.name[locale]} $${p.priceYearly}/${t("yıl")}`).join(", "),
          }),
        }
      : null,
    {
      q: t("Planımı sonradan değiştirebilir miyim?"),
      a: t("Evet. Panelin Plan & kullanım sayfasından plan değişikliği talebi gönderirsin. Ücretli planın süresi dolduğunda çalışma alanın Ücretsiz plan limitlerine döner; verilerin silinmez."),
    },
    byokItem(t, cfg, locale),
  ];
  // Yıllık = 10 x aylık değilse "2 ay" cümlesi doğru olmaz: o zaman soruyu yalnızca fiyatlarla bırak
  if (yearly.some((p) => p.priceYearly !== p.priceMonthly * 10) && items[2]) {
    items[2] = { q: items[2].q, a: t("Evet. Yıllık ödemede {list}.", { list: yearly.map((p) => `${p.name[locale]} $${p.priceYearly}/${t("yıl")}`).join(", ") }) };
  }
  return items.filter((x): x is FaqItem => Boolean(x));
}
