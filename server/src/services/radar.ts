import { adaptViralPost } from "../ai/index.js";
import { decrypt, encrypt } from "../core/crypto.js";
import { AppError, notFound } from "../core/i18n.js";
import { createLogger } from "../core/logger.js";
import { channelsRepo } from "../core/repos/channels.js";
import { orgsRepo } from "../core/repos/orgs.js";
import { radarRepo, type RadarAccountRow, type RadarRole, type RadarSavedStatus, type RadarSponsorStatus } from "../core/repos/radar.js";
import type { Channel, Ctx } from "../core/types.js";
import { channelBase, GRAPH } from "../providers/meta/common.js";
import { requireRole } from "./access.js";
import { localYmd } from "./analytics-report.js";
import { createPost } from "./posts.js";
import { ensureFreshToken } from "./publisher.js";
import {
  ApifyError,
  apifyExhaustedMessage,
  apifyUsage,
  creatorStats,
  extractEmail,
  fetchApifyProfiles,
  fetchBusinessDiscovery,
  firstLine,
  formatInsights,
  GraphError,
  hashtagInsights,
  levelOf,
  median,
  mentionSuggestions,
  normalizeUsername,
  radarScores,
  round,
  scoreAccount,
  timeHeatmap,
  type CreatorStats,
  type MediaKind,
  type RadarAccount,
  type Region,
  type ScoredPost,
} from "./radar-core.js";

/**
 * İçerik radarı: nişteki (Türkiye ve global) hesapların gönderilerini hesabın kendi normaline göre puanlar,
 * üreticileri niş içinde sıralar, tutan içeriği marka sesine uyarlayıp taslak açar.
 * Kaynak: çalışma alanının Instagram hesabıyla Business Discovery (ücretsiz); kişisel hesaplar ve hız sınırı için isteğe bağlı Apify.
 * Puanlama radar-core.ts'te (bağımsız İçerik Radarı uygulamasıyla aynı dosya).
 */

const log = createLogger("radar");
export const MAX_RADAR_ACCOUNTS = 200;
const DAY = 86_400_000;
const POSTS_PER_ACCOUNT = 30;
const tzOf = (orgId: string) => orgsRepo.get(orgId)?.timezone || "Europe/Istanbul";

function igChannel(orgId: string): Channel | null {
  return channelsRepo.list(orgId).find((c) => c.provider === "instagram" && c.status === "active") ?? null;
}
function apifyOf(orgId: string): { token: string; maxUsd: number } | null {
  const s = radarRepo.settings(orgId);
  if (!s.apifyToken) return null;
  try {
    return { token: decrypt(s.apifyToken), maxUsd: s.apifyMaxUsd ?? 1 };
  } catch {
    return null;
  }
}

/* ============================== Ayarlar ve durum ============================== */

export function radarStatus(ctx: Ctx) {
  const ch = igChannel(ctx.orgId);
  const s = radarRepo.settings(ctx.orgId);
  return {
    instagram: ch ? { channelId: ch.id, username: ch.username ?? ch.name } : null,
    apify: Boolean(s.apifyToken),
    apifyMaxUsd: s.apifyMaxUsd ?? 1,
    canScan: Boolean(ch || s.apifyToken),
    accounts: radarRepo.countAccounts(ctx.orgId),
    max: MAX_RADAR_ACCOUNTS,
  };
}

export function updateRadarSettings(ctx: Ctx, input: { apifyToken?: string | null; apifyMaxUsd?: number | null }) {
  requireRole(ctx, "admin");
  radarRepo.putSettings(ctx.orgId, {
    apifyToken: input.apifyToken === undefined ? undefined : input.apifyToken ? encrypt(input.apifyToken.trim()) : null,
    apifyMaxUsd: input.apifyMaxUsd === undefined ? undefined : input.apifyMaxUsd,
  });
  return radarStatus(ctx);
}

/* ============================== Nişler ============================== */

export function listNiches(ctx: Ctx) {
  const counts = new Map<string, number>();
  for (const a of radarRepo.accounts(ctx.orgId)) if (a.nicheId) counts.set(a.nicheId, (counts.get(a.nicheId) ?? 0) + 1);
  return radarRepo.niches(ctx.orgId).map((n) => ({ ...n, accounts: counts.get(n.id) ?? 0 }));
}

