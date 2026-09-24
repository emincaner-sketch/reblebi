/**
 * Planlar ve limitler. Ödeme sağlayıcısı bağlı değilken plan admin panelinden elle atanır.
 * Fiyatları ve limitleri değiştirmek için PLANS_JSON ortam değişkeniyle üzerine yazılabilir.
 */

export interface PlanLimits {
  id: string;
  name: { tr: string; en: string };
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  /** Satış sayfasında gösterilsin mi */
  public: boolean;
  channels: number;
  members: number;
  postsPerMonth: number;
  aiPerMonth: number;
  storageMb: number;
  features: {
    mcp: boolean;
    inbox: boolean;
    aiReplies: boolean;
    approvals: boolean;
    webhooks: boolean;
    customers: boolean;
    previewLinks: boolean;
    analytics: boolean;
    byokAi: boolean;
  };
}

const INF = 1_000_000_000;

const BASE_PLANS: Record<string, PlanLimits> = {
  free: {
    id: "free",
    name: { tr: "Ücretsiz", en: "Free" },
    priceMonthly: 0,
    priceYearly: 0,
    currency: "USD",
    public: true,
    channels: 3,
    members: 1,
    postsPerMonth: 30,
    aiPerMonth: 20,
    storageMb: 500,
    features: { mcp: true, inbox: false, aiReplies: false, approvals: false, webhooks: false, customers: false, previewLinks: false, analytics: true, byokAi: false },
  },
  pro: {
    id: "pro",
    name: { tr: "Pro", en: "Pro" },
    priceMonthly: 19,
    priceYearly: 190,
    currency: "USD",
    public: true,
    channels: 10,
    members: 3,
    postsPerMonth: 1000,
    aiPerMonth: 500,
    storageMb: 5_000,
    features: { mcp: true, inbox: true, aiReplies: true, approvals: true, webhooks: true, customers: false, previewLinks: true, analytics: true, byokAi: true },
  },
  agency: {
    id: "agency",
    name: { tr: "Ajans", en: "Agency" },
    priceMonthly: 59,
    priceYearly: 590,
    currency: "USD",
    public: true,
    channels: 50,
    members: 15,
    postsPerMonth: 10_000,
    aiPerMonth: 3_000,
    storageMb: 50_000,
    features: { mcp: true, inbox: true, aiReplies: true, approvals: true, webhooks: true, customers: true, previewLinks: true, analytics: true, byokAi: true },
  },
  unlimited: {
    id: "unlimited",
    name: { tr: "Sınırsız (iç kullanım)", en: "Unlimited (internal)" },
    priceMonthly: 0,
    priceYearly: 0,
    currency: "USD",
    public: false,
    channels: INF,
    members: INF,
    postsPerMonth: INF,
    aiPerMonth: INF,
    storageMb: INF,
    features: { mcp: true, inbox: true, aiReplies: true, approvals: true, webhooks: true, customers: true, previewLinks: true, analytics: true, byokAi: true },
  },
};

function loadPlans(): Record<string, PlanLimits> {
  const raw = process.env.PLANS_JSON;
  if (!raw) return BASE_PLANS;
  try {
    const override = JSON.parse(raw) as Record<string, Partial<PlanLimits>>;
    const merged: Record<string, PlanLimits> = { ...BASE_PLANS };
    for (const [id, p] of Object.entries(override)) {
      const base = merged[id] ?? BASE_PLANS.free;
      merged[id] = { ...base, ...p, id, features: { ...base.features, ...(p.features ?? {}) } } as PlanLimits;
    }
    return merged;
  } catch {
    return BASE_PLANS;
  }
}

export const PLANS = loadPlans();

export function getPlan(id: string | null | undefined): PlanLimits {
  return PLANS[id ?? "free"] ?? PLANS.free;
}

/** Plan süresi dolduysa ücretsiz plana düşer */
export function effectivePlan(org: { plan: string; planExpiresAt: string | null }): PlanLimits {
  if (org.planExpiresAt && new Date(org.planExpiresAt).getTime() < Date.now()) return PLANS.free;
  return getPlan(org.plan);
}

export function isUnlimited(n: number): boolean {
  return n >= INF;
}

export type UsageMetric = "posts" | "ai";

export function currentPeriod(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export function publicPlans(): PlanLimits[] {
  return Object.values(PLANS).filter((p) => p.public);
}
