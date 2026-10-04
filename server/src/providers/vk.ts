import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

export const vkProvider: Provider = {
  id: "vk",
  label: "VKontakte",
  color: "#4680C2",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: true,
    thread: false,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 4096,
    comments: true,
    maxMedia: 10,
    mediaNote: "VK duvar gönderisi: Topluluk/grup veya profil duvarında metin ve görsel paylaşımı.",
  },
  settingFields: [],
  connectFields: [
    { key: "accessToken", label: "VK Access Token", type: "text" },
    { key: "ownerId", label: "Grup / Kullanıcı ID (Topluluklar için negatif: -12345)", type: "text" },
    { key: "displayName", label: "Topluluk / Profil Adı", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const token = values.accessToken?.trim();
    if (!token) throw new ProviderError("VK Access Token zorunlu");
    const ownerId = values.ownerId?.trim() || "";

    return [
      {
        externalId: `vk_${ownerId || Date.now()}`,
        name: values.displayName?.trim() || "VK Topluluğu",
        username: null,
        accessToken: token,
        tokenExpiresAt: null,
        metadata: { ownerId },
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const ownerId = channel.metadata.ownerId as string;
    try {
      const res = await http<{ response?: { post_id: number } }>("https://api.vk.com/method/wall.post", {
        method: "POST",
        form: {
          access_token: channel.accessToken,
          v: "5.131",
          owner_id: ownerId || undefined,
          message: input.text,
          from_group: "1",
        },
      });
      const postId = res.response?.post_id || Date.now();
      return { externalId: String(postId), url: `https://vk.com/wall${ownerId}_${postId}` };
    } catch (e: any) {
      throw new ProviderError(e.message || "VK gönderisi yayınlanamadı");
    }
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
