import type { Locale } from "./types.js";

type Dict = Record<string, string>;

const tr: Dict = {
  // Genel
  "err.unauthorized": "Oturum gerekli",
  "err.forbidden": "Bu işlem için yetkin yok",
  "err.not_found": "{what} bulunamadı",
  "err.validation": "Geçersiz istek: {detail}",
  "err.server": "Sunucu hatası",
  "err.rate_limited": "Çok fazla istek. Biraz bekleyip tekrar dene.",
  "err.org_disabled": "Bu çalışma alanı askıya alınmış. Destek ile iletişime geç.",
  "err.csrf": "İstek reddedildi (köken doğrulanamadı)",
  "what.post": "Gönderi",
  "what.channel": "Kanal",
  "what.conversation": "Konuşma",
  "what.rule": "Kural",
  "what.campaign": "Kampanya",
  "what.media": "Medya",
  "what.org": "Çalışma alanı",
  "what.user": "Kullanıcı",
  "what.invitation": "Davet",
  "what.webhook": "Webhook",
  "what.tag": "Etiket",
  "what.customer": "Müşteri",
  "what.signature": "İmza",
  "what.preset": "Hazır ayar",
  "what.preview": "Önizleme",

  // Kimlik
  "auth.invalid_credentials": "E-posta ya da şifre hatalı",
  "auth.email_taken": "Bu e-posta ile zaten bir hesap var",
  "auth.signup_closed": "Kayıtlar şu an kapalı",
  "auth.signup_invite_only": "Kayıt yalnızca davetle yapılabilir",
  "auth.user_disabled": "Hesabın devre dışı bırakılmış",
  "auth.token_invalid": "Bağlantı geçersiz ya da süresi dolmuş",
  "auth.email_not_verified": "Önce e-posta adresini doğrula",
  "auth.password_wrong": "Mevcut şifre hatalı",
  "auth.not_member": "Bu çalışma alanının üyesi değilsin",
  "auth.last_owner": "Çalışma alanının en az bir sahibi olmalı",
  "auth.cannot_remove_self": "Kendini çıkaramazsın; çalışma alanından ayrıl seçeneğini kullan",
  "auth.invite_email_mismatch": "Bu davet başka bir e-posta adresine gönderilmiş",

  // Plan / kota
  "limit.channels": "Planındaki kanal sınırına ulaştın ({limit}). Daha fazla kanal için planını yükselt.",
  "limit.members": "Planındaki ekip üyesi sınırına ulaştın ({limit}).",
  "limit.posts": "Bu ayki gönderi kotan doldu ({limit}). Planını yükselt ya da gelecek ayı bekle.",
  "limit.ai": "Bu ayki AI kullanım kotan doldu ({limit}). Kendi AI anahtarını ekleyebilir ya da planını yükseltebilirsin.",
  "limit.feature": "Bu özellik ({feature}) mevcut planında yok. Planını yükselt.",
  "limit.storage": "Depolama sınırına ulaştın ({limit} MB).",

  // Gönderi
  "post.need_channel": "En az bir kanal seç",
  "post.kind_unsupported": "{channel} ({provider}) '{kind}' türünü desteklemiyor",
  "post.media_required": "{channel} için en az bir görsel ya da video gerekli",
  "post.story_media": "Hikaye için bir görsel ya da video gerekli",
  "post.video_required": "{channel} için bir video gerekli",
  "post.too_long": "{channel}: metin {len} karakter, sınır {max}",
  "post.too_many_media": "{channel}: en fazla {max} medya eklenebilir",
  "post.date_past": "Yayın tarihi geçmişte olamaz",
  "post.date_invalid": "Geçersiz tarih: {value}",
  "post.channel_inactive": "{channel} kanalı aktif değil ({status})",
  "post.publishing_locked": "Yayınlanmakta olan gönderi değiştirilemez",
  "post.already_publishing": "Gönderi zaten yayınlanıyor",
  "post.only_scheduled_cancel": "Sadece planlanmış gönderiler iptal edilebilir",
  "post.not_pending_approval": "Bu gönderi onay beklemiyor",
  "post.empty": "Metin ya da medya olmadan gönderi oluşturulamaz",
  "post.no_slot": "Seçilen aralıkta uygun boş saat bulunamadı",
  "post.youtube_title": "{channel}: YouTube için video başlığı gerekli (ayarlar > title)",

  // Kanal
  "channel.oauth_only": "Bu platform OAuth ile bağlanır",
  "channel.form_only": "Bu platform form ile bağlanır",
  "channel.not_configured": "{provider} için sunucuda uygulama anahtarları tanımlı değil",
  "channel.oauth_state": "Geçersiz ya da süresi dolmuş bağlantı isteği; tekrar dene",
  "channel.oauth_missing": "Eksik OAuth parametresi",
  "channel.no_dm": "{provider} mesaj göndermeyi desteklemiyor",

  // AI
  "ai.disabled": "AI yapılandırılmamış. Ayarlar > AI bölümünden sağlayıcı ve anahtar ekle.",
  "ai.refused": "Model bu isteği yanıtlamadı",
  "ai.empty": "AI boş yanıt döndü",
  "ai.bad_json": "AI yanıtı çözümlenemedi",

  // E-posta
  "mail.verify.subject": "{app} hesabını doğrula",
  "mail.verify.body": "Merhaba,\n\n{app} hesabını doğrulamak için bu bağlantıya tıkla:\n{link}\n\nBağlantı 48 saat geçerli.",
  "mail.reset.subject": "{app} şifre sıfırlama",
  "mail.reset.body": "Merhaba,\n\nŞifreni sıfırlamak için bu bağlantıya tıkla:\n{link}\n\nBağlantı 1 saat geçerli. Bu isteği sen yapmadıysan bu e-postayı yok say.",
  "mail.invite.subject": "{inviter} seni {org} çalışma alanına davet etti",
  "mail.invite.body": "Merhaba,\n\n{inviter}, seni {app} üzerindeki \"{org}\" çalışma alanına {role} olarak davet etti.\n\nKatılmak için: {link}\n\nDavet 7 gün geçerli.",
  "mail.failure.subject": "{app}: gönderi yayınlanamadı",
  "mail.failure.body": "\"{org}\" çalışma alanında bir gönderi yayınlanamadı.\n\nKanal: {channel}\nHata: {error}\n\nDetay: {link}",

  // Bildirim
  "notif.publish_failed": "Gönderi yayınlanamadı",
  "notif.publish_partial": "Gönderi bazı kanallarda yayınlanamadı",
  "notif.published": "Gönderi yayınlandı",
  "notif.token_expired": "{channel} bağlantısı yenilenmeli",
  "notif.pending_approval": "Onay bekleyen gönderi: {title}",
  "notif.plan_created": "AI planı hazır: {name} ({count} gönderi)",
  "notif.handoff": "{name} insan desteği istedi",

  "role.owner": "sahip",
  "role.admin": "yönetici",
  "role.editor": "editör",
  "role.viewer": "izleyici",
};

