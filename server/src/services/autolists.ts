import { AppError, notFound } from "../core/i18n.js";
import { createLogger } from "../core/logger.js";
import { autolistsRepo, type Autolist, type AutolistItem, type AutolistSlot } from "../core/repos/autolists.js";
import { channelsRepo } from "../core/repos/channels.js";
import { libraryRepo } from "../core/repos/library.js";
import { activityRepo, mediaRepo } from "../core/repos/misc.js";
import { orgSettingsRepo, orgsRepo } from "../core/repos/orgs.js";
import { postsRepo } from "../core/repos/posts.js";
import type { Ctx, PostKind } from "../core/types.js";
import { canApprove, requireRole } from "./access.js";
import { addDays, localYmd, zonedMidnight } from "./analytics-report.js";
import { consumePostQuota } from "./limits.js";
import { validatePost } from "./posts.js";

/**
 * Otomatik listeler (Metricool "Autolists"): bir içerik kuyruğu seçilen haftalık gün/saatlerde sırayla
 * paylaşılır; liste bitince isterse başa döner (evergreen içerik). Zamanlayıcı dakikada bir bakar; kaçırılan
 * saatler en fazla 15 dakika geriye telafi edilir (sunucu kapalı kaldıysa toplu paylaşım yapılmaz).
 */

const log = createLogger("autolists");
export const MAX_AUTOLISTS = 20;
export const MAX_ITEMS = 500;
const CATCHUP_MS = 15 * 60_000;
const DAY = 86_400_000;

const tzOf = (orgId: string) => orgsRepo.get(orgId)?.timezone || "Europe/Istanbul";