export function createNiche(ctx: Ctx, name: string, color: string | null = null) {
  requireRole(ctx, "editor");
  if (!name.trim()) throw new AppError(400, "radar.niche_name");
  if (radarRepo.nicheByName(ctx.orgId, name)) throw new AppError(409, "radar.niche_exists");
  return radarRepo.createNiche(ctx.orgId, name.trim().slice(0, 60), color);
}

export function updateNiche(ctx: Ctx, id: string, patch: { name?: string; color?: string | null }) {
  requireRole(ctx, "editor");
  if (!radarRepo.niche(ctx.orgId, id)) throw notFound("radar_niche");
  if (patch.name !== undefined) {
    const other = radarRepo.nicheByName(ctx.orgId, patch.name);
    if (!patch.name.trim()) throw new AppError(400, "radar.niche_name");
    if (other && other.id !== id) throw new AppError(409, "radar.niche_exists");
  }
  radarRepo.updateNiche(ctx.orgId, id, patch);
  return radarRepo.niche(ctx.orgId, id);
}

export function removeNiche(ctx: Ctx, id: string) {
  requireRole(ctx, "editor");
  radarRepo.removeNiche(ctx.orgId, id);
}

/* ============================== Tarama ============================== */

export interface RadarScanResult {
  total: number;
  ok: number;
  failed: number;
  newPosts: number;
  message: string | null;
  errors: Array<{ username: string; error: string }>;
}

const scanning = new Set<string>();

function metaMessage(e: GraphError): string {
  if (e.kind === "not_found") return "Instagram'da bulunamadı ya da işletme/üretici hesabı değil (kişisel hesaplar için Apify gerekir)";
  if (e.kind === "rate_limit") return "Meta hız sınırına takıldı; sonraki taramada tekrar denenecek";
  if (e.kind === "auth") return "Instagram bağlantısının süresi dolmuş; Kanallar'dan yeniden bağla";
  return e.message;
}

