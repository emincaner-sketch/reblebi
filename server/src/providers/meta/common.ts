import { config } from "../../core/config.js";
import { http, sleep } from "../http.js";
import { ProviderError, type ConnectedAccount, type OAuthStart } from "../types.js";

export const GRAPH = () => `https://graph.facebook.com/${config.meta.graphVersion}`;

/** Graph API GET/POST kısayolu: token query'de gider */
export async function graph<T = Record<string, unknown>>(
  path: string,
  token: string,
  opts: { method?: "GET" | "POST" | "DELETE"; params?: Record<string, unknown>; base?: string } = {},
): Promise<T> {
  const base = opts.base ?? GRAPH();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const method = opts.method ?? "GET";
  const params: Record<string, string> = { access_token: token };
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v === undefined || v === null) continue;
    params[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  if (method === "GET" || method === "DELETE") return http<T>(url, { method, query: params });
  return http<T>(url, { method, form: params });
}

/** Facebook Login (Sayfalar + Instagram + Messenger + IG DM) izinleri */
export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_messaging",
  "pages_manage_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_messages",
  "instagram_manage_insights",
  "instagram_manage_comments",
  "read_insights",
  "business_management",
];

export function metaOAuthStart(redirectUri: string, state: string): OAuthStart {
  const u = new URL(`https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth`);
  u.searchParams.set("client_id", config.meta.appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", META_SCOPES.join(","));
  return { url: u.toString() };
}

interface PageRow {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
}

/**
 * Kod -> kısa ömürlü kullanıcı token -> uzun ömürlü kullanıcı token -> sayfa token'ları.
 * Her Facebook sayfası bir "facebook" kanalı, bağlı Instagram hesabı bir "instagram" kanalı olur.
 */
export async function metaOAuthCallback(code: string, redirectUri: string): Promise<ConnectedAccount[]> {
  const short = await http<{ access_token: string }>(`${GRAPH()}/oauth/access_token`, {
    query: { client_id: config.meta.appId, client_secret: config.meta.appSecret, redirect_uri: redirectUri, code },
  });
  const long = await http<{ access_token: string; expires_in?: number }>(`${GRAPH()}/oauth/access_token`, {
    query: {
      grant_type: "fb_exchange_token",
      client_id: config.meta.appId,
      client_secret: config.meta.appSecret,
      fb_exchange_token: short.access_token,
    },
  });
  const userToken = long.access_token;
  const pages: PageRow[] = [];
  let next: string | null = `${GRAPH()}/me/accounts`;
  let guard = 0;
  while (next && guard++ < 10) {
    const res: { data?: PageRow[]; paging?: { next?: string } } = await http(next, {
      query: next.includes("access_token")
        ? undefined
        : {
            access_token: userToken,
            fields: "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
            limit: 100,
          },
    });
    pages.push(...(res.data ?? []));
    next = res.paging?.next ?? null;
  }
  if (!pages.length) {
    throw new ProviderError(
      "Hiç Facebook sayfası bulunamadı. Hesabında yönettiğin bir sayfa olmalı ve izin ekranında sayfaları seçmelisin.",
    );
  }
  const accounts: ConnectedAccount[] = [];
  for (const p of pages) {
    accounts.push({
      provider: "facebook",
      externalId: p.id,
      name: p.name,
      username: null,
      avatarUrl: p.picture?.data?.url ?? null,
      accessToken: p.access_token,
      tokenExpiresAt: null, // uzun ömürlü kullanıcı token'ından türeyen sayfa token'ları süresizdir
      scopes: META_SCOPES.join(","),
      metadata: { pageId: p.id, userToken },
    });
    if (p.instagram_business_account) {
      const ig = p.instagram_business_account;
      accounts.push({
        provider: "instagram",
        externalId: ig.id,
        name: ig.name ?? ig.username ?? p.name,
        username: ig.username ?? null,
        avatarUrl: ig.profile_picture_url ?? null,
        accessToken: p.access_token,
        tokenExpiresAt: null,
        scopes: META_SCOPES.join(","),
        metadata: { pageId: p.id, pageName: p.name, igUserId: ig.id },
      });
    }
  }
  return accounts;
}

/** Instagram/Threads konteyner durumunu FINISHED olana kadar bekler */
export async function waitForContainer(
  statusUrl: string,
  token: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  while (Date.now() < deadline) {
    const r = await graph<{ status_code?: string; status?: string }>(statusUrl, token, {
      params: { fields: "status_code,status" },
      base: "",
    });
    const code = r.status_code ?? "";
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new ProviderError(`Medya işleme başarısız: ${r.status ?? code}`);
    }
    await sleep(opts.intervalMs ?? 4000);
  }
  throw new ProviderError("Medya işleme zaman aşımına uğradı", undefined, undefined, true);
}

/** Messenger / Instagram DM gönderimi (Sayfa token'ı ile) */
export async function sendPageMessage(pageId: string, token: string, recipientId: string, text: string): Promise<string | null> {
  const r = await graph<{ message_id?: string; recipient_id?: string }>(`/${pageId}/messages`, token, {
    method: "POST",
    params: { recipient: { id: recipientId }, message: { text }, messaging_type: "RESPONSE" },
  });
  return r.message_id ?? null;
}
