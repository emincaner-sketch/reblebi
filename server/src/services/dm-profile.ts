import { AppError, notFound } from "../core/i18n.js";
import { channelsRepo } from "../core/repos/channels.js";
import { dmProfilesRepo } from "../core/repos/dm-profile.js";
import { inboxRepo } from "../core/repos/inbox.js";
import { activityRepo } from "../core/repos/misc.js";
import type { Channel, Conversation, Ctx, DmProfile, DmProfileItem } from "../core/types.js";
import { getProvider, type MessengerProfileInput } from "../providers/index.js";
import { requireRole } from "./access.js";
import { assertFeature } from "./limits.js";
import { ensureFreshToken } from "./publisher.js";

/**
 * Sohbet menüsü (ManyChat "ice breakers" ve "main menu" benzeri), kanal başına.
 * - Hazır sorular (ice breakers): kişi sohbeti ilk açtığında çıkan en fazla 4 soru.
 * - Sabit menü (persistent menu): sohbet ekranındaki menü; en fazla 20 öğe, bağlantı ya da cevap.
 * Kaydedince Meta'nın Messenger Profile API'sine gönderilir. Kişi bir öğeye basınca postback gelir
 * ("ib:<sıra>" ya da "pm:<sıra>"); öğenin cevabı varsa o gider, yoksa normal DM kuralları cevaplar.
 */

export const ICE_BREAKER_MAX = 4;
export const ICE_BREAKER_CHARS = 80;
export const MENU_MAX = 20;
export const MENU_TITLE_CHARS = 30;

const ICE_PREFIX = "ib:";
const MENU_PREFIX = "pm:";

export interface DmProfileInput {
  iceBreakers: DmProfileItem[];
  menu: DmProfileItem[];
}

function emptyProfile(channel: Channel): DmProfile {
  return { channelId: channel.id, orgId: channel.orgId, iceBreakers: [], menu: [], syncedAt: null, syncError: null, updatedAt: null };
}

function loadChannel(ctx: Ctx, channelId: string): Channel {
  const channel = channelsRepo.get(ctx.orgId, channelId);
  if (!channel) throw notFound("channel");
  if (channel.provider !== "instagram" && channel.provider !== "facebook") throw new AppError(400, "dm_profile.provider");
  return channel;
}

