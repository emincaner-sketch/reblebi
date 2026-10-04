/**
 * Marka görsellerini üretir (bir kez çalıştırılır, çıktı public/ altında depoya girer):
 *   public/og/og-home.png, public/og/og-en.png   1200x630 paylaşım görselleri
 *   public/logo-512.png                          JSON-LD Organization logosu
 *   public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, favicon-48.png, favicon.ico
 *
 * Bağımlılıklar projede yok (Docker derlemesini şişirmesin). Çalıştırmak için:
 *   npm i --no-save satori @resvg/resvg-js @fontsource/inter @fontsource/bricolage-grotesque && node web/scripts/brand-assets.mjs
 * OG görselleri giriş sayfasının görsel diliyle aynı (web/BRAND_DECISIONS.md §9–10: açık zemin, Bricolage başlık, leblebi tanesi).
 * İşaretin çizimi src/components/Logo.tsx ve public/favicon.svg ile aynı.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { siFacebook, siInstagram, siTelegram, siThreads, siTiktok, siWhatsapp, siX, siYoutube } from "simple-icons";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pub = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, "..", "public");

const MARK = (size, { rounded = true, pad = 0, bg = true } = {}) => {
  const s = 32 / (1 - pad * 2);
  const o = -(s - 32) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${o} ${o} ${s} ${s}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8B7DFF"/><stop offset="1" stop-color="#5B49F2"/></linearGradient></defs>${
    bg ? `<rect x="${o}" y="${o}" width="${s}" height="${s}" rx="${rounded ? 9 * (s / 32) : 0}" fill="url(#g)"/>` : ""
  }<path d="M9.2 22.4V15.8c0-3.5 2.5-6 6-6" stroke="#fff" stroke-width="4.4" stroke-linecap="round" fill="none"/><circle cx="21.7" cy="11" r="3.3" fill="#fff"/></svg>`;
};

const png = (svg, width) => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
const out = (rel, buf) => {
  const f = path.join(pub, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  console.log(`${rel}  ${(buf.length / 1024).toFixed(1)} KB`);
};

/* ---------- İkonlar ---------- */
out("logo-512.png", png(MARK(512), 512));
out("icon-512.png", png(MARK(512), 512));
out("icon-192.png", png(MARK(192), 192));
out("favicon-48.png", png(MARK(48), 48));
// iOS köşeleri kendisi yuvarlar; maskelenebilir ikonda işaret güvenli alanda (%20 kenar payı)
out("apple-touch-icon.png", png(MARK(180, { rounded: false }), 180));
out("icon-maskable-512.png", png(MARK(512, { rounded: false, pad: 0.12 }), 512));
// favicon.ico: içine 48px PNG gömülü tek görüntülü ICO
{
  const p = png(MARK(48), 48);
  const h = Buffer.alloc(22);
  h.writeUInt16LE(0, 0);
  h.writeUInt16LE(1, 2);
  h.writeUInt16LE(1, 4);
  h.writeUInt8(48, 6);
  h.writeUInt8(48, 7);
  h.writeUInt8(0, 8);
  h.writeUInt8(0, 9);
  h.writeUInt16LE(1, 10);
  h.writeUInt16LE(32, 12);
  h.writeUInt32LE(p.length, 14);
  h.writeUInt32LE(22, 18);
  out("favicon.ico", Buffer.concat([h, p]));
}

/* ---------- OG görselleri ---------- */
const font = (pkg, w, sub) => fs.readFileSync(require.resolve(`@fontsource/${pkg}/files/${pkg}-${sub}-${w}-normal.woff`));
// latin-ext ayrı aile adıyla: satori eksik harfi (ğ, ş, İ) yalnızca font-family listesindeki sonraki aileden alır
const fonts = [
  ...[400, 600].flatMap((w) => [
    { name: "Inter", data: font("inter", w, "latin"), weight: w, style: "normal" },
    { name: "InterExt", data: font("inter", w, "latin-ext"), weight: w, style: "normal" },
  ]),
  { name: "Bricolage", data: font("bricolage-grotesque", 700, "latin"), weight: 700, style: "normal" },
  { name: "BricolageExt", data: font("bricolage-grotesque", 700, "latin-ext"), weight: 700, style: "normal" },
];
// src/site/site.css token'ları
const C = { canvas: "#F6F2EA", surface: "#FFFDF8", ink: "#1A1726", muted: "#5E5970", subtle: "#E3DCCF", primary: "#5B49F2", primarySoft: "#ECE9FE", accent: "#D9A441" };

