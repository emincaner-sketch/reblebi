/**
 * Platform uygulama anahtarları (X, TikTok, Google, LinkedIn, Meta, Threads).
 * .env dosyasına dokunmadan panelden girilebilir: değerler şifrelenip `settings` tablosuna yazılır ve
 * açılışta `config` üzerine uygulanır. Panelden girilen değer .env'deki değerin önüne geçer.
 */
import { config } from "../core/config.js";
import { decrypt, encrypt } from "../core/crypto.js";
import { platformSettingsRepo } from "../core/repos/misc.js";

type KeyGroup = keyof typeof config;

interface KeyField {
  /** İstemcide ve depoda kullanılan anahtar */
  id: string;
  env: string;
  group: KeyGroup;
  field: string;
  label: string;
  secret: boolean;
}

export interface PlatformGuide {
  id: string;
  label: string;
  /** Bu uygulamayla açılan kanallar */
  unlocks: string[];
  portalUrl: string;
  portalLabel: string;
  /** Platform panelinde tanımlanacak geri dönüş adresleri */
  redirects: string[];
  scopes: string;
  steps: string[];
  /** İnceleme/onay hakkında dürüst not */
  reviewNote: string;
  fields: KeyField[];
}

const f = (id: string, env: string, group: KeyGroup, field: string, label: string, secret: boolean): KeyField => ({ id, env, group, field, label, secret });

