import { z } from "zod";
import { AppError } from "../core/i18n.js";
import { loadBrandContext } from "../core/brand.js";
import { orgSettingsRepo, orgsRepo } from "../core/repos/orgs.js";
import type { Locale, Message, PostKind, ProviderId } from "../core/types.js";
import { consumeAiQuota } from "../services/limits.js";
import { aiJson, aiText, resolveAiConfig, type AiConfig } from "./providers.js";

export { aiAvailable, platformAiAvailable, resolveAiConfig, testAi, DEFAULT_MODELS } from "./providers.js";

const PLATFORM_HINTS: Partial<Record<ProviderId, string>> = {
  instagram: "Instagram: first line is the hook, max 2200 chars, 5-15 hashtags at the end, moderate emoji, line breaks for readability.",
  facebook: "Facebook Page: conversational, 1-3 short paragraphs, 0-3 hashtags, invite engagement with a question.",
  threads: "Threads: max 500 chars, short and conversational, zero or one hashtag.",
  whatsapp: "WhatsApp: short, personal, warm; 1-2 paragraphs.",
  x: "X: max 280 chars per post, sharp and clear, 0-2 hashtags; for threads separate parts with a line containing only ---.",
  linkedin: "LinkedIn: professional but human, the first 2 lines are the hook (see-more cut), max 3000 chars, 3-5 hashtags at the end.",
  tiktok: "TikTok: video caption around 150 chars, 3-5 hashtags, hook in the first words.",
  youtube: "YouTube: put a 60-70 char title in 'title'; text = description (first 2 lines matter), add chapters/CTA if useful.",
  telegram: "Telegram channel: up to 4096 chars, plain text, clear headline line, hashtags optional.",
};

const KIND_HINTS: Record<PostKind, string> = {
  post: "Regular feed post.",
  story: "Story: ephemeral, 1-3 short on-screen lines, big-typography mindset; always fill visualDirection.",
  reel: "Reel / short video caption: first sentence is the hook, hashtags at the end; always fill visualDirection with a shot list.",
  video: "Video description: summarize what viewers get, add a CTA.",
  thread: "Thread: 3-7 parts, one idea per part, separate parts with a line containing only ---.",
};

function languageName(locale: Locale): string {
  return locale === "en" ? "English" : "Turkish";
}

function systemPrompt(orgId: string, extra = ""): string {
  const brand = loadBrandContext(orgId);
  const org = orgsRepo.get(orgId);
  const locale = org?.locale ?? "tr";
  return [
    "You are the content and customer-communication assistant of a social media management platform.",
    `Write in ${languageName(locale)} unless the user explicitly asks for another language.`,
    "Rules: no invented numbers, fake testimonials or fake discounts. Never use the brand's banned words. Stay true to the brand voice.",
    "Do not use em dashes (—); use periods, commas or colons instead. No exclamation-mark spam and no cliché marketing phrases.",
    brand.text ? `\n# Brand memory\n${brand.text}` : "\n(No brand profile yet; keep a neutral, friendly, professional tone.)",
    extra,
  ]
    .filter(Boolean)
    .join("\n");
}

function requireAi(orgId: string): AiConfig {
  const cfg = resolveAiConfig(orgId);
  if (!cfg) throw new AppError(400, "ai.disabled");
  consumeAiQuota(orgId, cfg.usingPlatformKey);
  return cfg;
}

/* ---------------- İçerik üretimi ---------------- */

const VariantSchema = z.object({
  platform: z.string().describe("Provider id: instagram, facebook, x, linkedin, threads, tiktok, youtube, telegram"),
  hook: z.string().describe("Opening line / hook"),
  text: z.string().describe("Ready-to-publish full text for this platform, including hashtags"),
  hashtags: z.array(z.string()),
  title: z.string().nullable().describe("Title for platforms that need one (YouTube), otherwise null"),
  visualDirection: z.string().nullable().describe("Direction for the image/video (required for story and reel), otherwise null"),
  firstComment: z.string().nullable().describe("Optional first comment (e.g. link or extra hashtags), otherwise null"),
});

