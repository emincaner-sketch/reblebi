import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { EN } from "./en";
import { setApiLocale, type Locale, type PostKind, type PostStatus, type Role } from "./api";
import { localeFromPath } from "../seo/routes";

/**
 * Arayüz metinleri Türkçe yazılır (kaynak dil); İngilizce karşılıkları EN sözlüğündedir.
 * t("Yeni gönderi") -> "New post". {degisken} yer tutucuları desteklenir.
 */
interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (s: string, vars?: Record<string, string | number>) => string;
  /** Tarih/saat biçimlendirme için BCP-47 dil etiketi */
  intl: string;
}

const Ctx = createContext<I18n>({ locale: "tr", setLocale: () => {}, t: (s) => s, intl: "tr-TR" });

function detect(): Locale {
  if (typeof window === "undefined") return "tr";
  try {
    const saved = localStorage.getItem("sp_locale");
    if (saved === "en" || saved === "tr") return saved;
  } catch {
    /* yoksay */
  }
  return navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

/**
 * Router içinde kullanılır. Herkese açık içerik sayfalarında (/, /en, /fiyatlar...) dil URL'den gelir;
 * böylece ön-render edilen HTML ile tarayıcıdaki ilk çizim aynı olur. Diğer sayfalarda kayıtlı tercih geçerlidir.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [preferred, setLocaleState] = useState<Locale>(detect);
  const locale = localeFromPath(pathname) ?? preferred;
  setApiLocale(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setApiLocale(l);
    setLocaleState(l);
    try {
      localStorage.setItem("sp_locale", l);
    } catch {
      /* yoksay */
    }
  }, []);

  const t = useCallback(
    (s: string, vars?: Record<string, string | number>) => {
      const raw = locale === "en" ? (EN[s] ?? s) : s;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_match: string, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t, intl: locale === "en" ? "en-GB" : "tr-TR" }), [locale, setLocale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  return useContext(Ctx);
}

export function useT() {
  return useContext(Ctx).t;
}

const KIND: Record<PostKind, string> = { post: "Gönderi", story: "Hikaye", reel: "Reel", video: "Video", thread: "Zincir" };
const STATUS: Record<PostStatus, string> = {
  draft: "Taslak",
  pending_approval: "Onay bekliyor",
  scheduled: "Planlandı",
  publishing: "Yayınlanıyor",
  published: "Yayınlandı",
  partial: "Kısmen",
  failed: "Başarısız",
  cancelled: "İptal",
};
const ROLE: Record<Role, string> = { owner: "Sahip", admin: "Yönetici", editor: "Editör", viewer: "İzleyici" };
const ROLE_HELP: Record<Role, string> = {
  owner: "Her şey + faturalama ve çalışma alanını silme",
  admin: "Kanal, ekip, ayar ve onay yönetimi",
  editor: "Gönderi oluşturur, gelen kutusunu yanıtlar",
  viewer: "Sadece görüntüler",
};

export function useLabels() {
  const { t, locale } = useI18n();
  return useMemo(
    () => ({
      kind: (k: PostKind) => t(KIND[k] ?? k),
      status: (s: PostStatus) => t(STATUS[s] ?? s),
      role: (r: Role) => t(ROLE[r] ?? r),
      roleHelp: (r: Role) => t(ROLE_HELP[r] ?? ""),
      plan: (name: { tr: string; en: string } | undefined, fallback = "") => (name ? name[locale] : fallback),
      statuses: Object.keys(STATUS) as PostStatus[],
    }),
    [t, locale],
  );
}