/** Hesapları çeker: önce bağlı Instagram hesabıyla Business Discovery, bulunamayanlar ve hız sınırından sonrakiler Apify'a */
export async function scanAccounts(orgId: string, list: RadarAccountRow[]): Promise<RadarScanResult> {
  if (scanning.has(orgId)) throw new AppError(409, "radar.busy");
  const channel = igChannel(orgId);
  const apify = apifyOf(orgId);
  if (!channel && !apify) throw new AppError(400, "radar.no_source");
  scanning.add(orgId);
  const tz = tzOf(orgId);
  const today = localYmd(Date.now(), tz);
  const res: RadarScanResult = { total: list.length, ok: 0, failed: 0, newPosts: 0, message: null, errors: [] };
  const fail = (a: RadarAccountRow, msg: string) => {
    radarRepo.saveError(a.id, msg);
    res.errors.push({ username: a.username, error: msg });
    res.failed++;
  };
  const save = (a: RadarAccountRow, acc: RadarAccount, source: string) => {
    res.newPosts += radarRepo.store(a, acc, source, today, extractEmail(acc.biography));
    res.ok++;
  };
  try {
    const viaApify: RadarAccountRow[] = [];
    if (channel) {
      let stop: string | null = null;
      let fresh: Channel | null = null;
      try {
        fresh = await ensureFreshToken(channel);
      } catch (e) {
        stop = `Instagram bağlantısı yenilenemedi: ${e instanceof Error ? e.message : String(e)}`;
      }
      for (const a of list) {
        if (stop || !fresh) {
          if (apify) viaApify.push(a);
          else fail(a, stop ?? "Instagram bağlantısı yok");
          continue;
        }
        try {
          const acc = await fetchBusinessDiscovery({ igUserId: fresh.externalId, token: fresh.accessToken, username: a.username, limit: POSTS_PER_ACCOUNT, base: channelBase(fresh) ?? GRAPH() });
          save(a, acc, "meta");
        } catch (e) {
          if (e instanceof GraphError && (e.kind === "rate_limit" || e.kind === "auth")) {
            stop = metaMessage(e);
            res.message = stop;
            if (apify) viaApify.push(a);
            else fail(a, stop);
          } else if (e instanceof GraphError && e.kind === "not_found" && apify) viaApify.push(a);
          else fail(a, e instanceof GraphError ? metaMessage(e) : e instanceof Error ? e.message : String(e));
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    } else viaApify.push(...list);

    for (let i = 0; i < viaApify.length; i += 50) {
      const chunk = viaApify.slice(i, i + 50);
      try {
        const r = await fetchApifyProfiles({ token: apify!.token, usernames: chunk.map((a) => a.username), maxChargeUsd: apify!.maxUsd });
        const byName = new Map(r.accounts.map((x) => [x.username, x]));
        // Eksik dönen varsa sebep çoğunlukla dolan aylık Apify sınırıdır; öyleyse bunu açıkça söyle
        const usage = r.missing.length ? await apifyUsage(apify!.token) : null;
        const missingMsg = usage?.exhausted ? apifyExhaustedMessage(usage) : "Apify bu profili getiremedi (gizli hesap, yanlış ad ya da çalışma başına harcama tavanı)";
        if (usage?.exhausted) res.message = [res.message, missingMsg].filter(Boolean).join(" · ");
        for (const a of chunk) {
          const acc = byName.get(a.username);
          if (acc) save(a, acc, "apify");
          else fail(a, missingMsg);
        }
      } catch (e) {
        const msg = e instanceof ApifyError && (e.status === 401 || e.status === 403) ? "Apify anahtarı geçersiz" : `Apify: ${e instanceof Error ? e.message : String(e)}`;
        for (const a of chunk) fail(a, msg);
      }
    }
  } finally {
    scanning.delete(orgId);
  }
  return res;
}

export async function scanRadar(ctx: Ctx, ids?: string[]): Promise<RadarScanResult> {
  requireRole(ctx, "editor");
  const want = ids?.length ? new Set(ids) : null;
  const list = radarRepo.accounts(ctx.orgId).filter((a) => (want ? want.has(a.id) : !a.paused));
  return scanAccounts(ctx.orgId, list);
}

/** Zamanlayıcı: her hesap günde bir kez (çalışma alanı saatine göre) taranır */
export async function snapshotRadar(now = Date.now()): Promise<number> {
  const byOrg = new Map<string, RadarAccountRow[]>();
  for (const a of radarRepo.allAccounts()) byOrg.set(a.orgId, [...(byOrg.get(a.orgId) ?? []), a]);
  let done = 0;
  for (const [orgId, list] of byOrg) {
    const org = orgsRepo.get(orgId);
    if (!org || org.disabled) continue;
    const today = localYmd(now, org.timezone);
    const due = list.filter((a) => !a.paused && (!a.lastFetchedAt || localYmd(Date.parse(a.lastFetchedAt), org.timezone) !== today));
    if (!due.length || (!igChannel(orgId) && !apifyOf(orgId))) continue;
    try {
      done += (await scanAccounts(orgId, due)).ok;
    } catch (e) {
      log.warn("radar taraması başarısız", { orgId, msg: e instanceof Error ? e.message : String(e) });
    }
  }
  return done;
}

/* ============================== Hesaplar ============================== */

export async function addRadarAccounts(ctx: Ctx, input: { usernames: string[]; nicheId?: string | null; nicheName?: string | null; region?: Region; role?: RadarRole; scan?: boolean }) {
  requireRole(ctx, "editor");
  const valid = new Set<string>();
  const invalid: string[] = [];
  for (const raw of input.usernames.map((s) => s.trim()).filter(Boolean)) {
    const u = normalizeUsername(raw);
    if (u) valid.add(u);
    else invalid.push(raw);
  }
  if (!valid.size) throw new AppError(400, "radar.bad_username");
  let nicheId: string | null | undefined = undefined;
  if (input.nicheName?.trim()) nicheId = (radarRepo.nicheByName(ctx.orgId, input.nicheName) ?? radarRepo.createNiche(ctx.orgId, input.nicheName.trim().slice(0, 60), null)).id;
  else if (input.nicheId) {
    if (!radarRepo.niche(ctx.orgId, input.nicheId)) throw notFound("radar_niche");
    nicheId = input.nicheId;
  }
  const fresh = [...valid].filter((u) => !radarRepo.accountByUsername(ctx.orgId, u));
  if (radarRepo.countAccounts(ctx.orgId) + fresh.length > MAX_RADAR_ACCOUNTS) throw new AppError(400, "radar.too_many", { max: MAX_RADAR_ACCOUNTS });
  const own = new Set(channelsRepo.list(ctx.orgId).filter((c) => c.provider === "instagram").map((c) => (c.username ?? "").replace(/^@/, "").toLowerCase()));
  const added: RadarAccountRow[] = [];
  const updated: string[] = [];
  for (const u of valid) {
    const cur = radarRepo.accountByUsername(ctx.orgId, u);
    if (cur) {
      radarRepo.patchAccount(ctx.orgId, cur.id, { nicheId, region: input.region, role: input.role });
      updated.push(u);
    } else added.push(radarRepo.createAccount(ctx.orgId, u, { nicheId: nicheId ?? null, region: input.region ?? "TR", role: input.role ?? (own.has(u) ? "own" : "watch") }));
  }
  let scan: RadarScanResult | null = null;
  if (input.scan !== false && added.length && (igChannel(ctx.orgId) || apifyOf(ctx.orgId))) {
    try {
      scan = await scanAccounts(ctx.orgId, added);
    } catch (e) {
      if (!(e instanceof AppError && e.key === "radar.busy")) throw e;
    }
  }
  return { added: added.map((a) => a.username), updated, invalid, nicheId: nicheId ?? null, scan };
}

export function patchRadarAccount(ctx: Ctx, id: string, patch: { nicheId?: string | null; region?: Region; role?: RadarRole; paused?: boolean }) {
  requireRole(ctx, "editor");
  if (!radarRepo.account(ctx.orgId, id)) throw notFound("radar_account");
  if (patch.nicheId && !radarRepo.niche(ctx.orgId, patch.nicheId)) throw notFound("radar_niche");
  radarRepo.patchAccount(ctx.orgId, id, patch);
  return radarRepo.account(ctx.orgId, id);
}

export function removeRadarAccount(ctx: Ctx, id: string) {
  requireRole(ctx, "editor");
  radarRepo.removeAccount(ctx.orgId, id);
}

/* ============================== Puanlı gönderiler ============================== */

export interface RadarScope {
  nicheId?: string | null;
  region?: Region | null;
  role?: RadarRole | null;
  accountId?: string | null;
}

export type RadarFeedPost = ScoredPost & {
  level: ReturnType<typeof levelOf>;
  hook: string;
  saved: boolean;
  account: { id: string; username: string; fullName: string | null; avatarUrl: string | null; followers: number | null; nicheId: string | null; region: Region; role: RadarRole };
};

function scopedAccounts(orgId: string, s: RadarScope): RadarAccountRow[] {
  return radarRepo
    .accounts(orgId)
    .filter(
      (a) =>
        (!s.nicheId || (s.nicheId === "none" ? a.nicheId === null : a.nicheId === s.nicheId)) &&
        (!s.region || a.region === s.region) &&
        (!s.role || a.role === s.role) &&
        (!s.accountId || a.id === s.accountId),
    );
}

function scored(orgId: string, s: RadarScope, now = Date.now()): RadarFeedPost[] {
  const list = scopedAccounts(orgId, s);
  const ids = new Set(list.map((a) => a.id));
  const byAcc = new Map<string, ReturnType<typeof radarRepo.posts>>();
  for (const p of radarRepo.posts(orgId)) if (ids.has(p.accountId)) byAcc.set(p.accountId, [...(byAcc.get(p.accountId) ?? []), p]);
  const savedKeys = new Set(radarRepo.saved(orgId).map((x) => x.key));
  const out: RadarFeedPost[] = [];
  for (const a of list) {
    for (const p of scoreAccount({ followers: a.followers, posts: byAcc.get(a.id) ?? [] }, now)) {
      out.push({
        ...p,
        owner: a.username,
        level: levelOf(p.outlier),
        hook: firstLine(p.caption),
        saved: savedKeys.has(p.key),
        account: { id: a.id, username: a.username, fullName: a.fullName, avatarUrl: a.avatarUrl, followers: a.followers, nicheId: a.nicheId, region: a.region, role: a.role },
      });
    }
  }
  return out;
}

export type RadarFeedSort = "outlier" | "engagement" | "views" | "rate" | "newest";

export function radarFeed(ctx: Ctx, q: RadarScope & { days?: number; kind?: MediaKind | null; minOutlier?: number; sort?: RadarFeedSort; q?: string; limit?: number; offset?: number }, now = Date.now()) {
  const since = q.days && q.days > 0 ? now - q.days * DAY : -Infinity;
  const needle = q.q?.trim().toLocaleLowerCase("tr");
  const by: Record<RadarFeedSort, (p: RadarFeedPost) => number> = {
    outlier: (p) => p.outlier ?? -1,
    engagement: (p) => p.engagement ?? -1,
    views: (p) => p.views ?? -1,
    rate: (p) => p.engagementRate ?? -1,
    newest: (p) => (p.postedAt ? Date.parse(p.postedAt) : 0),
  };
  const key = by[q.sort ?? "outlier"];
  const list = scored(ctx.orgId, q, now)
    .filter(
      (p) =>
        (!p.postedAt || Date.parse(p.postedAt) >= since) &&
        (!q.kind || p.kind === q.kind) &&
        (!q.minOutlier || (p.outlier ?? 0) >= q.minOutlier) &&
        (!needle || p.caption.toLocaleLowerCase("tr").includes(needle) || p.account.username.includes(needle)),
    )
    .sort((a, b) => key(b) - key(a));
  const offset = Math.max(q.offset ?? 0, 0);
  const limit = Math.min(Math.max(q.limit ?? 48, 1), 200);
  return { total: list.length, items: list.slice(offset, offset + limit) };
}

export function radarPost(ctx: Ctx, key: string) {
  const p = scored(ctx.orgId, {}).find((x) => x.key === key);
  if (!p) throw notFound("post");
  return { post: p, saved: radarRepo.savedOne(ctx.orgId, key) };
}

/* ============================== Üreticiler ============================== */

export type RadarCreatorSort = "radar" | "followers" | "engagementRate" | "growth" | "views" | "hitRate" | "postsPerWeek";

export type RadarCreator = CreatorStats & {
  id: string;
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
  biography: string | null;
  email: string | null;
  website: string | null;
  nicheId: string | null;
  region: Region;
  role: RadarRole;
  paused: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  lastSource: string | null;
  radarScore: number | null;
  sponsorStatus: RadarSponsorStatus | null;
  topPost: { key: string; permalink: string | null; outlier: number | null; hook: string; kind: MediaKind } | null;
  history: number[];
};

export function radarCreators(ctx: Ctx, q: RadarScope & { sort?: RadarCreatorSort }, now = Date.now()): RadarCreator[] {
  const tz = tzOf(ctx.orgId);
  const since = localYmd(now - 45 * DAY, tz);
  const spons = new Map(radarRepo.sponsors(ctx.orgId).map((s) => [s.username, s.status]));
  const posts = radarRepo.posts(ctx.orgId);
  const rows: RadarCreator[] = scopedAccounts(ctx.orgId, q).map((a) => {
    const sp = scoreAccount({ followers: a.followers, posts: posts.filter((p) => p.accountId === a.id) }, now);
    const hist = radarRepo.history(a.id, since);
    const top = sp.filter((p) => p.outlier !== null).sort((x, y) => (y.outlier ?? 0) - (x.outlier ?? 0))[0] ?? null;
    return {
      ...creatorStats(a.followers, sp, hist, now),
      id: a.id,
      username: a.username,
      fullName: a.fullName,
      avatarUrl: a.avatarUrl,
      biography: a.biography,
      email: a.email,
      website: a.website,
      nicheId: a.nicheId,
      region: a.region,
      role: a.role,
      paused: a.paused,
      lastFetchedAt: a.lastFetchedAt,
      lastError: a.lastError,
      lastSource: a.lastSource,
      radarScore: null,
      sponsorStatus: spons.get(a.username) ?? null,
      topPost: top ? { key: top.key, permalink: top.permalink, outlier: top.outlier, hook: firstLine(top.caption, 90), kind: top.kind } : null,
      history: hist.map((h) => h.followers).filter((v): v is number => v !== null),
    };
  });
  // Radar puanı niş içinde karşılaştırmalı ("kendi hesabım" hariç)
  const groups = new Map<string, RadarCreator[]>();
  for (const r of rows) if (r.role !== "own") groups.set(String(r.nicheId), [...(groups.get(String(r.nicheId)) ?? []), r]);
  for (const g of groups.values()) radarScores(g).forEach((s, i) => (g[i].radarScore = s));
  const by: Record<RadarCreatorSort, (r: RadarCreator) => number> = {
    radar: (r) => r.radarScore ?? -1,
    followers: (r) => r.followers ?? -1,
    engagementRate: (r) => r.engagementRate ?? -1,
    growth: (r) => r.growth30 ?? -Infinity,
    views: (r) => r.medianViews ?? -1,
    hitRate: (r) => r.hitRate ?? -1,
    postsPerWeek: (r) => r.postsPerWeek ?? -1,
  };
  const key = by[q.sort ?? "radar"];
  return rows.sort((a, b) => key(b) - key(a));
}

export function radarCreator(ctx: Ctx, id: string) {
  const a = radarRepo.account(ctx.orgId, id);
  if (!a) throw notFound("radar_account");
  const stats = radarCreators(ctx, { nicheId: a.nicheId ?? "none" }).find((r) => r.id === id) ?? null;
  const posts = scored(ctx.orgId, { accountId: id }).sort((x, y) => (y.outlier ?? -1) - (x.outlier ?? -1));
  return { account: a, stats, posts: posts.slice(0, 24), sponsor: radarRepo.sponsor(ctx.orgId, a.username) };
}

/* ============================== Keşif ve içgörüler ============================== */

export function radarSuggestions(ctx: Ctx) {
  const exclude = new Set([...radarRepo.accounts(ctx.orgId).map((a) => a.username), ...radarRepo.dismissed(ctx.orgId)]);
  for (const c of channelsRepo.list(ctx.orgId)) if (c.provider === "instagram" && c.username) exclude.add(c.username.replace(/^@/, "").toLowerCase());
  const since = Date.now() - 120 * DAY;
  const posts = scored(ctx.orgId, {}).filter((p) => !p.postedAt || Date.parse(p.postedAt) >= since);
  return mentionSuggestions(
    posts.map((p) => ({ caption: p.caption, owner: p.account.username, outlier: p.outlier })),
    exclude,
  ).slice(0, 60);
}

export function dismissSuggestion(ctx: Ctx, username: string) {
  requireRole(ctx, "editor");
  const u = normalizeUsername(username);
  if (u) radarRepo.dismiss(ctx.orgId, u);
}

export function radarInsights(ctx: Ctx, q: RadarScope & { days?: number }, now = Date.now()) {
  const days = q.days ?? 90;
  const list = scored(ctx.orgId, q, now).filter((p) => !p.postedAt || Date.parse(p.postedAt) >= now - days * DAY);
  const mature = list.filter((p) => !p.early);
  const outs = mature.map((p) => p.outlier).filter((v): v is number => v !== null);
  return {
    days,
    posts: list.length,
    accounts: new Set(list.map((p) => p.account.id)).size,
    medianOutlier: outs.length ? round(median(outs)!, 2) : null,
    viral: mature.filter((p) => (p.outlier ?? 0) >= 5).length,
    formats: formatInsights(list),
    heatmap: timeHeatmap(list, tzOf(ctx.orgId)),
    hashtags: hashtagInsights(list.map((p) => ({ ...p, owner: p.account.username }))).slice(0, 20),
    hooks: mature
      .filter((p) => (p.outlier ?? 0) >= 2.5 && p.hook)
      .sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0))
      .slice(0, 15)
      .map((p) => ({ key: p.key, hook: p.hook, outlier: p.outlier, kind: p.kind, owner: p.account.username, permalink: p.permalink })),
  };
}

