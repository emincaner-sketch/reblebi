import crypto from "node:crypto";
import { config } from "../../core/config.js";
import { http, sleep } from "../http.js";
import { ProviderError, type ConnectedAccount, type MessengerProfileInput, type OAuthStart, type OutboundMessage } from "../types.js";

export const GRAPH = () => `https://graph.facebook.com/${config.meta.graphVersion}`;
/** Instagram Login ile bağlanan hesaplar graph.facebook.com yerine graph.instagram.com'a gider */
export const IG_GRAPH = () => `https://graph.instagram.com/${config.meta.graphVersion}`;

/** Kanalın Graph tabanı: Instagram Login kanalları için graph.instagram.com, diğerleri varsayılan */
export function channelBase(channel: { metadata: Record<string, unknown> }): string | undefined {
  return channel.metadata.igLogin ? IG_GRAPH() : undefined;
}

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
  // Uygulamaya özel Facebook kullanıcı kimliği: Meta veri silme geri çağrısında eşleştirmek için saklanır
  const me = await graph<{ id: string }>("/me", userToken, { params: { fields: "id" } });
  const fbUserId = me.id;
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
      metadata: { pageId: p.id, userToken, fbUserId },
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
        metadata: { pageId: p.id, pageName: p.name, igUserId: ig.id, fbUserId },
      });
    }
  }
  return accounts;
}

/**
 * Instagram/Threads konteyner durumunu FINISHED olana kadar bekler.
 * Instagram durumu `status_code`'da (açıklama `status`'ta) verir; Threads'te `status_code` alanı yoktur
 * (istenirse kod 100 hatası döner), durum `status`'ta, açıklama `error_message`'dadır.
 */
export async function waitForContainer(
  statusUrl: string,
  token: string,
  opts: { timeoutMs?: number; intervalMs?: number; api?: "instagram" | "threads" } = {},
): Promise<void> {
  const threads = opts.api === "threads";
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  while (Date.now() < deadline) {
    const r = await graph<{ status_code?: string; status?: string; error_message?: string }>(statusUrl, token, {
      params: { fields: threads ? "status,error_message" : "status_code,status" },
      base: "",
    });
    const code = (threads ? r.status : r.status_code) ?? "";
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new ProviderError(`Medya işleme başarısız: ${(threads ? r.error_message : r.status) || code}`);
    }
    await sleep(opts.intervalMs ?? 4000);
  }
  throw new ProviderError("Medya işleme zaman aşımına uğradı", undefined, undefined, true);
}

/** Send API mesaj türü: normal cevap ya da (24 saat dışında insan cevabı için) etiketli mesaj */
export function messagingTypeParams(tag?: "HUMAN_AGENT"): Record<string, string> {
  return tag ? { messaging_type: "MESSAGE_TAG", tag } : { messaging_type: "RESPONSE" };
}

/** Messenger / Instagram DM gönderimi (Sayfa token'ı ile) */
export async function sendPageMessage(pageId: string, token: string, recipientId: string, text: string, tag?: "HUMAN_AGENT"): Promise<string | null> {
  const r = await graph<{ message_id?: string; recipient_id?: string }>(`/${pageId}/messages`, token, {
    method: "POST",
    params: { recipient: { id: recipientId }, message: { text }, ...messagingTypeParams(tag) },
  });
  return r.message_id ?? null;
}

/**
 * Meta webhook imzası (X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(ham gövde)).
 * Facebook/Messenger olayları Meta uygulamasının, "Instagram ile giriş" olayları Instagram ürününün
 * kendi App Secret'ı ile imzalanır; tanımlı anahtarlardan biri tutarsa kabul edilir.
 * Hiç anahtar yoksa (yerel geliştirme) doğrulama atlanır.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | undefined,
  secrets: Array<string | undefined> = [config.meta.appSecret, config.instagram.appSecret],
): boolean {
  const keys = [...new Set(secrets.filter((k): k is string => Boolean(k)))];
  if (!keys.length) return true;
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7).toLowerCase());
  return keys.some((key) => {
    const expected = Buffer.from(crypto.createHmac("sha256", key).update(rawBody, "utf8").digest("hex"));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

/** Meta Send API sınırları (Messenger ve Instagram) */
export const MESSAGE_LIMITS = { buttons: 3, quickReplies: 13, titleChars: 20, buttonTextChars: 640, textChars: 1000, payloadChars: 1000 } as const;

