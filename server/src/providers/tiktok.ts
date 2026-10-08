import fs from "node:fs";
import { config } from "../core/config.js";
import type { Channel } from "../core/types.js";
import { pkcePair } from "../core/crypto.js";
import { expiresIn, http, sleep } from "./http.js";
import { ProviderError, type Provider, type PublishInput, type PublishResult } from "./types.js";

const API = "https://open.tiktokapis.com/v2";
const SCOPES = ["user.info.basic", "user.info.profile", "user.info.stats", "video.publish", "video.upload", "video.list"];

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

interface TikTokResp<T> {
  data: T;
  error?: { code?: string; message?: string; log_id?: string };
}

/** TikTok hata kodlarının anlaşılır karşılıkları (kod her zaman mesajın başında kalır) */
const ERROR_HINTS: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts: "Uygulama TikTok denetiminden geçmedi: yalnızca 'Sadece ben' gizliliğiyle paylaşılabilir. TikTok for Developers'ta uygulamayı denetime gönder.",
  url_ownership_unverified: "Fotoğraf için TikTok'ta alan adı doğrulanmamış: TikTok for Developers > Manage URL properties bölümünden PUBLIC_URL adresini (URL öneki olarak) doğrula.",
  spam_risk_too_many_posts: "TikTok günlük paylaşım sınırına ulaşıldı; yarın tekrar denenecek.",
  spam_risk_user_banned_from_posting: "TikTok bu hesabın paylaşım yapmasını kısıtlamış.",
  access_token_invalid: "TikTok bağlantısı geçersiz; kanalı yeniden bağla.",
  scope_not_authorized: "Bu işlem için gereken TikTok izni verilmemiş; kanalı yeniden bağlayıp tüm izinleri onayla.",
  reached_active_user_cap: "TikTok uygulamasının sandbox kullanıcı sınırı doldu; uygulamayı denetime gönder ya da test kullanıcısı ekle.",
  duration_check_failed: "Video süresi bu hesabın TikTok sınırını aşıyor.",
};

function check<T>(r: TikTokResp<T>): T {
  if (r.error && r.error.code && r.error.code !== "ok") {
    const hint = ERROR_HINTS[r.error.code];
    throw new ProviderError(`TikTok: ${r.error.code} ${hint ?? r.error.message ?? ""}`.trim(), undefined, r.error);
  }
  return r.data;
}

interface CreatorInfo {
  privacy_level_options?: string[];
}

/** Yayından önce zorunlu sorgu: hesabın izin verdiği gizlilik seçenekleri ve en uzun video süresi (alınamazsa null) */
async function creatorInfo(token: string): Promise<CreatorInfo | null> {
  try {
    return check(await http<TikTokResp<CreatorInfo>>(`${API}/post/publish/creator_info/query/`, { method: "POST", headers: bearer(token), json: {}, retries: 0 }));
  } catch {
    return null;
  }
}

/** İstenen gizlilik hesapta kapalıysa izin verilen en kısıtlıya (yoksa ilk seçeneğe) düşer */
export function resolvePrivacy(requested: string, options: string[] | undefined): string {
  if (!options?.length || options.includes(requested)) return requested;
  return options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0];
}

/** Denetimden geçmemiş uygulama herkese açık yayın yapamaz: bir kez 'Sadece ben' ile yeniden dener */
async function initWithAuditFallback<T>(privacy: string, init: (privacy: string) => Promise<TikTokResp<T>>): Promise<{ data: T; privacy: string }> {
  try {
    return { data: check(await init(privacy)), privacy };
  } catch (e) {
    if (privacy !== "SELF_ONLY" && e instanceof Error && /unaudited_client/.test(e.message)) return { data: check(await init("SELF_ONLY")), privacy: "SELF_ONLY" };
    throw e;
  }
}

async function waitPublish(token: string, publishId: string): Promise<string | null> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const r = await http<TikTokResp<{ status: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> }>>(`${API}/post/publish/status/fetch/`, {
      method: "POST",
      headers: bearer(token),
      json: { publish_id: publishId },
    });
    const d = check(r);
    if (d.status === "PUBLISH_COMPLETE") return d.publicaly_available_post_id?.[0] ? String(d.publicaly_available_post_id[0]) : null;
    if (d.status === "FAILED") throw new ProviderError(`TikTok yayın başarısız: ${d.fail_reason ?? "bilinmiyor"}`);
    if (d.status === "SEND_TO_USER_INBOX") return null;
    await sleep(5000);
  }
  throw new ProviderError("TikTok yayın durumu zaman aşımı", undefined, undefined, true);
}

