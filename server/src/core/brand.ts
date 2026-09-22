import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { settingsRepo } from "./repos/misc.js";

/**
 * Marka hafızası: sistemler/marka-hafizasi/hafiza altındaki markdown dosyaları (varsa)
 * + paneldeki marka ayarları. AI üretimlerinde sistem promptuna eklenir.
 */
export interface BrandContext {
  text: string;
  sources: string[];
}

function readIfExists(p: string): string | null {
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  } catch {
    /* yoksay */
  }
  return null;
}

/** Şablon dosyalarında doldurulmamış örnek satırları ayıkla (çok kaba: "Örnek:" ve "<...>" satırları) */
function stripTemplateNoise(md: string): string {
  return md
    .split("\n")
    .filter((line) => !/^\s*>/.test(line) && !/Örnek:/i.test(line) && !/<[^>]+>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function loadBrandContext(): BrandContext {
  const sources: string[] = [];
  const parts: string[] = [];
  const s = settingsRepo.get();

  const panel: string[] = [];
  if (s.brandName) panel.push(`Marka adı: ${s.brandName}`);
  if (s.brandAudience) panel.push(`Hedef kitle: ${s.brandAudience}`);
  if (s.brandOffers) panel.push(`Teklifler / ürünler:\n${s.brandOffers}`);
  if (s.brandVoice) panel.push(`Ses tonu: ${s.brandVoice}`);
  if (s.brandBannedWords) panel.push(`YASAK kelimeler ve kalıplar (asla kullanma): ${s.brandBannedWords}`);
  if (s.brandExamples) panel.push(`Markanın kendi sesinden örnek cümleler:\n${s.brandExamples}`);
  if (panel.length) {
    parts.push("## Panelde tanımlı marka bilgileri\n" + panel.join("\n"));
    sources.push("panel");
  }

  if (config.ai.brandMemoryDir) {
    const files = ["01-marka-kimlik.md", "02-ses.md", "03-kararlar.md"];
    for (const f of files) {
      const raw = readIfExists(path.join(config.ai.brandMemoryDir, f));
      if (!raw) continue;
      // Doldurulmamış şablon (çok sayıda <...> yer tutucu) ise atla
      if ((raw.match(/<[^>\n]+>/g) ?? []).length >= 3) continue;
      const cleaned = stripTemplateNoise(raw);
      // Sadece başlıklardan ibaretse (şablon doldurulmamış) atla
      const meaningful = cleaned.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
      if (meaningful < 3) continue;
      parts.push(cleaned);
      sources.push(f);
    }
    // Hook kalıpları (carousel-uretici sistemi) varsa ekle
    const hooks = readIfExists(path.join(config.ai.brandMemoryDir, "..", "..", "carousel-uretici", "format", "hook-kaliplari.md"));
    if (hooks) {
      parts.push("## Hook (kanca) kalıpları\n" + hooks.slice(0, 6000));
      sources.push("hook-kaliplari.md");
    }
  }

  return { text: parts.join("\n\n"), sources };
}
