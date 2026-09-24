import { channelsRepo } from "../core/repos/channels.js";
import { campaignsRepo } from "../core/repos/content.js";
import { inboxRepo } from "../core/repos/inbox.js";
import { activityRepo, analyticsRepo, postMetricsRepo } from "../core/repos/misc.js";
import { postsRepo } from "../core/repos/posts.js";
import { resolveAiConfig } from "../ai/providers.js";
import { getProvider } from "../providers/index.js";
import { usageSummary } from "./limits.js";

export function dashboard(orgId: string) {
  const channels = channelsRepo.list(orgId);
  const until = new Date(Date.now() + 48 * 3600_000).toISOString();
  return {
    channels: { total: channels.length, active: channels.filter((c) => c.status === "active").length, problem: channels.filter((c) => c.status === "error" || c.status === "expired").length },
    posts: postsRepo.stats(orgId),
    inbox: inboxRepo.stats(orgId),
    upcoming: postsRepo.list(orgId, { status: ["scheduled", "pending_approval"], from: new Date().toISOString(), to: until, limit: 12, order: "asc" }),
    pendingApproval: postsRepo.list(orgId, { status: ["pending_approval"], limit: 5, order: "asc" }),
    recent: postsRepo.list(orgId, { status: ["published", "partial", "failed"], limit: 6 }),
    campaigns: campaignsRepo.list(orgId).filter((c) => c.status === "active").slice(0, 5),
    activity: activityRepo.list(orgId, 12),
    ai: Boolean(resolveAiConfig(orgId)),
    usage: usageSummary(orgId),
  };
}

export function analyticsOverview(orgId: string, days: number) {
  const from = new Date(Date.now() - days * 86400_000).toISOString();
  const channels = channelsRepo.list(orgId);
  const outcomes = postsRepo.targetOutcomes(orgId, from);
  const published = postsRepo.publishedTargets(orgId, from, 300);
  const metrics = postMetricsRepo.getMany(published.map((t) => t.id));

  const perChannel = channels.map((c) => {
    const series = analyticsRepo.series(c.id, days);
    const latest = series[series.length - 1]?.metrics ?? {};
    const first = series[0]?.metrics ?? {};
    const o = outcomes.filter((x) => x.channelId === c.id);
    const eng = published
      .filter((t) => t.channelId === c.id)
      .reduce(
        (acc, t) => {
          const m = metrics.get(t.id)?.metrics ?? {};
          acc.likes += m.likes ?? 0;
          acc.comments += m.comments ?? 0;
          acc.shares += m.shares ?? 0;
          acc.views += m.views ?? m.reach ?? 0;
          return acc;
        },
        { likes: 0, comments: 0, shares: 0, views: 0 },
      );
    return {
      channelId: c.id,
      name: c.name,
      provider: c.provider,
      avatarUrl: c.avatarUrl,
      latest,
      followersDelta: (latest.followers ?? 0) - (first.followers ?? 0),
      series: series.map((s) => ({ date: s.date, ...s.metrics })),
      published: o.filter((x) => x.status === "published").reduce((a, x) => a + x.n, 0),
      failed: o.filter((x) => x.status === "failed").reduce((a, x) => a + x.n, 0),
      engagement: eng,
      supported: Boolean(getProvider(c.provider).fetchMetrics),
    };
  });

  const top = published
    .map((t) => {
      const m = metrics.get(t.id)?.metrics ?? {};
      return { t, m, score: (m.likes ?? 0) + 2 * (m.comments ?? 0) + 3 * (m.shares ?? 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ t, m }) => {
      const ch = channels.find((c) => c.id === t.channelId);
      return {
        targetId: t.id,
        postId: t.postId,
        channelId: t.channelId,
        channel: ch?.name ?? "?",
        provider: ch?.provider ?? null,
        url: t.externalUrl,
        kind: t.kind,
        preview: t.content.slice(0, 140),
        publishedAt: t.publishedAt,
        metrics: m,
      };
    });

  // Hangi gün ve saatte paylaşılanlar daha çok etkileşim aldı (AI planlaması için ipucu)
  const byHour = new Map<number, { n: number; score: number }>();
  for (const t of published) {
    if (!t.publishedAt) continue;
    const h = new Date(t.publishedAt).getUTCHours();
    const m = metrics.get(t.id)?.metrics ?? {};
    const cur = byHour.get(h) ?? { n: 0, score: 0 };
    cur.n++;
    cur.score += (m.likes ?? 0) + 2 * (m.comments ?? 0) + 3 * (m.shares ?? 0);
    byHour.set(h, cur);
  }
  const bestHoursUtc = [...byHour.entries()]
    .filter(([, v]) => v.n >= 2)
    .map(([h, v]) => ({ hourUtc: h, avgScore: Math.round((v.score / v.n) * 10) / 10, posts: v.n }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 5);

  return { days, channels: perChannel, top, bestHoursUtc, posts: postsRepo.stats(orgId), inbox: inboxRepo.stats(orgId) };
}