/** Mesajın Meta sınırlarına uyup uymadığını kontrol eder; uymuyorsa açıklayıcı hata fırlatır */
export function validateOutboundMessage(m: OutboundMessage): void {
  const buttons = m.buttons ?? [];
  const quick = m.quickReplies ?? [];
  const L = MESSAGE_LIMITS;
  if (!m.text.trim()) throw new ProviderError("Mesaj metni boş", 400);
  if (buttons.length > L.buttons) throw new ProviderError(`En fazla ${L.buttons} düğme eklenebilir`, 400);
  if (quick.length > L.quickReplies) throw new ProviderError(`En fazla ${L.quickReplies} hızlı cevap eklenebilir`, 400);
  if (buttons.length && m.text.length > L.buttonTextChars) throw new ProviderError(`Düğmeli mesaj en fazla ${L.buttonTextChars} karakter olabilir`, 400);
  if (m.text.length > L.textChars) throw new ProviderError(`Mesaj en fazla ${L.textChars} karakter olabilir`, 400);
  for (const b of [...buttons, ...quick]) {
    if (!b.title.trim() || b.title.length > L.titleChars) throw new ProviderError(`Düğme ve hızlı cevap başlığı 1-${L.titleChars} karakter olmalı: "${b.title}"`, 400);
  }
  for (const b of buttons) {
    if (b.type === "web_url" && !/^https:\/\//.test(b.url)) throw new ProviderError(`Bağlantı https:// ile başlamalı: ${b.url}`, 400);
    if (b.type === "postback" && (!b.payload || b.payload.length > L.payloadChars)) throw new ProviderError("Düğme payload'ı geçersiz", 400);
  }
  for (const q of quick) if (!q.payload || q.payload.length > L.payloadChars) throw new ProviderError("Hızlı cevap payload'ı geçersiz", 400);
}

/** Send API "message" alanı: düğme varsa button template, hızlı cevaplar her mesaja eklenebilir */
export function metaMessagePayload(m: OutboundMessage): Record<string, unknown> {
  validateOutboundMessage(m);
  const message: Record<string, unknown> = m.buttons?.length
    ? {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: m.text,
            buttons: m.buttons.map((b) => (b.type === "web_url" ? { type: "web_url", url: b.url, title: b.title } : { type: "postback", title: b.title, payload: b.payload })),
          },
        },
      }
    : { text: m.text };
  if (m.quickReplies?.length) message.quick_replies = m.quickReplies.map((q) => ({ content_type: "text", title: q.title, payload: q.payload }));
  return message;
}

/** Yorum sahibine özel yanıt: /{hesap}/messages, alıcı yorum kimliği (Messenger ve Instagram aynı biçim) */
export async function sendCommentPrivateReply(accountId: string, token: string, commentId: string, message: OutboundMessage, base?: string): Promise<string | null> {
  const r = await graph<{ message_id?: string }>(`/${accountId}/messages`, token, {
    method: "POST",
    params: { recipient: { comment_id: commentId }, message: metaMessagePayload(message) },
    base,
  });
  return r.message_id ?? null;
}

/** Messenger Profile sınırları (Instagram ve Messenger) */
export const PROFILE_LIMITS = { iceBreakers: 4, questionChars: 80, menuItems: 20, menuTitleChars: 30, payloadChars: 1000 } as const;

/**
 * Sohbet menüsünü Meta'ya yazar: /{hesap}/messenger_profile.
 * Dolu alanlar POST ile ayarlanır, boş alanlar DELETE ile kaldırılır.
 * Instagram'da platform=instagram gider. Messenger'da sabit menü için "Başlarken" düğmesi gerekir; menü varsa o da ayarlanır.
 */
