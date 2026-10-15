/** Desteklenen platformlar (Postiz + Zapier tam liste) */
export type ProviderId =
  | "facebook"
  | "instagram"
  | "threads"
  | "whatsapp"
  | "x"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "telegram"
  | "reddit"
  | "pinterest"
  | "gmb"
  | "slack"
  | "discord"
  | "mastodon"
  | "bluesky"
  | "lemmy"
  | "nostr"
  | "vk"
  | "devto"
  | "medium"
  | "hashnode"
  | "wordpress"
  | "warpcast"
  | "kick"
  | "twitch"
  | "dribbble";

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
  "reddit",
  "pinterest",
  "gmb",
  "slack",
  "discord",
  "mastodon",
  "bluesky",
  "lemmy",
  "nostr",
  "vk",
  "devto",
  "medium",
  "hashnode",
  "wordpress",
  "warpcast",
  "kick",
  "twitch",
  "dribbble",
];

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
export type PostSource = "panel" | "mcp" | "api" | "ai" | "recurrence" | "autolist";

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

/**
 * Kural tetikleyicisi. story_mention: hikâyede bahsetme; story_reply: hikâyeye cevap (pattern doluysa kelime de aranır);
 * ref: ig.me/m.me bağlantısındaki ref değeri (pattern: virgülle ayrılmış ref listesi, boşsa her ref)
 */
export type RuleMatch = "any" | "first_contact" | "keyword" | "regex" | "story_mention" | "story_reply" | "ref";
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

