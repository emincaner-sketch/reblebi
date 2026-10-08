/**
 * Bahsetme kaynaklarını gerçek internette dener (geçici veritabanı; hiçbir şey kaydedilmez).
 * npx tsx server/scripts/listening-smoke.ts "terim" [tr|en|any]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sp-listen-smoke-"));
const term = process.argv[2] ?? "Galatasaray";
const lang = (process.argv[3] ?? "tr") as "tr" | "en" | "any";

const { FETCHERS } = await import("../src/services/listening-sources.js");
const q = { id: "smoke", orgId: "smoke", name: "smoke", terms: [term], excludes: [], sources: [], lang, enabled: true, notify: false, aiSentiment: false, state: {}, lastRunAt: null, createdAt: "", updatedAt: "" };
const since = Date.now() - 3 * 86_400_000;
for (const src of ["news", "bluesky", "hn"] as const) {
  const t0 = Date.now();
  try {
    const r = await FETCHERS[src](q, since);
    const items = Array.isArray(r) ? r : r.items;
    const warning = Array.isArray(r) ? undefined : r.warning;
    console.log(`${src}: ${items.length} sonuç (${Date.now() - t0} ms)${warning ? ` · uyarı: ${warning}` : ""}`);
    for (const m of items.slice(0, 3)) console.log(`   - [${m.site}] ${(m.title ?? m.snippet ?? "").slice(0, 90)} · ${m.publishedAt}`);
  } catch (e) {
    console.log(`${src}: HATA ${e instanceof Error ? e.message : e}`);
  }
}
process.exit(0);
