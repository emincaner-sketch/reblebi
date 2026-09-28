/**
 * Çeviri kapsamı kontrolü: kaynaktaki tüm t("...") metinlerinin İngilizce karşılığı var mı?
 * Kullanım: npx tsx scripts/i18n-check.ts [--write-missing eksik.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EN } from "../src/lib/en";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "src");
const files: string[] = [];
(function walk(d: string) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(f) && !p.endsWith(path.join("lib", "en.ts"))) files.push(p);
  }
})(src);

const keys = new Map<string, string>();
// t("...") ve t('...') çağrıları; ayrıca etiket tablolarındaki (KIND/STATUS/ROLE...) değerler useLabels ile t()'den geçer
const callRe = /\bt\(\s*"((?:[^"\\]|\\.)*)"|\bt\(\s*'((?:[^'\\]|\\.)*)'/g;
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(s))) {
    const raw = m[1] ?? m[2];
    const key = m[1] !== undefined ? (JSON.parse(`"${raw}"`) as string) : raw.replace(/\\'/g, "'").replace(/\\n/g, "\n");
    if (!keys.has(key)) keys.set(key, path.relative(src, f));
  }
}
// i18n.tsx etiket tabloları
const i18nSrc = fs.readFileSync(path.join(src, "lib", "i18n.tsx"), "utf8");
for (const m of i18nSrc.matchAll(/:\s*"([^"]+)"/g)) if (/[a-zçğıöşü]/i.test(m[1]) && !/^[a-z]{2}(-[A-Z]{2})?$/.test(m[1]) && !keys.has(m[1])) keys.set(m[1], "lib/i18n.tsx");

const missing = [...keys.entries()].filter(([k]) => !(k in EN));
const unused = Object.keys(EN).filter((k) => !keys.has(k));
console.log(`anahtar: ${keys.size} · sözlük: ${Object.keys(EN).length} · eksik: ${missing.length} · kullanılmayan: ${unused.length}`);
const out = process.argv.indexOf("--write-missing");
if (out > -1) fs.writeFileSync(process.argv[out + 1], JSON.stringify(Object.fromEntries(missing.map(([k, f]) => [k, f])), null, 1));
else for (const [k, f] of missing) console.log(`  [${f}] ${JSON.stringify(k)}`);
process.exitCode = missing.length ? 1 : 0;
