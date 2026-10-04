import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishResult } from "./types.js";

export const warpcastProvider: Provider = {
  id: "warpcast",
  label: "Warpcast",
  color: "#472A91",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: false,
    thread: true,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 320,
    comments: true,
    maxMedia: 2,
    mediaNote: "Farcaster / Warpcast cast yayını: 320 karakter sınırı, embed linkler.",
  },
  settingFields: [
    { key: "channelId", label: "Hedef Farcaster Kanalı (örn. dev, design)", type: "text" },
  ],
  connectFields: [
    { key: "signerUuid", label: "Neynar / Warpcast Signer UUID / API Key", type: "text" },
    { key: "displayName", label: "Farcaster Kullanıcı Adı (@...)", type: "text" },
  ],
  // Paylaşım henüz gerçek API'ye bağlanmadı: bağlantı kapalı, sahte "yayınlandı" dönülmez
  isConfigured: () => false,

  async connectWithForm(values) {
    const key = values.signerUuid?.trim();
    if (!key) throw new ProviderError("Warpcast Signer Key zorunlu");
    return [
      {
        externalId: `fc_${Date.now()}`,
        name: values.displayName?.trim() || "Warpcast",
        username: values.displayName?.trim() || null,
        accessToken: key,
        tokenExpiresAt: null,
        metadata: {},
      },
    ];
  },

  async publish(): Promise<PublishResult> {
    throw new ProviderError("Warpcast paylaşımı henüz desteklenmiyor; gönderi bu kanala gönderilmedi", 501);
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