const en: Dict = {
  "err.unauthorized": "Sign in required",
  "err.forbidden": "You don't have permission for this action",
  "err.not_found": "{what} not found",
  "err.validation": "Invalid request: {detail}",
  "err.server": "Server error",
  "err.rate_limited": "Too many requests. Please wait and try again.",
  "err.org_disabled": "This workspace is suspended. Please contact support.",
  "err.csrf": "Request rejected (origin could not be verified)",
  "what.post": "Post",
  "what.channel": "Channel",
  "what.conversation": "Conversation",
  "what.rule": "Rule",
  "what.campaign": "Campaign",
  "what.media": "Media",
  "what.org": "Workspace",
  "what.user": "User",
  "what.invitation": "Invitation",
  "what.webhook": "Webhook",
  "what.tag": "Tag",
  "what.customer": "Customer",
  "what.signature": "Signature",
  "what.preset": "Preset",
  "what.preview": "Preview",

  "auth.invalid_credentials": "Incorrect email or password",
  "auth.email_taken": "An account with this email already exists",
  "auth.signup_closed": "Sign-ups are currently closed",
  "auth.signup_invite_only": "Sign-up is by invitation only",
  "auth.user_disabled": "Your account has been disabled",
  "auth.token_invalid": "This link is invalid or has expired",
  "auth.email_not_verified": "Please verify your email first",
  "auth.password_wrong": "Current password is incorrect",
  "auth.not_member": "You are not a member of this workspace",
  "auth.last_owner": "A workspace must have at least one owner",
  "auth.cannot_remove_self": "You can't remove yourself; use leave workspace instead",
  "auth.invite_email_mismatch": "This invitation was sent to a different email address",

  "limit.channels": "You've reached your plan's channel limit ({limit}). Upgrade for more channels.",
  "limit.members": "You've reached your plan's team member limit ({limit}).",
  "limit.posts": "This month's post quota is used up ({limit}). Upgrade or wait for next month.",
  "limit.ai": "This month's AI quota is used up ({limit}). Add your own AI key or upgrade your plan.",
  "limit.feature": "This feature ({feature}) isn't included in your plan. Please upgrade.",
  "limit.storage": "Storage limit reached ({limit} MB).",

  "post.need_channel": "Select at least one channel",
  "post.kind_unsupported": "{channel} ({provider}) doesn't support '{kind}'",
  "post.media_required": "{channel} requires at least one image or video",
  "post.story_media": "A story requires an image or video",
  "post.video_required": "{channel} requires a video",
  "post.too_long": "{channel}: text is {len} characters, limit is {max}",
  "post.too_many_media": "{channel}: at most {max} media items allowed",
  "post.date_past": "Publish date can't be in the past",
  "post.date_invalid": "Invalid date: {value}",
  "post.channel_inactive": "Channel {channel} is not active ({status})",
  "post.publishing_locked": "A post that is being published can't be changed",
  "post.already_publishing": "Post is already being published",
  "post.only_scheduled_cancel": "Only scheduled posts can be cancelled",
  "post.not_pending_approval": "This post is not awaiting approval",
  "post.empty": "A post needs text or media",
  "post.no_slot": "No free time slot found in the selected range",
  "post.youtube_title": "{channel}: YouTube needs a video title (settings > title)",

  "channel.oauth_only": "This platform connects via OAuth",
  "channel.form_only": "This platform connects with a form",
  "channel.not_configured": "App credentials for {provider} are not configured on the server",
  "channel.oauth_state": "Invalid or expired connection request; please try again",
  "channel.oauth_missing": "Missing OAuth parameter",
  "channel.no_dm": "{provider} doesn't support sending messages",

  "ai.disabled": "AI is not configured. Add a provider and key under Settings > AI.",
  "ai.refused": "The model declined this request",
  "ai.empty": "The AI returned an empty response",
  "ai.bad_json": "Could not parse the AI response",

  "mail.verify.subject": "Verify your {app} account",
  "mail.verify.body": "Hi,\n\nClick this link to verify your {app} account:\n{link}\n\nThe link is valid for 48 hours.",
  "mail.reset.subject": "{app} password reset",
  "mail.reset.body": "Hi,\n\nClick this link to reset your password:\n{link}\n\nThe link is valid for 1 hour. If you didn't request this, ignore this email.",
  "mail.invite.subject": "{inviter} invited you to {org}",
  "mail.invite.body": "Hi,\n\n{inviter} invited you to join the \"{org}\" workspace on {app} as {role}.\n\nJoin here: {link}\n\nThe invitation is valid for 7 days.",
  "mail.failure.subject": "{app}: a post failed to publish",
  "mail.failure.body": "A post in the \"{org}\" workspace failed to publish.\n\nChannel: {channel}\nError: {error}\n\nDetails: {link}",

  "notif.publish_failed": "Post failed to publish",
  "notif.publish_partial": "Post failed on some channels",
  "notif.published": "Post published",
  "notif.token_expired": "{channel} needs to be reconnected",
  "notif.pending_approval": "Post awaiting approval: {title}",
  "notif.plan_created": "AI plan ready: {name} ({count} posts)",
  "notif.handoff": "{name} asked for a human",

  "role.owner": "owner",
  "role.admin": "admin",
  "role.editor": "editor",
  "role.viewer": "viewer",
};

