import type { Channel, MediaFile, PostKind, ProviderId } from "../core/types.js";

/** Yayınlanacak medya: hem yerel dosya yolu hem herkese açık URL (Meta/TikTok URL ister, X/YouTube dosya ister) */
export interface PublishMedia extends MediaFile {
  localPath: string;
  publicUrl: string;
}

export interface PublishInput {
  kind: PostKind;
  text: string;
  media: PublishMedia[];
  /** Platforma özel ayarlar (ör. YouTube başlık/gizlilik, TikTok privacy_level) */
  settings: Record<string, unknown>;
}

export interface PublishResult {
  externalId: string;
  url?: string | null;
}

export interface Capabilities {
  post: boolean;
  story: boolean;
  reel: boolean;
  video: boolean;
  thread: boolean;
  dm: boolean;
  /** Gelen mesajlar webhook ile mi geliyor yoksa polling mi */
  inbound: "webhook" | "poll" | "none";
  analytics: boolean;
  maxTextLength: number;
  /** Gönderi altına ilk yorum / zincir yanıtı atılabilir mi */
  comments?: boolean;
  /** Tek gönderide en fazla medya */
  maxMedia?: number;
  /** Medyasız gönderi kabul etmiyor (Instagram, TikTok, YouTube) */
  requiresMedia?: boolean;
  /** Sadece video kabul ediyor (YouTube) */
  requiresVideo?: boolean;
  mediaNote?: string;
}

export interface OAuthStart {
  url: string;
  codeVerifier?: string;
}