function guides(): PlatformGuide[] {
  const base = config.publicUrl;
  const cb = (p: string) => `${base}/api/oauth/${p}/callback`;
  return [
    {
      id: "x",
      label: "X (Twitter)",
      unlocks: ["X"],
      portalUrl: "https://developer.x.com/en/portal/dashboard",
      portalLabel: "X Developer Portal",
      redirects: [cb("x")],
      scopes: "tweet.read tweet.write users.read offline.access dm.read dm.write media.write",
      steps: [
        "developer.x.com'a gir, bir Proje ve içinde bir Uygulama oluştur.",
        "Uygulama → User authentication settings → Set up: App permissions \"Read and write and Direct message\", Type of App \"Web App, Automated App or Bot\" (confidential client).",
        "Callback URI olarak aşağıdaki adresi aynen yapıştır; Website URL olarak site adresini yaz.",
        "Keys and tokens sekmesinden OAuth 2.0 Client ID ve Client Secret değerlerini kopyalayıp aşağı yapıştır.",
        "Gönderi atmak için X'in ücretli ya da kullanım-başı-öde API katmanı gerekir; DM okuma daha üst katman ister.",
      ],
      reviewNote: "X'te ayrı bir inceleme yoktur; erişim API katmanına (ücret) bağlıdır.",
      fields: [f("clientId", "X_CLIENT_ID", "x", "clientId", "OAuth 2.0 Client ID", false), f("clientSecret", "X_CLIENT_SECRET", "x", "clientSecret", "OAuth 2.0 Client Secret", true)],
    },
    {
      id: "tiktok",
      label: "TikTok",
      unlocks: ["TikTok"],
      portalUrl: "https://developers.tiktok.com/apps/",
      portalLabel: "TikTok for Developers",
      redirects: [cb("tiktok")],
      scopes: "user.info.basic user.info.profile user.info.stats video.publish video.upload video.list",
      steps: [
        "developers.tiktok.com'da bir uygulama oluştur; ürünlerden \"Login Kit\" ve \"Content Posting API\" ekle.",
        "Redirect URI olarak aşağıdaki adresi ekle; Terms of Service ve Privacy Policy adreslerini gir (aşağıdaki bağlantılar).",
        "Scopes bölümünden listedeki izinleri iste (video.publish için Direct Post izni gerekir).",
        "Uygulamanın Client key ve Client secret değerlerini aşağı yapıştır.",
        "Sandbox'ta yalnızca ekli test hesapları bağlanır. Herkese açık yayın için \"Submit for review\" ile demo videosu yükleyip onay al.",
      ],
      reviewNote: "TikTok denetimi geçene kadar paylaşımlar yalnızca \"Sadece ben\" görünürlüğünde yayınlanır.",
      fields: [f("clientKey", "TIKTOK_CLIENT_KEY", "tiktok", "clientKey", "Client key", false), f("clientSecret", "TIKTOK_CLIENT_SECRET", "tiktok", "clientSecret", "Client secret", true)],
    },
    {
      id: "google",
      label: "Google (YouTube + İşletme Profili)",
      unlocks: ["YouTube", "Google İşletme", "Google ile giriş"],
      portalUrl: "https://console.cloud.google.com/apis/credentials",
      portalLabel: "Google Cloud Console",
      redirects: [cb("youtube"), cb("gmb"), `${config.appUrl}/api/auth/google/callback`],
      scopes: "youtube.upload youtube.readonly yt-analytics.readonly youtube.force-ssl business.manage openid email profile",
      steps: [
        "Google Cloud'da bir proje seç; YouTube Data API v3, YouTube Analytics API ve Business Profile API'lerini etkinleştir.",
        "OAuth consent screen'i External olarak doldur (uygulama adı, destek e-postası, gizlilik ve koşullar bağlantıları).",
        "Credentials → Create credentials → OAuth client ID → Web application; yetkili yönlendirme URI'leri olarak aşağıdaki üç adresi ekle.",
        "Client ID ve Client secret değerlerini aşağı yapıştır.",
        "Test modundayken yalnızca \"Test users\" listesindeki hesaplar bağlanır; YouTube izinleri için Google doğrulaması gerekir.",
      ],
      reviewNote: "youtube.upload ve business.manage hassas izinlerdir: Google uygulama doğrulaması (demo videosu) ister.",
      fields: [f("clientId", "GOOGLE_CLIENT_ID", "google", "clientId", "Client ID", false), f("clientSecret", "GOOGLE_CLIENT_SECRET", "google", "clientSecret", "Client secret", true)],
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      unlocks: ["LinkedIn"],
      portalUrl: "https://www.linkedin.com/developers/apps",
      portalLabel: "LinkedIn Developers",
      redirects: [cb("linkedin")],
      scopes: "openid profile w_member_social",
      steps: [
        "linkedin.com/developers'ta uygulama oluştur ve bir LinkedIn Sayfası ile ilişkilendir.",
        "Products sekmesinden \"Sign In with LinkedIn using OpenID Connect\" ve \"Share on LinkedIn\" ürünlerini ekle.",
        "Auth sekmesinde Authorized redirect URL olarak aşağıdaki adresi ekle.",
        "Client ID ve Primary Client Secret değerlerini aşağı yapıştır.",
        "Şirket sayfalarına paylaşım için Community Management API onayı ve LINKEDIN_SCOPES gerekir.",
      ],
      reviewNote: "Kişisel profil paylaşımı onaysız çalışır; şirket sayfası için LinkedIn onayı gerekir.",
      fields: [f("clientId", "LINKEDIN_CLIENT_ID", "linkedin", "clientId", "Client ID", false), f("clientSecret", "LINKEDIN_CLIENT_SECRET", "linkedin", "clientSecret", "Primary Client Secret", true)],
    },
    {
      id: "meta",
      label: "Meta (Instagram + Facebook)",
      unlocks: ["Instagram", "Facebook", "WhatsApp"],
      portalUrl: "https://developers.facebook.com/apps/",
      portalLabel: "Meta for Developers",
      redirects: [cb("meta")],
      scopes: "instagram_basic instagram_content_publish instagram_manage_comments instagram_manage_messages instagram_manage_insights pages_show_list pages_manage_posts pages_read_engagement pages_manage_metadata pages_messaging business_management",
      steps: [
        "developers.facebook.com'da \"Business\" türünde uygulama oluştur; Facebook Login for Business ve Instagram ürünlerini ekle.",
        "Facebook Login → Settings → Valid OAuth Redirect URIs alanına aşağıdaki adresi ekle.",
        "App settings → Basic'ten gizlilik, koşullar ve veri silme bağlantılarını gir; App ID ve App Secret değerlerini aşağı yapıştır.",
        "Geliştirme modunda yalnızca uygulamanın rol verilmiş kullanıcıları bağlanır; herkese açmak için App Review (aşağıdaki başvuru notları) ve Business Verification gerekir.",
      ],
      reviewNote: "Canlıya geçmek için App Review ve Business Verification gerekir; ayrıntı docs/BASVURULAR.md içinde.",
      fields: [f("appId", "META_APP_ID", "meta", "appId", "App ID", false), f("appSecret", "META_APP_SECRET", "meta", "appSecret", "App Secret", true)],
    },
    {
      id: "instagram",
      label: "Instagram (doğrudan giriş)",
      unlocks: ["Instagram (Facebook Sayfası gerekmez)"],
      portalUrl: "https://developers.facebook.com/apps/",
      portalLabel: "Meta for Developers: Instagram > API setup with Instagram login",
      redirects: [cb("instagram-login")],
      scopes: "instagram_business_basic instagram_business_content_publish instagram_business_manage_comments instagram_business_manage_messages instagram_business_manage_insights",
      steps: [
        "Meta uygulamanda sol menüden Instagram > \"API setup with Instagram login\" bölümünü aç.",
        "\"Set up Instagram business login\" altında OAuth redirect URI olarak aşağıdaki adresi ekle.",
        "Aynı sayfadaki \"Instagram app ID\" ve \"Instagram app secret\" değerlerini aşağı yapıştır (Meta App ID'sinden farklıdır).",
        "Webhooks için aynı sayfada Callback URL olarak /webhooks/meta adresini ve doğrulama jetonunu gir; messages ve comments alanlarına abone ol.",
        "Geliştirme modunda yalnızca Instagram Tester rolü verilen hesaplar bağlanır; herkese açmak için App Review gerekir.",
      ],
      reviewNote: "İnceleme sırasında her izin için kısa bir ekran kaydı istenir; ayrıntılar docs/BASVURULAR.md içinde.",
      fields: [f("appId", "INSTAGRAM_APP_ID", "instagram", "appId", "Instagram App ID", false), f("appSecret", "INSTAGRAM_APP_SECRET", "instagram", "appSecret", "Instagram App Secret", true)],
    },
    {
      id: "threads",
      label: "Threads",
      unlocks: ["Threads"],
      portalUrl: "https://developers.facebook.com/apps/",
      portalLabel: "Meta for Developers (Threads kullanım örneği)",
      redirects: [cb("threads")],
      scopes: "threads_basic threads_content_publish threads_manage_replies threads_read_replies threads_manage_insights",
      steps: [
        "Meta uygulamanda \"Threads API\" kullanım örneğini ekle.",
        "Threads ayarlarında Redirect Callback URL olarak aşağıdaki adresi ekle.",
        "Threads App ID ve Threads App Secret değerlerini (Meta App ID'sinden farklıdır) aşağı yapıştır.",
      ],
      reviewNote: "Threads izinleri de App Review ister.",
      fields: [f("appId", "THREADS_APP_ID", "threads", "appId", "Threads App ID", false), f("appSecret", "THREADS_APP_SECRET", "threads", "appSecret", "Threads App Secret", true)],
    },
  ];
}

