import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

export const wordpressProvider: Provider = {
  id: "wordpress",
  label: "WordPress",
  color: "#21759B",
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
    maxMedia: 10,
    mediaNote: "WordPress blog yazısı: Başlık (ilk satır), HTML/Markdown içerik, yayınlanma durumu (yayınla veya taslak).",
  },
  settingFields: [
    {
      key: "status",
      label: "Yazı Durumu",
      type: "select",
      options: [
        { value: "publish", label: "Doğrudan Yayınla" },
        { value: "draft", label: "Taslak Olarak Kaydet" },
      ],
      default: "publish",
    },
    { key: "categories", label: "Kategori ID'leri (virgülle ayır)", type: "text" },
  ],
  connectFields: [
    { key: "siteUrl", label: "WordPress Site URL (örn. https://sitem.com)", type: "text" },
    { key: "username", label: "Kullanıcı Adı", type: "text" },
    { key: "appPassword", label: "Uygulama Parolası (Application Password)", type: "text", help: "WP Admin > Kullanıcılar > Profil > Uygulama Parolaları bölümünden oluşturulur" },
    { key: "displayName", label: "Blog Adı", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const siteUrl = values.siteUrl?.trim().replace(/\/$/, "");
    const username = values.username?.trim();
    const appPassword = values.appPassword?.trim().replace(/\s+/g, "");
    if (!siteUrl || !username || !appPassword) throw new ProviderError("Site URL, Kullanıcı Adı ve Uygulama Parolası zorunlu");

    const auth = Buffer.from(`${username}:${appPassword}`).toString("base64");
    return [
      {
        externalId: `wp_${new URL(siteUrl).hostname}`,
        name: values.displayName?.trim() || `${new URL(siteUrl).hostname} (WordPress)`,
        username: username,
        accessToken: auth,
        tokenExpiresAt: null,
        metadata: { siteUrl, username },
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const siteUrl = (channel.metadata.siteUrl as string) || "https://example.com";
    const status = (input.settings.status as string) || "publish";

    const lines = input.text.split("\n");
    const title = lines[0].replace(/^#+\s*/, "").slice(0, 200) || "Reblebi Paylaşımı";
    const content = lines.slice(1).join("\n").trim() || input.text;

    try {
      const res = await http<{ id: number; link: string }>(`${siteUrl}/wp-json/wp/v2/posts`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        json: {
          title,
          content,
          status,
        },
      });

      return { externalId: String(res.id), url: res.link };
    } catch (e: any) {
      throw new ProviderError(e.message || "WordPress yazısı oluşturulamadı");
    }
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
