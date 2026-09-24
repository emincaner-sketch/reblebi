/** Desteklenen platformlar */
export type ProviderId =
  | "facebook"
  | "instagram"
  | "threads"
  | "whatsapp"
  | "x"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "telegram";

export const ALL_PROVIDERS: ProviderId[] = ["instagram", "facebook", "threads", "whatsapp", "x", "linkedin", "tiktok", "youtube", "telegram"];

export type Locale = "tr" | "en";
export type Role = "owner" | "admin" | "editor" | "viewer";
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/** Her isteğin taşıdığı bağlam: hangi çalışma alanı, kim, nereden */
export interface Ctx {
  orgId: string;
  userId: string | null;
  role: Role;
  via: "session" | "apikey" | "oauth" | "system";
  locale: Locale;
  /** OAuth ile bağlanan MCP istemcisinin adı (Claude, Gemini...) */
  clientName?: string | null;
}

export type PostKind = "post" | "story" | "reel" | "video" | "thread";
export type PostStatus = "draft" | "pending_approval" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "cancelled";
export type TargetStatus = "pending" | "publishing" | "published" | "failed" | "skipped";
export type ChannelStatus = "active" | "expired" | "error" | "disabled";
export type ConversationMode = "auto" | "manual";
export type MessageDirection = "in" | "out";
export type MessageSender = "customer" | "user" | "rule" | "ai";
export type PostSource = "panel" | "mcp" | "api" | "ai" | "recurrence";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  planExpiresAt: string | null;
  billingRef: string | null;
  timezone: string;
  locale: Locale;
  disabled: number;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  isSuperadmin: number;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  locale: Locale;
  disabled: number;
  createdAt: string;
}

export interface Membership {
  orgId: string;
  userId: string;
  role: Role;
  createdAt: string;
}