/** Yorumdan DM'e kuralı: kurala uyan gönderi yorumuna özel yanıt (private reply) ve isteğe bağlı açık yorum cevabı */
export interface CommentRule {
  id: string;
  orgId: string;
  name: string;
  enabled: number;
  /** Boşsa çalışma alanındaki tüm Instagram/Facebook kanalları */
  channelId: string | null;
  /** Boşsa tüm gönderiler */
  mediaIds: string[];
  matchType: "any" | "keyword";
  pattern: string | null;
  dmText: string;
  /** Açık yorum cevabı varyasyonları; boşsa açık cevap yazılmaz */
  publicReplies: string[];
  /** 0: yalnızca üst seviye yorumlar tetikler, 1: yorumlara yazılan cevaplar da */
  includeReplies: number;
  /** 1: DM'in sonuna "otomatik mesaj" notu eklenir */
  botNotice: number;
  /** İlk DM'deki düğmeler (en fazla 3): bağlantı (url) ya da basınca gönderilecek cevap (replyText) */
  buttons: CommentRuleButton[];
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommentRuleButton {
  title: string;
  url?: string | null;
  replyText?: string | null;
}

/** Giden mesaj düğmesi (sağlayıcıdaki MessageButton ile aynı biçim) */
export type DmButton = { type: "postback"; title: string; payload: string } | { type: "web_url"; title: string; url: string };

/** Sohbet menüsü öğesi: basınca gidecek cevap (replyText; boşsa normal DM kuralları cevaplar) ya da bağlantı (url, yalnızca sabit menüde) */
export interface DmProfileItem {
  title: string;
  replyText?: string | null;
  url?: string | null;
}

/** Kanalın sohbet menüsü (Messenger Profile): sohbet açılınca çıkan hazır sorular (ice breakers) ve sabit menü */
export interface DmProfile {
  channelId: string;
  orgId: string;
  iceBreakers: DmProfileItem[];
  menu: DmProfileItem[];
  /** Meta'ya son başarılı gönderim zamanı */
  syncedAt: string | null;
  /** Son gönderim hatası (başarılıysa null) */
  syncError: string | null;
  updatedAt: string | null;
}

/** Kişi kartı: bir kanalda mesajlaşan kişi */
export interface Contact {
  channelId: string;
  participantId: string;
  orgId: string;
  tags: string[];
  /** Serbest alanlar, ör. { seviye: "B1", eposta: "a@b.com" } */
  fields: Record<string, string>;
  /** "durdur/stop" yazdıysa: bu kişiye otomatik mesaj gönderilmez */
  optedOutAt: string | null;
  optedOutReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PrivateReplyStatus = "queued" | "sending" | "sent" | "failed" | "skipped" | "expired";

export interface PrivateReply {
  channelId: string;
  commentId: string;
  orgId: string;
  ruleId: string | null;
  mediaId: string;
  commenterId: string;
  commenterName: string | null;
  commentText: string;
  commentedAt: string;
  status: PrivateReplyStatus;
  attempts: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  dmText: string;
  dmButtons: DmButton[];
  dmMessageId: string | null;
  publicReplyText: string | null;
  publicReplyId: string | null;
  publicReplyError: string | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
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
  /** Markalı rapor: logo adresi (https ya da /media/…), vurgu rengi, varsayılan bölümler, giriş notu */
  reportLogoUrl: string;
  reportColor: string;
  reportSections: string[];
  reportIntro: string;
  /** Zamanlanmış e-posta özeti: kapalı, haftalık (pazartesi 09:00) ya da aylık (ayın ilk günü 09:00), çalışma alanı saatiyle */
  reportEmail: "off" | "weekly" | "monthly";
  /** Virgülle ayrılmış alıcılar; boşsa sahip ve yöneticiler */
  reportRecipients: string;
  /** Son gönderilen özetin dönemi (aynı dönem iki kez gönderilmesin), ör. "weekly:2026-09-28" */
  reportLastSent: string;
  /** Çıkış (opt-out) kelimeleri: yazan kişiye bir daha otomatik mesaj gönderilmez (tam kelime, * ile ek) */
  optOutKeywords: string;
  /** Çıkışta bir kez gönderilen onay mesajı; boşsa gönderilmez */
  optOutReply: string;
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
  reportLogoUrl: "",
  reportColor: "#5b49f2",
  reportSections: ["summary", "followers", "networks", "engagement", "kinds", "timing", "topPosts", "hashtags"],
  reportIntro: "",
  reportEmail: "off",
  reportRecipients: "",
  reportLastSent: "",
  optOutKeywords: "stop, durdur, abonelikten çık*, unsubscribe, mesaj istemiyorum, otomatik mesaj gönderme*",
  optOutReply: "",
};

/** Dil bazlı akıllı varsayılanlar (yeni org açılırken) */
export function localizedDefaults(locale: Locale): Partial<OrgSettings> {
  return locale === "en"
    ? {
        aiReplyInstructions: "Give short, friendly, helpful replies. If you don't know something, say the team will get back soon.",
        outsideHoursMessage: "Hi! We got your message and will reply during business hours.",
        handoffKeywords: "human, agent, manager, complaint, refund",
        optOutKeywords: "stop, unsubscribe, opt out, durdur",
        optOutReply: "Got it, we won't send you automated messages anymore. Our team can still reply here if needed. (This message was sent automatically.)",
      }
    : {
        aiReplyInstructions: "Kısa, samimi, yardımcı yanıtlar ver. Bilmediğin bir konuda 'ekibimiz en kısa sürede dönüş yapacak' de.",
        outsideHoursMessage: "Merhaba! Mesajınızı aldık, çalışma saatlerimiz içinde en kısa sürede dönüş yapacağız.",
        handoffKeywords: "insan, yetkili, temsilci, şikayet, iade",
        optOutReply: "Tamam, sana bir daha otomatik mesaj göndermeyeceğiz. Gerekirse ekibimiz buradan yazabilir. (Bu mesaj otomatik gönderildi.)",
      };
}

/* ============================================================
   Zapier Tarzı İş Akışı (Workflows & Zaps) Tipleri
============================================================ */

export type WorkflowTriggerType =
  | "webhook.inbound"         // Gelen özel webhook (Zapier Catch Hook)
  | "shopify.order_created"   // Shopify: Yeni sipariş / ödeme alındı
  | "shopify.cart_abandoned"  // Shopify: Sepet terk edildi
  | "stripe.payment_succeeded"// Stripe: Başarılı ödeme
  | "forms.submission"        // Form yanıtı (Typeform / Google Forms vb.)
  | "post.published"          // Gönderi yayınlandı
  | "post.failed"             // Gönderi başarısız oldu
  | "post.scheduled"          // Gönderi planlandı
  | "message.received"        // Gelen DM / mesaj / yorum
  | "rss.new_item"            // RSS akışında yeni içerik
  | "schedule.cron"           // Periyodik zamanlayıcı (saatlik, günlük vb.)
  | "manual";                 // Elle veya test tetikleme

export type WorkflowStepType =
  | "filter"                  // Koşullu filtre (eşittir, içerir, regex...)
  | "paths"                   // Zapier Paths: Koşullu dallanma (Path A / Path B)
  | "formatter"               // Veri biçimlendirici (metin, sayı, tarih, para)
  | "code"                    // Code by Zapier: Güvenli JavaScript kod çalıştırma
  | "looping"                 // Looping by Zapier: Dizi öğelerini döngüyle işleme
  | "ai"                      // AI by Zapier (özet, yeniden yazım, sınıflandırma)
  | "sistemler"               // Sistemler klasöründeki ajanlar (marka-hafizasi, carousel, trend-radari vb.)
  | "delay"                   // Bekleme (süre veya hedeflenen tarihe kadar)
  | "action_post"             // Reblebi üzerinde 25+ platforma gönderi oluştur / yayınla
  | "action_reply"            // DM'ye otomatik yanıt ver
  | "action_slack"            // Slack: Kanala mesaj veya Block Kit bildirimi
  | "action_discord"          // Discord: Webhook ile zengin Embed mesajı
  | "action_telegram"         // Telegram: Kanal veya gruba bildirim gönder
  | "action_calendar_event"   // Takvime etkinlik / içerik bloğu ekle
  | "action_shopify"          // Shopify: Siparişe etiket / not ekle
  | "action_webhook"          // Harici API / Webhook çağrısı (POST, GET, PUT...)
  | "action_email"            // E-posta uyarısı gönder
  | "action_notify";          // Reblebi içi bildirim

export type AppConnectorId =
  | "shopify"
  | "slack"
  | "discord"
  | "stripe"
  | "google"
  | "notion"
  | "airtable"
  | "reddit"
  | "pinterest"
  | "wordpress";

export interface AppConnection {
  id: string;
  orgId: string;
  appId: AppConnectorId;
  name: string;
  credentials: Record<string, any>;
  metadata: Record<string, any>;
  status: "active" | "error" | "revoked";
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowCondition {
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "starts_with"
    | "ends_with"
    | "regex"
    | "greater_than"
    | "less_than"
    | "is_empty"
    | "is_not_empty";
  value: string;
}

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  name: string;
  config: Record<string, any>;
}

export interface Workflow {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  enabled: number;
  triggerType: WorkflowTriggerType;
  triggerConfig: Record<string, any>;
  webhookSlug: string | null;
  steps: WorkflowStep[];
  createdBy: string | null;
  runCount: number;
  lastRunAt: string | null;
  lastStatus: "idle" | "success" | "failed" | "filtered" | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepExecution {
  stepId: string;
  name: string;
  type: WorkflowStepType;
  status: "success" | "failed" | "filtered" | "skipped";
  input: any;
  output: any;
  durationMs: number;
  error?: string | null;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  orgId: string;
  triggerType: WorkflowTriggerType;
  triggerPayload: Record<string, any>;
  status: "running" | "success" | "failed" | "filtered";
  error: string | null;
  stepsExecuted: WorkflowStepExecution[];
  durationMs: number;
  createdAt: string;
  updatedAt: string;
}