export function radarOverview(ctx: Ctx, now = Date.now()) {
  const accounts = radarRepo.accounts(ctx.orgId);
  const month = radarFeed(ctx, { days: 30, limit: 200 }, now);
  return {
    status: radarStatus(ctx),
    counts: {
      accounts: accounts.length,
      errors: accounts.filter((a) => a.lastError).length,
      viral30: month.items.filter((p) => (p.outlier ?? 0) >= 5 && !p.early).length,
      saved: radarRepo.saved(ctx.orgId).length,
      sponsors: radarRepo.sponsors(ctx.orgId).length,
    },
    lastFetchedAt: accounts.map((a) => a.lastFetchedAt).filter(Boolean).sort().pop() ?? null,
  };
}

/* ============================== Pano ve sponsorlar ============================== */

export function listSaved(ctx: Ctx) {
  return radarRepo.saved(ctx.orgId);
}

export function saveRadarPost(ctx: Ctx, input: { key: string; status?: RadarSavedStatus; note?: string | null }) {
  requireRole(ctx, "editor");
  const cur = radarRepo.savedOne(ctx.orgId, input.key);
  const p = cur ? null : scored(ctx.orgId, {}).find((x) => x.key === input.key);
  // Kayıtlıysa yalnız durum/not değişir; ilk kayıtta gönderinin o anki hâli saklanır
  const base = cur ?? (p ? { username: p.account.username, permalink: p.permalink, kind: p.kind, caption: p.caption.slice(0, 2200), thumbnailUrl: p.thumbnailUrl, outlier: p.outlier, status: "idea" as const, note: null } : null);
  if (!base) throw notFound("post");
  radarRepo.putSaved(ctx.orgId, {
    key: input.key,
    username: base.username,
    permalink: base.permalink,
    kind: base.kind,
    caption: base.caption,
    thumbnailUrl: base.thumbnailUrl,
    outlier: base.outlier,
    status: input.status ?? base.status,
    note: input.note === undefined ? base.note : input.note,
  });
  return radarRepo.savedOne(ctx.orgId, input.key);
}

