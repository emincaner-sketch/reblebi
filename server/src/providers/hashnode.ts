import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

export const hashnodeProvider: Provider = {
  id: "hashnode",
  label: "Hashnode",
  color: "#2962FF",
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
    mediaNote: "Hashnode blog yayını: Başlık, markdown gövdesi, publication ID ve etiketler.",
  },
  settingFields: [
    { key: "subtitle", label: "Alt Başlık (Subtitle)", type: "text" },
  ],
  connectFields: [
    { key: "token", label: "Hashnode Personal Access Token", type: "text", help: "Hashnode > Account Settings > Developer > Access Tokens" },
    { key: "publicationId", label: "Publication ID", type: "text", help: "Yazının yayınlanacağı blogun kimliği" },
    { key: "displayName", label: "Blog Adı", type: "text" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const token = values.token?.trim();
    const pubId = values.publicationId?.trim();
    if (!token) throw new ProviderError("Hashnode Access Token zorunlu");

    return [
      {
        externalId: pubId || `hashnode_${Date.now()}`,
        name: values.displayName?.trim() || "Hashnode Blog",
        username: values.displayName?.trim() || null,
        accessToken: token,
        tokenExpiresAt: null,
        metadata: { publicationId: pubId },
      },
    ];
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const pubId = (channel.metadata.publicationId as string) || "primary";
    const lines = input.text.split("\n");
    const title = lines[0].replace(/^#+\s*/, "").slice(0, 150) || "Reblebi Paylaşımı";
    const content = lines.slice(1).join("\n").trim() || input.text;

    try {
      const query = `
        mutation PublishPost($input: PublishPostInput!) {
          publishPost(input: $input) {
            post {
              id
              url
            }
          }
        }
      `;
      const res = await http<{ data?: { publishPost?: { post?: { id: string; url: string } } }; errors?: any[] }>("https://gql.hashnode.com", {
        method: "POST",
        headers: {
          Authorization: channel.accessToken,
          "Content-Type": "application/json",
        },
        json: {
          query,
          variables: {
            input: {
              title,
              subtitle: (input.settings.subtitle as string) || undefined,
              publicationId: pubId,
              contentMarkdown: content,
            },
          },
        },
      });

      const p = res.data?.publishPost?.post;
      return { externalId: p?.id || `hash_${Date.now()}`, url: p?.url || "https://hashnode.com" };
    } catch (e: any) {
      throw new ProviderError(e.message || "Hashnode makalesi yayınlanamadı");
    }
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
