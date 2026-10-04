import type { Locale, PlanFeature, PlanInfo, PublicConfig } from "../../lib/api";
import type { FinderRole, PricingContent } from "../types/content";
import { fill } from "./fill";

/** Sunucudaki "sınırsız" eşiği (server/src/core/plans.ts) */
const UNLIMITED = 1_000_000_000;

export function intlOf(locale: Locale): string {
  return locale === "en" ? "en-GB" : "tr-TR";
}

/** "Pro ve Ajans" / "Pro and Agency" */
export function joinNames(names: string[], locale: Locale): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${locale === "en" ? "and" : "ve"} ${names[names.length - 1]}`;
}

export function plansWith(cfg: PublicConfig, feature: PlanFeature): PlanInfo[] {
  return cfg.plans.filter((p) => p.features[feature]);
}

/** Özellik hangi planlarda: tümündeyse null (etiket "Tüm planlarda" olur) */
export function featurePlanNames(cfg: PublicConfig, feature: PlanFeature, locale: Locale): string | null {
  const with_ = plansWith(cfg, feature);
  if (!with_.length || with_.length === cfg.plans.length) return null;
  return joinNames(
    with_.map((p) => p.name[locale]),
    locale,
  );
}

export function trialPlanName(cfg: PublicConfig, locale: Locale): string {
  return cfg.plans.find((p) => p.id === cfg.trialPlan)?.name[locale] ?? cfg.trialPlan;
}

export function hasFreePlan(cfg: PublicConfig): boolean {
  return cfg.plans.some((p) => p.priceMonthly === 0);
}

export function formatLimit(n: number, locale: Locale, unlimited: string): string {
  return n >= UNLIMITED ? unlimited : n.toLocaleString(intlOf(locale));
}

export function limitRows(p: PlanInfo, c: PricingContent, locale: Locale): string[] {
  const f = (n: number) => formatLimit(n, locale, c.limits.unlimited);
  return [
    fill(c.limits.channels, { n: f(p.channels) }),
    fill(c.limits.members, { n: f(p.members) }),
    fill(c.limits.posts, { n: f(p.postsPerMonth) }),
    fill(c.limits.ai, { n: f(p.aiPerMonth) }),
    fill(c.limits.storage, { n: f(p.storageMb) }),
  ];
}

/** Yıllık fiyat tam 10 ay ise "2 ay bedava", değilse en yüksek tasarruf yüzdesi */
export function yearlyBadge(plans: PlanInfo[], c: PricingContent): string | null {
  const paid = plans.filter((p) => p.priceMonthly > 0 && p.priceYearly > 0);
  if (!paid.length) return null;
  if (paid.every((p) => p.priceYearly === p.priceMonthly * 10)) return c.billing.twoMonths;
  const best = Math.max(...paid.map((p) => Math.round((1 - p.priceYearly / (p.priceMonthly * 12)) * 100)));
  return best > 0 ? fill(c.billing.save, { n: best }) : null;
}

/** Kartta öne çıkan plan: deneme planı, yoksa "pro" */
export function highlightedPlanId(cfg: PublicConfig): string | undefined {
  if (cfg.plans.some((p) => p.id === cfg.trialPlan)) return cfg.trialPlan;
  return cfg.plans.find((p) => p.id === "pro")?.id;
}

/* ---------------- Plan bulucu ---------------- */

export interface FinderInput {
  role: FinderRole;
  channels: number;
  members: number;
}

export type FinderReason =
  | { kind: "channels" | "members"; plan: PlanInfo; n: number }
  | { kind: "inbox" | "customers"; plan: PlanInfo }
  | { kind: "fits"; plan: PlanInfo }
  | { kind: "over"; plan: PlanInfo };

export interface FinderResult {
  plan: PlanInfo;
  reasons: FinderReason[];
}

/**
 * Yalnızca gerçek limitlerden öneri: ihtiyacı karşılayan en ucuz plan.
 * E-ticaret DM'leri tek kutuda toplamak ister (inbox), ajans müşteri modunu ister (customers):
 * bu eşleşme eski "Kimler için" bölümünün metniyle aynıdır.
 */
export function recommendPlan(plans: PlanInfo[], input: FinderInput): FinderResult | null {
  if (!plans.length) return null;
  const sorted = [...plans].sort((a, b) => a.priceMonthly - b.priceMonthly);
  const needInbox = input.role === "ecommerce";
  const needCustomers = input.role === "agency";
  const reasons: FinderReason[] = [];
  for (const p of sorted) {
    const miss: FinderReason[] = [];
    if (p.channels < input.channels) miss.push({ kind: "channels", plan: p, n: p.channels });
    if (p.members < input.members) miss.push({ kind: "members", plan: p, n: p.members });
    if (needInbox && !p.features.inbox) miss.push({ kind: "inbox", plan: p });
    if (needCustomers && !p.features.customers) miss.push({ kind: "customers", plan: p });
    if (!miss.length) return { plan: p, reasons: [...reasons, { kind: "fits", plan: p }] };
    // Bir alt planın neden elendiğini yalnızca ilk eksikle anlat (kısa kalsın)
    reasons.push(miss[0]);
  }
  const top = sorted[sorted.length - 1];
  return { plan: top, reasons: [{ kind: "over", plan: top }] };
}
