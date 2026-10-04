import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

export const devtoProvider: Provider = {
  id: "devto",
  label: "Dev.to",
  color: "#0A0A0A",
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
    maxTextLength: 100000,
    comments: true,
    maxMedia: 5,
    mediaNote: "Dev.to yazılım geliştirici makalesi: Başlık, markdown gövdesi, etiketler ve kapak görseli.",
  },
  settingFields: [
    { key: "tags", label: "Etiketler (virgülle ayır, maks 4, örn: javascript, webdev)", type: "text" },
    { key: "published", label: "Doğrudan Yayınla (kapalıysa taslak olur)", type: "boolean", default: true },
  ],
  connectFields: [
    { key: "apiKey", label: "Dev.to API Key", type: "text", help: "Dev.to > Settings > Extensions > DEV Community API Keys" },
    { key: "displayName", label: "Görünen Ad / Yazar", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const key = values.apiKey?.trim();
    if (!key) throw new ProviderError("Dev.to API Key zorunlu");

    return [
      {
        externalId: `devto_${Date.now()}`,
        name: values.displayName?.trim() || "Dev.to Yazar",
        username: values.displayName?.trim() || null,
        accessToken: key,
        tokenExpiresAt: null,
        metadata: {},
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const lines = input.text.split("\n");
    const title = lines[0].replace(/^#+\s*/, "").slice(0, 120) || "Reblebi Paylaşımı";
    const body = lines.slice(1).join("\n").trim() || input.text;
    const published = input.settings.published !== false;
    const tags = ((input.settings.tags as string) || "technology")
      .split(/[,\s]+/)
      .map((t) => t.replace(/#/g, "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 4);

    try {
      const res = await http<{ id: number; url: string }>("https://dev.to/api/articles", {
        method: "POST",
        headers: {
          "api-key": channel.accessToken,
          "Content-Type": "application/json",
        },
        json: {
          article: {
            title,
            body_markdown: body,
            published,
            tags,
            main_image: input.media[0]?.publicUrl || undefined,
          },
        },
      });

      return { externalId: String(res.id), url: res.url };
    } catch (e: any) {
      throw new ProviderError(e.message || "Dev.to makalesi yayınlanamadı");
    }
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
