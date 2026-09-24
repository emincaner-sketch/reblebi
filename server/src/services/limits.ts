import { AppError } from "../core/i18n.js";
import { currentPeriod, effectivePlan, isUnlimited, type PlanLimits } from "../core/plans.js";
import { channelsRepo } from "../core/repos/channels.js";
import { mediaRepo, usageRepo } from "../core/repos/misc.js";
import { membershipsRepo, orgsRepo } from "../core/repos/orgs.js";

export function orgPlan(orgId: string): PlanLimits {
  const org = orgsRepo.get(orgId);
  return org ? effectivePlan(org) : effectivePlan({ plan: "free", planExpiresAt: null });
}

export type Feature = keyof PlanLimits["features"];

export function hasFeature(orgId: string, feature: Feature): boolean {
  return orgPlan(orgId).features[feature];
}

export function assertFeature(orgId: string, feature: Feature): void {
  if (!hasFeature(orgId, feature)) throw new AppError(402, "limit.feature", { feature });
}

export function assertChannelQuota(orgId: string, adding = 1): void {
  const plan = orgPlan(orgId);
  if (isUnlimited(plan.channels)) return;
  if (channelsRepo.count(orgId) + adding > plan.channels) throw new AppError(402, "limit.channels", { limit: plan.channels });
}

export function assertMemberQuota(orgId: string, adding = 1): void {
  const plan = orgPlan(orgId);
  if (isUnlimited(plan.members)) return;
  if (membershipsRepo.count(orgId) + adding > plan.members) throw new AppError(402, "limit.members", { limit: plan.members });
}

export function assertStorage(orgId: string, addingBytes: number): void {
  const plan = orgPlan(orgId);
  if (isUnlimited(plan.storageMb)) return;
  if (mediaRepo.totalBytes(orgId) + addingBytes > plan.storageMb * 1024 * 1024) throw new AppError(402, "limit.storage", { limit: plan.storageMb });
}

/** Gönderi kotası: zamanlanan/onaya giden her gönderi hedef sayısı kadar değil, gönderi başına 1 sayılır */
export function assertPostQuota(orgId: string, count = 1): void {
  const plan = orgPlan(orgId);
  if (isUnlimited(plan.postsPerMonth)) return;
  const used = usageRepo.get(orgId, currentPeriod(), "posts");
  if (used + count > plan.postsPerMonth) throw new AppError(402, "limit.posts", { limit: plan.postsPerMonth });
}

export function consumePostQuota(orgId: string, count = 1): void {
  assertPostQuota(orgId, count);
  usageRepo.increment(orgId, currentPeriod(), "posts", count);
}

/** AI kotası sadece platformun AI anahtarı kullanılıyorsa düşer (kendi anahtarını getirenler sınırsız) */
export function consumeAiQuota(orgId: string, usingPlatformKey: boolean): void {
  if (!usingPlatformKey) return;
  const plan = orgPlan(orgId);
  if (isUnlimited(plan.aiPerMonth)) {
    usageRepo.increment(orgId, currentPeriod(), "ai", 1);
    return;
  }
  const used = usageRepo.get(orgId, currentPeriod(), "ai");
  if (used + 1 > plan.aiPerMonth) throw new AppError(402, "limit.ai", { limit: plan.aiPerMonth });
  usageRepo.increment(orgId, currentPeriod(), "ai", 1);
}

export function usageSummary(orgId: string) {
  const plan = orgPlan(orgId);
  const org = orgsRepo.get(orgId);
  const usage = usageRepo.forOrg(orgId, currentPeriod());
  const cap = (n: number) => (isUnlimited(n) ? null : n);
  return {
    plan: { id: plan.id, name: plan.name, features: plan.features, priceMonthly: plan.priceMonthly, currency: plan.currency },
    assignedPlan: org?.plan ?? "free",
    planExpiresAt: org?.planExpiresAt ?? null,
    expired: Boolean(org?.planExpiresAt && new Date(org.planExpiresAt).getTime() < Date.now()),
    period: currentPeriod(),
    channels: { used: channelsRepo.count(orgId), limit: cap(plan.channels) },
    members: { used: membershipsRepo.count(orgId), limit: cap(plan.members) },
    posts: { used: usage.posts ?? 0, limit: cap(plan.postsPerMonth) },
    ai: { used: usage.ai ?? 0, limit: cap(plan.aiPerMonth) },
    storageMb: { used: Math.round((mediaRepo.totalBytes(orgId) / 1024 / 1024) * 10) / 10, limit: cap(plan.storageMb) },
  };
}
