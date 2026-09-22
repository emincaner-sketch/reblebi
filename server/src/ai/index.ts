import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../core/config.js";
import { loadBrandContext } from "../core/brand.js";
import { settingsRepo } from "../core/repos/misc.js";
import type { Message, PostKind, ProviderId } from "../core/types.js";

let client: Anthropic | null = null;

/** AI yalnızca .env içindeki ANTHROPIC_API_KEY ile açılır (ortamdaki geçici tokenlara güvenilmez) */
export function isAiEnabled(): boolean {
  return Boolean(config.ai.apiKey);
}

function getClient(): Anthropic {
  if (!isAiEnabled()) throw new Error("ANTHROPIC_API_KEY tanımlı değil; AI özellikleri kapalı");
  if (!client) client = new Anthropic({ apiKey: config.ai.apiKey, maxRetries: 2, timeout: 5 * 60_000 });
  return client;
}

const PLATFORM_HINTS: Record<ProviderId, string> = {
  instagram: "Instagram: ilk cümle kanca, 2200 karakter sınırı, 5-15 hashtag sona, emoji ölçülü, satır boşluklarıyla okunabilir.",
  facebook: "Facebook Sayfası: sohbet tonunda, 1-3 paragraf, hashtag az (0-3), soru ile etkileşim iste.",
  threads: "Threads: en fazla 500 karakter, kısa ve sohbet gibi, hashtag yok ya da 1 tane.",
  whatsapp: "WhatsApp: kısa, kişisel, samimi; 1-2 paragraf.",
  x: "X: 280 karakter sınırı, keskin ve net, 0-2 hashtag; zincir gerekiyorsa parçaları --- ile ayır.",
  linkedin: "LinkedIn: profesyonel ama insan sesi, ilk 2 satır kanca (devamını gör kırılımı), 3000 karakter, 3-5 hashtag sona.",
  tiktok: "TikTok: video açıklaması, 150 karakter civarı, 3-5 hashtag, kanca ilk kelimelerde.",
  youtube: "YouTube: 'title' alanına 60-70 karakterlik başlık, metin = açıklama (ilk 2 satır önemli), zaman damgaları ve CTA ekle.",
  telegram: "Telegram kanalı: 4096 karakter, düz metin, net başlık satırı, hashtag opsiyonel.",
};

const KIND_HINTS: Record<PostKind, string> = {
  post: "Normal akış gönderisi.",
  story: "Hikaye: 24 saatlik, ekranda 1-3 kısa cümle, büyük tipografi mantığı; ayrıca 'visualDirection' alanında görsel yönerge ver.",
  reel: "Reel/kısa video açıklaması: ilk cümle kanca, hashtag'ler sona.",
  video: "Video açıklaması: ne göreceklerini özetle, CTA ekle.",
  thread: "Zincir: 3-7 parça, her parça tek fikir, parçaları --- ile ayır.",
};

function systemPrompt(extra = ""): Anthropic.TextBlockParam[] {
  const brand = loadBrandContext();
  const s = settingsRepo.get();
  const base = [
    "Sen SosyalPilot'un içerik ve müşteri iletişimi asistanısın. Türkçe yazarsın (kullanıcı başka dil istemedikçe).",
    "Kurallar: uydurma sayı, sahte referans, sahte indirim yok. Marka 'ne değiliz' satırlarına ters düşme. Yasak kelimeleri asla kullanma.",
    "Em dash (—) kullanma; ayraç gerekiyorsa nokta, virgül, iki nokta ya da orta nokta (·) kullan.",
    "Ünlem yağmuru ve klişe pazarlama dili ('kaçırma', 'son fırsat', 'efsane') yok; markanın sesine sadık kal.",
    s.brandName ? `Marka: ${s.brandName}` : "",
    brand.text ? "\n# Marka hafızası\n" + brand.text : "\n(Marka hafızası boş. Panel > Ayarlar > Marka bölümünden doldurulursa ton buna göre ayarlanır.)",
    extra,
  ]
    .filter(Boolean)
    .join("\n");
  return [{ type: "text", text: base, cache_control: { type: "ephemeral" } }];
}

function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/* ---------------- İçerik üretimi ---------------- */

const VariantSchema = z.object({
  platform: z.string().describe("Sağlayıcı kimliği: instagram, facebook, x, linkedin, threads, tiktok, youtube, telegram"),
  hook: z.string().describe("İlk cümle / kanca"),
  text: z.string().describe("Platforma hazır tam metin (hashtag'ler dahil)"),
  hashtags: z.array(z.string()),
  title: z.string().nullable().describe("YouTube/TikTok gibi başlık isteyen platformlar için başlık, yoksa null"),
  visualDirection: z.string().nullable().describe("Görsel/video için yönerge (hikaye ve reel için zorunlu), yoksa null"),
  bestTimeHint: z.string().nullable().describe("Önerilen paylaşım zamanı (ör. 'Salı 19:30'), yoksa null"),
});

