import { AppError, notFound } from "../core/i18n.js";
import { randomId } from "../core/crypto.js";
import { config } from "../core/config.js";
import { bioRepo, DEFAULT_THEME, RESERVED_SLUGS, type BioGridItem, type BioLink, type BioPage, type BioPatch, type BioSocial, type BioTheme } from "../core/repos/bio.js";
import { mediaRepo, postMetricsRepo } from "../core/repos/misc.js";
import { orgsRepo } from "../core/repos/orgs.js";
import { postsRepo } from "../core/repos/posts.js";
import type { Ctx, Locale } from "../core/types.js";
import { requireRole } from "./access.js";
import { BIO_ICONS } from "./bio-icons.js";

/**
 * Link in bio (Metricool SmartLinks karşılığı): /l/:slug adresinde sunucuda çizilen, JavaScript'siz hafif sayfa.
 * Sayaçlar günlük ve kaynak bazında toplanır; IP, çerez ya da cihaz kimliği saklanmaz.
 */

const DAY = 86_400_000;
export const BIO_PATH = "/l/";

export function bioUrl(slug: string): string {
  return `${config.appUrl}${BIO_PATH}${slug}`;
}

/* ---------------- Doğrulama ---------------- */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function checkSlug(slug: string, exceptId?: string): "ok" | "invalid" | "reserved" | "taken" {
  const s = slug.trim().toLowerCase();
  if (!SLUG_RE.test(s) || s.includes("--")) return "invalid";
  if (RESERVED_SLUGS.has(s)) return "reserved";
  if (bioRepo.slugTaken(s, exceptId)) return "taken";
  return "ok";
}

function assertSlug(slug: string, exceptId?: string): string {
  const r = checkSlug(slug, exceptId);
  if (r !== "ok") throw new AppError(400, `bio.slug_${r}`);
  return slug.trim().toLowerCase();
}

/** Yalnızca http(s), mailto ve tel; şemasız alan adına https eklenir. javascript:, data: vb. reddedilir. */
export function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^(mailto|tel):/i.test(v)) return v.length <= 500 ? v : null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

function cleanLinks(links: BioLink[]): BioLink[] {
  return links.slice(0, 50).map((l) => {
    const url = normalizeUrl(l.url);
    if (!url) throw new AppError(400, "bio.bad_url", { url: l.url.slice(0, 80) });
    return { id: l.id || randomId("lnk"), label: l.label.trim().slice(0, 80), url, enabled: l.enabled !== false };
  });
}

function cleanSocials(socials: BioSocial[]): BioSocial[] {
  return socials
    .filter((s) => BIO_ICONS[s.network])
    .slice(0, 12)
    .map((s) => {
      const url = s.network === "email" && !/^mailto:/i.test(s.url) && s.url.includes("@") ? normalizeUrl(`mailto:${s.url.trim()}`) : normalizeUrl(s.url);
      if (!url) throw new AppError(400, "bio.bad_url", { url: s.url.slice(0, 80) });
      return { network: s.network, url };
    });
}

function cleanGrid(orgId: string, grid: BioGridItem[]): BioGridItem[] {
  return grid.slice(0, 60).map((g) => {
    if (!postsRepo.get(orgId, g.postId)) throw notFound("post");
    const url = normalizeUrl(g.url);
    if (!url) throw new AppError(400, "bio.bad_url", { url: g.url.slice(0, 80) });
    return { id: g.id || randomId("grd"), postId: g.postId, url };
  });
}

const HEX = /^#[0-9a-f]{6}$/i;
function cleanTheme(t: Partial<BioTheme>): BioTheme {
  return {
    accent: t.accent && HEX.test(t.accent) ? t.accent.toLowerCase() : DEFAULT_THEME.accent,
    background: t.background === "light" || t.background === "dark" || t.background === "cream" ? t.background : DEFAULT_THEME.background,
    buttons: t.buttons === "pill" || t.buttons === "square" || t.buttons === "rounded" ? t.buttons : DEFAULT_THEME.buttons,
  };
}

/* ---------------- Panel işlemleri ---------------- */

export function listBioPages(ctx: Ctx): Array<BioPage & { url: string; last30: { views: number; clicks: number } }> {
  const org = orgsRepo.get(ctx.orgId)!;
  const to = localYmd(Date.now(), org.timezone);
  const from = addDays(to, -29);
  return bioRepo.list(ctx.orgId).map((p) => {
    const ev = bioRepo.events(p.id, from, to);
    return { ...p, url: bioUrl(p.slug), last30: { views: sum(ev.filter((e) => !e.linkId)), clicks: sum(ev.filter((e) => e.linkId)) } };
  });
}

