import type { PostKind, ProviderId } from "../../lib/api";

/** GET /api/analytics/report yanıtı (server/src/services/analytics-report.ts ile aynı şekil) */

type Num = number | null;
export interface Kpi {
  value: Num;
  prev: Num;
}

export interface AnalyticsReport {
  range: { from: string; to: string; days: number; prevFrom: string; prevTo: string; tz: string; today: string };
  filter: { provider: ProviderId | null; channelId: string | null; campaignId: string | null };
  networks: Array<{ provider: ProviderId; channels: number; supported: boolean }>;
  truncated: boolean;
  kpis: Record<
    "followers" | "followersDelta" | "posts" | "postsWithMetrics" | "interactions" | "likes" | "comments" | "shares" | "views" | "engagementRate" | "autoReplyRate" | "incomingMessages",
    Kpi
  >;
  daily: Array<{ date: string; posts: number; interactions: number; views: number; likes: number; comments: number; shares: number; followers: Num }>;
  followersByProvider: Partial<Record<ProviderId, Num[]>>;
  channels: Array<{
    channelId: string;
    name: string;
    provider: ProviderId;
    avatarUrl: string | null;
    status: string;
    supported: boolean;
    followers: Num;
    followersDelta: Num;
    posts: number;
    postsWithMetrics: number;
    interactions: number;
    views: number;
    engagementRate: Num;
  }>;
  byProvider: Array<{ provider: ProviderId; channels: number; supported: boolean; followers: Num; followersDelta: Num; posts: number; postsWithMetrics: number; interactions: number; views: number; engagementRate: Num }>;
  kinds: Array<{ kind: PostKind; posts: number; withMetrics: number; interactions: number; views: number; avgInteractions: Num }>;
  hashtags: Array<{ tag: string; posts: number; interactions: number; views: number; likes: number; comments: number }>;
  heatmap: { cells: Array<{ weekday: number; hour: number; posts: number; interactions: number; withMetrics: number; avgInteractions: Num }>; maxAvg: number };
  posts: Array<{
    targetId: string;
    postId: string;
    channelId: string;
    channel: string;
    provider: ProviderId | null;
    kind: PostKind;
    url: string | null;
    preview: string;
    publishedAt: string | null;
    hasMetrics: boolean;
    metricsAt: string | null;
    likes: Num;
    comments: Num;
    shares: Num;
    views: Num;
    interactions: Num;
    engagementRate: Num;
  }>;
  /** Hesap insights (tamamlanmış günler; platform izni varsa) */
  insights: {
    available: boolean;
    channels: number;
    daily: Record<InsightKey, Num[]>;
    kpis: Record<InsightKey, Kpi>;
  };
  /** Takipçi kitlesi (kapsamdaki kanalların toplamı) */
  audience: {
    channels: string[];
    fetchedAt: string | null;
    /** followers: takipçi sayıları (Instagram, Facebook) · viewers: izleyiciler (YouTube) */
    basis: "followers" | "viewers";
    /** Yaş/cinsiyet değerleri yüzde (YouTube) */
    percent: boolean;
    country: Array<{ key: string; value: number }>;
    city: Array<{ key: string; value: number }>;
    age: Array<{ key: string; value: number }>;
    gender: Array<{ key: string; value: number }>;
  } | null;
}

export type InsightKey = "reach" | "views" | "profileViews" | "websiteClicks" | "follows" | "unfollows" | "engaged" | "watchMinutes" | "clicks" | "saves" | "calls" | "directions";