export function unsaveRadarPost(ctx: Ctx, key: string) {
  requireRole(ctx, "editor");
  radarRepo.removeSaved(ctx.orgId, key);
}

export function listSponsors(ctx: Ctx) {
  const rows = new Map(radarCreators(ctx, {}).map((c) => [c.username, c]));
  return radarRepo.sponsors(ctx.orgId).map((s) => {
    const c = rows.get(s.username);
    return { ...s, creator: c ? { id: c.id, fullName: c.fullName, avatarUrl: c.avatarUrl, followers: c.followers, engagementRate: c.engagementRate, radarScore: c.radarScore, email: c.email } : null };
  });
}

export function putSponsor(ctx: Ctx, input: { username: string; status?: RadarSponsorStatus; note?: string | null; contact?: string | null; price?: string | null }) {
  requireRole(ctx, "editor");
  const u = normalizeUsername(input.username);
  if (!u) throw new AppError(400, "radar.bad_username");
  radarRepo.putSponsor(ctx.orgId, { ...input, username: u });
  return radarRepo.sponsor(ctx.orgId, u);
}

export function removeSponsor(ctx: Ctx, username: string) {
  requireRole(ctx, "editor");
  radarRepo.removeSponsor(ctx.orgId, username.replace(/^@/, "").toLowerCase());
}