const dicts: Record<Locale, Dict> = { tr, en };

export function t(locale: Locale, key: string, vars: Record<string, string | number> = {}): string {
  const raw = dicts[locale]?.[key] ?? dicts.tr[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export function pickLocale(input: string | null | undefined): Locale {
  if (!input) return "tr";
  const s = input.toLowerCase();
  if (s.startsWith("en")) return "en";
  if (s.startsWith("tr")) return "tr";
  // Accept-Language: "en-US,en;q=0.9,tr;q=0.8"
  const first = s.split(",")[0]?.trim() ?? "";
  return first.startsWith("en") ? "en" : "tr";
}

/**
 * Uygulama hatası: HTTP durum kodu + çeviri anahtarı.
 * Hata işleyici kullanıcının diline çevirir; MCP araçları da aynı mesajı kullanır.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly key: string,
    public readonly vars: Record<string, string | number> = {},
    public readonly details?: unknown,
  ) {
    super(t("tr", key, vars));
    this.name = "AppError";
  }
  localized(locale: Locale): string {
    // "what" değişkeni başka bir anahtarsa onu da çevir
    const vars = { ...this.vars };
    if (typeof vars.what === "string" && vars.what.startsWith("what.")) vars.what = t(locale, vars.what);
    return t(locale, this.key, vars);
  }
}

export const notFound = (what: string) => new AppError(404, "err.not_found", { what: `what.${what}` });
export const forbidden = () => new AppError(403, "err.forbidden");
