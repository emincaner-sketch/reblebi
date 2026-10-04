import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

export const redditProvider: Provider = {
  id: "reddit",
  label: "Reddit",
  color: "#FF4500",
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
    maxTextLength: 40000,
    comments: true,
    maxMedia: 20,
    mediaNote: "Subreddit gönderileri: Başlık + metin veya görsel/link. Hedef subreddit adı zorunludur (örn. r/teknoloji).",
  },
  settingFields: [
    { key: "subreddit", label: "Hedef Subreddit (örn. test veya r/test)", type: "text" },
    { key: "flair", label: "Gönderi Etiketi (Flair)", type: "text" },
    { key: "nsfw", label: "NSFW (18+)", type: "boolean", default: false },
    { key: "spoiler", label: "Spoiler Olarak İşaretle", type: "boolean", default: false },
  ],
  connectFields: [
    { key: "subreddit", label: "Varsayılan Subreddit (örn. r/duyurular veya u/kullaniciadi)", type: "text", help: "Paylaşımların yapılacağı varsayılan subreddit veya profiliniz" },
    { key: "accessToken", label: "Reddit API Bearer Token / Script Token", type: "text", help: "Reddit Apps > Personal Use Script token" },
    { key: "username", label: "Reddit Kullanıcı Adı (u/...)", type: "text" },
    { key: "displayName", label: "Görünen Ad", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const token = values.accessToken?.trim();
    if (!token) throw new ProviderError("Reddit Access Token zorunlu");
    const sub = (values.subreddit?.trim() || "u_" + (values.username || "me")).replace(/^r\//, "");
    const username = values.username?.trim() || sub;

    return [
      {
        externalId: `reddit_${username}`,
        name: values.displayName?.trim() || `Reddit (r/${sub})`,
        username: username,
        accessToken: token,
        tokenExpiresAt: null,
        metadata: { defaultSubreddit: sub },
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const sub = ((input.settings.subreddit as string) || (channel.metadata.defaultSubreddit as string) || "test").replace(/^r\//, "");
    const lines = input.text.split("\n");
    const title = lines[0].slice(0, 300) || "Reblebi Paylaşımı";
    const body = lines.slice(1).join("\n").trim() || input.text;

    try {
      const res = await http<{ json?: { data?: { id?: string; url?: string }; errors?: any[] } }>("https://oauth.reddit.com/api/submit", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "User-Agent": "Reblebi/1.0.0",
        },
        form: {
          sr: sub,
          kind: input.media.length > 0 && input.media[0].publicUrl ? "link" : "self",
          title: title,
          text: body,
          url: input.media.length > 0 ? input.media[0].publicUrl : undefined,
          resubmit: "true",
          nsfw: input.settings.nsfw ? "true" : "false",
          spoiler: input.settings.spoiler ? "true" : "false",
        },
        retries: 1,
      });

      if (res.json?.errors && res.json.errors.length > 0) {
        throw new ProviderError(`Reddit hatası: ${JSON.stringify(res.json.errors)}`);
      }

      const id = res.json?.data?.id || `rd_${Date.now()}`;
      const url = res.json?.data?.url || `https://reddit.com/r/${sub}/comments/${id}`;
      return { externalId: id, url };
    } catch (e: any) {
      // Simülasyon / Test durumunda graceful fallback
      throw new ProviderError(e.message || "Reddit yayını başarısız");
    }
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
