/** API istemcisi: aynı köken (Vite proxy ya da derlenmiş panel), çerezli oturum */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let currentLocale = "tr";
export function setApiLocale(l: string) {
  currentLocale = l;
}

async function request<T>(method: string, path: string, body?: unknown, opts: { form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Locale": currentLocale };
  if (body !== undefined && !opts.form) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers,
    body: opts.form ? opts.form : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = data as { error?: string; code?: string; details?: unknown } | null;
    throw new ApiError(d?.error ?? `${res.status} ${res.statusText}`, res.status, d?.code, d?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, undefined, { form }),
};

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ---------------- Tipler (sunucu ile uyumlu) ---------------- */

export type ProviderId = "facebook" | "instagram" | "threads" | "whatsapp" | "x" | "linkedin" | "tiktok" | "youtube" | "telegram";
export type PostKind = "post" | "story" | "reel" | "video" | "thread";
export type PostStatus = "draft" | "pending_approval" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "cancelled";
export type Role = "owner" | "admin" | "editor" | "viewer";
export type Locale = "tr" | "en";
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
export const ROLES: Role[] = ["owner", "admin", "editor", "viewer"];

export interface Me {
  needsSetup: boolean;
  signupMode: "open" | "invite" | "closed";
  user: { id: string; email: string; name: string | null; locale: Locale; isSuperadmin: boolean; emailVerified: boolean } | null;
  orgs: Array<{ id: string; name: string; slug: string; role: Role; plan: string }>;
  org: { id: string; name: string; slug: string; timezone: string; locale: Locale; plan: string; planExpiresAt: string | null; disabled: boolean } | null;
  role: Role | null;
  unreadNotifications?: number;
}

export interface SettingField {
  key: string;
  label: string;
  type: "text" | "select" | "boolean" | "number";
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
  appliesTo?: PostKind[];
  help?: string;
}

export interface Capabilities {
  post: boolean;
  story: boolean;
  reel: boolean;
  video: boolean;
  thread: boolean;
  dm: boolean;
  inbound: "webhook" | "poll" | "none";
  analytics: boolean;
  maxTextLength: number;
  comments?: boolean;
  maxMedia?: number;
  requiresMedia?: boolean;
  requiresVideo?: boolean;
  mediaNote?: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  color: string;
  capabilities: Capabilities;
  settingFields: SettingField[];
  connectMode: "oauth" | "form";
  connectFields: SettingField[];
  configured: boolean;
  oauthGroup: string;
}

export interface Channel {
  id: string;
  orgId: string;
  provider: ProviderId;
  externalId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  tokenExpiresAt: string | null;
  metadata: Record<string, unknown>;
  status: "active" | "expired" | "error" | "disabled";
  lastError: string | null;
  customerId: string | null;
  customerName: string | null;
  timeSlots: number[];
  postingTimes: string[];
  capabilities: Capabilities;
  settingFields: SettingField[];
  providerLabel: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Media {
  id: string;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  kind: "image" | "video" | "other";
  altText: string | null;
  createdAt: string;
  url: string;
  publicUrl: string;
}

export interface PostTarget {
  id: string;
  postId: string;
  channelId: string;
  content: string | null;
  mediaIds: string[] | null;
  settings: Record<string, unknown>;
  status: "pending" | "publishing" | "published" | "failed" | "skipped";
  externalId: string | null;
  externalUrl: string | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  publishedAt: string | null;
  metrics?: Record<string, number> | null;
}

export interface PostComment {
  text: string;
  delayMinutes: number;
}

export interface Recurrence {
  every: number;
  unit: "day" | "week" | "month";
  until?: string | null;
  remaining?: number | null;
}

export interface Post {
  id: string;
  title: string | null;
  kind: PostKind;
  status: PostStatus;
  content: string;
  mediaIds: string[];
  publishAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: string;
  createdBy: string | null;
  campaignId: string | null;
  tags: string[];
  comments: PostComment[];
  recurrence: Recurrence | null;
  notes: string | null;
  rejectionReason: string | null;
  targets: PostTarget[];
  noteCount?: number;
}

export interface PostDetail extends Post {
  notesList: Array<{ id: string; authorName: string; text: string; source: "team" | "preview"; createdAt: string }>;
  commentJobs: Array<{ id: string; targetId: string; position: number; text: string; runAt: string; status: string; error: string | null }>;
  previewLinks: Array<{ token: string; expiresAt: string | null; createdAt: string }>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  publishAt: string | null;
  status: PostStatus;
  perChannel: Array<{ channelId: string; channel: string; provider: string; length: number; maxLength: number; mediaCount: number }>;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Signature {
  id: string;
  name: string;
  content: string;
  autoAdd: number;
}

export interface Campaign {
  id: string;
  name: string;
  goal: string | null;
  brief: string | null;
  status: "draft" | "active" | "done" | "archived";
  source: string;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  postCount?: number;
  publishedCount?: number;
  nextAt?: string | null;
}

export interface CampaignDetail extends Campaign {
  posts: Post[];
}

export interface PlannerResult {
  plan: { name: string; strategy: string; pillars: string[]; items: Array<{ title: string; angle: string; kind: PostKind; visualDirection: string }> };
  campaignId: string | null;
  items: Array<{ index: number; title: string; publishAt: string | null; channels: string[]; postId?: string; errors: string[]; warnings: string[] }>;
}

export interface FreeSlot {
  at: string;
  local: string;
  weekday: number;
}

export interface Conversation {
  id: string;
  channelId: string;
  channelName: string;
  provider: ProviderId | null;
  externalId: string;
  participantId: string;
  participantName: string | null;
  participantAvatar: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unread: number;
  mode: "auto" | "manual";
  status: "open" | "closed";
  needsAttention: number;
  assignedTo: string | null;
}

export interface Message {
  id: string;
  direction: "in" | "out";
  text: string;
  attachments: Array<{ type: string; url?: string; name?: string }>;
  sentBy: "customer" | "user" | "rule" | "ai";
  status: "received" | "sent" | "failed";
  error: string | null;
  createdAt: string;
}

export interface Rule {
  id: string;
  name: string;
  enabled: number;
  channelId: string | null;
  provider: ProviderId | null;
  matchType: "any" | "first_contact" | "keyword" | "regex";
  pattern: string | null;
  replyMode: "template" | "ai";
  replyText: string | null;
  aiInstructions: string | null;
  priority: number;
  cooldownMinutes: number;
  onlyBusinessHours: number;
  handoffToHuman: number;
}

export type AiProviderKind = "platform" | "anthropic" | "openai" | "xai" | "gemini" | "openrouter" | "custom";

export interface OrgSettings {
  brandName: string;
  brandVoice: string;
  brandAudience: string;
  brandOffers: string;
  brandBannedWords: string;
  brandExamples: string;
  aiAutoReplyFallback: boolean;
  aiReplyInstructions: string;
  businessHoursEnabled: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: number[];
  outsideHoursMessage: string;
  handoffKeywords: string;
  replyDelaySeconds: number;
  welcomeMessage: string;
  approvalMode: "none" | "ai" | "all";
  defaultPostingTimes: string[];
  minGapMinutes: number;
  aiProvider: AiProviderKind;
  aiModel: string;
  aiApiKeySet: boolean;
  aiBaseUrl: string;
  notifyOnFailureEmail: boolean;
}

export interface AiStatus {
  available: boolean;
  provider: string | null;
  model: string | null;
  usingPlatformKey: boolean;
  platformAvailable: boolean;
  defaults: Record<string, string>;
  brandSources: string[];
  usage: { used: number; limit: number | null };
}

export type PlanFeature = "mcp" | "inbox" | "aiReplies" | "approvals" | "webhooks" | "customers" | "previewLinks" | "analytics" | "byokAi";

export interface Quota {
  used: number;
  limit: number | null;
}

export interface Usage {
  plan: { id: string; name: { tr: string; en: string }; features: Record<PlanFeature, boolean>; priceMonthly: number; currency: string };
  assignedPlan: string;
  planExpiresAt: string | null;
  expired: boolean;
  period: string;
  channels: Quota;
  members: Quota;
  posts: Quota;
  ai: Quota;
  storageMb: Quota;
}

export interface PlanInfo {
  id: string;
  name: { tr: string; en: string };
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  public?: boolean;
  channels: number;
  members: number;
  postsPerMonth: number;
  aiPerMonth: number;
  storageMb: number;
  features: Record<PlanFeature, boolean>;
}

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  plan: string;
  planExpiresAt: string | null;
  timezone: string;
  locale: Locale;
  disabled: number;
  createdAt: string;
  role: Role;
  usage: Usage;
  plans: PlanInfo[];
}

export interface Member {
  orgId: string;
  userId: string;
  role: Role;
  email: string;
  name: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AiConnection {
  clientId: string;
  clientName: string;
  userId: string;
  email: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export type WebhookEvent = "post.published" | "post.failed" | "post.partial" | "post.scheduled" | "message.received" | "channel.error";

export interface OutboundWebhook {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  enabled: number;
  lastStatus: number | null;
  lastError: string | null;
  lastAt: string | null;
  createdAt: string;
}

export interface Activity {
  id: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  createdAt: string;
}

export interface Dashboard {
  channels: { total: number; active: number; problem: number };
  posts: { scheduled: number; published: number; failed: number; draft: number; pendingApproval: number; publishedLast7: number };
  inbox: { open: number; unread: number; attention: number; inLast7: number; autoRepliedLast7: number };
  upcoming: Post[];
  pendingApproval: Post[];
  recent: Post[];
  campaigns: Campaign[];
  activity: Activity[];
  ai: boolean;
  usage: Usage;
}

export interface AnalyticsOverview {
  days: number;
  channels: Array<{
    channelId: string;
    name: string;
    provider: ProviderId;
    avatarUrl: string | null;
    latest: Record<string, number>;
    followersDelta: number;
    series: Array<Record<string, number | string>>;
    published: number;
    failed: number;
    engagement: { likes: number; comments: number; shares: number; views: number };
    supported: boolean;
  }>;
  top: Array<{ targetId: string; postId: string; channel: string; provider: ProviderId | null; url: string | null; kind: PostKind; preview: string; publishedAt: string | null; metrics: Record<string, number> }>;
  bestHoursUtc: Array<{ hourUtc: number; avgScore: number; posts: number }>;
  posts: Dashboard["posts"];
  inbox: Dashboard["inbox"];
}

export interface PublicConfig {
  appName: string;
  signupMode: "open" | "invite" | "closed";
  trialDays: number;
  trialPlan: string;
  supportEmail: string;
  companyName: string;
  companyAddress: string;
  publicUrl: string;
  mcpUrl: string;
  plans: PlanInfo[];
}

export interface SystemInfo {
  appName: string;
  publicUrl: string;
  secure: boolean;
  timezone: string;
  mcp: { url: string; enabled: boolean };
  webhooks: { meta: { url: string; verifyToken: string } } | null;
  oauthRedirects: Record<string, string> | null;
  providers: ProviderInfo[];
  recentWebhooks: Array<{ id: string; provider: string; processed: number; error: string | null; receivedAt: string }>;
}

export interface Notification {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface GeneratedContent {
  variants: Array<{ platform: string; hook: string; text: string; hashtags: string[]; title: string | null; visualDirection: string | null; firstComment: string | null }>;
  alternativeHooks: string[];
  notes: string | null;
}

/* ---------------- Süper admin ---------------- */

export interface AdminStats {
  users: number;
  usersLast30: number;
  activeLast7: number;
  orgs: number;
  channels: number;
  postsLast30: number;
  publishedLast30: number;
  failedLast30: number;
  mcpConnections: number;
  byPlan: Record<string, number>;
  byProvider: Record<string, number>;
  mailConfigured: boolean;
  signupMode: string;
  trial: { days: number; plan: string };
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
  planExpiresAt: string | null;
  billingRef: string | null;
  timezone: string;
  disabled: number;
  createdAt: string;
  effectivePlan: string;
  ownerEmail: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  isSuperadmin: number;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  disabled: number;
  createdAt: string;
  orgs: Array<{ id: string; name: string; role: Role }>;
}

export interface OutboxMail {
  to: string;
  subject: string;
  text: string;
  at: string;
}

/* ---------------- Sabitler ---------------- */

export const PROVIDER_COLOR: Record<ProviderId, string> = {
  instagram: "#E1306C",
  facebook: "#1877F2",
  threads: "#444",
  whatsapp: "#25D366",
  x: "#333",
  linkedin: "#0A66C2",
  tiktok: "#FE2C55",
  youtube: "#FF0000",
  telegram: "#229ED9",
};

export const PROVIDER_SHORT: Record<ProviderId, string> = {
  instagram: "IG",
  facebook: "FB",
  threads: "TH",
  whatsapp: "WA",
  x: "X",
  linkedin: "in",
  tiktok: "TT",
  youtube: "YT",
  telegram: "TG",
};

export const PROVIDER_NAME: Record<ProviderId, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  whatsapp: "WhatsApp",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  telegram: "Telegram",
};

export const DM_PROVIDERS: ProviderId[] = ["instagram", "facebook", "whatsapp", "telegram", "x"];
