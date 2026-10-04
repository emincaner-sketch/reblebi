/**
 * Ön-render için genel yapılandırma anlık görüntüsü: src/generated/public-config.json
 * Plan fiyat ve limitleri sunucunun tek kaynağından (server/src/core/plans.ts) okunur, böylece
 * landing'deki fiyatlar paneldeki planlarla birebir aynı kalır. Tarayıcı açılınca /api/public/config
 * ile canlı değerler yeniden çekilir (PLANS_JSON, TRIAL_DAYS gibi çalışma zamanı ayarları oradan gelir).
 *
 * .env bilerek okunmaz: derleme çıktısı yerel makinede ve Docker'da aynı olmalı.
 * Kullanım: npx tsx scripts/snapshot.ts  (npm run build bunu kendisi çalıştırır)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicPlans } from "../../server/src/core/plans";
import { SITE_NAME, SITE_URL } from "../src/config/site";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "src", "generated", "public-config.json");

const env = (k: string, d: string) => (process.env[k] ? String(process.env[k]) : d);
const mode = env("SIGNUP_MODE", "open");

const snapshot = {
  appName: SITE_NAME,
  signupMode: ["open", "invite", "closed"].includes(mode) ? mode : "open",
  trialDays: Number(env("TRIAL_DAYS", "14")) || 0,
  trialPlan: env("TRIAL_PLAN", "pro"),
  supportEmail: env("SUPPORT_EMAIL", ""),
  companyName: env("COMPANY_NAME", ""),
  companyAddress: env("COMPANY_ADDRESS", ""),
  publicUrl: SITE_URL,
  mcpUrl: `${SITE_URL}/mcp`,
  plans: publicPlans(),
};

fs.mkdirSync(path.dirname(out), { recursive: true });
const json = JSON.stringify(snapshot, null, 2) + "\n";
if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== json) fs.writeFileSync(out, json);
console.log(`snapshot: ${snapshot.plans.map((p) => `${p.id} $${p.priceMonthly}`).join(", ")} · deneme ${snapshot.trialDays} gün`);
