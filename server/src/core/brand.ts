import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { orgSettingsRepo, orgsRepo } from "./repos/orgs.js";

/**
 * Marka hafızası: çalışma alanının panelde girdiği marka bilgileri.
 * Kurulumu yapan (süper admin) çalışma alanı için ek olarak BRAND_MEMORY_DIR klasöründeki
 * markdown dosyaları da okunur (sistemler/marka-hafizasi/hafiza).
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

/** Şablon dosyalarında doldurulmamış örnek satırları ayıkla */
function stripTemplateNoise(md: string): string {
  return md
    .split("\n")
    .filter((line) => !/^\s*>/.test(line) && !/Örnek:/i.test(line) && !/<[^>]+>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function loadBrandContext(orgId: string): BrandContext {
  const sources: string[] = [];
  const parts: string[] = [];
  const s = orgSettingsRepo.get(orgId);
  const org = orgsRepo.get(orgId);

  const panel: string[] = [];
  if (s.brandName) panel.push(`Brand name: ${s.brandName}`);
  if (s.brandAudience) panel.push(`Target audience: ${s.brandAudience}`);
  if (s.brandOffers) panel.push(`Offers / products:\n${s.brandOffers}`);
  if (s.brandVoice) panel.push(`Voice & tone: ${s.brandVoice}`);
  if (s.brandBannedWords) panel.push(`BANNED words and patterns (never use): ${s.brandBannedWords}`);
  if (s.brandExamples) panel.push(`Example sentences in the brand's own voice:\n${s.brandExamples}`);
  if (panel.length) {
    parts.push("## Brand profile\n" + panel.join("\n"));
    sources.push("panel");
  }

  // Dosya tabanlı marka hafızası sadece varsayılan (kurulum) çalışma alanı içindir
  if (config.ai.brandMemoryDir && (orgId === "org_default" || org?.plan === "unlimited")) {
    for (const f of ["01-marka-kimlik.md", "02-ses.md", "03-kararlar.md"]) {
      const raw = readIfExists(path.join(config.ai.brandMemoryDir, f));
      if (!raw) continue;
      if ((raw.match(/<[^>\n]+>/g) ?? []).length >= 3) continue; // doldurulmamış şablon
      const cleaned = stripTemplateNoise(raw);
      const meaningful = cleaned.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
      if (meaningful < 3) continue;
      parts.push(cleaned);
      sources.push(f);
    }
    const hooks = readIfExists(path.join(config.ai.brandMemoryDir, "..", "..", "carousel-uretici", "format", "hook-kaliplari.md"));
    if (hooks) {
      parts.push("## Hook patterns\n" + hooks.slice(0, 6000));
      sources.push("hook-kaliplari.md");
    }
  }

  return { text: parts.join("\n\n"), sources };
}