const GenerateSchema = z.object({
  variants: z.array(VariantSchema),
  alternativeHooks: z.array(z.string()).describe("3 hooks from different angles: pain point, number, contrarian"),
  notes: z.string().nullable(),
});

export type GeneratedContent = z.infer<typeof GenerateSchema>;

export interface GenerateInput {
  topic: string;
  kind: PostKind;
  platforms: ProviderId[];
  tone?: string;
  goal?: string;
  language?: string;
  extraInstructions?: string;
}

export async function generateContent(orgId: string, input: GenerateInput): Promise<GeneratedContent> {
  const cfg = requireAi(orgId);
  const platforms = [...new Set(input.platforms)];
  const prompt = [
    `Topic / brief: ${input.topic}`,
    `Post type: ${input.kind}. ${KIND_HINTS[input.kind]}`,
    input.goal ? `Goal: ${input.goal}` : "",
    input.tone ? `Desired tone: ${input.tone}` : "",
    input.language ? `Language: ${input.language}` : "",
    "Target platforms and their rules:\n" + platforms.map((p) => `- ${p}: ${PLATFORM_HINTS[p]}`).join("\n"),
    input.extraInstructions ? `Extra instructions: ${input.extraInstructions}` : "",
    "Produce exactly one variant per target platform. Texts must be copy-paste ready.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return aiJson(cfg, GenerateSchema, { system: systemPrompt(orgId), user: prompt, maxTokens: 16000, effort: "high" });
}

/* ---------------- Metin iyileştirme ---------------- */

export async function improveText(orgId: string, text: string, instruction: string, platform?: ProviderId): Promise<string> {
  const cfg = requireAi(orgId);
  return aiText(cfg, {
    system: systemPrompt(orgId, "Return ONLY the rewritten text. No explanation, no heading, no quotes."),
    user: `Text:\n${text}\n\nInstruction: ${instruction}${platform ? `\nPlatform rule: ${PLATFORM_HINTS[platform]}` : ""}`,
    maxTokens: 4000,
    effort: "medium",
  });
}

/* ---------------- DM yanıtı ---------------- */

const ReplySchema = z.object({
  reply: z.string().describe("Reply to send to the customer; empty string means do not reply"),
  intent: z.enum(["sales", "support", "complaint", "spam", "greeting", "other"]),
  handoff: z.boolean().describe("Should a human take over (complaint, anger, complex request, price negotiation, legal topic)"),
  confidence: z.number().min(0).max(1),
  summary: z.string().describe("One-sentence summary of the conversation"),
});

export type DraftedReply = z.infer<typeof ReplySchema>;

export interface DraftReplyInput {
  platform: ProviderId;
  participantName: string | null;
  history: Message[];
  ruleInstructions?: string | null;
}

export async function draftReply(orgId: string, input: DraftReplyInput): Promise<DraftedReply> {
  const cfg = requireAi(orgId);
  const s = orgSettingsRepo.get(orgId);
  const transcript = input.history
    .slice(-20)
    .map((m) => `${m.direction === "in" ? "CUSTOMER" : "US"}: ${m.text || "[media]"}`)
    .join("\n");
  const extra = [
    `A customer is messaging us via ${input.platform}${input.participantName ? ` (name: ${input.participantName})` : ""}.`,
    "Task: based on the conversation, write a short, clear, helpful reply in the brand voice. 2-4 sentences, at most one emoji. Reply in the customer's language.",
    "Never invent facts (stock, shipping times, prices). If you don't know, say the team will follow up shortly and set handoff=true.",
    "For spam or irrelevant messages leave reply as an empty string.",
    s.aiReplyInstructions ? `Workspace instructions: ${s.aiReplyInstructions}` : "",
    input.ruleInstructions ? `Rule instructions: ${input.ruleInstructions}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    return await aiJson(cfg, ReplySchema, {
      system: systemPrompt(orgId, extra),
      user: `Conversation (the last message is from the customer):\n${transcript}\n\nWrite the reply.`,
      maxTokens: 2000,
      effort: "medium",
    });
  } catch (e) {
    if (e instanceof AppError && e.key === "ai.refused") return { reply: "", intent: "other", handoff: true, confidence: 0, summary: "refused" };
    throw e;
  }
}

/* ---------------- Gelen kutusu özeti ---------------- */

export async function summarizeConversations(orgId: string, items: Array<{ name: string; platform: string; lastMessage: string; unread: number }>): Promise<string> {
  const cfg = requireAi(orgId);
  const list = items.map((i, idx) => `${idx + 1}. [${i.platform}] ${i.name} (${i.unread} unread): ${i.lastMessage}`).join("\n");
  return aiText(cfg, {
    system: systemPrompt(orgId, "You summarize the inbox for a manager. Bullet points: urgent, sales opportunities, complaints, the rest. Short and action-oriented."),
    user: `Conversations:\n${list}`,
    maxTokens: 3000,
    effort: "low",
  });
}

/* ---------------- Kampanya planlama (AI içerik takvimi) ---------------- */

const PlanItemSchema = z.object({
  dayOffset: z.number().int().min(0).describe("Days after the plan start date (0 = first day)"),
  time: z.string().nullable().describe("Preferred local time HH:mm, or null to use the channel's next free posting slot"),
  kind: z.enum(["post", "story", "reel", "video", "thread"]),
  platforms: z.array(z.string()).describe("Provider ids this item targets (subset of the available ones)"),
  title: z.string().describe("Short internal title for the calendar"),
  angle: z.string().describe("Content angle / pillar (e.g. education, social proof, behind the scenes, offer)"),
  texts: z
    .array(z.object({ platform: z.string(), text: z.string(), title: z.string().nullable() }))
    .describe("Ready-to-publish text per platform"),
  firstComment: z.string().nullable(),
  hashtags: z.array(z.string()),
  visualDirection: z.string().describe("What image or video to prepare"),
});

const PlanSchema = z.object({
  name: z.string().describe("Campaign name"),
  strategy: z.string().describe("2-4 sentence strategy summary"),
  pillars: z.array(z.string()),
  items: z.array(PlanItemSchema),
});

export type GeneratedPlan = z.infer<typeof PlanSchema>;

export interface PlanInput {
  brief: string;
  goal?: string;
  days: number;
  postsPerWeek: number;
  platforms: ProviderId[];
  kinds?: PostKind[];
  tone?: string;
  startDate: string;
}

export async function generatePlan(orgId: string, input: PlanInput): Promise<GeneratedPlan> {
  const cfg = requireAi(orgId);
  const total = Math.max(1, Math.min(40, Math.round((input.days / 7) * input.postsPerWeek)));
  const platforms = [...new Set(input.platforms)];
  const prompt = [
    `Build a social media content plan.`,
    `Brief: ${input.brief}`,
    input.goal ? `Goal: ${input.goal}` : "",
    input.tone ? `Tone: ${input.tone}` : "",
    `Plan length: ${input.days} days starting ${input.startDate}. Create about ${total} items spread evenly (vary weekdays; avoid more than one item per day per platform unless necessary).`,
    `Allowed post types: ${(input.kinds?.length ? input.kinds : ["post", "reel", "story"]).join(", ")}.`,
    "Platforms and rules:\n" + platforms.map((p) => `- ${p}: ${PLATFORM_HINTS[p]}`).join("\n"),
    "Mix content pillars (education, proof, behind-the-scenes, community, offer). Every item must have a concrete hook and a texts entry for each of its platforms.",
    "Use time = null unless the brief requires a specific hour; the system will place posts into free posting slots.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const plan = await aiJson(cfg, PlanSchema, { system: systemPrompt(orgId), user: prompt, maxTokens: 16000, effort: "medium" });
  // Modelin izin verilmeyen platform üretmesine karşı süzgeç
  plan.items = plan.items
    .map((it) => ({ ...it, platforms: it.platforms.filter((p) => platforms.includes(p as ProviderId)), texts: it.texts.filter((x) => platforms.includes(x.platform as ProviderId)) }))
    .filter((it) => it.platforms.length > 0);
  return plan;
}