const STORE_KEY = "platform_keys";

function readStore(): Record<string, string> {
  const raw = platformSettingsRepo.get(STORE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(decrypt(raw)) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStore(v: Record<string, string>): void {
  platformSettingsRepo.set(STORE_KEY, encrypt(JSON.stringify(v)));
}

function setConfig(fl: KeyField, value: string): void {
  ((config as Record<string, unknown>)[fl.group] as Record<string, string>)[fl.field] = value;
}

/** Açılışta ve kayıttan sonra: panelde saklı değerleri config üzerine uygula */
export function applyStoredKeys(): void {
  const store = readStore();
  for (const g of guides()) for (const fl of g.fields) if (store[`${g.id}.${fl.id}`]) setConfig(fl, store[`${g.id}.${fl.id}`]);
}

const mask = (v: string) => (v.length <= 8 ? "••••" : `${v.slice(0, 3)}••••${v.slice(-3)}`);

export function describePlatformKeys() {
  const store = readStore();
  return guides().map((g) => ({
    ...g,
    fields: g.fields.map((fl) => {
      const cur = ((config as Record<string, unknown>)[fl.group] as Record<string, string>)[fl.field] ?? "";
      const fromPanel = Boolean(store[`${g.id}.${fl.id}`]);
      return { id: fl.id, label: fl.label, secret: fl.secret, set: Boolean(cur), source: !cur ? "none" : fromPanel ? "panel" : "env", preview: cur ? (fl.secret ? mask(cur) : cur) : "" };
    }),
    configured: g.fields.every((fl) => Boolean(((config as Record<string, unknown>)[fl.group] as Record<string, string>)[fl.field])),
  }));
}

/** Boş bırakılan alan mevcut değeri korur; `null` panel değerini siler (varsa .env'e döner) */
export function savePlatformKeys(platformId: string, values: Record<string, string | null>): void {
  const g = guides().find((x) => x.id === platformId);
  if (!g) throw new Error("unknown_platform");
  const store = readStore();
  for (const fl of g.fields) {
    const v = values[fl.id];
    const k = `${g.id}.${fl.id}`;
    if (v === null) {
      delete store[k];
      setConfig(fl, process.env[fl.env] ?? "");
    } else if (typeof v === "string" && v.trim()) {
      store[k] = v.trim();
      setConfig(fl, v.trim());
    }
  }
  writeStore(store);
}
