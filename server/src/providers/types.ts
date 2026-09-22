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
}

export interface SendMessageInput {
  channel: Channel;
  conversationExternalId: string;
  participantId: string;
  text: string;
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
  /** Kanal sağlığı: token geçerli mi */
  healthCheck?(channel: Channel): Promise<{ ok: boolean; detail?: string }>;
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