export interface Channel {
  id: string;
  orgId: string;
  provider: ProviderId;
  externalId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  /** Şifreli saklanır; repos katmanı çözüp verir */
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  scopes: string | null;
  metadata: Record<string, unknown>;
  status: ChannelStatus;
  lastError: string | null;
  customerId: string | null;
  /** Tercih edilen paylaşım saatleri: günün dakikası (ör. 600 = 10:00) */
  timeSlots: number[];
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFile {
  id: string;
  orgId: string;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  kind: "image" | "video" | "other";
  altText: string | null;
  createdAt: string;
}

export interface PostComment {
  text: string;
  /** Ana gönderiden kaç dakika sonra (0 = hemen) */
  delayMinutes: number;
}

export interface Recurrence {
  every: number;
  unit: "day" | "week" | "month";
  /** Bu tarihten sonra tekrar etme (ISO) */
  until?: string | null;
  /** Kalan tekrar sayısı (null = sınırsız) */
  remaining?: number | null;
}

export interface Post {
  id: string;
  orgId: string;
  title: string | null;
  kind: PostKind;
  status: PostStatus;
  content: string;
  mediaIds: string[];
  publishAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: PostSource;
  createdBy: string | null;
  campaignId: string | null;
  tags: string[];
  comments: PostComment[];
  recurrence: Recurrence | null;
  notes: string | null;
  rejectionReason: string | null;
  targets: PostTarget[];
}

export interface PostTarget {
  id: string;
  postId: string;
  channelId: string;
  /** Kanal-özel içerik; boşsa post.content kullanılır */
  content: string | null;
  mediaIds: string[] | null;
  settings: Record<string, unknown>;
  status: TargetStatus;
  externalId: string | null;
  externalUrl: string | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  publishedAt: string | null;
}

export interface CommentJob {
  id: string;
  orgId: string;
  postId: string;
  targetId: string;
  position: number;
  text: string;
  runAt: string;
  status: "pending" | "done" | "failed" | "skipped";
  externalId: string | null;
  error: string | null;
  attempts: number;
}

export interface Conversation {
  id: string;
  orgId: string;
  channelId: string;
  externalId: string;
  participantId: string;
  participantName: string | null;
  participantAvatar: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unread: number;
  mode: ConversationMode;
  status: "open" | "closed";
  needsAttention: number;
  assignedTo: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  externalId: string | null;
  text: string;
  attachments: Array<{ type: string; url?: string; name?: string }>;
  sentBy: MessageSender;
  ruleId: string | null;
  status: "received" | "sent" | "failed";
  error: string | null;
  createdAt: string;
}

export type RuleMatch = "any" | "first_contact" | "keyword" | "regex";
export type RuleReplyMode = "template" | "ai";

export interface AutoReplyRule {
  id: string;
  orgId: string;
  name: string;
  enabled: number;
  channelId: string | null;
  provider: ProviderId | null;
  matchType: RuleMatch;
  pattern: string | null;
  replyMode: RuleReplyMode;
  replyText: string | null;
  aiInstructions: string | null;
  priority: number;
  cooldownMinutes: number;
  onlyBusinessHours: number;
  handoffToHuman: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  orgId: string;
  name: string;
  prefix: string;
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ActivityEntry {
  id: string;
  orgId: string | null;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface AnalyticsSnapshot {
  id: string;
  channelId: string;
  date: string;
  metrics: Record<string, number>;
}

export interface Customer {
  id: string;
  orgId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Tag {
  id: string;
  orgId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  orgId: string;
  name: string;
  goal: string | null;
  brief: string | null;
  status: "draft" | "active" | "done" | "archived";
  source: PostSource;
  createdBy: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Signature {
  id: string;
  orgId: string;
  name: string;
  content: string;
  autoAdd: number;
  createdAt: string;
}

export interface Preset {
  id: string;
  orgId: string;
  name: string;
  channelIds: string[];
  settings: Record<string, Record<string, unknown>>;
  createdAt: string;
}

export interface PostNote {
  id: string;
  postId: string;
  authorUserId: string | null;
  authorName: string;
  text: string;
  source: "team" | "preview";
  createdAt: string;
}

export interface PreviewLink {
  token: string;
  orgId: string;
  postId: string;
  createdBy: string | null;
  expiresAt: string | null;
  allowComments: number;
  createdAt: string;
}

export type WebhookEvent = "post.published" | "post.failed" | "post.partial" | "post.scheduled" | "message.received" | "channel.error";
export const WEBHOOK_EVENTS: WebhookEvent[] = ["post.published", "post.failed", "post.partial", "post.scheduled", "message.received", "channel.error"];

export interface OutboundWebhook {
  id: string;
  orgId: string;
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

export interface Notification {
  id: string;
  orgId: string;
  userId: string | null;
  kind: "info" | "success" | "warning" | "error";
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

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
  /** Onay akışı: none = doğrudan zamanla, ai = AI/MCP gönderileri onay bekler, all = her gönderi onay bekler */
  approvalMode: "none" | "ai" | "all";
  /** Varsayılan paylaşım saatleri (kanal kendi saatini tanımlamazsa) */
  defaultTimeSlots: number[];
  /** Aynı kanalda iki gönderi arası en az dakika */
  minGapMinutes: number;
  /** AI: platform anahtarı mı (plan kotasından düşer) yoksa kendi anahtarı mı */
  aiProvider: "platform" | "anthropic" | "openai" | "xai" | "gemini" | "openrouter" | "custom";
  aiModel: string;
  aiApiKeyEnc: string;
  aiBaseUrl: string;
  notifyOnFailureEmail: boolean;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  brandName: "",
  brandVoice: "",
  brandAudience: "",
  brandOffers: "",
  brandBannedWords: "",
  brandExamples: "",
  aiAutoReplyFallback: false,
  aiReplyInstructions: "",
  businessHoursEnabled: false,
  businessHoursStart: "09:00",
  businessHoursEnd: "19:00",
  businessDays: [1, 2, 3, 4, 5],
  outsideHoursMessage: "",
  handoffKeywords: "",
  replyDelaySeconds: 3,
  welcomeMessage: "",
  approvalMode: "none",
  defaultTimeSlots: [600, 780, 1140],
  minGapMinutes: 60,
  aiProvider: "platform",
  aiModel: "",
  aiApiKeyEnc: "",
  aiBaseUrl: "",
  notifyOnFailureEmail: true,
};

/** Dil bazlı akıllı varsayılanlar (yeni org açılırken) */
export function localizedDefaults(locale: Locale): Partial<OrgSettings> {
  return locale === "en"
    ? {
        aiReplyInstructions: "Give short, friendly, helpful replies. If you don't know something, say the team will get back soon.",
        outsideHoursMessage: "Hi! We got your message and will reply during business hours.",
        handoffKeywords: "human, agent, manager, complaint, refund",
      }
    : {
        aiReplyInstructions: "Kısa, samimi, yardımcı yanıtlar ver. Bilmediğin bir konuda 'ekibimiz en kısa sürede dönüş yapacak' de.",
        outsideHoursMessage: "Merhaba! Mesajınızı aldık, çalışma saatlerimiz içinde en kısa sürede dönüş yapacağız.",
        handoffKeywords: "insan, yetkili, temsilci, şikayet, iade",
      };
}