export interface ConnectedAccount {
  /** Bir OAuth akışı birden çok platform hesabı döndürebilir (Meta: Facebook sayfası + Instagram) */
  provider?: ProviderId;
  externalId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: string | null;
  scopes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RefreshedToken {
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: string | null;
}

/** Kitle kırılımı: anahtar → takipçi sayısı. age: "18-24"…; gender: "F" | "M" | "U"; ageGender: "F.18-24" */
export interface AudienceBreakdown {
  country?: Record<string, number>;
  city?: Record<string, number>;
  age?: Record<string, number>;
  gender?: Record<string, number>;
  /** Kimin kırılımı: takipçiler (Instagram, Facebook) ya da izleyiciler (YouTube) */
  basis?: "followers" | "viewers";
  /** Yaş/cinsiyet değerleri sayı değil yüzde (YouTube viewerPercentage) */
  percent?: boolean;
}

export interface InboundEvent {
  /** Kanalı bulmak için sağlayıcı-taraflı hesap kimliği (page id / ig id / phone_number_id / bot id) */
  accountExternalId: string;
  conversationExternalId: string;
  participantId: string;
  participantName?: string | null;
  participantAvatar?: string | null;
  externalMessageId?: string | null;
  text: string;
  attachments?: Array<{ type: string; url?: string; name?: string }>;
  receivedAt?: string;
  /** "comment": gönderi yorumu, "review": işletme değerlendirmesi (gelen kutusunda ayrı konu); varsayılan DM */
  kind?: "dm" | "comment" | "review";
  /** Yorumlar için: { kind, mediaId|postId, commentId, permalink, … } konuşmanın metadata alanına yazılır */
  metadata?: Record<string, unknown>;
  /** Düğmeye (postback) ya da hızlı cevaba basıldıysa: gönderdiğimiz payload ve düğme başlığı */
  postback?: { payload: string; title: string };
  /** Instagram hikâyesi: kişi hikâyesinde hesabı etiketledi (mention) ya da hesabın hikâyesine cevap yazdı (reply) */
  story?: { kind: "mention" | "reply"; id?: string | null; url?: string | null };
  /** ig.me / m.me bağlantısındaki ref değeri (ör. ig.me/m/hesap?ref=kampanya); source: Meta'nın bildirdiği kaynak; clickOnly: kişi bir şey yazmadı, yalnızca bağlantıya tıkladı */
  referral?: { ref: string; source?: string | null; clickOnly?: boolean };
}

export interface SendMessageInput {
  channel: Channel;
  conversationExternalId: string;
  participantId: string;
  text: string;
  /** 24 saat geçtiyse insan cevabı için Meta mesaj etiketi (7 güne kadar) */
  tag?: "HUMAN_AGENT";
}

export interface SettingField {
  key: string;
  label: string;
  type: "text" | "select" | "boolean" | "number";
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
  appliesTo?: PostKind[];
  help?: string;
}

/** Her platform adaptörünün uyması gereken sözleşme */
export interface Provider {
  id: ProviderId;
  label: string;
  color: string;
  capabilities: Capabilities;
  /** Panelde gösterilecek platforma özel gönderi ayarları */
  settingFields: SettingField[];
  /** Env'de gerekli anahtarlar tanımlı mı */
  isConfigured(): boolean;
  /** Bağlantı biçimi: OAuth yönlendirme mi, form (token girme) mi */
  connectMode: "oauth" | "form";
  /** Form modunda istenen alanlar */
  connectFields?: SettingField[];
  oauthStart?(redirectUri: string, state: string): OAuthStart;
  oauthCallback?(code: string, redirectUri: string, codeVerifier?: string | null): Promise<ConnectedAccount[]>;
  connectWithForm?(values: Record<string, string>): Promise<ConnectedAccount[]>;
  refreshToken?(channel: Channel): Promise<RefreshedToken | null>;
  publish(channel: Channel, input: PublishInput): Promise<PublishResult>;
  sendMessage?(input: SendMessageInput): Promise<{ externalId?: string | null }>;
  /** Polling tabanlı gelen kutusu için: cursor'dan itibaren yeni mesajlar */
  pollInbound?(channel: Channel, cursor: string | null): Promise<{ events: InboundEvent[]; cursor: string | null }>;
  fetchMetrics?(channel: Channel): Promise<Record<string, number>>;
  /** Yayınlanmış bir gönderinin beğeni/yorum/görüntülenme metrikleri */
  fetchPostMetrics?(channel: Channel, externalId: string): Promise<Record<string, number>>;
  /**
   * Tamamlanmış bir günün hesap insights değerleri (since/until: unix saniye, [since, until)).
   * Standart anahtarlar: reach, views, profileViews, websiteClicks, follows, unfollows, engaged.
   * Platform bir metriği vermezse anahtar hiç dönmez (0 yazılmaz).
   */
  fetchDailyInsights?(channel: Channel, range: { since: number; until: number }): Promise<Record<string, number>>;
  /** İşletme değerlendirmesine herkese açık yanıt (Google Business Profile) */
  replyReview?(channel: Channel, reviewName: string, text: string): Promise<{ externalId?: string | null }>;
  /** Takipçi kitlesi kırılımı (ülke, şehir, yaş, cinsiyet); izin yoksa ya da hesap küçükse boş döner */
  fetchAudience?(channel: Channel): Promise<AudienceBreakdown>;
  /**
   * Yayınlanmış gönderinin altına yorum ya da zincir yanıtı ekler.
   * parentExternalId: ana gönderinin id'si; replyToExternalId: zincirde bir önceki yorum (varsa)
   */
  publishComment?(channel: Channel, parentExternalId: string, text: string, replyToExternalId?: string | null): Promise<{ externalId: string }>;
  /** Gönderi yorumuna özel DM (private reply, recipient: comment_id): yorum başına tek mesaj, yorumdan sonraki 7 gün içinde */
  sendPrivateReply?(channel: Channel, commentId: string, message: OutboundMessage): Promise<{ externalId?: string | null }>;
  /**
   * Sohbet menüsü (Messenger Profile API): ice breakers ve sabit menü. Boş liste Meta'daki ayarı kaldırır.
   * Ice breakers en fazla 4 soru; sabit menü en fazla 20 öğe.
   */
  setMessengerProfile?(channel: Channel, profile: MessengerProfileInput): Promise<void>;
  /** Kanal sağlığı: token geçerli mi */
  healthCheck?(channel: Channel): Promise<{ ok: boolean; detail?: string }>;
}

/** Mesaj düğmesi: postback (basınca webhook'a payload gelir) ya da bağlantı */
export type MessageButton = { type: "postback"; title: string; payload: string } | { type: "web_url"; title: string; url: string };

/** Sohbet menüsü: ice breaker soruları (basınca payload gelir) ve sabit menü düğmeleri */
export interface MessengerProfileInput {
  iceBreakers: Array<{ question: string; payload: string }>;
  menu: MessageButton[];
}

/** Hızlı cevap: mesajın altında çıkan, basınca metni gönderen kısa seçenek */
export interface QuickReply {
  title: string;
  payload: string;
}

/** Otomatik giden mesaj içeriği: metin, en fazla 3 düğme, en fazla 13 hızlı cevap */
export interface OutboundMessage {
  text: string;
  buttons?: MessageButton[];
  quickReplies?: QuickReply[];
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
