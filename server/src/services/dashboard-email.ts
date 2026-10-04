import { config } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { dashboardsRepo, type Dashboard, type DashboardWidget } from "../core/repos/dashboards.js";
import { channelsRepo } from "../core/repos/channels.js";
import { membershipsRepo, orgSettingsRepo, orgsRepo } from "../core/repos/orgs.js";
import type { Locale, Organization, ProviderId } from "../core/types.js";
import { systemCtx } from "./access.js";
import { adsReport } from "./ads.js";
import { addDays, analyticsReport, localYmd } from "./analytics-report.js";
import { competitorReport } from "./competitors.js";
import { sendMail } from "./mailer.js";
import { duePeriod, parseRecipients } from "./report-email.js";

/**
 * Studio panosunu e-postayla gönderme (Metricool zamanlanmış özel rapor karşılığı): panodaki kartların
 * dönem değerleri, önceki döneme göre değişim ve listeler; markalı başlık (rapor renk/logo ayarları).
 * Grafikler e-postada çizilmez; tam görünüm için panoya bağlantı verilir.
 */

const log = createLogger("dashboard-email");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const NET: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  gmb: "Google Business",
  bluesky: "Bluesky",
  twitch: "Twitch",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

const L = {
  tr: {
    metric: {
      followers: "Takipçi",
      followersDelta: "Takipçi değişimi",
      posts: "Gönderi",
      interactions: "Etkileşim",
      likes: "Beğeni",
      comments: "Yorum",
      shares: "Paylaşım",
      views: "Gönderi görüntülenmesi",
      engagementRate: "Etkileşim oranı",
      incomingMessages: "Gelen mesaj",
      "ins.reach": "Erişim",
      "ins.views": "Hesap görüntülenmesi",
      "ins.profileViews": "Profil ziyareti",
      "ins.websiteClicks": "Web sitesi tıklaması",
      "ins.follows": "Yeni takip",
      "ins.unfollows": "Takibi bırakan",
      "ins.clicks": "İçerik tıklaması",
      "ins.saves": "Kaydetme",
      "ins.calls": "Telefon araması",
      "ins.directions": "Yol tarifi",
      "ins.watchMinutes": "İzlenme süresi (dk)",
      "ins.engaged": "Etkileşen hesap",
    } as Record<string, string>,
    type: { networks: "Ağlara göre", topPosts: "En iyi gönderiler", kinds: "İçerik türleri", hashtags: "Hashtag'ler", heatmap: "En iyi saatler", audience: "Kitle", ads: "Reklamlar", competitors: "Rakipler", note: "Not", trend: "Günlük" } as Record<string, string>,
    all: "Tüm hesaplar",
    vsPrev: "önceki döneme göre",
    total: "dönem toplamı",
    last: "dönem sonu",
    noData: "Bu dönemde veri yok.",
    cta: "Panoyu aç",
    footer: "Bu e-postayı Analitik > Studio ekranında panonun \"E-posta\" ayarından kapatabilir ya da alıcıları değiştirebilirsin.",
    weekly: "Haftalık pano",
    monthly: "Aylık pano",
    interactions: "etkileşim",
    posts: "gönderi",
    followers: "takipçi",
    avg: "ort. etkileşim",
    spend: "Harcama",
    clicks: "Tıklama",
    conversions: "Dönüşüm",
    lastDays: "son {n} gün",
    days: ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"],
    best: "En yüksek ortalama etkileşim: {d} {h}:00",
    rate: "etkileşim oranı",
  },
  en: {
    metric: {
      followers: "Followers",
      followersDelta: "Follower change",
      posts: "Posts",
      interactions: "Engagement",
      likes: "Likes",
      comments: "Comments",
      shares: "Shares",
      views: "Post views",
      engagementRate: "Engagement rate",
      incomingMessages: "Incoming messages",
      "ins.reach": "Reach",
      "ins.views": "Account views",
      "ins.profileViews": "Profile visits",
      "ins.websiteClicks": "Website clicks",
      "ins.follows": "New follows",
      "ins.unfollows": "Unfollows",
      "ins.clicks": "Content clicks",
      "ins.saves": "Saves",
      "ins.calls": "Calls",
      "ins.directions": "Directions",
      "ins.watchMinutes": "Watch time (min)",
      "ins.engaged": "Accounts engaged",
    } as Record<string, string>,
    type: { networks: "By network", topPosts: "Top posts", kinds: "Content types", hashtags: "Hashtags", heatmap: "Best times", audience: "Audience", ads: "Ads", competitors: "Competitors", note: "Note", trend: "Daily" } as Record<string, string>,
    all: "All accounts",
    vsPrev: "vs previous period",
    total: "period total",
    last: "end of period",
    noData: "No data in this period.",
    cta: "Open the dashboard",
    footer: "Turn this email off or change recipients in the dashboard's \"Email\" settings under Analytics > Studio.",
    weekly: "Weekly dashboard",
    monthly: "Monthly dashboard",
    interactions: "engagements",
    posts: "posts",
    followers: "followers",
    avg: "avg. engagement",
    spend: "Spend",
    clicks: "Clicks",
    conversions: "Conversions",
    lastDays: "last {n} days",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    best: "Highest average engagement: {d} {h}:00",
    rate: "engagement rate",
  },
};

