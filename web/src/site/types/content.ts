import type { PlanFeature } from "../../lib/api";
import type { PlatformKey } from "../../landing/PlatformIcon";

/**
 * Giriş sayfasının içerik sözleşmesi. Kullanıcıya görünen her metin data/site-content.ts'ten gelir.
 * Metinlerdeki {degisken} yer tutucuları lib/fill.ts ile doldurulur (fiyat, gün, plan adı veriden).
 */

/** Bilinmeyen operasyonel gerçek: ekranda gerçek bilgi gibi basılmaz */
export interface Placeholder {
  placeholder: true;
  note: string;
}

export type SectionId = "how" | "ai" | "features" | "pricing" | "faq";

export interface NavContent {
  items: Array<{ id: Exclude<SectionId, "features">; label: string }>;
  login: string;
  menu: string;
  menuOpen: string;
  menuClose: string;
  mainNav: string;
  skip: string;
  homeAria: string;
  lang: string;
}

export interface CtaContent {
  trial: string;
  start: string;
  login: string;
  panel: string;
  note: string;
  noteNoFree: string;
}

export interface ComposerContent {
  label: string;
  status: string;
  text: string;
  channels: string;
  slot: string;
  action: string;
  aria: string;
}

export interface HeroContent {
  eyebrow: string;
  title: string;
  lead: string;
  secondary: string;
  caption: string;
  composer: ComposerContent;
}

export interface JourneyStep {
  short: string;
  title: string;
  text: string;
}

export interface JourneyContent {
  eyebrow: string;
  title: string;
  lead: string;
  rail: string;
  steps: [JourneyStep, JourneyStep, JourneyStep, JourneyStep, JourneyStep];
  inboxNote: string;
  scene: {
    tabsOpen: string;
    versions: Array<{ p: PlatformKey; text: string }>;
    limitNote: string;
    days: string[];
    times: string[];
    busy: string;
    added: string;
    messages: Array<{ p: PlatformKey; who: string; text: string }>;
    autoLabel: string;
    autoText: string;
  };
  caption: string;
}

export interface AiContent {
  eyebrow: string;
  title: string;
  lead: string;
  allPlans: string;
  points: string[];
  compat: string;
  guide: string;
  chat: {
    head: string;
    badge: string;
    user: string;
    tools: Array<{ name: string; result: string }>;
    reply: string;
    replyNote: string;
    days: string[];
    caption: string;
    aria: string;
  };
}

/** "Panelde ayrıca" maddeleri. Plan etiketi veriden: feature (plan özelliği) ya da quota ("ai": aylık AI kotası > 0). */
export interface CapabilityItem {
  title: string;
  text: string;
  feature?: PlanFeature;
  quota?: "ai";
}

export interface CapabilitiesContent {
  eyebrow: string;
  title: string;
  items: CapabilityItem[];
  inPlans: string;
  allPlans: string;
}

export interface TrustContent {
  eyebrow: string;
  title: string;
  items: Array<{ title: string; text: string }>;
  platforms: string;
}

export type FinderRole = "creator" | "ecommerce" | "agency";

export interface FinderContent {
  title: string;
  roleLegend: string;
  roles: Record<FinderRole, string>;
  channels: string;
  members: string;
  result: string;
  reasons: {
    channels: string;
    members: string;
    inbox: string;
    customers: string;
    fits: string;
    over: string;
  };
  seeCard: string;
  note: string;
}

export interface PricingContent {
  eyebrow: string;
  title: string;
  leadTrial: string;
  lead: string;
  billing: { label: string; monthly: string; yearly: string; twoMonths: string; save: string };
  perMonth: string;
  perYear: string;
  freeNote: string;
  yearlyAvg: string;
  yearlyAlt: string;
  recommended: string;
  match: string;
  limits: { channels: string; members: string; posts: string; ai: string; storage: string; unlimited: string };
  features: Record<PlanFeature, string>;
  notIncluded: string;
  cardCta: { free: string; trial: string; other: string };
  foot: string;
  compare: string;
  who: Record<string, string>;
}

export interface FinalContent {
  title: string;
  leadTrial: string;
  lead: string;
  steps: Array<{ title: string; text: string }>;
}

export interface FooterContent {
  tagline: string;
  product: string;
  resources: string;
  account: string;
  legal: string;
  links: {
    how: string;
    ai: string;
    pricing: string;
    faq: string;
    mcp: string;
    compare: string;
    login: string;
    signup: string;
    contact: string;
    privacy: string;
    terms: string;
    deletion: string;
  };
}

export interface NotFoundContent {
  code: string;
  title: string;
  lead: string;
  home: string;
  pricing: string;
}

export interface PricingPageContent {
  crumbs: string;
  home: string;
  current: string;
  title: string;
  leadTrial: string;
  lead: string;
  compareTitle: string;
  table: { feature: string; channels: string; members: string; posts: string; ai: string; storage: string; yes: string; no: string };
  faqTitle: string;
}

export interface VisualSlot extends Placeholder {
  /** Ekranda görünmez. null: bu görsel AI ile üretilmemeli (gerçek ekran görüntüsü gerekir) */
  aiPrompt: string | null;
}

export interface SiteContent {
  nav: NavContent;
  cta: CtaContent;
  hero: HeroContent;
  journey: JourneyContent;
  ai: AiContent;
  capabilities: CapabilitiesContent;
  trust: TrustContent;
  finder: FinderContent;
  pricing: PricingContent;
  faq: { eyebrow: string; title: string };
  final: FinalContent;
  footer: FooterContent;
  notFound: NotFoundContent;
  pricingPage: PricingPageContent;
  /** Sosyal hesaplar: doğrulanmış hesap yoksa boş; bölüm kurulmaz */
  social: { accounts: Array<{ name: string; url: string }> } & Partial<Placeholder>;
  visuals: { productScreenshot: VisualSlot };
}

/** Dil bağımsız yer tutucu listesi (BRAND_DECISIONS.md §14 ile aynı) */
export type PlaceholderList = Record<string, Placeholder>;
