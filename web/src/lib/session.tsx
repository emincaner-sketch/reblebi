import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ROLE_RANK, type Me, type Role } from "./api";
import { useI18n } from "./i18n";
import { BROWSER_TZ, fmt, fmtTime, inputToServer, timeAgo, toInputValue } from "./tz";

export const ME_KEY = ["me"];

export function useMeQuery() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => api.get<Me>("/api/auth/me"), staleTime: 60_000, retry: 1 });
}

type OrgOf<T> = T extends { org: infer O } ? NonNullable<O> : never;

export interface Session {
  me: Me;
  user: NonNullable<Me["user"]>;
  org: OrgOf<Me>;
  role: Role;
  can: (min: Role) => boolean;
  refresh: () => Promise<void>;
  switchOrg: (id: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionCtx = createContext<Session | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const qc = useQueryClient();
  const { locale, setLocale } = useI18n();
  const userId = me.user?.id;
  const userLocale = me.user?.locale;
  // Oturum açılınca arayüz, kullanıcının kayıtlı dil tercihine geçer (aynı tarayıcıda başka kullanıcı dili değiştirmiş olabilir)
  useEffect(() => {
    if (userLocale && userLocale !== locale) setLocale(userLocale);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ME_KEY });
  }, [qc]);
  const switchOrg = useCallback(
    async (id: string) => {
      await api.post("/api/auth/switch-org", { orgId: id });
      qc.clear();
      await qc.refetchQueries({ queryKey: ME_KEY });
    },
    [qc],
  );
  const logout = useCallback(async () => {
    await api.post("/api/auth/logout");
    qc.clear();
    window.location.href = "/login";
  }, [qc]);

  const value = useMemo<Session | null>(() => {
    if (!me.user || !me.org || !me.role) return null;
    const role = me.role;
    return { me, user: me.user, org: me.org, role, can: (min: Role) => ROLE_RANK[role] >= ROLE_RANK[min], refresh, switchOrg, logout };
  }, [me, refresh, switchOrg, logout]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("useSession: oturum yok");
  return s;
}

export function useOptionalSession(): Session | null {
  return useContext(SessionCtx);
}

/** Çalışma alanının saat diliminde tarih biçimlendirme ve datetime-local dönüşümleri */
export function useFmt() {
  const s = useContext(SessionCtx);
  const { intl, locale } = useI18n();
  const tz = s?.org.timezone ?? BROWSER_TZ;
  return useMemo(
    () => ({
      tz,
      intl,
      date: (iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions) => fmt(iso, tz, intl, opts),
      short: (iso: string | null | undefined) => fmt(iso, tz, intl, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }),
      day: (iso: string | null | undefined) => fmt(iso, tz, intl, { dateStyle: "medium" }),
      time: (iso: string | null | undefined) => fmtTime(iso, tz, intl),
      ago: (iso: string) => timeAgo(iso, locale),
      toInput: (iso: string | null | undefined) => toInputValue(iso ?? null, tz),
      fromInput: (v: string) => inputToServer(v),
      num: (n: number) => n.toLocaleString(intl),
    }),
    [tz, intl, locale],
  );
}
