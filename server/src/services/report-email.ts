import { config } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { membershipsRepo, orgSettingsRepo, orgsRepo } from "../core/repos/orgs.js";
import type { Locale, Organization, OrgSettings } from "../core/types.js";
import { analyticsReport } from "./analytics-report.js";
import { sendMail } from "./mailer.js";

/**
 * Zamanlanmış e-posta raporu (Metricool "scheduled reports" karşılığı): haftalık ya da aylık özet,
 * markalı başlık (logo + renk), önceki döneme göre değişim, en iyi gönderiler ve panelde tam raporun bağlantısı.
 */

const log = createLogger("report");

export const REPORT_SECTIONS = ["summary", "followers", "networks", "engagement", "kinds", "timing", "topPosts", "hashtags"] as const;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "a@x.com, b@y.com" → dizi; geçersiz adres ya da 10'dan fazlası varsa null */
export function parseRecipients(raw: string): string[] | null {
  const list = [...new Set(raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (list.length > 10 || list.some((e) => !EMAIL_RE.test(e))) return null;
  return list;
}

/* ---------------- Dönem hesabı (çalışma alanı saatiyle) ---------------- */

function partsIn(tz: string, t: number): { y: number; m: number; d: number; h: number; wd: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]),
  );
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, wd };
}

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Şu an gönderim zamanı mı? Haftalık: pazartesi 09:00 sonrası, geçen pazartesi–pazar. Aylık: ayın 1'i 09:00 sonrası, geçen ay.
 * Dönen key aynı dönem için sabittir; reportLastSent ile karşılaştırılır.
 */
export function duePeriod(freq: "weekly" | "monthly", tz: string, now = Date.now()): { key: string; from: string; to: string } | null {
  const p = partsIn(tz, now);
  if (p.h < 9) return null;
  const today = ymd(p.y, p.m, p.d);
  if (freq === "weekly") {
    if (p.wd !== 0) return null;
    return { key: `weekly:${today}`, from: addDays(today, -7), to: addDays(today, -1) };
  }
  if (p.d !== 1) return null;
  const prevMonthEnd = addDays(today, -1);
  return { key: `monthly:${today}`, from: `${prevMonthEnd.slice(0, 8)}01`, to: prevMonthEnd };
}

