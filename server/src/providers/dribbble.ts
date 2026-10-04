import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishResult } from "./types.js";

export const dribbbleProvider: Provider = {
  id: "dribbble",
  label: "Dribbble",
  color: "#EA4C89",
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
    maxTextLength: 2000,
    comments: true,
    maxMedia: 1,
    requiresMedia: true,
    mediaNote: "Dribbble tasarımı (Shot): Başlık, görsel zorunludur.",
  },
  settingFields: [
    { key: "title", label: "Tasarım Başlığı (Shot Title)", type: "text" },
  ],
  connectFields: [
    { key: "accessToken", label: "Dribbble Client Access Token", type: "text" },
    { key: "displayName", label: "Dribbble Profil Adı", type: "text" },
  ],
  // Paylaşım henüz gerçek API'ye bağlanmadı: bağlantı kapalı, sahte "yayınlandı" dönülmez
  isConfigured: () => false,

  async connectWithForm(values) {
    const token = values.accessToken?.trim();
    if (!token) throw new ProviderError("Dribbble Access Token zorunlu");
    return [
      {
        externalId: `drb_${Date.now()}`,
        name: values.displayName?.trim() || "Dribbble",
        username: values.displayName?.trim() || null,
        accessToken: token,
        tokenExpiresAt: null,
        metadata: {},
      },
    ];
  },

  async publish(): Promise<PublishResult> {
    throw new ProviderError("Dribbble paylaşımı henüz desteklenmiyor; gönderi bu kanala gönderilmedi", 501);
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
