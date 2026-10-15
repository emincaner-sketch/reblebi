import { z } from "zod";

/** REST API ve MCP araçlarının paylaştığı şemalar */

export const PostKindSchema = z.enum(["post", "story", "reel", "video", "thread"]);

export const CommentSchema = z.object({
  text: z.string().min(1).max(5000),
  delayMinutes: z.number().int().min(0).max(10080).default(0),
});

export const RecurrenceSchema = z.object({
  every: z.number().int().min(1).max(365),
  unit: z.enum(["day", "week", "month"]),
  until: z.string().nullable().optional(),
  remaining: z.number().int().min(0).max(1000).nullable().optional(),
});

export const TargetSchema = z.object({
  channelId: z.string(),
  content: z.string().max(70000).nullable().optional(),
  mediaIds: z.array(z.string()).max(35).nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const PostInputSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  kind: PostKindSchema.optional(),
  content: z.string().max(70000).optional(),
  mediaIds: z.array(z.string()).max(35).optional(),
  publishAt: z.string().max(60).nullable().optional(),
  draft: z.boolean().optional(),
  targets: z.array(TargetSchema).min(1).max(50),
  campaignId: z.string().nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  comments: z.array(CommentSchema).max(10).optional(),
  firstComment: z.string().max(5000).nullable().optional(),
  recurrence: RecurrenceSchema.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  applySignature: z.boolean().optional(),
});

export const PostPatchSchema = PostInputSchema.partial();

export const ListPostsQuery = z.object({
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  campaignId: z.string().optional(),
  channelId: z.string().optional(),
  tag: z.string().optional(),
  customerId: z.string().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().min(1).max(2000).optional(),
  offset: z.coerce.number().min(0).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

/** Varsayılansız alanlar: güncellemede gönderilmeyen alan mevcut değerini korur */
const RuleFields = {
  name: z.string().min(1).max(100),
  enabled: z.coerce.number().int().min(0).max(1),
  channelId: z.string().nullable(),
  provider: z.enum(["instagram", "facebook", "threads", "whatsapp", "x", "linkedin", "tiktok", "youtube", "telegram"]).nullable(),
  matchType: z.enum(["any", "first_contact", "keyword", "regex"]),
  pattern: z.string().max(500).nullable(),
  replyMode: z.enum(["template", "ai"]),
  replyText: z.string().max(4000).nullable(),
  aiInstructions: z.string().max(4000).nullable(),
  priority: z.coerce.number().int().min(0).max(10000),
  cooldownMinutes: z.coerce.number().int().min(0).max(100000),
  onlyBusinessHours: z.coerce.number().int().min(0).max(1),
  handoffToHuman: z.coerce.number().int().min(0).max(1),
};

export const RuleSchema = z.object({
  ...RuleFields,
  enabled: RuleFields.enabled.default(1),
  channelId: RuleFields.channelId.optional(),
  provider: RuleFields.provider.optional(),
  matchType: RuleFields.matchType.default("keyword"),
  pattern: RuleFields.pattern.optional(),
  replyMode: RuleFields.replyMode.default("template"),
  replyText: RuleFields.replyText.optional(),
  aiInstructions: RuleFields.aiInstructions.optional(),
  priority: RuleFields.priority.default(100),
  cooldownMinutes: RuleFields.cooldownMinutes.default(60),
  onlyBusinessHours: RuleFields.onlyBusinessHours.default(0),
  handoffToHuman: RuleFields.handoffToHuman.default(0),
});

export const RulePatchSchema = z.object(RuleFields).partial();

/* Yorumdan DM'e kuralı: Instagram DM metni en fazla 1000 karakter */
const CommentRuleFields = {
  name: z.string().min(1).max(100),
  enabled: z.coerce.number().int().min(0).max(1),
  channelId: z.string().nullable(),
  mediaIds: z.array(z.string().min(1).max(100)).max(50),
  matchType: z.enum(["any", "keyword"]),
  pattern: z.string().max(500).nullable(),
  dmText: z.string().trim().min(1).max(900),
  publicReplies: z.array(z.string().trim().min(1).max(300)).max(10),
  includeReplies: z.coerce.number().int().min(0).max(1),
  botNotice: z.coerce.number().int().min(0).max(1),
  /** En fazla 3 düğme; her biri ya bağlantı (url) ya da basınca gidecek cevap (replyText). Başlık en fazla 20 karakter. */
  buttons: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(20),
        url: z.string().trim().url().max(2000).nullable().optional(),
        replyText: z.string().trim().max(900).nullable().optional(),
      }),
    )
    .max(3),
  priority: z.coerce.number().int().min(0).max(10000),
};

/** Gelen kutusu otomasyon ayarları (MCP üzerinden): çıkış, devretme, karşılama, mesai dışı, gecikme */
export const InboxSettingsSchema = z.object({
  optOutKeywords: z.string().max(1000).optional(),
  optOutReply: z.string().max(1000).optional(),
  handoffKeywords: z.string().max(1000).optional(),
  welcomeMessage: z.string().max(2000).optional(),
  outsideHoursMessage: z.string().max(2000).optional(),
  replyDelaySeconds: z.number().int().min(0).max(60).optional(),
  aiAutoReplyFallback: z.boolean().optional(),
});

export const INBOX_SETTING_KEYS = ["optOutKeywords", "optOutReply", "handoffKeywords", "welcomeMessage", "outsideHoursMessage", "replyDelaySeconds", "aiAutoReplyFallback"] as const;

/** Kişi kartı güncellemesi: etiketler, alanlar (ör. seviye, e-posta), çıkış listesi */
export const ContactPatchSchema = z.object({
  tags: z.array(z.string().max(40)).max(20).optional(),
  fields: z.record(z.string().max(40), z.string().max(200)).optional(),
  optedOut: z.boolean().optional(),
});

export const CommentRuleSchema = z.object({
  ...CommentRuleFields,
  enabled: CommentRuleFields.enabled.default(0),
  channelId: CommentRuleFields.channelId.optional(),
  mediaIds: CommentRuleFields.mediaIds.default([]),
  matchType: CommentRuleFields.matchType.default("keyword"),
  pattern: CommentRuleFields.pattern.optional(),
  publicReplies: CommentRuleFields.publicReplies.default([]),
  includeReplies: CommentRuleFields.includeReplies.default(0),
  botNotice: CommentRuleFields.botNotice.default(1),
  buttons: CommentRuleFields.buttons.default([]),
  priority: CommentRuleFields.priority.default(100),
});

export const CommentRulePatchSchema = z.object(CommentRuleFields).partial();

export const PlannerSchema = z.object({
  brief: z.string().min(5).max(5000),
  goal: z.string().max(500).optional(),
  tone: z.string().max(200).optional(),
  channelIds: z.array(z.string()).min(1).max(30),
  days: z.number().int().min(1).max(60).default(14),
  postsPerWeek: z.number().int().min(1).max(21).default(4),
  kinds: z.array(PostKindSchema).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  mode: z.enum(["draft", "schedule"]).default("draft"),
  previewOnly: z.boolean().optional(),
});
