import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishResult } from "./types.js";

export const kickProvider: Provider = {
  id: "kick",
  label: "Kick",
  color: "#53FC18",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: false,
    thread: false,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 500,
    comments: false,
    maxMedia: 0,
    mediaNote: "Kick canlı yayın ve kanal topluluk duyurusu.",
  },
  settingFields: [],
  connectFields: [
    { key: "token", label: "Kick API / Webhook Token", type: "text" },
    { key: "channelName", label: "Kick Kanal Adı", type: "text" },
  ],
  // Paylaşım henüz gerçek API'ye bağlanmadı: bağlantı kapalı, sahte "yayınlandı" dönülmez
  isConfigured: () => false,

  async connectWithForm(values) {
    const token = values.token?.trim();
    const ch = values.channelName?.trim().toLowerCase();
    if (!token || !ch) throw new ProviderError("Kick Token ve Kanal Adı zorunlu");

    return [
      {
        externalId: `kick_${ch}`,
        name: `Kick (${ch})`,
        username: ch,
        accessToken: token,
        tokenExpiresAt: null,
        metadata: { channelName: ch },
      },
    ];
  },

  async publish(): Promise<PublishResult> {
    throw new ProviderError("Kick paylaşımı henüz desteklenmiyor; gönderi bu kanala gönderilmedi", 501);
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
