import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

export const discordProvider: Provider = {
  id: "discord",
  label: "Discord",
  color: "#5865F2",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: false,
    thread: true,
    dm: false,
    inbound: "webhook",
    analytics: false,
    maxTextLength: 2000,
    comments: false,
    maxMedia: 10,
    mediaNote: "Discord kanalına Webhook veya Bot ile zengin renkli Embed ve duyuru gönderimi.",
  },
  settingFields: [
    { key: "embedColor", label: "Embed Rengi (Hex, örn. #5865F2)", type: "text" },
    { key: "title", label: "Embed Başlığı", type: "text" },
  ],
  connectFields: [
    { key: "webhookUrl", label: "Discord Webhook URL", type: "text", help: "Kanal Ayarları > Entegrasyonlar > Webhook Oluştur ile alınan URL" },
    { key: "displayName", label: "Kanal / Sunucu Adı", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const url = values.webhookUrl?.trim();
    if (!url || !url.startsWith("http")) throw new ProviderError("Geçerli bir Discord Webhook URL'i zorunlu");
    return [
      {
        externalId: `discord_${Date.now()}`,
        name: values.displayName?.trim() || "Discord Kanalı",
        username: null,
        accessToken: url,
        tokenExpiresAt: null,
        metadata: { webhookUrl: url },
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const webhookUrl = channel.accessToken;
    const title = (input.settings.title as string) || undefined;
    const hexColor = (input.settings.embedColor as string)?.replace("#", "") || "5865F2";
    const colorInt = parseInt(hexColor, 16) || 0x5865f2;

    const payload: Record<string, any> = {};

    if (title || input.media.length > 0) {
      payload.embeds = [
        {
          title: title,
          description: input.text,
          color: colorInt,
          image: input.media[0]?.publicUrl ? { url: input.media[0].publicUrl } : undefined,
          timestamp: new Date().toISOString(),
          footer: { text: "Reblebi · Otomasyon Motoru" },
        },
      ];
    } else {
      payload.content = input.text.slice(0, 2000);
    }

    try {
      const res = await http<{ id?: string }>(`${webhookUrl}?wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        json: payload,
      });

      const msgId = res?.id || `disc_${Date.now()}`;
      return { externalId: msgId };
    } catch (e: any) {
      throw new ProviderError(e.message || "Discord mesajı gönderilemedi");
    }
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
