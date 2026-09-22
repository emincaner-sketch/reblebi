import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Proje kökü: server/src/core -> ../../..  (derlenmiş halde server/dist/core -> aynı derinlik)
const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, "..", "..", "..");

// .env önce proje kökünden, sonra server klasöründen okunur.
for (const candidate of [path.join(PROJECT_ROOT, ".env"), path.join(PROJECT_ROOT, "server", ".env")]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate, override: false });
}

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

const dataDir = resolveFromRoot(env("DATA_DIR", "./data"));
// Not: genel PORT degiskeni bilerek okunmaz (onizleme araclari onu web sunucusuna verir)
const port = Number(env("API_PORT", "4100"));

export const config = {
  port,
  publicUrl: env("PUBLIC_URL", "http://localhost:" + port).replace(/\/$/, ""),
  appSecret: env("APP_SECRET", "sosyalpilot-dev-secret-degistir-bunu-lutfen-32"),
  dataDir,
  mediaDir: path.join(dataDir, "media"),
  dbPath: path.join(dataDir, "sosyalpilot.db"),
  timezone: env("TZ", "Europe/Istanbul"),
  ai: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("AI_MODEL", "claude-opus-5"),
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
};

export type AppConfig = typeof config;

export function isSecure(): boolean {
  return config.publicUrl.startsWith("https://");
}

export function ensureDirs(): void {
  fs.mkdirSync(config.mediaDir, { recursive: true });
}