/* ============================== Uyarlama ve taslak ============================== */

const KIND_LABEL: Record<MediaKind, string> = { REEL: "Reel", VIDEO: "Video", CAROUSEL: "Carousel", IMAGE: "Single image" };

function performanceLine(p: RadarFeedPost): string {
  return [
    p.views !== null ? `${p.views} views` : null,
    p.likes !== null ? `${p.likes} likes` : null,
    p.comments !== null ? `${p.comments} comments` : null,
    p.outlier !== null ? `${p.outlier}x the account's median` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export async function adaptRadarPost(ctx: Ctx, key: string): Promise<{ text: string }> {
  requireRole(ctx, "editor");
  const { post } = radarPost(ctx, key);
  const text = await adaptViralPost(ctx.orgId, { kind: KIND_LABEL[post.kind], owner: post.account.username, followers: post.account.followers, performance: performanceLine(post) || "unknown", caption: post.caption, permalink: post.permalink });
  return { text };
}

/** MCP ve harici AI için: uyarlamayı istemcinin kendisi yazsın diye bağlam */
export function adaptContext(ctx: Ctx, key: string) {
  const { post } = radarPost(ctx, key);
  return {
    key,
    owner: post.account.username,
    followers: post.account.followers,
    kind: post.kind,
    performance: performanceLine(post),
    caption: post.caption,
    permalink: post.permalink,
    instructions: "Explain briefly why it worked, then write an ORIGINAL adaptation in the brand's voice (hooks, script or slides, caption, hashtags). Do not copy the source caption or script.",
  };
}

/** Uyarlanmış metinle Reblebi'de taslak gönderi açar (yayınlamaz) */
export async function radarDraft(ctx: Ctx, key: string, content: string, channelId?: string) {
  requireRole(ctx, "editor");
  const { post } = radarPost(ctx, key);
  const target = channelId ?? igChannel(ctx.orgId)?.id;
  if (!target) throw new AppError(400, "radar.no_channel");
  return createPost(ctx, {
    draft: true,
    kind: post.kind === "REEL" || post.kind === "VIDEO" ? "reel" : "post",
    content: content.slice(0, 70000),
    targets: [{ channelId: target }],
    notes: `İçerik radarı · kaynak: @${post.account.username} ${post.permalink ?? ""}${post.outlier !== null ? ` (${post.outlier}x)` : ""}`.slice(0, 5000),
    tags: ["radar"],
  });
}
