import { config } from "../core/config.js";
import { AppError, notFound } from "../core/i18n.js";
import { channelsRepo, publicChannel, type PublicChannel } from "../core/repos/channels.js";
import { customersRepo } from "../core/repos/content.js";
import { activityRepo, oauthStatesRepo } from "../core/repos/misc.js";
import { orgSettingsRepo } from "../core/repos/orgs.js";
import type { Channel, Ctx, ProviderId } from "../core/types.js";
import { getProvider, type ConnectedAccount } from "../providers/index.js";
import { instagramLoginFlow } from "../providers/meta/instagram.js";
import { requireRole } from "./access.js";
import { assertChannelQuota } from "./limits.js";
import { ensureFreshToken } from "./publisher.js";
import { describeSlots } from "./slots.js";

/** Meta OAuth akışı 'meta' adıyla başlatılır; instagram + facebook aynı dönüşte oluşur */
export function resolveOAuthProvider(name: string): ProviderId {
  if (name === "meta") return "facebook";
  if (name === "instagram-login") return "instagram";
  const valid: ProviderId[] = ["instagram", "facebook", "threads", "whatsapp", "x", "linkedin", "tiktok", "youtube", "telegram"];
  if (!valid.includes(name as ProviderId)) throw new AppError(404, "err.not_found", { what: "provider" });
  return name as ProviderId;
}

export function oauthRedirectUri(providerName: string): string {
  return `${config.publicUrl}/api/oauth/${providerName}/callback`;
}

/** AI ve panel için kanal + platform kuralları tek yerde */
export function describeChannel(c: Channel) {
  const p = getProvider(c.provider);
  const settings = orgSettingsRepo.get(c.orgId);
  return {
    ...publicChannel(c),
    providerLabel: p.label,
    capabilities: p.capabilities,
    settingFields: p.settingFields,
    postingTimes: describeSlots(c.timeSlots.length ? c.timeSlots : settings.defaultTimeSlots),
    customerName: c.customerId ? (customersRepo.get(c.orgId, c.customerId)?.name ?? null) : null,
  };
}

export function listChannels(ctx: Ctx) {
  return channelsRepo.list(ctx.orgId).map(describeChannel);
}

function saveAccounts(ctx: Ctx, pid: ProviderId, accounts: ConnectedAccount[]): PublicChannel[] {
  const newOnes = accounts.filter((a) => !channelsRepo.findByExternal(ctx.orgId, a.provider ?? pid, a.externalId));
  assertChannelQuota(ctx.orgId, newOnes.length);
  const saved = accounts.map((a) => channelsRepo.upsert({ orgId: ctx.orgId, provider: a.provider ?? pid, ...a }).channel);
  activityRepo.add(ctx.orgId, "info", "channel", `${getProvider(pid).label}: ${saved.map((c) => c.name).join(", ")}`);
  return saved.map(publicChannel);
}

export async function connectWithForm(ctx: Ctx, pid: ProviderId, values: Record<string, string>): Promise<PublicChannel[]> {
  requireRole(ctx, "admin");
  const provider = getProvider(pid);
  if (provider.connectMode !== "form" || !provider.connectWithForm) throw new AppError(400, "channel.oauth_only");
  assertChannelQuota(ctx.orgId, 1);
  const accounts = await provider.connectWithForm(values);
  return saveAccounts(ctx, pid, accounts);
}

/** "instagram-login": Facebook Sayfası gerektirmeyen doğrudan Instagram girişi; diğerleri sağlayıcının kendi akışı */
function oauthFlow(name: string, pid: ProviderId) {
  return name === "instagram-login" ? instagramLoginFlow : getProvider(pid);
}

export function startOAuth(ctx: Ctx, name: string): { url: string } {
  requireRole(ctx, "admin");
  const pid = resolveOAuthProvider(name);
  const provider = oauthFlow(name, pid);
  if (!provider.oauthStart) throw new AppError(400, "channel.form_only");
  if (!provider.isConfigured()) throw new AppError(400, "channel.not_configured", { provider: provider.label });
  assertChannelQuota(ctx.orgId, 1);
  const state = oauthStatesRepo.create(pid, ctx.orgId, ctx.userId);
  const start = provider.oauthStart(oauthRedirectUri(name), state);
  if (start.codeVerifier) oauthStatesRepo.setVerifier(state, start.codeVerifier);
  return { url: start.url };
}

/** OAuth dönüşü: state içinden hangi çalışma alanı için bağlandığı çözülür */
export async function finishOAuth(name: string, code: string, state: string): Promise<{ orgId: string; channels: PublicChannel[] }> {
  const st = oauthStatesRepo.consume(state);
  if (!st) throw new AppError(400, "channel.oauth_state");
  const pid = resolveOAuthProvider(name);
  const provider = oauthFlow(name, pid);
  if (!provider.oauthCallback) throw new AppError(400, "channel.form_only");
  const accounts = await provider.oauthCallback(code, oauthRedirectUri(name), st.codeVerifier);
  const ctx: Ctx = { orgId: st.orgId, userId: st.userId, role: "admin", via: "session", locale: "tr" };
  return { orgId: st.orgId, channels: saveAccounts(ctx, pid, accounts) };
}

export function updateChannel(
  ctx: Ctx,
  id: string,
  patch: { name?: string; status?: "active" | "disabled"; customerId?: string | null; postingTimes?: string[]; preferences?: Record<string, unknown>; dmPolling?: boolean },
) {
  requireRole(ctx, "admin");
  const ch = channelsRepo.get(ctx.orgId, id);
  if (!ch) throw notFound("channel");
  let timeSlots: number[] | undefined;
  if (patch.postingTimes) {
    timeSlots = patch.postingTimes
      .map((s) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
        return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
      })
      .filter((n) => Number.isFinite(n) && n >= 0 && n < 1440);
    timeSlots = [...new Set(timeSlots)].sort((a, b) => a - b);
  }
  if (patch.customerId && !customersRepo.get(ctx.orgId, patch.customerId)) throw notFound("customer");
  channelsRepo.update(ctx.orgId, id, {
    name: patch.name,
    customerId: patch.customerId,
    timeSlots,
    preferences: patch.preferences,
    metadata: patch.dmPolling === undefined ? undefined : { dmPolling: patch.dmPolling },
  });
  if (patch.status) channelsRepo.setStatus(id, patch.status, null);
  return describeChannel(channelsRepo.get(ctx.orgId, id)!);
}

export function removeChannel(ctx: Ctx, id: string): void {
  requireRole(ctx, "admin");
  const ch = channelsRepo.get(ctx.orgId, id);
  if (!ch) throw notFound("channel");
  channelsRepo.remove(ctx.orgId, id);
  activityRepo.add(ctx.orgId, "warn", "channel", `${ch.name} removed`);
}

export async function checkChannel(ctx: Ctx, id: string): Promise<{ ok: boolean; detail?: string; channel: ReturnType<typeof describeChannel> }> {
  const ch = channelsRepo.get(ctx.orgId, id);
  if (!ch) throw notFound("channel");
  const provider = getProvider(ch.provider);
  try {
    const fresh = await ensureFreshToken(ch);
    const r = provider.healthCheck ? await provider.healthCheck(fresh) : { ok: true };
    channelsRepo.setStatus(id, r.ok ? "active" : "error", r.ok ? null : (r.detail ?? "error"));
    return { ...r, channel: describeChannel(channelsRepo.get(ctx.orgId, id)!) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), channel: describeChannel(channelsRepo.get(ctx.orgId, id)!) };
  }
}
