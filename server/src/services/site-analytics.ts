import { config } from "../core/config.js";
import { hmacSha256, randomToken, randomId } from "../core/crypto.js";
import { getDb, nowIso } from "../core/db.js";
import { AppError, notFound } from "../core/i18n.js";
import { orgsRepo } from "../core/repos/orgs.js";
import type { Ctx } from "../core/types.js";
import { requireRole } from "./access.js";
import { addDays, localYmd } from "./analytics-report.js";

/**
 * Web sitesi analitiği (Metricool'un izleme kodu karşılığı). Gizlilik öncelikli:
 * - Çerez ve kalıcı kimlik yok; tekil ziyaretçi, günlük değişen tuzla (gizli anahtar + gün) hashlenmiş
 *   IP + tarayıcı + site üzerinden o gün için sayılır; hash 2 gün sonra silinir.
 * - Ham olay saklanmaz: günlük sayaçlar (sayfa, giriş kaynağı, UTM, cihaz, tarayıcı, dil, ülke) tutulur.
 */

const MAX_SITES = 10;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|monitor|curl|wget|python|axios|go-http/i;
const SOCIAL: Record<string, string> = {
  "facebook.com": "Facebook",
  "m.facebook.com": "Facebook",
  "l.facebook.com": "Facebook",
  "lm.facebook.com": "Facebook",
  "instagram.com": "Instagram",
  "l.instagram.com": "Instagram",
  "t.co": "X",
  "x.com": "X",
  "twitter.com": "X",
  "linkedin.com": "LinkedIn",
  "lnkd.in": "LinkedIn",
  "tiktok.com": "TikTok",
  "youtube.com": "YouTube",
  "m.youtube.com": "YouTube",
  "pinterest.com": "Pinterest",
  "pin.it": "Pinterest",
  "threads.net": "Threads",
  "threads.com": "Threads",
  "bsky.app": "Bluesky",
  "reddit.com": "Reddit",
};

export interface Site {
  id: string;
  orgId: string;
  domain: string;
  token: string;
  lastHitAt: string | null;
  createdAt: string;
}
type Row = Record<string, unknown>;
const toSite = (r: Row): Site => ({ id: r.id as string, orgId: r.org_id as string, domain: r.domain as string, token: r.token as string, lastHitAt: (r.last_hit_at as string) ?? null, createdAt: r.created_at as string });