export function createBioPage(ctx: Ctx, input: { slug: string; title: string; bio?: string | null }): BioPage {
  requireRole(ctx, "editor");
  if (bioRepo.list(ctx.orgId).length >= 10) throw new AppError(400, "bio.too_many");
  const slug = assertSlug(input.slug);
  return bioRepo.create(ctx.orgId, { slug, title: input.title.trim().slice(0, 80), bio: input.bio?.trim().slice(0, 300) || null });
}

export function updateBioPage(ctx: Ctx, id: string, patch: Omit<BioPatch, "theme"> & { theme?: Partial<BioTheme> }): BioPage {
  requireRole(ctx, "editor");
  const page = bioRepo.get(ctx.orgId, id);
  if (!page) throw notFound("bio");
  const next: BioPatch = {
    slug: patch.slug !== undefined && patch.slug !== page.slug ? assertSlug(patch.slug, id) : undefined,
    title: patch.title?.trim().slice(0, 80) || undefined,
    bio: patch.bio === undefined ? undefined : patch.bio?.trim().slice(0, 300) || null,
    avatarUrl: patch.avatarUrl === undefined ? undefined : patch.avatarUrl ? (normalizeUrl(patch.avatarUrl) ?? (patch.avatarUrl.startsWith("/media/") ? patch.avatarUrl : null)) : null,
    theme: patch.theme ? cleanTheme({ ...page.theme, ...patch.theme }) : undefined,
    links: patch.links ? cleanLinks(patch.links) : undefined,
    socials: patch.socials ? cleanSocials(patch.socials) : undefined,
    grid: patch.grid ? cleanGrid(ctx.orgId, patch.grid) : undefined,
    published: patch.published,
  };
  return bioRepo.update(ctx.orgId, id, next)!;
}

export function deleteBioPage(ctx: Ctx, id: string): void {
  requireRole(ctx, "editor");
  bioRepo.remove(ctx.orgId, id);
}

/** Izgaraya eklenebilecek yayınlanmış, görselli gönderiler (en yeniler önce) */
export function gridCandidates(ctx: Ctx): Array<{ postId: string; image: string; text: string; publishedAt: string | null; interactions: number | null }> {
  const posts = postsRepo.list(ctx.orgId, { status: ["published", "partial"], limit: 60, order: "desc" });
  const out: Array<{ postId: string; image: string; text: string; publishedAt: string | null; interactions: number | null }> = [];
  for (const p of posts) {
    const img = mediaRepo.getMany(ctx.orgId, p.mediaIds).find((m) => m.kind === "image");
    if (!img) continue;
    const metrics = postMetricsRepo.getMany(p.targets.map((t) => t.id));
    let inter: number | null = null;
    for (const m of metrics.values()) inter = (inter ?? 0) + (m.metrics.likes ?? 0) + (m.metrics.comments ?? 0) + (m.metrics.shares ?? 0) + (m.metrics.saves ?? 0);
    out.push({ postId: p.id, image: `/media/${encodeURIComponent(img.filename)}`, text: p.content.slice(0, 140), publishedAt: p.publishedAt ?? p.publishAt, interactions: inter });
  }
  return out;
}

/* ---------------- Sayaç ---------------- */

const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp\/|telegrambot|discordbot|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget|python-requests|go-http-client|okhttp/i;

export function isBot(ua: string | undefined): boolean {
  return !ua || BOT_RE.test(ua);
}

const SOURCES = ["instagram", "tiktok", "facebook", "x", "linkedin", "youtube", "threads", "pinterest", "whatsapp", "telegram", "google", "direct", "other"] as const;
export type BioSource = (typeof SOURCES)[number];