/** [from, to] aralığındaki slot anları (artan) */
export function slotInstants(slots: AutolistSlot[], tz: string, from: number, to: number): number[] {
  const out: number[] = [];
  for (let ymd = localYmd(from - DAY, tz), end = localYmd(to + DAY, tz); ymd <= end; ymd = addDays(ymd, 1)) {
    const wd = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
    const base = zonedMidnight(ymd, tz);
    for (const s of slots) {
      if (s.day !== wd) continue;
      const [h, m] = s.time.split(":").map(Number);
      const at = base + h * 3_600_000 + m * 60_000;
      if (at >= from && at <= to) out.push(at);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Sıradaki paylaşımlar: hangi saatte hangi öğe (önizleme) */
export function upcoming(list: Autolist, items: AutolistItem[], now = Date.now(), count = 5): Array<{ at: string; itemId: string; preview: string }> {
  if (!items.length || !list.slots.length) return [];
  const out: Array<{ at: string; itemId: string; preview: string }> = [];
  let pos = list.position;
  for (const at of slotInstants(list.slots, tzOf(list.orgId), now + 1, now + 28 * DAY)) {
    if (pos >= items.length) {
      if (!list.repeat) break;
      pos = 0;
    }
    const it = items[pos];
    out.push({ at: new Date(at).toISOString(), itemId: it.id, preview: it.content.replace(/\s+/g, " ").slice(0, 80) });
    pos++;
    if (out.length >= count) break;
  }
  return out;
}

/** Zamanlayıcı: vakti gelen listelerden bir gönderi oluşturur (normal yayın kuyruğu yayınlar) */
export async function runAutolists(now = Date.now()): Promise<number> {
  let created = 0;
  for (const list of autolistsRepo.listEnabled()) {
    const org = orgsRepo.get(list.orgId);
    if (!org || org.disabled) continue;
    const since = Math.max(list.lastRunAt ? Date.parse(list.lastRunAt) : 0, Date.parse(list.updatedAt), now - CATCHUP_MS);
    const due = slotInstants(list.slots, org.timezone || "Europe/Istanbul", since + 1, now).pop();
    if (due === undefined) continue;
    const slotIso = new Date(due).toISOString();
    const items = autolistsRepo.items(list.id);
    const keep = (error: string | null, position = list.position, enabled = true) => autolistsRepo.advance(list.id, { position, lastRunAt: slotIso, enabled, error });
    if (!items.length) {
      keep("empty");
      continue;
    }
    let pos = list.position;
    if (pos >= items.length) {
      if (!list.repeat) {
        keep(null, pos, false);
        continue;
      }
      pos = 0;
    }
    const item = items[pos];
    const channelIds = list.channelIds.filter((id) => {
      const ch = channelsRepo.get(list.orgId, id);
      return ch && ch.status !== "disabled" && ch.status !== "expired";
    });
    const next = pos + 1;
    const finished = next >= items.length && !list.repeat;
    const advanceTo = finished ? next : next % items.length;
    if (!channelIds.length) {
      keep("no_channels");
      continue;
    }
    const ctx: Ctx = { orgId: list.orgId, userId: list.createdBy, role: "editor", via: "session", locale: org.locale };
    const v = validatePost(ctx, { kind: item.kind, content: item.content, mediaIds: item.mediaIds, targets: channelIds.map((channelId) => ({ channelId })), publishAt: "now" });
    if (!v.ok) {
      // Uygun olmayan öğe kuyruğu kilitlemesin: atlanır, hata panelde görünür
      activityRepo.add(list.orgId, "warn", "autolist", `${list.name}: ${v.errors.join(" | ").slice(0, 300)}`, { autolistId: list.id, itemId: item.id });
      keep(v.errors.join(" | ").slice(0, 500), advanceTo, !finished);
      continue;
    }
    try {
      consumePostQuota(list.orgId, 1);
    } catch (e) {
      keep(e instanceof AppError ? e.key : "quota");
      continue;
    }
    const post = postsRepo.create({
      orgId: list.orgId,
      title: null,
      kind: item.kind,
      content: item.content,
      mediaIds: item.mediaIds,
      publishAt: new Date(now).toISOString(),
      status: "scheduled",
      source: "autolist",
      createdBy: list.createdBy,
      campaignId: null,
      tags: [],
      comments: [],
      recurrence: null,
      notes: null,
      targets: channelIds.map((channelId) => ({ channelId, content: null, mediaIds: null, settings: {} })),
    });
    autolistsRepo.markUsed(item.id, new Date(now).toISOString());
    keep(null, advanceTo, !finished);
    activityRepo.add(list.orgId, "info", "autolist", `${list.name} · ${item.content.replace(/\s+/g, " ").slice(0, 60)}`, { autolistId: list.id, postId: post.id });
    log.info("otomatik liste gönderisi oluşturuldu", { autolist: list.id, post: post.id });
    created++;
  }
  return created;
}

/* ---------------- Panel işlemleri ---------------- */

function ownedChannels(orgId: string, ids: string[]): string[] {
  return [...new Set(ids)].filter((id) => channelsRepo.get(orgId, id));
}

export function getAutolist(ctx: Ctx, id: string) {
  const list = autolistsRepo.get(ctx.orgId, id);
  if (!list) throw notFound("autolist");
  const items = autolistsRepo.items(list.id);
  return { ...list, items, upcoming: upcoming(list, items, Date.now(), 10) };
}

export function listAutolists(ctx: Ctx) {
  return {
    items: autolistsRepo.list(ctx.orgId).map((l) => {
      const items = autolistsRepo.items(l.id);
      return { ...l, itemCount: items.length, upcoming: upcoming(l, items, Date.now(), 3) };
    }),
    max: MAX_AUTOLISTS,
  };
}

export function createAutolist(ctx: Ctx, a: { name: string; channelIds: string[]; slots: AutolistSlot[]; repeat: boolean }) {
  requireRole(ctx, "editor");
  if (autolistsRepo.list(ctx.orgId).length >= MAX_AUTOLISTS) throw new AppError(400, "autolist.too_many", { max: MAX_AUTOLISTS });
  return autolistsRepo.create(ctx.orgId, { ...a, channelIds: ownedChannels(ctx.orgId, a.channelIds), createdBy: ctx.userId });
}

export function updateAutolist(ctx: Ctx, id: string, patch: Partial<Pick<Autolist, "name" | "channelIds" | "slots" | "repeat" | "enabled" | "position">>) {
  requireRole(ctx, "editor");
  const cur = autolistsRepo.get(ctx.orgId, id);
  if (!cur) throw notFound("autolist");
  if (patch.enabled && !cur.enabled) {
    // Onay modu "tümü" ise listeyi yayına yalnızca onay yetkisi olan açar (her gönderi tek tek onaya düşmez)
    if (orgSettingsRepo.get(ctx.orgId).approvalMode === "all" && !canApprove(ctx)) throw new AppError(403, "autolist.needs_approval");
    const n = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Autolist;
    if (!autolistsRepo.countItems(id)) throw new AppError(400, "autolist.empty");
    if (!ownedChannels(ctx.orgId, n.channelIds).length || !n.slots.length) throw new AppError(400, "autolist.incomplete");
  }
  const count = autolistsRepo.countItems(id);
  const position = patch.position === undefined ? undefined : Math.max(0, Math.min(Math.round(patch.position), Math.max(0, count - 1)));
  return autolistsRepo.update(ctx.orgId, id, { ...patch, position, channelIds: patch.channelIds ? ownedChannels(ctx.orgId, patch.channelIds) : undefined })!;
}

export function removeAutolist(ctx: Ctx, id: string): void {
  requireRole(ctx, "editor");
  autolistsRepo.remove(ctx.orgId, id);
}

function listFor(ctx: Ctx, id: string): Autolist {
  requireRole(ctx, "editor");
  const list = autolistsRepo.get(ctx.orgId, id);
  if (!list) throw notFound("autolist");
  return list;
}

export function addItem(ctx: Ctx, id: string, i: { kind: PostKind; content: string; mediaIds: string[] }): AutolistItem {
  const list = listFor(ctx, id);
  if (autolistsRepo.countItems(list.id) >= MAX_ITEMS) throw new AppError(400, "autolist.too_many_items", { max: MAX_ITEMS });
  const mediaIds = mediaRepo.getMany(ctx.orgId, i.mediaIds).map((m) => m.id);
  if (!i.content.trim() && !mediaIds.length) throw new AppError(400, "library.empty");
  return autolistsRepo.addItem(list.id, { kind: i.kind, content: i.content, mediaIds });
}

/** Kütüphanedeki gönderi şablonlarını listeye kopyalar */
export function importFromLibrary(ctx: Ctx, id: string, libraryIds: string[]): { added: number } {
  const list = listFor(ctx, id);
  let added = 0;
  for (const lid of [...new Set(libraryIds)]) {
    const t = libraryRepo.get(ctx.orgId, lid);
    if (!t || t.type !== "post") continue;
    if (autolistsRepo.countItems(list.id) >= MAX_ITEMS) break;
    autolistsRepo.addItem(list.id, { kind: t.kind, content: t.content, mediaIds: t.mediaIds });
    added++;
  }
  return { added };
}

export function updateItem(ctx: Ctx, id: string, itemId: string, patch: { kind?: PostKind; content?: string; mediaIds?: string[] }): AutolistItem {
  const list = listFor(ctx, id);
  const mediaIds = patch.mediaIds ? mediaRepo.getMany(ctx.orgId, patch.mediaIds).map((m) => m.id) : undefined;
  const it = autolistsRepo.updateItem(list.id, itemId, { ...patch, mediaIds });
  if (!it) throw notFound("autolist");
  return it;
}

export function removeItem(ctx: Ctx, id: string, itemId: string): void {
  const list = listFor(ctx, id);
  const before = autolistsRepo.items(list.id).findIndex((x) => x.id === itemId);
  autolistsRepo.removeItem(list.id, itemId);
  // Sıradaki öğeden önceki bir öğe silindiyse sıra kaymasın
  if (before >= 0 && before < list.position) autolistsRepo.update(ctx.orgId, list.id, { position: list.position - 1 });
}

export function reorderItems(ctx: Ctx, id: string, ids: string[]): AutolistItem[] {
  const list = listFor(ctx, id);
  autolistsRepo.reorder(list.id, ids);
  return autolistsRepo.items(list.id);
}
