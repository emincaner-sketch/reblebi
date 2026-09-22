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

export const ALL_PROVIDERS: ProviderId[] = [
  "instagram",
  "facebook",
  "threads",
  "whatsapp",
  "x",
  "linkedin",
  "tiktok",
  "youtube",
  "telegram",
];

export type PostKind = "post" | "story" | "reel" | "video" | "thread";
export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "cancelled";
export type TargetStatus = "pending" | "publishing" | "published" | "failed" | "skipped";
export type ChannelStatus = "active" | "expired" | "error" | "disabled";
export type ConversationMode = "auto" | "manual";
export type MessageDirection = "in" | "out";
export type MessageSender = "customer" | "user" | "rule" | "ai";

export interface Channel {
  id: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface MediaFile {
  id: string;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  kind: "image" | "video" | "other";
  createdAt: string;
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
  source: "panel" | "mcp" | "api" | "ai";
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

export interface Conversation {
  id: string;
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
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ActivityEntry {
  id: string;
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

export interface Settings {
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
}

export const DEFAULT_SETTINGS: Settings = {
  brandName: "",
  brandVoice: "",
  brandAudience: "",
  brandOffers: "",
  brandBannedWords: "",
  brandExamples: "",
  aiAutoReplyFallback: false,
  aiReplyInstructions: "Kısa, samimi, yardımcı yanıtlar ver. Fiyat sorulursa panelde tanımlı teklifleri kullan; bilmediğin bir konuda 'ekibimiz en kısa sürede dönüş yapacak' de.",
  businessHoursEnabled: false,
  businessHoursStart: "09:00",
  businessHoursEnd: "19:00",
  businessDays: [1, 2, 3, 4, 5],
  outsideHoursMessage: "Merhaba! Mesajınızı aldık, çalışma saatlerimiz içinde en kısa sürede dönüş yapacağız.",
  handoffKeywords: "insan, yetkili, temsilci, şikayet",
  replyDelaySeconds: 3,
  welcomeMessage: "",
};