/* ---------------- E-posta içeriği ---------------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STR = {
  tr: {
    weekly: "Haftalık sosyal medya özeti",
    monthly: "Aylık sosyal medya özeti",
    custom: "Sosyal medya özeti",
    followers: "Takipçi",
    posts: "Yayınlanan gönderi",
    interactions: "Etkileşim",
    views: "Görüntülenme",
    rate: "Etkileşim oranı",
    newFollowers: "Yeni takipçi",
    vsPrev: "önceki döneme göre",
    top: "En çok etkileşim alan gönderiler",
    noPosts: "Bu dönemde yayınlanan gönderi yok.",
    cta: "Raporun tamamını aç",
    footer: "Bu özeti Analitik > Rapor ekranından kapatabilir ya da alıcıları değiştirebilirsin.",
    interactionsShort: "etkileşim",
  },
  en: {
    weekly: "Weekly social media summary",
    monthly: "Monthly social media summary",
    custom: "Social media summary",
    followers: "Followers",
    posts: "Published posts",
    interactions: "Interactions",
    views: "Views",
    rate: "Engagement rate",
    newFollowers: "New followers",
    vsPrev: "vs previous period",
    top: "Top posts by interactions",
    noPosts: "No posts were published in this period.",
    cta: "Open the full report",
    footer: "You can turn this summary off or change recipients under Analytics > Report.",
    interactionsShort: "interactions",
  },
} as const;

function contrastText(hex: string): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return (1.05 / (l + 0.05)) >= 4.5 ? "#ffffff" : "#1a1726";
}

export function buildReportEmail(org: Organization, settings: OrgSettings, range: { from: string; to: string }, kind: "weekly" | "monthly" | "custom") {
  const locale: Locale = org.locale === "en" ? "en" : "tr";
  const S = STR[locale];
  const intl = locale === "en" ? "en-GB" : "tr-TR";
  const r = analyticsReport(org.id, { from: range.from, to: range.to });
  const nf = new Intl.NumberFormat(intl);
  const pf = new Intl.NumberFormat(intl, { maximumFractionDigits: 1 });
  const day = (s: string) => new Intl.DateTimeFormat(intl, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`));
  const period = `${day(r.range.from)} – ${day(r.range.to)}`;
  const color = /^#[0-9a-f]{6}$/i.test(settings.reportColor) ? settings.reportColor : "#5b49f2";
  const onColor = contrastText(color);
  const brand = settings.brandName.trim() || org.name;
  const logo = settings.reportLogoUrl ? (settings.reportLogoUrl.startsWith("/") ? `${config.publicUrl}${settings.reportLogoUrl}` : settings.reportLogoUrl) : "";
  const title = S[kind];
  const link = `${config.appUrl}/app/analytics/report?${new URLSearchParams({ p: "custom", from: r.range.from, to: r.range.to })}`;

  const change = (v: number | null, p: number | null, pct = true) => {
    if (v === null || p === null) return "";
    const diff = v - p;
    if (diff === 0) return "±0";
    const arrow = diff > 0 ? "▲" : "▼";
    const txt = pct && p !== 0 ? `${pf.format(Math.abs((diff / Math.abs(p)) * 100))}%` : nf.format(Math.abs(diff));
    return `${arrow} ${txt}`;
  };
  const k = r.kpis;
  const tiles: Array<[string, string, string]> = [
    [S.followers, k.followers.value === null ? "—" : nf.format(k.followers.value), change(k.followers.value, k.followers.prev)],
    [S.newFollowers, k.followersDelta.value === null ? "—" : new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(k.followersDelta.value), ""],
    [S.posts, nf.format(k.posts.value ?? 0), change(k.posts.value, k.posts.prev, false)],
    [S.interactions, nf.format(k.interactions.value ?? 0), change(k.interactions.value, k.interactions.prev)],
    [S.views, nf.format(k.views.value ?? 0), change(k.views.value, k.views.prev)],
    [S.rate, k.engagementRate.value === null ? "—" : `${pf.format(k.engagementRate.value)}%`, change(k.engagementRate.value, k.engagementRate.prev)],
  ];
  const top = r.posts
    .filter((p) => p.interactions !== null)
    .sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0))
    .slice(0, 3);

  const text = [
    `${brand} · ${title}`,
    period,
    "",
    ...tiles.map(([l, v, c]) => `${l}: ${v}${c ? ` (${c} ${S.vsPrev})` : ""}`),
    "",
    `${S.top}:`,
    ...(top.length ? top.map((p, i) => `${i + 1}. ${p.preview.slice(0, 90)} · ${p.channel} · ${nf.format(p.interactions ?? 0)} ${S.interactionsShort}`) : [S.noPosts]),
    "",
    `${S.cta}: ${link}`,
    "",
    S.footer,
  ].join("\n");

  const cell = ([l, v, c]: [string, string, string]) =>
    `<td style="width:33%;padding:12px;border:1px solid #e6e1d8;border-radius:10px;vertical-align:top;background:#ffffff">
      <div style="font-size:12px;color:#5e5970;font-weight:600">${esc(l)}</div>
      <div style="font-size:22px;font-weight:700;color:#1a1726;margin-top:4px">${esc(v)}</div>
      ${c ? `<div style="font-size:12px;color:${c.startsWith("▲") ? "#1f7a45" : c.startsWith("▼") ? "#b42318" : "#5e5970"};margin-top:2px">${esc(c)} <span style="color:#5e5970">${esc(S.vsPrev)}</span></div>` : ""}
    </td>`;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f3f1ec;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1726">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${color};color:${onColor};padding:22px 24px;border-radius:14px 14px 0 0">
  <table role="presentation" width="100%"><tr>
    ${logo ? `<td style="width:52px;vertical-align:middle"><img src="${esc(logo)}" alt="" width="44" height="44" style="display:block;border-radius:10px;background:#fff;object-fit:contain"></td>` : ""}
    <td style="vertical-align:middle"><div style="font-size:13px;opacity:.85">${esc(brand)}</div><div style="font-size:20px;font-weight:700">${esc(title)}</div><div style="font-size:13px;opacity:.85">${esc(period)}</div></td>
  </tr></table>
</td></tr>
<tr><td style="background:#ffffff;padding:20px 24px;border:1px solid #e6e1d8;border-top:0">
  ${settings.reportIntro.trim() ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#3a3548;white-space:pre-line">${esc(settings.reportIntro.trim())}</p>` : ""}
  <table role="presentation" width="100%" cellspacing="6" cellpadding="0"><tr>${tiles.slice(0, 3).map(cell).join("")}</tr><tr>${tiles.slice(3).map(cell).join("")}</tr></table>
  <h2 style="font-size:15px;margin:22px 0 8px">${esc(S.top)}</h2>
  ${
    top.length
      ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${top
          .map(
            (p, i) =>
              `<tr><td style="padding:10px 0;border-top:1px solid #eee;font-size:14px;line-height:1.45"><strong>${i + 1}.</strong> ${esc(p.preview.slice(0, 120) || "—")}<div style="font-size:12px;color:#5e5970">${esc(p.channel)} · ${nf.format(p.interactions ?? 0)} ${esc(S.interactionsShort)}${p.views ? ` · ${nf.format(p.views)} ${esc(S.views.toLowerCase())}` : ""}</div></td></tr>`,
          )
          .join("")}</table>`
      : `<p style="font-size:14px;color:#5e5970">${esc(S.noPosts)}</p>`
  }
  <p style="margin:22px 0 4px"><a href="${esc(link)}" style="display:inline-block;background:${color};color:${onColor};text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">${esc(S.cta)}</a></p>
</td></tr>
<tr><td style="padding:14px 8px;font-size:12px;color:#5e5970;text-align:center">${esc(S.footer)}<br>${esc(config.appName)}</td></tr>
</table></body></html>`;

  return { subject: `${brand} · ${title} (${period})`, text, html, range: r.range };
}

function recipientsFor(orgId: string, settings: OrgSettings): string[] {
  const own = parseRecipients(settings.reportRecipients) ?? [];
  if (own.length) return own;
  return membershipsRepo
    .list(orgId)
    .filter((m) => m.role === "owner" || m.role === "admin")
    .map((m) => m.email);
}

/** Zamanlayıcıdan saatte bir çağrılır */
export async function sendScheduledReports(now = Date.now()): Promise<number> {
  let sent = 0;
  for (const org of orgsRepo.listAll({ limit: 100_000 })) {
    if (org.disabled) continue;
    const s = orgSettingsRepo.get(org.id);
    if (s.reportEmail === "off") continue;
    const due = duePeriod(s.reportEmail, org.timezone, now);
    if (!due || s.reportLastSent === due.key) continue;
    // Önce işaretle: gönderim yarıda kalsa bile aynı özet tekrar tekrar gitmesin
    orgSettingsRepo.set(org.id, { reportLastSent: due.key });
    const mail = buildReportEmail(org, s, due, s.reportEmail);
    for (const to of recipientsFor(org.id, s)) {
      await sendMail(to, mail.subject, mail.text, mail.html);
      sent++;
    }
    log.info("rapor özeti gönderildi", { orgId: org.id, key: due.key });
  }
  return sent;
}

/** Ayar ekranındaki "Test e-postası": son 7 tam gün, yalnızca isteyen kişiye */
export async function sendTestReport(orgId: string, to: string): Promise<{ sent: boolean; to: string }> {
  const org = orgsRepo.get(orgId)!;
  const p = partsIn(org.timezone, Date.now());
  const today = ymd(p.y, p.m, p.d);
  const mail = buildReportEmail(org, orgSettingsRepo.get(orgId), { from: addDays(today, -7), to: addDays(today, -1) }, "weekly");
  const sent = await sendMail(to, mail.subject, mail.text, mail.html);
  return { sent, to };
}
