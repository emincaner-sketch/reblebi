import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

export const mastodonProvider: Provider = {
  id: "mastodon",
  label: "Mastodon",
  color: "#6364FF",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: true,
    thread: true,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 500,
    comments: true,
    maxMedia: 4,
    mediaNote: "Mastodon federasyonunda gönderi: metin (varsayılan 500 karakter), 4 görsel/video, içerik uyarısı (CW).",
  },
  settingFields: [
    { key: "spoilerText", label: "İçerik Uyarısı / Spoiler (CW)", type: "text" },
    {
      key: "visibility",
      label: "Görünürlük",
      type: "select",
      options: [
        { value: "public", label: "Herkese Açık (Public)" },
        { value: "unlisted", label: "Listelenmemiş (Unlisted)" },
        { value: "private", label: "Sadece Takipçiler (Followers Only)" },
      ],
      default: "public",
    },
  ],
  connectFields: [
    { key: "instanceUrl", label: "Sunucu URL (örn. https://mastodon.social)", type: "text" },
    { key: "accessToken", label: "Erişim Token'ı (Access Token)", type: "text", help: "Mastodon > Tercihler > Geliştirme > Yeni Uygulama ile alınır" },
    { key: "displayName", label: "Hesap Adı / Profil", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const rawUrl = values.instanceUrl?.trim().replace(/\/$/, "");
    const token = values.accessToken?.trim();
    if (!rawUrl || !token) throw new ProviderError("Mastodon Sunucu URL ve Access Token zorunlu");

    try {
      const acc = await http<{ id: string; username: string; display_name: string }>(`${rawUrl}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return [
        {
          externalId: `mastodon_${acc.id}`,
          name: values.displayName?.trim() || acc.display_name || `@${acc.username}`,
          username: `@${acc.username}@${new URL(rawUrl).hostname}`,
          accessToken: token,
          tokenExpiresAt: null,
          metadata: { instanceUrl: rawUrl, accountId: acc.id },
        },
      ];
    } catch (e: any) {
      throw new ProviderError(e.message || "Mastodon kimlik doğrulanamadı");
    }
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const instance = (channel.metadata.instanceUrl as string) || "https://mastodon.social";
    const visibility = (input.settings.visibility as string) || "public";
    const spoiler = (input.settings.spoilerText as string) || undefined;

    try {
      const res = await http<{ id: string; url: string }>(`${instance}/api/v1/statuses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        json: {
          status: input.text.slice(0, 500),
          visibility: visibility,
          spoiler_text: spoiler,
        },
      });

      return { externalId: res.id, url: res.url };
    } catch (e: any) {
      throw new ProviderError(e.message || "Mastodon gönderisi yayınlanamadı");
    }
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
