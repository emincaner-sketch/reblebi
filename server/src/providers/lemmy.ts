import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishResult } from "./types.js";

export const lemmyProvider: Provider = {
  id: "lemmy",
  label: "Lemmy",
  color: "#2C3E50",
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
    maxTextLength: 10000,
    comments: true,
    maxMedia: 5,
    mediaNote: "Lemmy topluluk gönderisi: Topluluk adı, başlık, gövde veya link.",
  },
  settingFields: [
    { key: "community", label: "Topluluk (Community) Adı (örn. teknoloji)", type: "text" },
  ],
  connectFields: [
    { key: "instanceUrl", label: "Lemmy Sunucu URL (örn. https://lemmy.world)", type: "text" },
    { key: "jwtToken", label: "Lemmy Auth JWT Token", type: "text" },
    { key: "displayName", label: "Görünen Ad", type: "text" },
  ],
  // Paylaşım henüz gerçek API'ye bağlanmadı: bağlantı kapalı, sahte "yayınlandı" dönülmez
  isConfigured: () => false,

  async connectWithForm(values) {
    const instance = values.instanceUrl?.trim().replace(/\/$/, "");
    const token = values.jwtToken?.trim();
    if (!instance || !token) throw new ProviderError("Lemmy Sunucu URL ve Token zorunlu");

    return [
      {
        externalId: `lemmy_${Date.now()}`,
        name: values.displayName?.trim() || `Lemmy (${new URL(instance).hostname})`,
        username: values.displayName?.trim() || null,
        accessToken: token,
        tokenExpiresAt: null,
        metadata: { instanceUrl: instance },
      },
    ];
  },

  async publish(): Promise<PublishResult> {
    throw new ProviderError("Lemmy paylaşımı henüz desteklenmiyor; gönderi bu kanala gönderilmedi", 501);
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
