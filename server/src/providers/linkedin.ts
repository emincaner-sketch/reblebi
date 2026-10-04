import fs from "node:fs";
import { config } from "../core/config.js";
import type { Channel } from "../core/types.js";
import { expiresIn, http } from "./http.js";
import { ProviderError, type ConnectedAccount, type Provider, type PublishInput, type PublishMedia, type PublishResult } from "./types.js";

const REST = "https://api.linkedin.com/rest";
// LinkedIn sürümleri yaklaşık bir yıl desteklenir (202609: Eylül 2027 tarihine kadar); LINKEDIN_VERSION ile değiştirilebilir
const VERSION = process.env.LINKEDIN_VERSION || "202609";
const DEFAULT_SCOPES = "openid profile w_member_social";
const scopes = () => process.env.LINKEDIN_SCOPES || DEFAULT_SCOPES;

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

/** LinkedIn "little text format": ayrılmış karakterleri kaçır */
function escapeCommentary(text: string): string {
  return text.replace(/[\\()[\]{}<>@|~_*]/g, (c) => "\\" + c);
}

async function uploadImage(token: string, owner: string, m: PublishMedia): Promise<string> {
  const init = await http<{ value: { uploadUrl: string; image: string } }>(`${REST}/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(token),
    json: { initializeUploadRequest: { owner } },
  });
  await http(init.value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": m.mime },
    body: fs.readFileSync(m.localPath),
    timeoutMs: 120_000,
  });
  return init.value.image;
}

async function uploadVideo(token: string, owner: string, m: PublishMedia): Promise<string> {
  const buf = fs.readFileSync(m.localPath);
  const init = await http<{
    value: { video: string; uploadToken: string; uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }> };
  }>(`${REST}/videos?action=initializeUpload`, {
    method: "POST",
    headers: headers(token),
    json: { initializeUploadRequest: { owner, fileSizeBytes: buf.length, uploadCaptions: false, uploadThumbnail: false } },
  });
  const etags: string[] = [];
  for (const part of init.value.uploadInstructions) {
    const res = await fetch(part.uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: buf.subarray(part.firstByte, part.lastByte + 1),
    });
    if (!res.ok) throw new ProviderError(`LinkedIn video parçası yüklenemedi (${res.status})`, res.status, await res.text(), res.status >= 500);
    etags.push(res.headers.get("etag") ?? "");
  }
  await http(`${REST}/videos?action=finalizeUpload`, {
    method: "POST",
    headers: headers(token),
    json: { finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken, uploadedPartIds: etags } },
  });
  return init.value.video;
}

export const linkedinProvider: Provider = {
  id: "linkedin",
  label: "LinkedIn",
  color: "#0A66C2",
  connectMode: "oauth",
  capabilities: {
    post: true,
    story: false,
    reel: false,
    video: true,
    thread: false,
    dm: false,
    inbound: "none",
    analytics: true,
    maxTextLength: 3000,
    comments: true,
    maxMedia: 20,
    mediaNote: "Görsel (1-20) veya 1 video. Şirket sayfaları için LinkedIn Community Management API onayı + LINKEDIN_SCOPES env gerekir.",
  },
  settingFields: [
    {
      key: "visibility",
      label: "Görünürlük",
      type: "select",
      options: [
        { value: "PUBLIC", label: "Herkese açık" },
        { value: "CONNECTIONS", label: "Sadece bağlantılar" },
      ],
      default: "PUBLIC",
    },
    { key: "articleUrl", label: "Makale / bağlantı URL", type: "text", appliesTo: ["post"] },
    { key: "articleTitle", label: "Bağlantı başlığı", type: "text", appliesTo: ["post"] },
  ],
  isConfigured: () => Boolean(config.linkedin.clientId && config.linkedin.clientSecret),

  oauthStart(redirectUri, state) {
    const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", config.linkedin.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("scope", scopes());
    return { url: u.toString() };
  },

  async oauthCallback(code, redirectUri) {
    const tok = await http<{ access_token: string; expires_in?: number; refresh_token?: string; scope?: string }>(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        form: { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: config.linkedin.clientId, client_secret: config.linkedin.clientSecret },
      },
    );
    const me = await http<{ sub: string; name?: string; picture?: string }>("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const accounts: ConnectedAccount[] = [
      {
        externalId: `urn:li:person:${me.sub}`,
        name: me.name ?? "LinkedIn",
        avatarUrl: me.picture ?? null,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        tokenExpiresAt: expiresIn(tok.expires_in),
        scopes: tok.scope ?? scopes(),
        metadata: { type: "person" },
      },
    ];
    if (scopes().includes("organization")) {
      try {
        const orgs = await http<{ elements?: Array<{ organization: string; "organization~"?: { localizedName?: string } }> }>(
          `${REST}/organizationAcls`,
          {
            headers: headers(tok.access_token),
            query: { q: "roleAssignee", role: "ADMINISTRATOR", state: "APPROVED", projection: "(elements*(organization,organization~(localizedName)))" },
          },
        );
        for (const o of orgs.elements ?? []) {
          accounts.push({
            externalId: o.organization,
            name: o["organization~"]?.localizedName ?? o.organization,
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token ?? null,
            tokenExpiresAt: expiresIn(tok.expires_in),
            scopes: tok.scope ?? scopes(),
            metadata: { type: "organization" },
          });
        }
      } catch {
        /* organizasyon izni yoksa sadece kişisel profil */
      }
    }
    return accounts;
  },

  async refreshToken(channel) {
    if (!channel.refreshToken) return null;
    const tok = await http<{ access_token: string; expires_in?: number; refresh_token?: string }>("https://www.linkedin.com/oauth/v2/accessToken", {
      form: { grant_type: "refresh_token", refresh_token: channel.refreshToken, client_id: config.linkedin.clientId, client_secret: config.linkedin.clientSecret },
    });
    return { accessToken: tok.access_token, refreshToken: tok.refresh_token ?? channel.refreshToken, tokenExpiresAt: expiresIn(tok.expires_in) };
  },

  async publish(channel: Channel, input: PublishInput): Promise<PublishResult> {
    const token = channel.accessToken;
    const owner = channel.externalId;
    const body: Record<string, unknown> = {
      author: owner,
      commentary: escapeCommentary(input.text),
      visibility: (input.settings.visibility as string) || "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    const video = input.media.find((m) => m.kind === "video");
    const images = input.media.filter((m) => m.kind === "image");
    if (video) {
      body.content = { media: { id: await uploadVideo(token, owner, video), title: (input.settings.title as string) || undefined } };
    } else if (images.length === 1) {
      body.content = { media: { id: await uploadImage(token, owner, images[0]) } };
    } else if (images.length > 1) {
      const ids: string[] = [];
      for (const m of images.slice(0, 20)) ids.push(await uploadImage(token, owner, m));
      body.content = { multiImage: { images: ids.map((id) => ({ id })) } };
    } else if (input.settings.articleUrl) {
      body.content = { article: { source: input.settings.articleUrl, title: (input.settings.articleTitle as string) || String(input.settings.articleUrl) } };
    }
    const res = await fetch(`${REST}/posts`, { method: "POST", headers: { ...headers(token), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text();
      throw new ProviderError(`LinkedIn ${res.status}: ${text.slice(0, 400)}`, res.status, text, res.status === 429 || res.status >= 500);
    }
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? "";
    return { externalId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}` : null };
  },

  async fetchMetrics(channel: Channel) {
    if (channel.metadata.type !== "organization") return {} as Record<string, number>;
    const r = await http<{ elements?: Array<{ followerCountsByAssociationType?: Array<{ followerCounts: { organicFollowerCount: number; paidFollowerCount: number } }> }> }>(
      `${REST}/organizationalEntityFollowerStatistics`,
      { headers: headers(channel.accessToken), query: { q: "organizationalEntity", organizationalEntity: channel.externalId } },
    );
    let followers = 0;
    for (const e of r.elements ?? []) for (const f of e.followerCountsByAssociationType ?? []) followers += f.followerCounts.organicFollowerCount + f.followerCounts.paidFollowerCount;
    return { followers };
  },

  /**
   * Şirket sayfası günlük insights (Community Management API): gösterim, tekil erişim, sayfa ziyareti, yeni takipçi.
   * Kişisel profillerde LinkedIn bu verileri vermez; boş döner.
   */
  async fetchDailyInsights(channel: Channel, range: { since: number; until: number }) {
    if (channel.metadata.type !== "organization") return {};
    const urn = encodeURIComponent(channel.externalId);
    // Rest.li 2.0: yapısal parantezler kodlanmaz, URN değeri kodlanır
    const interval = `(timeRange:(start:${range.since * 1000},end:${range.until * 1000}),timeGranularityType:DAY)`;
    const out: Record<string, number> = {};
    const put = (k: string, v: unknown) => {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = (out[k] ?? 0) + v;
    };
    const get = async <T>(path: string) => {
      try {
        return await http<{ elements?: T[] }>(`${REST}/${path}&timeIntervals=${interval}`, { headers: headers(channel.accessToken), retries: 1 });
      } catch {
        return { elements: [] as T[] };
      }
    };
    const share = await get<{ totalShareStatistics?: { impressionCount?: number; uniqueImpressionsCount?: number; clickCount?: number } }>(
      `organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${urn}`,
    );
    for (const e of share.elements ?? []) {
      put("views", e.totalShareStatistics?.impressionCount);
      put("reach", e.totalShareStatistics?.uniqueImpressionsCount);
      put("clicks", e.totalShareStatistics?.clickCount);
    }
    const followers = await get<{ followerGains?: { organicFollowerGain?: number; paidFollowerGain?: number } }>(
      `organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${urn}`,
    );
    for (const e of followers.elements ?? []) {
      put("follows", e.followerGains?.organicFollowerGain);
      put("follows", e.followerGains?.paidFollowerGain);
    }
    const page = await get<{ totalPageStatistics?: { views?: { allPageViews?: { pageViews?: number } } } }>(`organizationPageStatistics?q=organization&organization=${urn}`);
    for (const e of page.elements ?? []) put("profileViews", e.totalPageStatistics?.views?.allPageViews?.pageViews);
    return out;
  },

  async publishComment(channel: Channel, parentExternalId: string, text: string, replyToExternalId?: string | null) {
    const target = replyToExternalId ?? parentExternalId;
    const res = await fetch(`${REST}/socialActions/${encodeURIComponent(target)}/comments`, {
      method: "POST",
      headers: { ...headers(channel.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ actor: channel.externalId, object: parentExternalId, message: { text } }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new ProviderError(`LinkedIn yorum ${res.status}: ${body.slice(0, 300)}`, res.status, body, res.status >= 500);
    }
    const id = res.headers.get("x-restli-id") ?? "";
    return { externalId: id || `${target}#comment` };
  },

  async fetchPostMetrics(channel: Channel, externalId: string) {
    const r = await http<{ likesSummary?: { totalLikes?: number }; commentsSummary?: { aggregatedTotalComments?: number; totalFirstLevelComments?: number } }>(
      `${REST}/socialActions/${encodeURIComponent(externalId)}`,
      { headers: headers(channel.accessToken), retries: 0 },
    );
    return {
      likes: Number(r.likesSummary?.totalLikes ?? 0),
      comments: Number(r.commentsSummary?.aggregatedTotalComments ?? r.commentsSummary?.totalFirstLevelComments ?? 0),
    };
  },

  async healthCheck(channel: Channel) {
    try {
      await http("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${channel.accessToken}` } });
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};
