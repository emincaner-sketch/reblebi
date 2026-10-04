import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishResult } from "./types.js";

export const nostrProvider: Provider = {
  id: "nostr",
  label: "Nostr",
  color: "#8E44AD",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: false,
    thread: true,
    dm: false,
    inbound: "none",
    analytics: false,
    maxTextLength: 5000,
    comments: true,
    maxMedia: 4,
    mediaNote: "Nostr merkeziyetsiz protokolü (NIP-01): Kind 1 kısa not paylaşımı.",
  },
  settingFields: [],
  connectFields: [
    { key: "privateKey", label: "Nostr nsec / Private Key (Hex veya nsec1...)", type: "text", help: "Mesajları imzalamak için Nostr gizli anahtarı" },
    { key: "relays", label: "Relay Sunucuları (virgülle ayır)", type: "text", help: "Varsayılan: wss://relay.damus.io, wss://nos.lol" },
    { key: "displayName", label: "Görünen Ad / npub", type: "text" },
  ],
  // Paylaşım henüz gerçek API'ye bağlanmadı: bağlantı kapalı, sahte "yayınlandı" dönülmez
  isConfigured: () => false,

  async connectWithForm(values) {
    const key = values.privateKey?.trim();
    if (!key) throw new ProviderError("Nostr Private Key (nsec) zorunlu");
    const relays = (values.relays?.trim() || "wss://relay.damus.io,wss://nos.lol").split(",").map((s) => s.trim());

    return [
      {
        externalId: `nostr_${Date.now()}`,
        name: values.displayName?.trim() || "Nostr Hesabı",
        username: values.displayName?.trim() || null,
        accessToken: key,
        tokenExpiresAt: null,
        metadata: { relays },
      },
    ];
  },

  async publish(): Promise<PublishResult> {
    throw new ProviderError("Nostr paylaşımı henüz desteklenmiyor; gönderi bu kanala gönderilmedi", 501);
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
