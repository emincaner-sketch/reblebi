import type { ProviderId } from "../core/types.js";
import { facebookProvider } from "./meta/facebook.js";
import { instagramProvider } from "./meta/instagram.js";
import { threadsProvider } from "./meta/threads.js";
import { whatsappProvider } from "./meta/whatsapp.js";
import { xProvider } from "./x.js";
import { linkedinProvider } from "./linkedin.js";
import { tiktokProvider } from "./tiktok.js";
import { youtubeProvider } from "./youtube.js";
import { telegramProvider } from "./telegram.js";
import type { Provider } from "./types.js";

export * from "./types.js";
export { parseMetaWebhook, lookupParticipant } from "./meta/webhook.js";

const registry: Record<ProviderId, Provider> = {
  instagram: instagramProvider,
  facebook: facebookProvider,
  threads: threadsProvider,
  whatsapp: whatsappProvider,
  x: xProvider,
  linkedin: linkedinProvider,
  tiktok: tiktokProvider,
  youtube: youtubeProvider,
  telegram: telegramProvider,
};

export function getProvider(id: ProviderId): Provider {
  const p = registry[id];
  if (!p) throw new Error(`Bilinmeyen sağlayıcı: ${id}`);
  return p;
}

export function listProviders(): Provider[] {
  return Object.values(registry);
}

/** Panelin ihtiyaç duyduğu, token içermeyen sağlayıcı açıklaması */
export function describeProvider(p: Provider) {
  return {
    id: p.id,
    label: p.label,
    color: p.color,
    capabilities: p.capabilities,
    settingFields: p.settingFields,
    connectMode: p.connectMode,
    connectFields: p.connectFields ?? [],
    configured: p.isConfigured(),
    /** Instagram ve Facebook aynı Meta OAuth akışını paylaşır */
    oauthGroup: p.id === "instagram" || p.id === "facebook" ? "meta" : p.id,
  };
}
