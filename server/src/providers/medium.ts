import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

export const mediumProvider: Provider = {
  id: "medium",
  label: "Medium",
  color: "#000000",
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
    comments: false,
    maxMedia: 5,
    mediaNote: "Medium makalesi: Başlık (ilk satır), markdown/HTML gövdesi ve etiketler.",
  },
  settingFields: [
    {
      key: "publishStatus",
      label: "Yayın Durumu",
      type: "select",
      options: [
        { value: "public", label: "Herkese Açık (Public)" },
        { value: "draft", label: "Taslak (Draft)" },
        { value: "unlisted", label: "Listelenmemiş (Unlisted)" },
      ],
      default: "public",
    },
    { key: "canonicalUrl", label: "Orijinal Kaynak URL (Canonical)", type: "text" },
  ],
  connectFields: [
    { key: "token", label: "Medium Integration Token", type: "text", help: "Medium > Settings > Security and apps > Integration tokens" },
    { key: "displayName", label: "Görünen Ad", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const token = values.token?.trim();
    if (!token) throw new ProviderError("Medium Integration Token zorunlu");

    try {
      const me = await http<{ data?: { id: string; username: string; name: string } }>("https://api.medium.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const u = me.data;
      if (!u) throw new ProviderError("Medium kullanıcı bilgisi alınamadı");

      return [
        {
          externalId: u.id,
          name: values.displayName?.trim() || u.name || `@${u.username}`,
          username: u.username,
          accessToken: token,
          tokenExpiresAt: null,
          metadata: { authorId: u.id },
        },
      ];
    } catch (e: any) {
      throw new ProviderError(e.message || "Medium token doğrulanamadı");
    }
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const authorId = (channel.metadata.authorId as string) || channel.externalId;
    const lines = input.text.split("\n");
    const title = lines[0].replace(/^#+\s*/, "").slice(0, 100) || "Reblebi Paylaşımı";
    const content = lines.slice(1).join("\n").trim() || input.text;
    const publishStatus = (input.settings.publishStatus as string) || "public";

    try {
      const res = await http<{ data?: { id: string; url: string } }>(`https://api.medium.com/v1/users/${authorId}/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        json: {
          title,
          contentFormat: "markdown",
          content: `# ${title}\n\n${content}`,
          publishStatus,
          canonicalUrl: input.settings.canonicalUrl || undefined,
        },
      });

      return { externalId: res.data?.id || `med_${Date.now()}`, url: res.data?.url };
    } catch (e: any) {
      throw new ProviderError(e.message || "Medium makalesi yayınlanamadı");
    }
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