const LINKEDIN = "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";
// Platform simgeleri gerçek marka renginde; siyah logolu markalar mürekkep rengiyle (açık zemin)
const icons = [siInstagram, siFacebook, siThreads, siWhatsapp, siX, { path: LINKEDIN, hex: "0A66C2" }, siTiktok, siYoutube, siTelegram];
const svgUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const iconUri = (i) => svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${i.hex === "000000" ? C.ink : `#${i.hex}`}" d="${i.path}"/></svg>`);

const el = (type, style, children) => ({ type, props: { style, children } });

/** Başlıktaki son nokta, sayfadaki gibi leblebi tanesiyle çizilir */
function og({ title, sub, badge }) {
  // Kelime kelime sarılır; nokta son kelimeye bağlı kalır (alt satıra tek başına düşmez)
  const words = title.replace(/\.$/, "").split(" ");
  const last = words.pop();
  return el(
    "div",
    { width: 1200, height: 630, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "60px 72px", background: C.canvas, fontFamily: "Inter, InterExt", color: C.ink },
    [
      el("div", { display: "flex", alignItems: "center", justifyContent: "space-between" }, [
        el("div", { display: "flex", alignItems: "center", gap: 18 }, [
          { type: "img", props: { src: svgUri(MARK(60)), width: 60, height: 60 } },
          el("div", { fontFamily: "Bricolage, BricolageExt", fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em" }, "Reblebi"),
        ]),
        el("div", { display: "flex", padding: "10px 22px", borderRadius: 999, background: C.primarySoft, color: C.primary, fontSize: 24, fontWeight: 600 }, badge),
      ]),
      el("div", { display: "flex", flexDirection: "column", gap: 22 }, [
        el("div", { display: "flex", flexWrap: "wrap", fontFamily: "Bricolage, BricolageExt", fontSize: 88, fontWeight: 700, lineHeight: 1.0, letterSpacing: "-0.04em", maxWidth: 1000 }, [
          ...words.map((w) => el("span", { marginRight: 22 }, w)),
          el("div", { display: "flex", alignItems: "flex-end" }, [el("span", {}, last), el("div", { width: 18, height: 18, borderRadius: 999, background: C.accent, marginLeft: 6, marginBottom: 14 }, "")]),
        ]),
        el("div", { fontSize: 32, color: C.muted, lineHeight: 1.4, maxWidth: 940 }, sub),
      ]),
      el("div", { display: "flex", alignItems: "center", justifyContent: "space-between" }, [
        el(
          "div",
          { display: "flex", gap: 12 },
          icons.map((i) => el("div", { display: "flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 16, background: C.surface, border: `1px solid ${C.subtle}` }, [{ type: "img", props: { src: iconUri(i), width: 28, height: 28 } }])),
        ),
        el("div", { fontSize: 28, fontWeight: 600, color: C.primary }, "reblebi.com"),
      ]),
    ],
  );
}

// Metinler src/site/data/site-content.ts (hero) ve src/seo/meta.ts (ogTitle) ile aynı
for (const [file, copy] of [
  ["og/og-home.png", { title: "Bir kez yaz, dokuz platformda yayında.", sub: "Planla, yayınla, gelen mesajları tek kutuda yanıtla. Claude ve ChatGPT bağlantısı.", badge: "9 platform · resmî API'ler" }],
  ["og/og-en.png", { title: "Write once. Publish on nine platforms.", sub: "Plan, publish and answer messages from one inbox. Works with Claude and ChatGPT.", badge: "9 platforms · official APIs" }],
]) {
  const svg = await satori(og(copy), { width: 1200, height: 630, fonts });
  out(file, png(svg, 1200));
}
