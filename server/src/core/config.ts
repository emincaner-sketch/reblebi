import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Proje kökü: server/src/core -> ../../..  (derlenmiş halde server/dist/core -> aynı derinlik)
const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, "..", "..", "..");

// .env önce proje kökünden, sonra server klasöründen okunur.
for (const candidate of [path.join(PROJECT_ROOT, ".env"), path.join(PROJECT_ROOT, "server", ".env")]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate, override: false, quiet: true } as dotenv.DotenvConfigOptions);
}

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envInt(name: string, fallback: number): number {
  const n = Number(env(name, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

const dataDir = resolveFromRoot(env("DATA_DIR", "./data"));
// Not: genel PORT degiskeni bilerek okunmaz (onizleme araclari onu web sunucusuna verir)
const port = envInt("API_PORT", 4100);
// PUBLIC_URL verilmezse: Railway'in atadığı alan adı, o da yoksa yerel adres
const defaultPublicUrl = env("RAILWAY_PUBLIC_DOMAIN") ? "https://" + env("RAILWAY_PUBLIC_DOMAIN") : "http://localhost:" + port;

export type SignupMode = "open" | "invite" | "closed";

export const config = {
  appName: env("APP_NAME", "SosyalPilot"),
  port,
  publicUrl: env("PUBLIC_URL", defaultPublicUrl).replace(/\/$/, ""),
  /** Geliştirmede panel ayrı porttan (5173) çalışır; e-posta linkleri buraya gider */
  appUrl: env("APP_URL", env("PUBLIC_URL", defaultPublicUrl)).replace(/\/$/, ""),
  appSecret: env("APP_SECRET", "sosyalpilot-dev-secret-degistir-bunu-lutfen-32"),
  dataDir,
  mediaDir: path.join(dataDir, "media"),
  backupDir: path.join(dataDir, "backups"),
  dbPath: path.join(dataDir, "sosyalpilot.db"),
  timezone: env("TZ", "Europe/Istanbul"),
  defaultLocale: (env("DEFAULT_LOCALE", "tr") === "en" ? "en" : "tr") as "tr" | "en",

  saas: {
    signupMode: (["open", "invite", "closed"].includes(env("SIGNUP_MODE", "open")) ? env("SIGNUP_MODE", "open") : "open") as SignupMode,
    trialDays: envInt("TRIAL_DAYS", 14),
    trialPlan: env("TRIAL_PLAN", "pro"),
    /** Virgülle ayrılmış e-postalar: kaydolunca otomatik süper admin olur */
    superadminEmails: env("SUPERADMIN_EMAILS")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    requireEmailVerification: env("REQUIRE_EMAIL_VERIFICATION", "false") === "true",
    supportEmail: env("SUPPORT_EMAIL", ""),
    companyName: env("COMPANY_NAME", ""),
    companyAddress: env("COMPANY_ADDRESS", ""),
  },

  mail: {
    host: env("SMTP_HOST"),
    port: envInt("SMTP_PORT", 587),
    secure: env("SMTP_SECURE", "false") === "true",
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    from: env("MAIL_FROM", "SosyalPilot <no-reply@localhost>"),
  },

  ai: {
    /** Platform varsayılan sağlayıcısı: anthropic | openai | xai | gemini | openrouter | custom */
    provider: env("AI_PROVIDER", "anthropic"),
    model: env("AI_MODEL", ""),
    apiKey: env("ANTHROPIC_API_KEY"),
    openaiKey: env("OPENAI_API_KEY"),
    xaiKey: env("XAI_API_KEY"),
    geminiKey: env("GEMINI_API_KEY"),
    openrouterKey: env("OPENROUTER_API_KEY"),
    customBaseUrl: env("AI_CUSTOM_BASE_URL"),
    customKey: env("AI_CUSTOM_API_KEY"),
    brandMemoryDir: env("BRAND_MEMORY_DIR") ? resolveFromRoot(env("BRAND_MEMORY_DIR")) : "",
  },

  meta: {
    appId: env("META_APP_ID"),
    appSecret: env("META_APP_SECRET"),
    graphVersion: env("META_GRAPH_VERSION", "v21.0"),
    webhookVerifyToken: env("META_WEBHOOK_VERIFY_TOKEN", "sosyalpilot-verify"),
  },
  threads: { appId: env("THREADS_APP_ID"), appSecret: env("THREADS_APP_SECRET") },
  x: { clientId: env("X_CLIENT_ID"), clientSecret: env("X_CLIENT_SECRET") },
  linkedin: { clientId: env("LINKEDIN_CLIENT_ID"), clientSecret: env("LINKEDIN_CLIENT_SECRET") },
  tiktok: { clientKey: env("TIKTOK_CLIENT_KEY"), clientSecret: env("TIKTOK_CLIENT_SECRET") },
  google: { clientId: env("GOOGLE_CLIENT_ID"), clientSecret: env("GOOGLE_CLIENT_SECRET") },

  security: {
    /** Panel dışındaki kökenlerden gelen çerezli istekleri reddet (CSRF) */
    extraOrigins: env("ALLOWED_ORIGINS")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean),
    rateLimitPerMinute: envInt("RATE_LIMIT_PER_MINUTE", 300),
  },

  backup: {
    enabled: env("BACKUP_ENABLED", "true") === "true",
    keep: envInt("BACKUP_KEEP", 7),
  },
};

export type AppConfig = typeof config;

export function isSecure(): boolean {
  return config.publicUrl.startsWith("https://");
}

export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function ensureDirs(): void {
  fs.mkdirSync(config.mediaDir, { recursive: true });
  fs.mkdirSync(config.backupDir, { recursive: true });
}

/** Güvenli olmayan varsayılanlarla üretimde çalışmayı engelle */
export function assertProductionSafety(): string[] {
  const warnings: string[] = [];
  if (config.appSecret.includes("degistir-bunu") || config.appSecret.length < 32) {
    warnings.push("APP_SECRET varsayılan ya da 32 karakterden kısa. Token şifrelemesi güvensiz.");
  }
  if (!isSecure()) warnings.push("PUBLIC_URL https değil. OAuth, webhook ve medya çekme çalışmaz.");
  return warnings;
}
