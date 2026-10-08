import { config } from "../core/config.js";
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
import { redditProvider } from "./reddit.js";
import { pinterestProvider } from "./pinterest.js";
import { gmbProvider } from "./gmb.js";
import { slackProvider } from "./slack.js";
import { discordProvider } from "./discord.js";
import { blueskyProvider } from "./bluesky.js";
import { mastodonProvider } from "./mastodon.js";
import { wordpressProvider } from "./wordpress.js";
import { mediumProvider } from "./medium.js";
import { devtoProvider } from "./devto.js";
import { hashnodeProvider } from "./hashnode.js";
import { nostrProvider } from "./nostr.js";
import { warpcastProvider } from "./warpcast.js";
import { lemmyProvider } from "./lemmy.js";
import { vkProvider } from "./vk.js";
import { dribbbleProvider } from "./dribbble.js";
import { twitchProvider } from "./twitch.js";
import { kickProvider } from "./kick.js";
import type { Provider } from "./types.js";

export * from "./types.js";
export { parseMetaWebhook, lookupParticipant } from "./meta/webhook.js";
export { parseSignedRequest } from "./meta/common.js";

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
  reddit: redditProvider,
  pinterest: pinterestProvider,
  gmb: gmbProvider,
  slack: slackProvider,
  discord: discordProvider,
  bluesky: blueskyProvider,
  mastodon: mastodonProvider,
  wordpress: wordpressProvider,
  medium: mediumProvider,
  devto: devtoProvider,
  hashnode: hashnodeProvider,
  nostr: nostrProvider,
  warpcast: warpcastProvider,
  lemmy: lemmyProvider,
  vk: vkProvider,
  dribbble: dribbbleProvider,
  twitch: twitchProvider,
  kick: kickProvider,
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
    /** Instagram için ikinci yol: Facebook Sayfası gerektirmeyen doğrudan Instagram girişi */
    ...(p.id === "instagram" ? { directLogin: { oauthGroup: "instagram-login", configured: Boolean(config.instagram.appId && config.instagram.appSecret) } } : {}),
  };
}
