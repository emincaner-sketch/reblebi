/** API istemcisi: aynı origin (Vite proxy ya da derlenmiş panel) */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts: { form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body !== undefined && !opts.form ? { "Content-Type": "application/json" } : undefined,
    body: opts.form ? opts.form : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* metin */
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, undefined, { form }),
};

/* ---------------- Tipler (server ile uyumlu) ---------------- */

export type ProviderId = "facebook" | "instagram" | "threads" | "whatsapp" | "x" | "linkedin" | "tiktok" | "youtube" | "telegram";
export type PostKind = "post" | "story" | "reel" | "video" | "thread";
export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "cancelled";

export interface SettingField {
  key: string;
  label: string;
  type: "text" | "select" | "boolean" | "number";
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
  appliesTo?: PostKind[];
  help?: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  color: string;
  capabilities: { post: boolean; story: boolean; reel: boolean; video: boolean; thread: boolean; dm: boolean; inbound: "webhook" | "poll" | "none"; analytics: boolean; maxTextLength: number; mediaNote?: string };
  settingFields: SettingField[];
  connectMode: "oauth" | "form";
  connectFields: SettingField[];
  configured: boolean;
  oauthGroup: string;
}

export interface Channel {
  id: string;
  provider: ProviderId;
  externalId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  tokenExpiresAt: string | null;
  scopes: string | null;
  metadata: Record<string, unknown>;
  status: "active" | "expired" | "error" | "disabled";
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  hasRefreshToken: boolean;
}

export interface Media {
  id: string;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  kind: "image" | "video" | "other";
  createdAt: string;
  url: string;
  publicUrl: string;
}

export interface PostTarget {
  id: string;
  postId: string;
  channelId: string;
  content: string | null;
  mediaIds: string[] | null;
  settings: Record<string, unknown>;
  status: "pending" | "publishing" | "published" | "failed" | "skipped";
  externalId: string | null;
  externalUrl: string | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  publishedAt: string | null;
}

export interface Post {
  id: string;
  title: string | null;
  kind: PostKind;
  status: PostStatus;
  content: string;
  mediaIds: string[];
  publishAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: string;
  targets: PostTarget[];
}

export interface Conversation {
  id: string;
  channelId: string;
  channelName: string;
  provider: ProviderId | null;
  externalId: string;
  participantId: string;
  participantName: string | null;
  participantAvatar: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unread: number;
  mode: "auto" | "manual";
  status: "open" | "closed";
  needsAttention: number;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  text: string;
  attachments: Array<{ type: string; url?: string; name?: string }>;
  sentBy: "customer" | "user" | "rule" | "ai";
  ruleId: string | null;
  status: "received" | "sent" | "failed";
  error: string | null;
  createdAt: string;
}

export interface Rule {
  id: string;
  name: string;
  enabled: number;
  channelId: string | null;
  provider: ProviderId | null;
  matchType: "any" | "first_contact" | "keyword" | "regex";
  pattern: string | null;
  replyMode: "template" | "ai";
  replyText: string | null;
  aiInstructions: string | null;
  priority: number;
  cooldownMinutes: number;
  onlyBusinessHours: number;
  handoffToHuman: number;
}

export interface Settings {
  brandName: string;
  brandVoice: string;
  brandAudience: string;
  brandOffers: string;
  brandBannedWords: string;
  brandExamples: string;
  aiAutoReplyFallback: boolean;
  aiReplyInstructions: string;
  businessHoursEnabled: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: number[];
  outsideHoursMessage: string;
  handoffKeywords: string;
  replyDelaySeconds: number;
  welcomeMessage: string;
}

export interface Activity {
  id: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface Dashboard {
  channels: { total: number; active: number; problem: number };
  posts: { scheduled: number; published: number; failed: number; draft: number; publishedLast7: number };
  inbox: { open: number; unread: number; attention: number; inLast7: number; autoRepliedLast7: number };
  upcoming: Post[];
  recent: Post[];
  activity: Activity[];
  ai: boolean;
}

export interface SystemInfo {
  publicUrl: string;
  secure: boolean;
  timezone: string;
  ai: { enabled: boolean; model: string; brandSources: string[]; brandMemoryDir: string | null };
  webhooks: { meta: { url: string; verifyToken: string } };
  oauthRedirects: Record<string, string>;
  providers: ProviderInfo[];
  recentWebhooks: Array<{ id: string; provider: string; processed: number; error: string | null; receivedAt: string }>;
}

export interface GeneratedContent {
  variants: Array<{ platform: string; hook: string; text: string; hashtags: string[]; title: string | null; visualDirection: string | null; bestTimeHint: string | null }>;
  alternativeHooks: string[];
  notes: string | null;
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  whatsapp: "WhatsApp",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  telegram: "Telegram",
};

export const PROVIDER_COLOR: Record<ProviderId, string> = {
  instagram: "#E1306C",
  facebook: "#1877F2",
  threads: "#444",
  whatsapp: "#25D366",
  x: "#333",
  linkedin: "#0A66C2",
  tiktok: "#FE2C55",
  youtube: "#FF0000",
  telegram: "#229ED9",
};

export const PROVIDER_SHORT: Record<ProviderId, string> = {
  instagram: "IG",
  facebook: "FB",
  threads: "TH",
  whatsapp: "WA",
  x: "X",
  linkedin: "in",
  tiktok: "TT",
  youtube: "YT",
  telegram: "TG",
};

export const KIND_LABEL: Record<PostKind, string> = { post: "Gönderi", story: "Hikaye", reel: "Reel", video: "Video", thread: "Zincir" };
export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Taslak",
  scheduled: "Planlandı",
  publishing: "Yayınlanıyor",
  published: "Yayınlandı",
  partial: "Kısmen",
  failed: "Başarısız",
  cancelled: "İptal",
};

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("tr-TR", opts).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "az önce";
  if (m < 60) return `${m} dk`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} sa`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} gün`;
  return fmtDate(iso, { dateStyle: "short" });
}

/** datetime-local input <-> ISO */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(v).toISOString();
}
