import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { pathFor, type PageKey } from "../seo/routes";

/** Geçerli dildeki sayfa yolu */
export function usePage() {
  const { locale } = useI18n();
  return (key: PageKey, hash?: string) => pathFor(key, locale) + (hash ? `#${hash}` : "");
}

/** Ön-render ve hidrasyon sırasında false; tarayıcıda ilk çizimden sonra true */
export function useHydrated(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok;
}