/** "https://www.Ornek.com/yol" → "ornek.com" */
export function normalizeDomain(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  let host = v;
  try {
    host = new URL(/^https?:\/\//.test(v) ? v : `https://${v}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) || host === "localhost" ? host : null;
}

export function listSites(ctx: Ctx): Site[] {
  return (getDb().prepare("SELECT * FROM sites WHERE org_id = ? ORDER BY created_at ASC").all(ctx.orgId) as Row[]).map(toSite);
}

export function addSite(ctx: Ctx, rawDomain: string): Site {
  requireRole(ctx, "admin");
  const domain = normalizeDomain(rawDomain);
  if (!domain) throw new AppError(400, "site.bad_domain");
  if (listSites(ctx).length >= MAX_SITES) throw new AppError(400, "site.too_many", { max: MAX_SITES });
  if (getDb().prepare("SELECT 1 FROM sites WHERE org_id = ? AND domain = ?").get(ctx.orgId, domain)) throw new AppError(409, "site.exists");
  const id = randomId("site");
  getDb().prepare("INSERT INTO sites (id, org_id, domain, token, created_at) VALUES (?, ?, ?, ?, ?)").run(id, ctx.orgId, domain, randomToken(12), nowIso());
  return listSites(ctx).find((s) => s.id === id)!;
}

export function removeSite(ctx: Ctx, id: string): void {
  requireRole(ctx, "admin");
  getDb().prepare("DELETE FROM sites WHERE id = ? AND org_id = ?").run(id, ctx.orgId);
}

/* ---------------- Toplama ---------------- */

export interface Hit {
  token: string;
  url: string;
  referrer?: string | null;
  width?: number | null;
}
export interface HitMeta {
  ip: string;
  ua: string;
  lang?: string | null;
  country?: string | null;
  origin?: string | null;
}

function browserOf(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua) || /CriOS/.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Diğer";
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};
const sameSite = (host: string | null, domain: string) => Boolean(host && (host === domain || host.endsWith(`.${domain}`)));

/** Sayfa görüntüleme kaydeder. Geçersiz/başka alan adı/bot ise false (yanıt yine 204) */
export function recordHit(h: Hit, m: HitMeta, now = Date.now()): boolean {
  const r = getDb().prepare("SELECT * FROM sites WHERE token = ?").get(h.token) as Row | undefined;
  if (!r) return false;
  const site = toSite(r);
  if (!m.ua || BOT_RE.test(m.ua)) return false;
  let url: URL;
  try {
    url = new URL(h.url);
  } catch {
    return false;
  }
  // Başka sitelerden sahte sayım olmasın: sayfa adresi (ve varsa Origin) sitenin alan adında olmalı
  if (!sameSite(url.hostname.toLowerCase().replace(/^www\./, ""), site.domain)) return false;
  if (m.origin && !sameSite(hostOf(m.origin), site.domain)) return false;

  const org = orgsRepo.get(site.orgId);
  const date = localYmd(now, org?.timezone || "Europe/Istanbul");
  const hash = hmacSha256(`${config.appSecret}:${date}`, `${site.id}|${m.ip}|${m.ua}`).slice(0, 32);
  const isNew = getDb().prepare("INSERT OR IGNORE INTO site_seen (site_id, date, hash) VALUES (?, ?, ?)").run(site.id, date, hash).changes === 1;

  const path = (url.pathname.replace(/\/+$/, "") || "/").slice(0, 300);
  const refHost = h.referrer ? hostOf(h.referrer) : null;
  const ref = !refHost ? "(doğrudan)" : sameSite(refHost, site.domain) ? null : refHost.slice(0, 120);
  const utmSource = url.searchParams.get("utm_source")?.slice(0, 80) ?? null;
  const utmCampaign = url.searchParams.get("utm_campaign")?.slice(0, 120) ?? null;
  const w = Number(h.width) || 0;
  const device = !w ? "?" : w < 768 ? "mobile" : w < 1100 ? "tablet" : "desktop";
  const lang = (m.lang ?? "").split(",")[0]?.split(/[-;]/)[0]?.trim().toLowerCase().slice(0, 8) || "?";
  const country = m.country && /^[A-Z]{2}$/.test(m.country) ? m.country : null;

  const dims: Array<[string, string | null, boolean]> = [
    ["", "", true],
    ["path", path, true],
    // Giriş kaynağı yalnızca o günün ilk görüntülemesinde (dahili gezinme kaynak sayılmaz)
    ["ref", isNew ? ref : null, true],
    ["social", isNew && refHost ? (SOCIAL[refHost] ?? null) : null, true],
    ["utm", isNew ? utmSource : null, true],
    ["campaign", isNew ? utmCampaign : null, true],
    ["device", device, isNew],
    ["browser", browserOf(m.ua), isNew],
    ["lang", lang, isNew],
    ["country", country, isNew],
  ];
  const st = getDb().prepare(
    "INSERT INTO site_daily (site_id, date, dim, key, views, entries) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(site_id, date, dim, key) DO UPDATE SET views = views + excluded.views, entries = entries + excluded.entries",
  );
  for (const [dim, key, count] of dims) {
    if (key === null || !count) continue;
    // Kişi başı ölçüler (cihaz, tarayıcı, dil, ülke) yalnızca günün ilk görüntülemesinde sayılır
    const perVisitor = dim === "device" || dim === "browser" || dim === "lang" || dim === "country";
    st.run(site.id, date, dim, key, perVisitor ? 0 : 1, isNew ? 1 : 0);
  }
  getDb().prepare("UPDATE sites SET last_hit_at = ? WHERE id = ?").run(new Date(now).toISOString(), site.id);
  return true;
}

/** Günlük bakım: 2 günden eski tekil-ziyaretçi hash'leri silinir */
export function purgeSeen(now = Date.now()): void {
  getDb().prepare("DELETE FROM site_seen WHERE date < ?").run(new Date(now - 2 * 86_400_000).toISOString().slice(0, 10));
}

/* ---------------- Rapor ---------------- */

export function siteReport(ctx: Ctx, id: string, days = 30) {
  const r = getDb().prepare("SELECT * FROM sites WHERE id = ? AND org_id = ?").get(id, ctx.orgId) as Row | undefined;
  if (!r) throw notFound("site");
  const site = toSite(r);
  const tz = orgsRepo.get(ctx.orgId)?.timezone || "Europe/Istanbul";
  const n = Math.min(Math.max(Math.round(days), 7), 366);
  const to = localYmd(Date.now(), tz);
  const from = addDays(to, -(n - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(n - 1));
  const rows = getDb().prepare("SELECT date, dim, key, views, entries FROM site_daily WHERE site_id = ? AND date >= ? AND date <= ?").all(site.id, prevFrom, to) as Array<{ date: string; dim: string; key: string; views: number; entries: number }>;
  const cur = rows.filter((x) => x.date >= from);
  const prev = rows.filter((x) => x.date < from);
  const total = (list: typeof rows) => {
    const t = list.filter((x) => x.dim === "");
    const views = t.reduce((a, x) => a + x.views, 0);
    const visitors = t.reduce((a, x) => a + x.entries, 0);
    const social = list.filter((x) => x.dim === "social").reduce((a, x) => a + x.entries, 0);
    return { views, visitors, viewsPerVisitor: visitors ? Math.round((views / visitors) * 10) / 10 : null, social };
  };
  const top = (dim: string, by: "views" | "entries", limit = 10) => {
    const m = new Map<string, { key: string; views: number; entries: number }>();
    for (const x of cur.filter((y) => y.dim === dim)) {
      const e = m.get(x.key) ?? { key: x.key, views: 0, entries: 0 };
      e.views += x.views;
      e.entries += x.entries;
      m.set(x.key, e);
    }
    return [...m.values()].sort((a, b) => b[by] - a[by]).slice(0, limit);
  };
  const byDate = new Map(cur.filter((x) => x.dim === "").map((x) => [x.date, x]));
  const daily: Array<{ date: string; views: number | null; visitors: number | null }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const x = byDate.get(d);
    // Kurulumdan önceki günler boş (sıfır değil) görünür
    const before = d < site.createdAt.slice(0, 10);
    daily.push({ date: d, views: x ? x.views : before ? null : 0, visitors: x ? x.entries : before ? null : 0 });
  }
  return {
    site,
    range: { from, to, days: n, tz },
    totals: total(cur),
    prev: total(prev),
    daily,
    pages: top("path", "views"),
    referrers: top("ref", "entries"),
    social: top("social", "entries"),
    utm: top("utm", "entries"),
    campaigns: top("campaign", "entries"),
    devices: top("device", "entries"),
    browsers: top("browser", "entries"),
    langs: top("lang", "entries"),
    countries: top("country", "entries"),
  };
}

/** Sitelere eklenen izleme kodu: sayfa yüklenince ve SPA gezinmesinde (pushState/popstate) bir görüntüleme gönderir */
export function trackerJs(): string {
  const endpoint = `${config.publicUrl.replace(/\/$/, "")}/api/public/collect`;
  return `(function(){var s=document.currentScript;if(!s)return;var k=s.getAttribute("data-site");if(!k||navigator.webdriver)return;var e=${JSON.stringify(endpoint)},l=null;function h(){var u=location.href;if(u===l)return;var r=l||document.referrer||null;l=u;var b=JSON.stringify({k:k,u:u,r:r,w:window.innerWidth||0});if(navigator.sendBeacon&&navigator.sendBeacon(e,new Blob([b],{type:"text/plain"})))return;try{fetch(e,{method:"POST",body:b,keepalive:true,mode:"no-cors",headers:{"Content-Type":"text/plain"}})}catch(x){}}var p=history.pushState;if(p){history.pushState=function(){p.apply(this,arguments);setTimeout(h,0)};addEventListener("popstate",h)}if(document.visibilityState==="prerender")document.addEventListener("visibilitychange",h,{once:true});else h()})();`;
}