/** Ziyaretin geldiği yer: ?src=… > uygulama içi tarayıcı imzası > yönlendiren alan adı */
export function sourceOf(ua: string | undefined, referer: string | undefined, src: string | undefined): BioSource {
  const s = (src ?? "").toLowerCase().trim();
  const alias: Record<string, BioSource> = { ig: "instagram", insta: "instagram", tt: "tiktok", fb: "facebook", twitter: "x", li: "linkedin", yt: "youtube", wa: "whatsapp", tg: "telegram" };
  if (s) return (SOURCES as readonly string[]).includes(s) ? (s as BioSource) : (alias[s] ?? "other");
  const u = ua ?? "";
  if (/Instagram/i.test(u)) return "instagram";
  if (/BytedanceWebview|musical_ly|TikTok/i.test(u)) return "tiktok";
  if (/FBAN|FBAV|FB_IAB/i.test(u)) return "facebook";
  if (/Barcelona|Threads/i.test(u)) return "threads";
  if (/LinkedInApp/i.test(u)) return "linkedin";
  if (/Pinterest/i.test(u)) return "pinterest";
  if (!referer) return "direct";
  let host = "";
  try {
    host = new URL(referer).hostname.replace(/^www\./, "");
  } catch {
    return "other";
  }
  const byHost: Array<[RegExp, BioSource]> = [
    [/(^|\.)instagram\.com$/, "instagram"],
    [/(^|\.)tiktok\.com$/, "tiktok"],
    [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"],
    [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "x"],
    [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
    [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
    [/(^|\.)threads\.(net|com)$/, "threads"],
    [/(^|\.)(pinterest\.[a-z.]+|pin\.it)$/, "pinterest"],
    [/(^|\.)whatsapp\.com$/, "whatsapp"],
    [/(^|\.)t\.me$/, "telegram"],
    [/(^|\.)google\.[a-z.]+$/, "google"],
  ];
  for (const [re, name] of byHost) if (re.test(host)) return name;
  return host === new URL(config.appUrl).hostname ? "direct" : "other";
}

export function trackBio(page: BioPage, linkId: string, source: BioSource): void {
  const org = orgsRepo.get(page.orgId);
  bioRepo.track(page.id, linkId, localYmd(Date.now(), org?.timezone ?? "Europe/Istanbul"), source);
}

/* ---------------- İstatistik ---------------- */

export function bioStats(ctx: Ctx, id: string, days = 30) {
  const page = bioRepo.get(ctx.orgId, id);
  if (!page) throw notFound("bio");
  const tz = orgsRepo.get(ctx.orgId)!.timezone;
  const n = Math.min(Math.max(Math.round(days), 7), 366);
  const to = localYmd(Date.now(), tz);
  const from = addDays(to, -(n - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(n - 1));
  const ev = bioRepo.events(page.id, prevFrom, to);
  const cur = ev.filter((e) => e.day >= from);
  const prev = ev.filter((e) => e.day < from);
  const views = sum(cur.filter((e) => !e.linkId));
  const clicks = sum(cur.filter((e) => e.linkId));

  const daily: Array<{ date: string; views: number; clicks: number }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = cur.filter((e) => e.day === d);
    daily.push({ date: d, views: sum(day.filter((e) => !e.linkId)), clicks: sum(day.filter((e) => e.linkId)) });
  }

  const known = new Map<string, { label: string; url: string; kind: "link" | "grid" | "social" }>();
  for (const l of page.links) known.set(l.id, { label: l.label, url: l.url, kind: "link" });
  for (const g of page.grid) known.set(g.id, { label: postsRepo.get(ctx.orgId, g.postId)?.content.slice(0, 60) ?? g.url, url: g.url, kind: "grid" });
  page.socials.forEach((s, i) => known.set(`s${i}-${s.network}`, { label: s.network, url: s.url, kind: "social" }));
  const byLink = new Map<string, number>();
  for (const e of cur.filter((x) => x.linkId)) byLink.set(e.linkId, (byLink.get(e.linkId) ?? 0) + e.count);
  const links = [...new Set([...known.keys(), ...byLink.keys()])]
    .map((lid) => {
      const k = known.get(lid);
      const c = byLink.get(lid) ?? 0;
      return { id: lid, label: k?.label ?? null, url: k?.url ?? null, kind: k?.kind ?? null, removed: !k, clicks: c, ctr: views ? Math.round((c / views) * 1000) / 10 : null };
    })
    .filter((l) => !l.removed || l.clicks > 0)
    .sort((a, b) => b.clicks - a.clicks);

  const bySource = new Map<string, { views: number; clicks: number }>();
  for (const e of cur) {
    const r = bySource.get(e.source) ?? { views: 0, clicks: 0 };
    if (e.linkId) r.clicks += e.count;
    else r.views += e.count;
    bySource.set(e.source, r);
  }
  const sources = [...bySource.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.views + b.clicks - (a.views + a.clicks));

  return {
    range: { from, to, days: n, prevFrom, prevTo, tz },
    totals: { views, clicks, ctr: views ? Math.round((clicks / views) * 1000) / 10 : null },
    prev: { views: sum(prev.filter((e) => !e.linkId)), clicks: sum(prev.filter((e) => e.linkId)) },
    daily,
    links,
    sources,
  };
}

/* ---------------- Sayfa çizimi ---------------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Göreli parlaklık (WCAG) */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const SOCIAL_NAME: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
  whatsapp: "WhatsApp",
  pinterest: "Pinterest",
  telegram: "Telegram",
  bluesky: "Bluesky",
  website: "Web",
  email: "E-posta",
};

export interface ResolvedGrid {
  id: string;
  url: string;
  image: string | null;
  alt: string;
}

export function resolveGrid(page: BioPage): ResolvedGrid[] {
  const out: ResolvedGrid[] = [];
  for (const g of page.grid) {
    const post = postsRepo.get(page.orgId, g.postId);
    if (!post) continue;
    const img = mediaRepo.getMany(page.orgId, post.mediaIds).find((m) => m.kind === "image");
    out.push({ id: g.id, url: g.url, image: img ? `/media/${encodeURIComponent(img.filename)}` : null, alt: post.content.replace(/\s+/g, " ").slice(0, 120) });
  }
  return out;
}

/**
 * Herkese açık sayfa HTML'i. preview: panel önizlemesi (sayaç yok, bağlantılar doğrudan hedefe, noindex).
 * Tek dosya, satır içi CSS, JavaScript yok; CSP (script-src 'self') ile uyumlu.
 */
export function renderBioPage(page: BioPage, opts: { locale: Locale; preview?: boolean; grid?: ResolvedGrid[]; source?: BioSource }): string {
  const th = page.theme;
  const pal =
    th.background === "dark"
      ? { bg: "#13111c", card: "#1d1a29", text: "#f4f2fa", muted: "#b3aec4", line: "#2e2a3d" }
      : th.background === "light"
        ? { bg: "#ffffff", card: "#f6f5f9", text: "#1a1726", muted: "#5e5970", line: "#e6e3ee" }
        : { bg: "#f6f2ea", card: "#fffdf8", text: "#1a1726", muted: "#5e5970", line: "#e7dfcf" };
  const accent = HEX.test(th.accent) ? th.accent : DEFAULT_THEME.accent;
  const onAccent = contrast("#ffffff", accent) >= 4.5 ? "#ffffff" : "#1a1726";
  // Vurgu zeminde yeterince ayrışmıyorsa düğmeye ince kenar eklenir
  const edge = contrast(accent, pal.bg) < 1.6 ? pal.text : accent;
  const radius = th.buttons === "pill" ? "999px" : th.buttons === "square" ? "6px" : "14px";
  // Tıklamanın kaynağı, sayfanın açıldığı kaynakla aynı sayılır (yönlendiren başlığı gönderilmez)
  const via = opts.source && opts.source !== "direct" ? `?s=${opts.source}` : "";
  const href = (id: string, url: string) => (opts.preview ? esc(url) : `${BIO_PATH}${esc(page.slug)}/go/${esc(id)}${via}`);
  const ext = opts.preview ? ` target="_blank" rel="noopener noreferrer"` : ` rel="noopener"`;
  const initials = page.title.trim().slice(0, 1).toUpperCase() || "R";
  const desc = page.bio?.trim() || page.title;
  const canonical = bioUrl(page.slug);
  const avatar = page.avatarUrl
    ? `<img class="av" src="${esc(page.avatarUrl)}" alt="" width="96" height="96" loading="eager" decoding="async">`
    : `<div class="av av-i" aria-hidden="true">${esc(initials)}</div>`;
  const socials = page.socials
    .map((s, i) => {
      const icon = BIO_ICONS[s.network];
      if (!icon) return "";
      const name = s.network === "email" && opts.locale === "en" ? "Email" : (SOCIAL_NAME[s.network] ?? s.network);
      return `<a class="so" href="${href(`s${i}-${s.network}`, s.url)}"${ext} aria-label="${esc(name)}" title="${esc(name)}"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">${icon}</svg></a>`;
    })
    .join("");
  const links = page.links
    .filter((l) => l.enabled && l.label && l.url)
    .map((l) => `<a class="bt" href="${href(l.id, l.url)}"${ext}>${esc(l.label)}</a>`)
    .join("");
  const grid = (opts.grid ?? [])
    .map((g) =>
      g.image
        ? `<a class="gi" href="${href(g.id, g.url)}"${ext}><img src="${esc(g.image)}" alt="${esc(g.alt)}" loading="lazy" decoding="async"></a>`
        : `<a class="gi gi-t" href="${href(g.id, g.url)}"${ext}><span>${esc(g.alt.slice(0, 60))}</span></a>`,
    )
    .join("");
  const made = opts.locale === "en" ? "Made with Reblebi" : "Reblebi ile hazırlandı";
  const gridTitle = opts.locale === "en" ? "Posts" : "Gönderiler";

  return `<!doctype html>
<html lang="${opts.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(desc.slice(0, 160))}">
${opts.preview ? `<meta name="robots" content="noindex, nofollow">` : `<link rel="canonical" href="${esc(canonical)}">`}
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(desc.slice(0, 200))}">
<meta property="og:url" content="${esc(canonical)}">
${page.avatarUrl && /^https:\/\//.test(page.avatarUrl) ? `<meta property="og:image" content="${esc(page.avatarUrl)}">` : ""}
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="${pal.bg}">
<style>
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:${pal.bg};color:${pal.text};font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:560px;margin:0 auto;padding:40px 16px 32px;display:flex;flex-direction:column;align-items:center;gap:18px}
.av{width:96px;height:96px;border-radius:50%;object-fit:cover;background:${pal.card};border:3px solid ${pal.bg};box-shadow:0 0 0 2px ${accent}}
.av-i{display:grid;place-items:center;font-size:40px;font-weight:700;color:${onAccent};background:${accent}}
h1{margin:0;font-size:22px;line-height:1.25;font-weight:750;text-align:center;letter-spacing:-.01em;overflow-wrap:anywhere}
.bio{margin:-8px 0 0;color:${pal.muted};text-align:center;max-width:42ch;white-space:pre-line;overflow-wrap:anywhere}
.sos{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}
.so{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;color:${pal.text}}
.so:hover{background:${pal.card}}
.bts{width:100%;display:flex;flex-direction:column;gap:12px}
.bt{display:flex;align-items:center;justify-content:center;min-height:54px;padding:12px 20px;border-radius:${radius};background:${accent};color:${onAccent};border:2px solid ${edge};font-weight:650;text-align:center;text-decoration:none;overflow-wrap:anywhere;transition:transform .15s ease,filter .15s ease}
.bt:hover{transform:translateY(-1px);filter:brightness(1.06)}
.gr{width:100%}
.gr h2{margin:6px 0 10px;font-size:13px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:${pal.muted};text-align:center}
.gg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.gi{position:relative;display:block;aspect-ratio:1;overflow:hidden;border-radius:6px;background:${pal.card}}
.gi img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s ease}
.gi:hover img{transform:scale(1.04)}
.gi-t{display:flex;align-items:center;padding:8px;color:${pal.muted};font-size:12px;line-height:1.3;text-decoration:none;border:1px solid ${pal.line}}
a:focus-visible{outline:3px solid ${pal.text};outline-offset:3px}
footer{margin-top:18px;font-size:12.5px;color:${pal.muted}}
footer a{color:inherit}
@media (prefers-reduced-motion:reduce){.bt,.gi img{transition:none}.bt:hover{transform:none}}
</style>
</head>
<body>
<main>
${avatar}
<h1>${esc(page.title)}</h1>
${page.bio ? `<p class="bio">${esc(page.bio)}</p>` : ""}
${socials ? `<nav class="sos" aria-label="${opts.locale === "en" ? "Social accounts" : "Sosyal hesaplar"}">${socials}</nav>` : ""}
${links ? `<div class="bts">${links}</div>` : ""}
${grid ? `<section class="gr" aria-label="${gridTitle}"><h2>${gridTitle}</h2><div class="gg">${grid}</div></section>` : ""}
<footer><a href="${esc(config.appUrl)}/"${opts.preview ? ` target="_blank" rel="noopener"` : ""}>${made}</a></footer>
</main>
</body>
</html>`;
}

export function renderBioNotFound(locale: Locale): string {
  const [title, text] = locale === "en" ? ["Page not found", "This link page doesn't exist or is not published."] : ["Sayfa bulunamadı", "Bu bağlantı sayfası yok ya da yayında değil."];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f2ea;color:#1a1726;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}main{text-align:center;max-width:40ch}h1{font-size:22px;margin:0 0 8px}p{color:#5e5970;margin:0 0 16px}a{color:#4b39e0}</style></head><body><main><h1>${title}</h1><p>${text}</p><a href="${esc(config.appUrl)}/">Reblebi</a></main></body></html>`;
}

/* ---------------- Yardımcılar ---------------- */

function sum(rows: Array<{ count: number }>): number {
  return rows.reduce((a, r) => a + r.count, 0);
}

function localYmd(t: number, tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}
