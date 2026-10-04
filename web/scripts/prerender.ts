/**
 * Ön-render: herkese açık sayfaları (seo/routes.ts) statik HTML'e çevirir ve SEO dosyalarını üretir.
 *   dist/index.html, dist/en/index.html, dist/fiyatlar/index.html ...  -> içerik + sayfaya özel <head>
 *   dist/404.html, dist/404-en.html -> bilinmeyen adresler (sunucu 404 koduyla verir, noindex)
 *   dist/app.html   -> panel, giriş, kayıt için boş kabuk (noindex)
 *   dist/sitemap.xml -> hreflang alternatifleriyle
 * Çalıştırma: npm run build (vite build + vite build --ssr sonrasında)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import snapshot from "../src/generated/public-config.json";
import type { PublicConfig } from "../src/lib/api";
import { SITE_URL } from "../src/config/site";
import { headHtml, notFoundMeta, pageMeta, privateMeta, type HeadMeta } from "../src/seo/meta";
import { PAGE_PATHS, PAGE_PRIORITY, PUBLIC_ROUTES, type PageKey } from "../src/seo/routes";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");
const ssrDir = path.join(here, "..", "dist-ssr");
const cfg = snapshot as PublicConfig;

const template = fs.readFileSync(path.join(dist, "index.html"), "utf8");
if (!template.includes("<!--app-head-->") || !template.includes("<!--app-html-->")) throw new Error("index.html yer tutucuları (<!--app-head-->, <!--app-html-->) bulunamadı");

const entry = fs.readdirSync(ssrDir).find((f) => /^entry-server\.(m?js)$/.test(f));
if (!entry) throw new Error("dist-ssr/entry-server.js yok: önce vite build --ssr çalışmalı");
const { render } = (await import(pathToFileURL(path.join(ssrDir, entry)).href)) as { render: (url: string) => string };

function page(meta: HeadMeta, body: string): string {
  return template
    .replace('<html lang="tr">', `<html lang="${meta.lang}">`)
    .replace("<!--app-head-->", headHtml(meta).trimStart())
    .replace("<!--app-html-->", body);
}

function write(rel: string, html: string): void {
  const file = path.join(dist, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

const warnings: string[] = [];
for (const r of PUBLIC_ROUTES) {
  const meta = pageMeta(r.key, r.locale, cfg);
  if (meta.title.length > 60) warnings.push(`${r.path}: başlık ${meta.title.length} karakter (en fazla 60)`);
  if (meta.description.length > 155) warnings.push(`${r.path}: açıklama ${meta.description.length} karakter (en fazla 155)`);
  const html = render(r.path);
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) warnings.push(`${r.path}: ${h1} adet H1 (1 olmalı)`);
  write(r.path === "/" ? "index.html" : `${r.path.slice(1)}/index.html`, page(meta, html));
}

write("404.html", page(notFoundMeta("tr"), render("/__404")));
write("404-en.html", page(notFoundMeta("en"), render("/en/__404")));
// Panel kabuğu: içerik yok, istemci kendisi çizer
write("app.html", template.replace("<!--app-head-->", headHtml(privateMeta("tr")).trimStart()).replace("<!--app-html-->", ""));

/* ---------- sitemap.xml ---------- */
const today = new Date().toISOString().slice(0, 10);
const abs = (p: string) => (p === "/" ? `${SITE_URL}/` : `${SITE_URL}${p}`);
const urls = PUBLIC_ROUTES.map((r) => {
  const alt = (["tr", "en"] as const).map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${abs(PAGE_PATHS[r.key][l])}" />`);
  alt.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(PAGE_PATHS[r.key].tr)}" />`);
  return `  <url>\n    <loc>${abs(r.path)}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${PAGE_PRIORITY[r.key as PageKey]}</priority>\n${alt.join("\n")}\n  </url>`;
});
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`);

fs.rmSync(ssrDir, { recursive: true, force: true });
console.log(`ön-render: ${PUBLIC_ROUTES.length} sayfa + 404 + app kabuğu + sitemap.xml`);

/* ---------- Önceden sıkıştırma ----------
 * Sunucu (@fastify/static preCompressed) tarayıcı destekliyorsa .br / .gz kopyayı verir; istek başına CPU harcanmaz.
 * Railway gibi önünde sıkıştıran vekil olmayan ortamlarda metin dosyaları ~4 kat küçülür. */
const COMPRESS = /\.(html|js|css|svg|xml|txt|json|webmanifest|ico)$/;
let saved = 0;
const walk = (dir: string) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(f);
    else if (COMPRESS.test(ent.name)) {
      const buf = fs.readFileSync(f);
      if (buf.length < 1024) continue;
      const br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      fs.writeFileSync(`${f}.br`, br);
      fs.writeFileSync(`${f}.gz`, zlib.gzipSync(buf, { level: 9 }));
      saved += buf.length - br.length;
    }
  }
};
walk(dist);
console.log(`sıkıştırma: .br/.gz kopyalar hazır (brotli ile ${(saved / 1024).toFixed(0)} KB daha az aktarım)`);
for (const w of warnings) console.warn(`  uyarı: ${w}`);
if (warnings.some((w) => w.includes("H1"))) process.exitCode = 1;
