import type { Channel } from "../core/types.js";
import { http } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

/** Herkese açık Bluesky AppView (kimlik doğrulama gerektirmez) */
export const BSKY_PUBLIC = "https://public.api.bsky.app/xrpc";

export interface BlueskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
}

export async function blueskyProfile(actor: string): Promise<BlueskyProfile> {
  return http<BlueskyProfile>(`${BSKY_PUBLIC}/app.bsky.actor.getProfile`, { query: { actor }, retries: 1 });
}

/** Hesabın son gönderileri (yanıtlar hariç) ve herkese açık etkileşim sayıları */
export async function blueskyRecentPosts(actor: string, limit = 25) {
  const r = await http<{ feed?: Array<{ post: { uri: string; record?: { text?: string; createdAt?: string }; likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number; author?: { did?: string } } }> }>(
    `${BSKY_PUBLIC}/app.bsky.feed.getAuthorFeed`,
    { query: { actor, limit, filter: "posts_no_replies" }, retries: 1 },
  );
  return (r.feed ?? [])
    .map((f) => f.post)
    .map((p) => ({
      uri: p.uri,
      text: p.record?.text ?? "",
      createdAt: p.record?.createdAt ?? "",
      likes: p.likeCount ?? 0,
      replies: p.replyCount ?? 0,
      reposts: (p.repostCount ?? 0) + (p.quoteCount ?? 0),
    }));
}

export const blueskyProvider: Provider = {
  id: "bluesky",
  label: "Bluesky",
  color: "#0085FF",
  connectMode: "form",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: false,
    thread: true,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 300,
    comments: true,
    maxMedia: 4,
    mediaNote: "Bluesky: 300 karakter sınırı, 4 görsel desteği ve zincirleme (thread) gönderi.",
  },
  settingFields: [],
  connectFields: [
    { key: "handle", label: "Bluesky Handle (@kullanici.bsky.social)", type: "text" },
    { key: "appPassword", label: "App Password", type: "text", help: "Bluesky Ayarlar > App Passwords menüsünden oluşturulur" },
    { key: "serviceUrl", label: "PDS / Sunucu URL (İsteğe bağlı)", type: "text", help: "Varsayılan: https://bsky.social" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const handle = values.handle?.trim().replace(/^@/, "");
    const pass = values.appPassword?.trim();
    if (!handle || !pass) throw new ProviderError("Bluesky Handle ve App Password zorunlu");
    const service = values.serviceUrl?.trim() || "https://bsky.social";

    try {
      const auth = await http<{ accessJwt: string; did: string; handle: string }>(`${service}/xrpc/com.atproto.server.createSession`, {
        method: "POST",
        json: { identifier: handle, password: pass },
      });

      return [
        {
          externalId: auth.did,
          name: `@${auth.handle}`,
          username: auth.handle,
          accessToken: auth.accessJwt,
          refreshToken: pass, // şifreyi saklayıp oturum yenilemede kullanabiliriz
          tokenExpiresAt: null,
          metadata: { did: auth.did, serviceUrl: service, handle: auth.handle },
        },
      ];
    } catch (e: any) {
      throw new ProviderError(e.message || "Bluesky giriş başarısız");
    }
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const service = (channel.metadata.serviceUrl as string) || "https://bsky.social";
    const did = channel.metadata.did as string;

    const record = {
      $type: "app.bsky.feed.post",
      text: input.text.slice(0, 300),
      createdAt: new Date().toISOString(),
    };

    try {
      const res = await http<{ uri: string; cid: string }>(`${service}/xrpc/com.atproto.repo.createRecord`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        json: {
          repo: did,
          collection: "app.bsky.feed.post",
          record: record,
        },
      });

      const rkey = res.uri.split("/").pop();
      const url = `https://bsky.app/profile/${channel.username}/post/${rkey}`;
      return { externalId: res.uri, url };
    } catch (e: any) {
      throw new ProviderError(e.message || "Bluesky gönderisi yayınlanamadı");
    }
  },

  /** Takipçi / gönderi sayısı herkese açık AppView'dan (jeton gerekmez, oturum süresinden etkilenmez) */
  async fetchMetrics(channel: Channel) {
    const actor = (channel.metadata.did as string) || channel.externalId;
    if (!actor || actor.includes("mock")) return {};
    const p = await blueskyProfile(actor);
    const out: Record<string, number> = {};
    if (typeof p.followersCount === "number") out.followers = p.followersCount;
    if (typeof p.followsCount === "number") out.following = p.followsCount;
    if (typeof p.postsCount === "number") out.posts = p.postsCount;
    return out;
  },

  /** Gönderi metrikleri: beğeni, yanıt, yeniden paylaşım + alıntı */
  async fetchPostMetrics(_channel: Channel, externalId: string): Promise<Record<string, number>> {
    if (!externalId.startsWith("at://") || externalId.includes("mock")) return {};
    const r = await http<{ posts?: Array<{ likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number }> }>(`${BSKY_PUBLIC}/app.bsky.feed.getPosts`, {
      query: { uris: externalId },
      retries: 1,
    });
    const p = r.posts?.[0];
    if (!p) return {};
    return { likes: p.likeCount ?? 0, comments: p.replyCount ?? 0, shares: (p.repostCount ?? 0) + (p.quoteCount ?? 0) };
  },

  async healthCheck(channel: Channel) {
    return { ok: Boolean(channel.accessToken) };
  },
};