type Block = { kind: "tile"; label: string; value: string; change: string; sub: string } | { kind: "list"; title: string; sub: string; lines: string[] } | { kind: "note"; title: string; text: string };

export function buildDashboardEmail(org: Organization, d: Dashboard, range: { from: string; to: string }, freq: "weekly" | "monthly" | "custom") {
  const locale: Locale = org.locale === "en" ? "en" : "tr";
  const S = L[locale];
  const intl = locale === "en" ? "en-GB" : "tr-TR";
  const nf = new Intl.NumberFormat(intl, { maximumFractionDigits: 1 });
  const settings = orgSettingsRepo.get(org.id);
  const ctx = systemCtx(org.id, locale);
  const fmt = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;

  // Aynı kapsamdaki kartlar raporu bir kez hesaplar
  const cache = new Map<string, ReturnType<typeof analyticsReport>>();
  const reportFor = (w: DashboardWidget) => {
    const key = `${w.channelId ?? ""}|${w.provider ?? ""}`;
    if (!cache.has(key)) cache.set(key, analyticsReport(org.id, { from: range.from, to: range.to, channelId: w.channelId ?? undefined, provider: w.channelId ? undefined : ((w.provider as ProviderId | null) ?? undefined) }));
    return cache.get(key)!;
  };
  const scopeName = (w: DashboardWidget) => (w.channelId ? (channelsRepo.get(org.id, w.channelId)?.name ?? "") : w.provider ? (NET[w.provider] ?? w.provider) : S.all);
  const change = (v: number | null, p: number | null) => {
    if (v === null || p === null || p === undefined) return "";
    const diff = v - p;
    if (diff === 0) return "±0";
    return `${diff > 0 ? "▲" : "▼"} ${p !== 0 ? `${nf.format(Math.abs((diff / Math.abs(p)) * 100))}%` : nf.format(Math.abs(diff))}`;
  };

  const blocks: Block[] = [];
  for (const w of d.widgets) {
    const title = w.title || (w.type === "kpi" || w.type === "trend" ? (S.metric[w.metric ?? "followers"] ?? w.metric ?? "") : (S.type[w.type] ?? w.type));
    if (w.type === "note") {
      if ((w.text ?? "").trim() || w.title) blocks.push({ kind: "note", title: w.title ?? "", text: w.text ?? "" });
      continue;
    }
    if (w.type === "kpi" || w.type === "trend") {
      const r = reportFor(w);
      const m = w.metric ?? "followers";
      const k = m.startsWith("ins.") ? r.insights.kpis[m.slice(4) as keyof typeof r.insights.kpis] : r.kpis[m as keyof typeof r.kpis];
      const v = k?.value ?? null;
      const value = v === null ? "—" : m === "engagementRate" ? `${nf.format(v)}%` : m === "followersDelta" ? new Intl.NumberFormat(intl, { signDisplay: "exceptZero" }).format(v) : nf.format(v);
      const sub = `${scopeName(w)} · ${m === "followers" ? S.last : m === "engagementRate" ? "" : S.total}`.replace(/ · $/, "");
      blocks.push({ kind: "tile", label: title, value, change: change(v, k?.prev ?? null), sub });
      continue;
    }
    if (w.type === "ads") {
      const a = adsReport(ctx, { days });
      const t = a.totals;
      const money = (n: number | null) => (n === null ? "—" : new Intl.NumberFormat(intl, { style: "currency", currency: a.account?.currency || "TRY", maximumFractionDigits: 0 }).format(n));
      blocks.push({
        kind: "list",
        title,
        sub: `${a.account?.name ?? ""} · ${fmt(S.lastDays, { n: days })}`,
        lines: t && t.spend !== null ? [`${S.spend}: ${money(t.spend)}`, `${S.clicks}: ${nf.format(t.clicks ?? 0)}`, `${S.conversions}: ${nf.format(t.conversions ?? 0)}`] : [S.noData],
      });
      continue;
    }
    if (w.type === "competitors") {
      const net = w.provider ?? "instagram";
      const c = competitorReport(ctx, Math.max(7, days));
      const rows = [...c.self.filter((x) => x.provider === net).map((x) => ({ name: `${x.username} ★`, rate: x.engagementRate, f: x.followers })), ...c.items.filter((x) => x.provider === net).map((x) => ({ name: `@${x.username}`, rate: x.engagementRate, f: x.followers }))]
        .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))
        .slice(0, 6);
      blocks.push({ kind: "list", title, sub: `${NET[net] ?? net} · ${S.rate}`, lines: rows.length ? rows.map((r) => `${r.name}: ${r.rate === null ? "—" : `${nf.format(r.rate)}%`} · ${r.f === null ? "—" : nf.format(r.f)} ${S.followers}`) : [S.noData] });
      continue;
    }
    const r = reportFor(w);
    const sub = scopeName(w);
    let lines: string[] = [];
    if (w.type === "networks") lines = r.byProvider.filter((p) => p.channels > 0).map((p) => `${NET[p.provider] ?? p.provider}: ${p.followers === null ? "—" : nf.format(p.followers)} ${S.followers} · ${nf.format(p.posts)} ${S.posts} · ${nf.format(p.interactions)} ${S.interactions}`);
    else if (w.type === "topPosts")
      lines = r.posts
        .filter((p) => p.interactions !== null)
        .sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0))
        .slice(0, 5)
        .map((p) => `${p.preview.slice(0, 90) || "—"} · ${p.channel} · ${nf.format(p.interactions ?? 0)} ${S.interactions}`);
    else if (w.type === "kinds")
      lines = r.kinds
        .filter((k) => k.withMetrics > 0)
        .sort((a, b) => (b.avgInteractions ?? 0) - (a.avgInteractions ?? 0))
        .map((k) => `${k.kind}: ${nf.format(k.avgInteractions ?? 0)} ${S.avg} · ${nf.format(k.posts)} ${S.posts}`);
    else if (w.type === "hashtags")
      lines = [...r.hashtags]
        .sort((a, b) => b.interactions - a.interactions)
        .slice(0, 8)
        .map((h) => `${h.tag}: ${nf.format(h.interactions)} ${S.interactions} · ${nf.format(h.posts)} ${S.posts}`);
    else if (w.type === "heatmap") {
      const best = [...r.heatmap.cells].filter((c) => c.avgInteractions !== null && c.posts > 0).sort((a, b) => (b.avgInteractions ?? 0) - (a.avgInteractions ?? 0))[0];
      lines = best ? [fmt(S.best, { d: S.days[best.weekday] ?? "", h: String(best.hour).padStart(2, "0") })] : [];
    } else if (w.type === "audience") {
      const a = r.audience;
      const total = (a?.country ?? []).reduce((s, x) => s + x.value, 0);
      lines = (a?.country ?? []).slice(0, 5).map((x) => `${x.key}: ${total ? `${nf.format((x.value / total) * 100)}%` : nf.format(x.value)}`);
    }
    blocks.push({ kind: "list", title, sub, lines: lines.length ? lines : [S.noData] });
  }

  const brand = settings.brandName.trim() || org.name;
  const color = /^#[0-9a-f]{6}$/i.test(settings.reportColor) ? settings.reportColor : "#5b49f2";
  const [r0, g0, b0] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const onColor = (0.299 * r0 + 0.587 * g0 + 0.114 * b0) / 255 > 0.6 ? "#1a1726" : "#ffffff";
  const logo = settings.reportLogoUrl ? (settings.reportLogoUrl.startsWith("/") ? `${config.publicUrl}${settings.reportLogoUrl}` : settings.reportLogoUrl) : "";
  const dayFmt = (s: string) => new Intl.DateTimeFormat(intl, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`));
  const period = `${dayFmt(range.from)} – ${dayFmt(range.to)}`;
  const kindTitle = freq === "monthly" ? S.monthly : S.weekly;
  const link = `${config.appUrl.replace(/\/$/, "")}/app/analytics/studio`;

  const tiles = blocks.filter((b): b is Extract<Block, { kind: "tile" }> => b.kind === "tile");
  const others = blocks.filter((b) => b.kind !== "tile");
  const text = [
    `${brand} · ${d.name}`,
    `${kindTitle} · ${period}`,
    "",
    ...tiles.map((t) => `${t.label}: ${t.value}${t.change ? ` (${t.change} ${S.vsPrev})` : ""} · ${t.sub}`),
    ...others.flatMap((b) => (b.kind === "list" ? ["", `${b.title} (${b.sub})`, ...b.lines.map((l) => `- ${l}`)] : b.kind === "note" ? ["", b.title, b.text] : [])),
    "",
    `${S.cta}: ${link}`,
    "",
    S.footer,
  ].join("\n");

  const cell = (t: Extract<Block, { kind: "tile" }>) =>
    `<td style="width:33%;padding:12px;border:1px solid #e6e1d8;border-radius:10px;vertical-align:top;background:#ffffff">
      <div style="font-size:12px;color:#5e5970;font-weight:600">${esc(t.label)}</div>
      <div style="font-size:22px;font-weight:700;color:#1a1726;margin-top:4px">${esc(t.value)}</div>
      ${t.change ? `<div style="font-size:12px;color:${t.change.startsWith("▲") ? "#1f7a45" : t.change.startsWith("▼") ? "#b42318" : "#5e5970"};margin-top:2px">${esc(t.change)} <span style="color:#5e5970">${esc(S.vsPrev)}</span></div>` : ""}
      <div style="font-size:11px;color:#5e5970;margin-top:4px">${esc(t.sub)}</div>
    </td>`;
  const rowsOf = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.name)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f3f1ec;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1726">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto">
<tr><td style="background:${color};color:${onColor};padding:22px 24px;border-radius:14px 14px 0 0">
  <table role="presentation" width="100%"><tr>
    ${logo ? `<td style="width:52px;vertical-align:middle"><img src="${esc(logo)}" alt="" width="44" height="44" style="display:block;border-radius:10px;background:#fff;object-fit:contain"></td>` : ""}
    <td style="vertical-align:middle"><div style="font-size:13px;opacity:.85">${esc(brand)} · ${esc(kindTitle)}</div><div style="font-size:20px;font-weight:700">${esc(d.name)}</div><div style="font-size:13px;opacity:.85">${esc(period)}</div></td>
  </tr></table>
</td></tr>
<tr><td style="background:#ffffff;padding:20px 24px;border:1px solid #e6e1d8;border-top:0">
  ${tiles.length ? `<table role="presentation" width="100%" cellspacing="6" cellpadding="0">${rowsOf(tiles, 3).map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("")}</table>` : ""}
  ${others
    .map((b) =>
      b.kind === "list"
        ? `<h2 style="font-size:15px;margin:22px 0 2px">${esc(b.title)}</h2><div style="font-size:12px;color:#5e5970;margin-bottom:6px">${esc(b.sub)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${b.lines.map((l) => `<tr><td style="padding:8px 0;border-top:1px solid #eee;font-size:14px;line-height:1.45">${esc(l)}</td></tr>`).join("")}</table>`
        : b.kind === "note"
          ? `<div style="margin:22px 0 0;padding:14px 16px;border-radius:10px;background:#f6f3ee">${b.title ? `<strong style="display:block;margin-bottom:4px">${esc(b.title)}</strong>` : ""}<div style="font-size:14px;line-height:1.55;white-space:pre-line">${esc(b.text)}</div></div>`
          : "",
    )
    .join("")}
  <p style="margin:22px 0 4px"><a href="${esc(link)}" style="display:inline-block;background:${color};color:${onColor};text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">${esc(S.cta)}</a></p>
</td></tr>
<tr><td style="padding:14px 8px;font-size:12px;color:#5e5970;text-align:center">${esc(S.footer)}<br>${esc(config.appName)}</td></tr>
</table></body></html>`;

  return { subject: `${brand} · ${d.name} (${period})`, text, html };
}

function recipientsFor(orgId: string, d: Dashboard): string[] {
  const own = parseRecipients(d.email.recipients) ?? [];
  if (own.length) return own;
  return membershipsRepo
    .list(orgId)
    .filter((m) => m.role === "owner" || m.role === "admin")
    .map((m) => m.email);
}

/** Zamanlayıcı (15 dakikada bir): vakti gelen panoları gönderir; aynı dönem iki kez gitmez */
export async function sendScheduledDashboards(now = Date.now()): Promise<number> {
  let sent = 0;
  for (const d of dashboardsRepo.listScheduled()) {
    const org = orgsRepo.get(d.orgId);
    if (!org || org.disabled || d.email.freq === "off") continue;
    const due = duePeriod(d.email.freq, org.timezone, now);
    if (!due || d.email.lastSent === due.key) continue;
    dashboardsRepo.setEmail(d.orgId, d.id, { ...d.email, lastSent: due.key });
    const mail = buildDashboardEmail(org, d, due, d.email.freq);
    for (const to of recipientsFor(d.orgId, d)) {
      await sendMail(to, mail.subject, mail.text, mail.html);
      sent++;
    }
    log.info("pano e-postası gönderildi", { dashboard: d.id, key: due.key });
  }
  return sent;
}

/** "Test e-postası": son 7 tam gün, yalnızca isteyen kişiye */
export async function sendTestDashboard(orgId: string, d: Dashboard, to: string): Promise<{ sent: boolean; to: string }> {
  const org = orgsRepo.get(orgId)!;
  const today = localYmd(Date.now(), org.timezone);
  const mail = buildDashboardEmail(org, d, { from: addDays(today, -7), to: addDays(today, -1) }, "weekly");
  return { sent: await sendMail(to, mail.subject, mail.text, mail.html), to };
}
