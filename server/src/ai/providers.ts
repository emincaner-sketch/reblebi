import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../core/config.js";
import { decrypt } from "../core/crypto.js";
import { AppError } from "../core/i18n.js";
import { orgSettingsRepo } from "../core/repos/orgs.js";
import type { OrgSettings } from "../core/types.js";

/**
 * Takılabilir AI beyni.
 *  - anthropic: Claude (resmi SDK, yapılandırılmış çıktı + sunucu tarafı yedek model)
 *  - openai / xai (Grok) / gemini / openrouter / custom: OpenAI uyumlu /chat/completions uç noktası
 * Çalışma alanı kendi anahtarını getirebilir (BYOK); yoksa platform anahtarı kullanılır ve plan kotasından düşer.
 */

export type AiProviderKind = "anthropic" | "openai" | "xai" | "gemini" | "openrouter" | "custom";

export interface AiConfig {
  provider: AiProviderKind;
  model: string;
  apiKey: string;
  baseUrl: string | null;
  usingPlatformKey: boolean;
}

export const DEFAULT_MODELS: Record<AiProviderKind, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-5",
  xai: "grok-4",
  gemini: "gemini-2.5-pro",
  openrouter: "anthropic/claude-opus-5",
  custom: "",
};

const BASE_URLS: Record<Exclude<AiProviderKind, "anthropic" | "custom">, string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
};

function platformKeyFor(provider: AiProviderKind): string {
  switch (provider) {
    case "anthropic":
      return config.ai.apiKey;
    case "openai":
      return config.ai.openaiKey;
    case "xai":
      return config.ai.xaiKey;
    case "gemini":
      return config.ai.geminiKey;
    case "openrouter":
      return config.ai.openrouterKey;
    case "custom":
      return config.ai.customKey;
  }
}

function platformConfig(): AiConfig | null {
  const provider = (["anthropic", "openai", "xai", "gemini", "openrouter", "custom"].includes(config.ai.provider) ? config.ai.provider : "anthropic") as AiProviderKind;
  const apiKey = platformKeyFor(provider);
  if (!apiKey && provider !== "custom") return null;
  if (provider === "custom" && !config.ai.customBaseUrl) return null;
  return {
    provider,
    model: config.ai.model || DEFAULT_MODELS[provider],
    apiKey,
    baseUrl: provider === "custom" ? config.ai.customBaseUrl : provider === "anthropic" ? null : BASE_URLS[provider],
    usingPlatformKey: true,
  };
}

export function resolveAiConfig(orgId: string, settings: OrgSettings = orgSettingsRepo.get(orgId)): AiConfig | null {
  if (settings.aiProvider && settings.aiProvider !== "platform") {
    const provider = settings.aiProvider as AiProviderKind;
    let apiKey = "";
    try {
      apiKey = settings.aiApiKeyEnc ? decrypt(settings.aiApiKeyEnc) : "";
    } catch {
      apiKey = "";
    }
    if (!apiKey && provider !== "custom") return platformConfig();
    const baseUrl = provider === "custom" ? settings.aiBaseUrl || null : provider === "anthropic" ? null : BASE_URLS[provider];
    if (provider === "custom" && !baseUrl) return platformConfig();
    return { provider, model: settings.aiModel || DEFAULT_MODELS[provider], apiKey, baseUrl, usingPlatformKey: false };
  }
  return platformConfig();
}

export function aiAvailable(orgId: string): boolean {
  return resolveAiConfig(orgId) !== null;
}

export function platformAiAvailable(): boolean {
  return platformConfig() !== null;
}

/* ---------------- Çağrılar ---------------- */

export interface AiCall {
  system: string;
  user: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

const clients = new Map<string, Anthropic>();
function anthropicClient(apiKey: string): Anthropic {
  let c = clients.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey, maxRetries: 2, timeout: 5 * 60_000 });
    clients.set(apiKey, c);
  }
  return c;
}

/** Claude Opus 5 / Fable 5.x için sunucu tarafı yedek model (güvenlik reddinde otomatik yönlendirme) */
function supportsFallbacks(model: string): boolean {
  return model.startsWith("claude-opus-5") || model.startsWith("claude-fable-5");
}

function anthropicText(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function openAiCompatible(cfg: AiConfig, call: AiCall, json: boolean): Promise<string> {
  const url = `${(cfg.baseUrl ?? "").replace(/\/$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = config.publicUrl;
    headers["X-Title"] = config.appName;
  }
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: "system", content: call.system },
      { role: "user", content: call.user },
    ],
    max_tokens: call.maxTokens ?? 8000,
  };
  if (json) body.response_format = { type: "json_object" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60_000);
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${cfg.provider} ${res.status}: ${text.slice(0, 400)}`);
    const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }> };
    const choice = data.choices?.[0];
    if (choice?.message?.refusal) throw new AppError(422, "ai.refused");
    return (choice?.message?.content ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new AppError(502, "ai.bad_json");
  }
}

/** Şemaya uygun JSON üret. Claude'da yapılandırılmış çıktı, diğerlerinde JSON modu + doğrulama + bir onarım denemesi. */
export async function aiJson<S extends z.ZodType>(cfg: AiConfig, schema: S, call: AiCall): Promise<z.infer<S>> {
  if (cfg.provider === "anthropic") {
    const client = anthropicClient(cfg.apiKey);
    const fallback = supportsFallbacks(cfg.model);
    const res = await client.beta.messages.parse({
      model: cfg.model,
      max_tokens: call.maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: call.effort ?? "high", format: betaZodOutputFormat(schema) },
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: call.user }],
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (res.stop_reason === "refusal") throw new AppError(422, "ai.refused");
    if (res.parsed_output === null || res.parsed_output === undefined) throw new AppError(502, "ai.empty");
    return res.parsed_output as z.infer<S>;
  }

  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  const system = `${call.system}\n\nRespond ONLY with a single JSON object that matches this JSON Schema (no markdown, no commentary):\n${jsonSchema}`;
  let raw = await openAiCompatible(cfg, { ...call, system }, true);
  let parsed = schema.safeParse(extractJson(raw));
  if (!parsed.success) {
    // Tek onarım denemesi: hataları modele geri ver
    const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    raw = await openAiCompatible(cfg, { ...call, system, user: `${call.user}\n\nYour previous JSON was invalid (${issues}). Previous output:\n${raw}\n\nReturn corrected JSON only.` }, true);
    parsed = schema.safeParse(extractJson(raw));
    if (!parsed.success) throw new AppError(502, "ai.bad_json");
  }
  return parsed.data;
}

export async function aiText(cfg: AiConfig, call: AiCall): Promise<string> {
  if (cfg.provider === "anthropic") {
    const client = anthropicClient(cfg.apiKey);
    const fallback = supportsFallbacks(cfg.model);
    const res = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: call.maxTokens ?? 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: call.effort ?? "medium" },
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: call.user }],
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (res.stop_reason === "refusal") throw new AppError(422, "ai.refused");
    const out = anthropicText(res.content);
    if (!out) throw new AppError(502, "ai.empty");
    return out;
  }
  const out = await openAiCompatible(cfg, call, false);
  if (!out) throw new AppError(502, "ai.empty");
  return out;
}

/** Ayarlar sayfasındaki "bağlantıyı test et" düğmesi */
export async function testAi(cfg: AiConfig): Promise<{ ok: boolean; detail: string }> {
  try {
    const out = await aiText(cfg, { system: "You are a connectivity check.", user: "Reply with exactly: OK", maxTokens: 50, effort: "low" });
    return { ok: /ok/i.test(out), detail: `${cfg.provider} · ${cfg.model} → ${out.slice(0, 60)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