export async function syncMessengerProfile(
  accountPath: string,
  token: string,
  profile: MessengerProfileInput,
  opts: { base?: string; platform?: "instagram"; getStarted?: boolean } = {},
): Promise<void> {
  const L = PROFILE_LIMITS;
  if (profile.iceBreakers.length > L.iceBreakers) throw new ProviderError(`En fazla ${L.iceBreakers} hazır soru eklenebilir`, 400);
  if (profile.menu.length > L.menuItems) throw new ProviderError(`Sabit menüde en fazla ${L.menuItems} öğe olabilir`, 400);
  for (const q of profile.iceBreakers) {
    if (!q.question.trim() || q.question.length > L.questionChars) throw new ProviderError(`Hazır soru 1-${L.questionChars} karakter olmalı: "${q.question}"`, 400);
    if (!q.payload || q.payload.length > L.payloadChars) throw new ProviderError("Hazır soru payload'ı geçersiz", 400);
  }
  for (const b of profile.menu) {
    if (!b.title.trim() || b.title.length > L.menuTitleChars) throw new ProviderError(`Menü başlığı 1-${L.menuTitleChars} karakter olmalı: "${b.title}"`, 400);
    if (b.type === "web_url" && !/^https:\/\//.test(b.url)) throw new ProviderError(`Bağlantı https:// ile başlamalı: ${b.url}`, 400);
    if (b.type === "postback" && (!b.payload || b.payload.length > L.payloadChars)) throw new ProviderError("Menü payload'ı geçersiz", 400);
  }

  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  if (profile.iceBreakers.length)
    set.ice_breakers = [{ locale: "default", call_to_actions: profile.iceBreakers.map((q) => ({ question: q.question, payload: q.payload })) }];
  else remove.push("ice_breakers");
  if (profile.menu.length) {
    set.persistent_menu = [
      {
        locale: "default",
        call_to_actions: profile.menu.map((b) => (b.type === "web_url" ? { type: "web_url", title: b.title, url: b.url } : { type: "postback", title: b.title, payload: b.payload })),
      },
    ];
    if (opts.getStarted) set.get_started = { payload: "GET_STARTED" };
  } else remove.push("persistent_menu");

  const path = `${accountPath}/messenger_profile`;
  if (Object.keys(set).length) await graph(path, token, { method: "POST", params: { platform: opts.platform, ...set }, base: opts.base });
  if (remove.length) await graph(path, token, { method: "DELETE", params: { platform: opts.platform, fields: remove }, base: opts.base });
}

/** Meta signed_request: base64url(imza).base64url(json), HMAC-SHA256(app secret) */
export function parseSignedRequest(signed: string): { user_id?: string; algorithm?: string } | null {
  const [sig, payload] = signed.split(".");
  if (!sig || !payload || !config.meta.appSecret) return null;
  const expected = crypto.createHmac("sha256", config.meta.appSecret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { user_id?: string; algorithm?: string };
    return data.algorithm?.toUpperCase() === "HMAC-SHA256" ? data : null;
  } catch {
    return null;
  }
}

/* ---------------- Insights yardımcıları (Instagram + Facebook Sayfa) ---------------- */

interface InsightRow {
  name: string;
  values?: Array<{ value: number | Record<string, number> }>;
  total_value?: { value?: number; breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }> };
}

/** total_value ya da values[] biçimindeki tek metriği sayıya çevirir (günlük değerler toplanır) */
export function insightNumber(row: InsightRow | undefined): number | null {
  if (!row) return null;
  if (typeof row.total_value?.value === "number") return row.total_value.value;
  const nums = (row.values ?? []).map((v) => v.value).filter((v): v is number => typeof v === "number");
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

/** breakdown sonuçlarını { boyut: değer } nesnesine çevirir */
export function insightBreakdown(row: InsightRow | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of row?.total_value?.breakdowns?.[0]?.results ?? []) {
    const k = r.dimension_values?.[0];
    if (k && typeof r.value === "number") out[k] = (out[k] ?? 0) + r.value;
  }
  return out;
}

/**
 * Metrikleri önce tek istekte ister; Graph geçersiz/desteklenmeyen bir metrikte tüm isteği reddederse
 * her metriği ayrı dener. Alınamayan metrik sonuçta yer almaz.
 */
export async function fetchInsights(path: string, token: string, metrics: string[], params: Record<string, unknown>, base?: string): Promise<Map<string, InsightRow>> {
  const out = new Map<string, InsightRow>();
  const take = (rows: InsightRow[] | undefined) => {
    for (const r of rows ?? []) out.set(r.name, r);
  };
  try {
    take((await graph<{ data?: InsightRow[] }>(path, token, { params: { ...params, metric: metrics.join(",") }, base })).data);
    return out;
  } catch {
    for (const m of metrics) {
      try {
        take((await graph<{ data?: InsightRow[] }>(path, token, { params: { ...params, metric: m }, base })).data);
      } catch {
        /* bu metrik bu hesapta yok ya da izin verilmemiş */
      }
    }
    return out;
  }
}