export const tiktokProvider: Provider = {
  id: "tiktok",
  label: "TikTok",
  color: "#FE2C55",
  connectMode: "oauth",
  capabilities: {
    post: true,
    story: false,
    reel: true,
    video: true,
    thread: false,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 2200,
    maxMedia: 35,
    requiresMedia: true,
    mediaNote: "Video: MP4/MOV, dikey. Fotoğraf gönderileri için TikTok'ta doğrulanmış alan adı (PUBLIC_URL) gerekir. Denetimden geçmemiş uygulamalar yalnızca 'Sadece ben' gizliliğiyle paylaşabilir.",
  },
  settingFields: [
    {
      key: "privacyLevel",
      label: "Gizlilik",
      type: "select",
      options: [
        { value: "PUBLIC_TO_EVERYONE", label: "Herkese açık" },
        { value: "MUTUAL_FOLLOW_FRIENDS", label: "Arkadaşlar" },
        { value: "FOLLOWER_OF_CREATOR", label: "Takipçiler" },
        { value: "SELF_ONLY", label: "Sadece ben" },
      ],
      default: "PUBLIC_TO_EVERYONE",
    },
    { key: "disableComment", label: "Yorumları kapat", type: "boolean", default: false },
    { key: "disableDuet", label: "Duet'i kapat", type: "boolean", default: false, appliesTo: ["video", "reel", "post"] },
    { key: "disableStitch", label: "Stitch'i kapat", type: "boolean", default: false, appliesTo: ["video", "reel", "post"] },
    { key: "aiGenerated", label: "Yapay zekâ ile üretildi etiketi", type: "boolean", default: false },
  ],
  isConfigured: () => Boolean(config.tiktok.clientKey && config.tiktok.clientSecret),

  oauthStart(redirectUri, state) {
    const { verifier, challenge } = pkcePair();
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.searchParams.set("client_key", config.tiktok.clientKey);
    u.searchParams.set("scope", SCOPES.join(","));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    return { url: u.toString(), codeVerifier: verifier };
  },

  async oauthCallback(code, redirectUri, codeVerifier) {
    const tok = await http<{ access_token: string; refresh_token?: string; expires_in?: number; open_id: string; scope?: string; error?: string; error_description?: string }>(
      `${API}/oauth/token/`,
      {
        form: {
          client_key: config.tiktok.clientKey,
          client_secret: config.tiktok.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code_verifier: codeVerifier ?? undefined,
        },
      },
    );
    if (tok.error) throw new ProviderError(`TikTok: ${tok.error} ${tok.error_description ?? ""}`);
    const me = await http<TikTokResp<{ user: { open_id: string; display_name?: string; username?: string; avatar_url?: string } }>>(`${API}/user/info/`, {
      headers: bearer(tok.access_token),
      query: { fields: "open_id,display_name,username,avatar_url" },
    });
    const user = check(me).user;
    return [
      {
        externalId: user.open_id ?? tok.open_id,
        name: user.display_name ?? "TikTok",
        username: user.username ?? null,
        avatarUrl: user.avatar_url ?? null,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        tokenExpiresAt: expiresIn(tok.expires_in),
        scopes: tok.scope ?? SCOPES.join(","),
      },
    ];
  },

  async refreshToken(channel) {
    if (!channel.refreshToken) return null;
    const tok = await http<{ access_token: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }>(`${API}/oauth/token/`, {
      form: { client_key: config.tiktok.clientKey, client_secret: config.tiktok.clientSecret, grant_type: "refresh_token", refresh_token: channel.refreshToken },
    });
    if (tok.error) throw new ProviderError(`TikTok yenileme: ${tok.error} ${tok.error_description ?? ""}`);
    return { accessToken: tok.access_token, refreshToken: tok.refresh_token ?? channel.refreshToken, tokenExpiresAt: expiresIn(tok.expires_in) };
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const token = channel.accessToken;
    const video = input.media.find((m) => m.kind === "video");
    const images = input.media.filter((m) => m.kind === "image");
    const info = await creatorInfo(token);
    const privacy = resolvePrivacy((input.settings.privacyLevel as string) || "PUBLIC_TO_EVERYONE", info?.privacy_level_options);
    const postInfo = {
      title: input.text.slice(0, 2200),
      privacy_level: privacy,
      disable_comment: Boolean(input.settings.disableComment),
      disable_duet: Boolean(input.settings.disableDuet),
      disable_stitch: Boolean(input.settings.disableStitch),
      is_aigc: Boolean(input.settings.aiGenerated),
    };

    if (video) {
      const buf = fs.readFileSync(video.localPath);
      const size = buf.length;
      const MIN_CHUNK = 5 * 1024 * 1024;
      const CHUNK = 10 * 1024 * 1024;
      const single = size < MIN_CHUNK * 2;
      const chunkSize = single ? size : CHUNK;
      const count = single ? 1 : Math.floor(size / CHUNK);
      const { data: init } = await initWithAuditFallback(postInfo.privacy_level, (pl) =>
        http<TikTokResp<{ publish_id: string; upload_url: string }>>(`${API}/post/publish/video/init/`, {
          method: "POST",
          headers: bearer(token),
          json: { post_info: { ...postInfo, privacy_level: pl, video_cover_timestamp_ms: 1000 }, source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: count } },
        }),
      );
      const { publish_id, upload_url } = init;
      for (let i = 0; i < count; i++) {
        const start = i * chunkSize;
        const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
        const part = buf.subarray(start, end + 1);
        const res = await fetch(upload_url, {
          method: "PUT",
          headers: { "Content-Type": video.mime || "video/mp4", "Content-Length": String(part.length), "Content-Range": `bytes ${start}-${end}/${size}` },
          body: part,
        });
        if (!res.ok && res.status !== 206) throw new ProviderError(`TikTok video yükleme ${res.status}`, res.status, await res.text(), res.status >= 500);
      }
      const postId = await waitPublish(token, publish_id);
      return { externalId: postId ?? publish_id, url: postId ? `https://www.tiktok.com/@${channel.username ?? ""}/video/${postId}` : null };
    }

    if (images.length) {
      const { data: init } = await initWithAuditFallback(postInfo.privacy_level, (pl) =>
        http<TikTokResp<{ publish_id: string }>>(`${API}/post/publish/content/init/`, {
          method: "POST",
          headers: bearer(token),
          json: {
            post_info: { title: input.text.slice(0, 90), description: input.text.slice(0, 4000), privacy_level: pl, disable_comment: postInfo.disable_comment, auto_add_music: true },
            source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: images.slice(0, 35).map((m) => m.publicUrl) },
            post_mode: "DIRECT_POST",
            media_type: "PHOTO",
          },
        }),
      );
      const { publish_id } = init;
      const postId = await waitPublish(token, publish_id);
      return { externalId: postId ?? publish_id, url: null };
    }
    throw new ProviderError("TikTok için bir video ya da en az bir fotoğraf gerekli");
  },

  async fetchMetrics(channel: Channel) {
    const me = await http<TikTokResp<{ user: { follower_count?: number; likes_count?: number; video_count?: number } }>>(`${API}/user/info/`, {
      headers: bearer(channel.accessToken),
      query: { fields: "follower_count,likes_count,video_count" },
    });
    const u = check(me).user;
    return { followers: Number(u.follower_count ?? 0), likes: Number(u.likes_count ?? 0), posts: Number(u.video_count ?? 0) };
  },

  async fetchPostMetrics(channel: Channel, externalId: string) {
    const r = await http<TikTokResp<{ videos?: Array<{ like_count?: number; comment_count?: number; share_count?: number; view_count?: number }> }>>(
      `${API}/video/query/`,
      {
        method: "POST",
        headers: bearer(channel.accessToken),
        query: { fields: "like_count,comment_count,share_count,view_count" },
        json: { filters: { video_ids: [externalId] } },
        retries: 0,
      },
    );
    const v = check(r).videos?.[0] ?? {};
    return { likes: Number(v.like_count ?? 0), comments: Number(v.comment_count ?? 0), shares: Number(v.share_count ?? 0), views: Number(v.view_count ?? 0) };
  },

  async healthCheck(channel: Channel) {
    try {
      check(await http<TikTokResp<unknown>>(`${API}/user/info/`, { headers: bearer(channel.accessToken), query: { fields: "open_id" } }));
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};
