/** /api/bio yanıtları (server/src/core/repos/bio.ts ve services/bio.ts ile aynı şekil) */

export interface BioLink {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
}

export interface BioSocial {
  network: string;
  url: string;
}

export interface BioGridItem {
  id: string;
  postId: string;
  url: string;
}

export interface BioTheme {
  accent: string;
  background: "light" | "cream" | "dark";
  buttons: "rounded" | "pill" | "square";
}

export interface BioPage {
  id: string;
  slug: string;
  title: string;
  bio: string | null;
  avatarUrl: string | null;
  theme: BioTheme;
  links: BioLink[];
  socials: BioSocial[];
  grid: BioGridItem[];
  published: boolean;
  createdAt: string;
  updatedAt: string;
  url: string;
  last30?: { views: number; clicks: number };
}

export interface BioStats {
  range: { from: string; to: string; days: number; prevFrom: string; prevTo: string; tz: string };
  totals: { views: number; clicks: number; ctr: number | null };
  prev: { views: number; clicks: number };
  daily: Array<{ date: string; views: number; clicks: number }>;
  links: Array<{ id: string; label: string | null; url: string | null; kind: "link" | "grid" | "social" | null; removed: boolean; clicks: number; ctr: number | null }>;
  sources: Array<{ source: string; views: number; clicks: number }>;
}

export interface GridCandidate {
  postId: string;
  image: string;
  text: string;
  publishedAt: string | null;
  interactions: number | null;
}

export type SlugStatus = "ok" | "invalid" | "reserved" | "taken";

/** Sayfada ikon olarak gösterilen ağlar (server/src/services/bio-icons.ts anahtarları) */
export const BIO_NETWORKS: Array<{ id: string; label: string }> = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "facebook", label: "Facebook" },
  { id: "x", label: "X (Twitter)" },
  { id: "youtube", label: "YouTube" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "threads", label: "Threads" },
  { id: "pinterest", label: "Pinterest" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "bluesky", label: "Bluesky" },
  { id: "website", label: "Web sitesi" },
  { id: "email", label: "E-posta" },
];