/** Öğeleri kırpar, boş başlıkları atar, bağlantı ile cevabı ayırır; sınır aşımında hata verir */
export function normalizeDmProfile(input: DmProfileInput): DmProfileInput {
  const clean = (items: DmProfileItem[], allowUrl: boolean): DmProfileItem[] =>
    items
      .map((i) => ({ title: i.title.trim().replace(/\s+/g, " "), url: allowUrl ? i.url?.trim() || null : null, replyText: i.replyText?.trim() || null }))
      .filter((i) => i.title)
      .map((i) => (i.url ? { title: i.title, url: i.url, replyText: null } : { title: i.title, url: null, replyText: i.replyText }));
  const iceBreakers = clean(input.iceBreakers, false);
  const menu = clean(input.menu, true);
  if (iceBreakers.length > ICE_BREAKER_MAX) throw new AppError(400, "dm_profile.ice_breakers");
  if (iceBreakers.some((i) => i.title.length > ICE_BREAKER_CHARS)) throw new AppError(400, "dm_profile.ice_breaker_chars");
  if (menu.length > MENU_MAX) throw new AppError(400, "dm_profile.menu");
  if (menu.some((i) => i.title.length > MENU_TITLE_CHARS)) throw new AppError(400, "dm_profile.menu_chars");
  if (menu.some((i) => i.url && !/^https:\/\//.test(i.url))) throw new AppError(400, "dm_profile.url");
  return { iceBreakers, menu };
}

/** Kayıtlı menüyü Meta'nın beklediği biçime çevirir */
export function toMessengerProfile(p: DmProfileInput): MessengerProfileInput {
  return {
    iceBreakers: p.iceBreakers.map((i, n) => ({ question: i.title, payload: `${ICE_PREFIX}${n}` })),
    menu: p.menu.map((i, n) => (i.url ? { type: "web_url" as const, title: i.title, url: i.url } : { type: "postback" as const, title: i.title, payload: `${MENU_PREFIX}${n}` })),
  };
}

export function getDmProfile(ctx: Ctx, channelId: string): DmProfile {
  const channel = loadChannel(ctx, channelId);
  return dmProfilesRepo.get(channel.id) ?? emptyProfile(channel);
}

/** Meta'ya gönderir; sonuç kayda yazılır. Hata fırlatmaz: panel syncError'u gösterir. */
async function pushToMeta(channel: Channel, profile: DmProfile): Promise<DmProfile> {
  const provider = getProvider(channel.provider);
  try {
    if (!provider.setMessengerProfile) throw new Error("kanal sohbet menüsünü desteklemiyor");
    const fresh = await ensureFreshToken(channel);
    await provider.setMessengerProfile(fresh, toMessengerProfile(profile));
    return dmProfilesRepo.markSynced(channel.id, { at: new Date().toISOString() })!;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    activityRepo.add(channel.orgId, "error", "dm", `${channel.name}: sohbet menüsü gönderilemedi: ${msg}`, { channelId: channel.id });
    return dmProfilesRepo.markSynced(channel.id, { error: msg })!;
  }
}

/** Panelden kaydet: yerelde saklar ve hemen Meta'ya gönderir (boş listeler Meta'daki ayarı kaldırır) */
export async function saveDmProfile(ctx: Ctx, channelId: string, input: DmProfileInput): Promise<DmProfile> {
  requireRole(ctx, "admin");
  assertFeature(ctx.orgId, "inbox");
  const channel = loadChannel(ctx, channelId);
  const saved = dmProfilesRepo.save(ctx.orgId, channel.id, normalizeDmProfile(input));
  return pushToMeta(channel, saved);
}

/** Kayıtlı menüyü yeniden gönderir (önceki gönderim hata verdiyse) */
export async function resyncDmProfile(ctx: Ctx, channelId: string): Promise<DmProfile> {
  requireRole(ctx, "admin");
  assertFeature(ctx.orgId, "inbox");
  const channel = loadChannel(ctx, channelId);
  const cur = dmProfilesRepo.get(channel.id);
  if (!cur) return emptyProfile(channel);
  return pushToMeta(channel, cur);
}

/**
 * Hazır soruya ya da menü öğesine basıldıysa öğenin cevabını gönderir.
 * Dönen değer: true ise olay burada bitti; false ise normal DM kuralları çalışır
 * (bu özelliğe ait değil, ya da öğenin cevabı boş: kuralların ya da yapay zekânın cevaplaması istenmiş).
 * Menü değiştiyse sıra kaymış olabilir: önce sıra, başlık tutmazsa başlıkla aranır.
 */
export async function handleProfileButton(
  channel: Channel,
  conversation: Conversation,
  postback: { payload: string; title: string },
  send: (text: string) => Promise<unknown>,
): Promise<boolean> {
  const { payload, title } = postback;
  const list = payload.startsWith(ICE_PREFIX) ? "iceBreakers" : payload.startsWith(MENU_PREFIX) ? "menu" : null;
  if (!list) return false;
  const items = dmProfilesRepo.get(channel.id)?.[list] ?? [];
  const byIndex = items[Number(payload.slice(ICE_PREFIX.length))];
  const item = byIndex && byIndex.title === title ? byIndex : (items.find((i) => i.title === title) ?? byIndex);
  const replyText = item?.replyText?.trim();
  if (!replyText) return false;
  if (conversation.mode === "manual") {
    inboxRepo.flagAttention(conversation.id, true);
    return true;
  }
  await send(replyText);
  return true;
}