const GenerateSchema = z.object({
  variants: z.array(VariantSchema),
  alternativeHooks: z.array(z.string()).describe("Farklı açıdan 3 kanca: dert, sayı, karşı görüş"),
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

export async function generateContent(input: GenerateInput): Promise<GeneratedContent> {
  const c = getClient();
  const platformLines = input.platforms.map((p) => `- ${p}: ${PLATFORM_HINTS[p]}`).join("\n");
  const prompt = [
    `Konu / brief: ${input.topic}`,
    `Gönderi türü: ${input.kind}. ${KIND_HINTS[input.kind]}`,
    input.goal ? `Amaç: ${input.goal}` : "",
    input.tone ? `İstenen ton: ${input.tone}` : "",
    input.language ? `Dil: ${input.language}` : "",
    "Hedef platformlar ve kuralları:\n" + platformLines,
    input.extraInstructions ? `Ek talimat: ${input.extraInstructions}` : "",
    "Her platform için ayrı bir variant üret. Metinler kopyala-yapıştır hazır olsun.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const res = await c.messages.parse({
    model: config.ai.model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(GenerateSchema) },
    system: systemPrompt(),
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("Model bu isteği reddetti");
  if (!res.parsed_output) throw new Error("İçerik üretilemedi (boş yanıt)");
  return res.parsed_output;
}

/* ---------------- Metin iyileştirme ---------------- */

export async function improveText(text: string, instruction: string, platform?: ProviderId): Promise<string> {
  const c = getClient();
  const res = await c.messages.create({
    model: config.ai.model,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: systemPrompt("Sadece yeniden yazılmış metni döndür; açıklama, başlık, tırnak ekleme."),
    messages: [
      {
        role: "user",
        content: `Metin:\n${text}\n\nTalimat: ${instruction}${platform ? `\nPlatform kuralı: ${PLATFORM_HINTS[platform]}` : ""}`,
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("Model bu isteği reddetti");
  return textOf(res);
}

/* ---------------- DM yanıtı ---------------- */

const ReplySchema = z.object({
  reply: z.string().describe("Müşteriye gönderilecek yanıt metni; boş string ise yanıt verme"),
  intent: z.enum(["sales", "support", "complaint", "spam", "greeting", "other"]),
  handoff: z.boolean().describe("İnsan devralmalı mı (şikayet, öfke, karmaşık talep, fiyat pazarlığı, hukuki konu)"),
  confidence: z.number().min(0).max(1),
  summary: z.string().describe("Konuşmanın tek cümlelik özeti"),
});

export type DraftedReply = z.infer<typeof ReplySchema>;

export interface DraftReplyInput {
  platform: ProviderId;
  participantName: string | null;
  history: Message[];
  ruleInstructions?: string | null;
}

export async function draftReply(input: DraftReplyInput): Promise<DraftedReply> {
  const c = getClient();
  const s = settingsRepo.get();
  const history = input.history.slice(-20).map((m) => ({
    role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
    content: m.text || "[medya]",
  }));
  // Sıralamayı API için normalize et: ilk mesaj user olmalı ve ardışık aynı roller birleşmeli
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const h of history) {
    const last = merged[merged.length - 1];
    if (last && last.role === h.role) last.content += "\n" + h.content;
    else merged.push({ ...h });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  if (!merged.length) merged.push({ role: "user", content: "[boş mesaj]" });
  const transcript = merged.map((m) => `${m.role === "user" ? "MÜŞTERİ" : "BİZ"}: ${m.content}`).join("\n");

  const extra = [
    `Şu an bir müşteri ${input.platform} üzerinden DM yazıyor${input.participantName ? ` (adı: ${input.participantName})` : ""}.`,
    "Görev: konuşma geçmişine bakarak markanın sesiyle kısa, net, yardımcı bir yanıt yaz. 2-4 cümle. Emoji en fazla 1.",
    "Bilmediğin bilgi (stok, kargo süresi, fiyat) için uydurma; 'ekibimiz kısa sürede net bilgi verecek' de ve handoff=true işaretle.",
    "Spam/alakasız mesajlarda reply boş string bırak.",
    s.aiReplyInstructions ? `Panel talimatı: ${s.aiReplyInstructions}` : "",
    input.ruleInstructions ? `Kural talimatı: ${input.ruleInstructions}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await c.messages.parse({
    model: config.ai.model,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(ReplySchema) },
    system: systemPrompt(extra),
    messages: [{ role: "user", content: `Konuşma geçmişi (son mesaj müşterinin):\n${transcript}\n\nYanıtı üret.` }],
  });
  if (res.stop_reason === "refusal") return { reply: "", intent: "other", handoff: true, confidence: 0, summary: "Model yanıt üretmeyi reddetti" };
  if (!res.parsed_output) throw new Error("Yanıt üretilemedi");
  return res.parsed_output;
}

/* ---------------- Gelen kutusu özeti ---------------- */

export async function summarizeConversations(items: Array<{ name: string; platform: string; lastMessage: string; unread: number }>): Promise<string> {
  const c = getClient();
  const list = items.map((i, idx) => `${idx + 1}. [${i.platform}] ${i.name} (${i.unread} okunmamış): ${i.lastMessage}`).join("\n");
  const res = await c.messages.create({
    model: config.ai.model,
    max_tokens: 3000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: systemPrompt("Gelen kutusunu yöneticiye özetliyorsun. Madde madde: acil olanlar, satış fırsatları, şikayetler, geri kalan. Kısa ve eyleme dönük."),
    messages: [{ role: "user", content: `Konuşmalar:\n${list}` }],
  });
  return textOf(res);
}
