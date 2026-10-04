import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

export const slackProvider: Provider = {
  id: "slack",
  label: "Slack",
  color: "#4A154B",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: false,
    thread: true,
    dm: true,
    inbound: "webhook",
    analytics: false,
    maxTextLength: 40000,
    comments: true,
    maxMedia: 5,
    mediaNote: "Slack kanallarına veya webhook'larına zengin biçimli mesaj, bildirim ve görsel paylaşımı.",
  },
  settingFields: [
    { key: "channel", label: "Hedef Kanal (örn. #duyurular veya C12345)", type: "text" },
    { key: "asUser", label: "Bot Olarak Gönder", type: "boolean", default: true },
  ],
  connectFields: [
    { key: "webhookOrToken", label: "Webhook URL veya Bot Token (xoxb-...)", type: "text", help: "Slack Incoming Webhook URL'i veya Bot User OAuth Token" },
    { key: "defaultChannel", label: "Varsayılan Kanal (örn. #genel)", type: "text" },
    { key: "displayName", label: "Kanal / Workspace Adı", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const raw = values.webhookOrToken?.trim();
    if (!raw) throw new ProviderError("Slack Webhook URL veya Bot Token zorunlu");
    const isWebhook = raw.startsWith("http");
    return [
      {
        externalId: `slack_${Date.now()}`,
        name: values.displayName?.trim() || (isWebhook ? "Slack Webhook" : "Slack Bot"),
        username: values.defaultChannel?.trim() || null,
        accessToken: raw,
        tokenExpiresAt: null,
        metadata: {
          isWebhook,
          defaultChannel: values.defaultChannel?.trim() || null,
        },
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const isWebhook = Boolean(channel.metadata.isWebhook);
    const targetChannel = (input.settings.channel as string) || (channel.metadata.defaultChannel as string);

    // Slack payload
    const payload: Record<string, any> = {
      text: input.text,
    };

    if (input.media.length > 0 && input.media[0].publicUrl) {
      payload.attachments = [
        {
          image_url: input.media[0].publicUrl,
          text: input.text,
        },
      ];
    }

    try {
      if (isWebhook) {
        // Incoming webhook call
        await http(channel.accessToken, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          json: payload,
        });
        return { externalId: `slack_wh_${Date.now()}` };
      } else {
        // Slack Web API
        if (targetChannel) payload.channel = targetChannel;
        const res = await http<{ ok: boolean; ts?: string; channel?: string; error?: string }>("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${channel.accessToken}`,
            "Content-Type": "application/json",
          },
          json: payload,
        });
        if (!res.ok) throw new ProviderError(`Slack hatası: ${res.error}`);
        return { externalId: res.ts || `slack_${Date.now()}` };
      }
    } catch (e: any) {
      throw new ProviderError(e.message || "Slack mesajı gönderilemedi");
    }
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
