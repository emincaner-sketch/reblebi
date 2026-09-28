import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronsUpDown,
  CreditCard,
  Flag,
  Image,
  Inbox,
  LayoutDashboard,
  LogOut,
  Moon,
  PlugZap,
  Plus,
  Settings,
  Shield,
  Sun,
  Users,
  Zap,
} from "lucide-react";
import { api, errMsg, type Dashboard, type Notification } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Modal, TIMEZONES, useLocalState, useToast } from "./ui";

function useOutside(ref: RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onOut]);
}

function OrgSwitcher() {
  const s = useSession();
  const { t, locale } = useI18n();
  const L = useLabels();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [tz, setTz] = useState(s.org.timezone);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>("/api/auth/orgs", { name, timezone: tz, locale }),
    onSuccess: async (r) => {
      setCreating(false);
      setName("");
      await s.switchOrg(r.id);
      toast(t("Çalışma alanı oluşturuldu"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  return (
    <div className="org-switch" ref={ref}>
      <button className="org-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <div className="brand-logo">{s.org.name.slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
          <div className="brand-name truncate">{s.org.name}</div>
          <div className="brand-sub">
            {L.role(s.role)} · {s.org.plan}
          </div>
        </div>
        <ChevronsUpDown style={{ width: 15, opacity: 0.6 }} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-label">{t("Çalışma alanları")}</div>
          {s.me.orgs.map((o) => (
            <button
              key={o.id}
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (o.id !== s.org.id) s.switchOrg(o.id).catch((e) => toast(errMsg(e), "err"));
              }}
            >
              <span className="truncate" style={{ flex: 1 }}>
                {o.name}
              </span>
              <span className="muted small">{L.role(o.role)}</span>
              {o.id === s.org.id && <Check style={{ width: 14 }} />}
            </button>
          ))}
          <div className="menu-sep" />
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            <Plus style={{ width: 14 }} /> {t("Yeni çalışma alanı")}
          </button>
        </div>
      )}
      {creating && (
        <Modal
          title={t("Yeni çalışma alanı")}
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)}>
                {t("Vazgeç")}
              </button>
              <button className="btn btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                {t("Oluştur")}
              </button>
            </>
          }
        >
          <div className="form">
            <p className="muted small">{t("Her çalışma alanının kendi kanalları, ekibi, planı ve ayarları olur. Ajanslar her müşteri için ayrı alan açabilir.")}</p>
            <div className="field">
              <label>{t("Ad")}</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
            </div>
            <div className="field">
              <label>{t("Saat dilimi")}</label>
              <select className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
                {TIMEZONES.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NotificationBell() {
  const { t } = useI18n();
  const f = useFmt();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<{ items: Notification[]; unread: number }>("/api/notifications"), refetchInterval: 30_000 });
  const markRead = useMutation({ mutationFn: () => api.post("/api/notifications/read"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const unread = q.data?.unread ?? 0;
  const color = { info: "var(--info)", success: "var(--ok)", warning: "var(--warn)", error: "var(--err)" };

  return (
    <div className="notif" ref={ref}>
      <button
        className="btn btn-ghost btn-icon"
        aria-label={t("Bildirimler")}
        onClick={() => {
          setOpen(!open);
          if (!open && unread > 0) markRead.mutate();
        }}
      >
        <Bell />
        {unread > 0 && <span className="notif-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="menu menu-wide" role="menu">
          <div className="menu-label">{t("Bildirimler")}</div>
          {!q.data?.items.length && <div className="muted small" style={{ padding: 12 }}>{t("Bildirim yok")}</div>}
          <div style={{ maxHeight: 380, overflow: "auto" }}>
            {q.data?.items.map((n) => (
              <button
                key={n.id}
                className={`menu-item notif-item ${n.readAt ? "" : "unread-row"}`}
                onClick={() => {
                  setOpen(false);
                  if (n.link) nav(n.link.startsWith("http") ? new URL(n.link).pathname : n.link);
                }}
              >
                <span className="dot" style={{ color: color[n.kind], marginTop: 6, flexShrink: 0 }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{n.title}</div>
                  {n.body && <div className="muted small pre">{n.body}</div>}
                  <div className="muted small">{f.ago(n.createdAt)}</div>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Banners() {
  const s = useSession();
  const { t } = useI18n();
  const f = useFmt();
  const toast = useToast();
  const resend = useMutation({ mutationFn: () => api.post("/api/auth/resend-verification"), onSuccess: () => toast(t("Doğrulama e-postası gönderildi"), "ok") });
  const exp = s.org.planExpiresAt ? new Date(s.org.planExpiresAt).getTime() : null;
  const daysLeft = exp ? Math.ceil((exp - Date.now()) / 86400_000) : null;
  return (
    <>
      {s.org.disabled && <div className="notice notice-err banner">{t("Bu çalışma alanı yönetici tarafından devre dışı bırakıldı. Yayınlar durduruldu.")}</div>}
      {!s.user.emailVerified && (
        <div className="notice notice-warn banner row">
          <span>{t("E-posta adresin doğrulanmadı ({email}).", { email: s.user.email })}</span>
          <button className="btn btn-sm" onClick={() => resend.mutate()} disabled={resend.isPending || resend.isSuccess} style={{ marginLeft: "auto" }}>
            {resend.isSuccess ? t("Gönderildi") : t("Tekrar gönder")}
          </button>
        </div>
      )}
      {daysLeft !== null && daysLeft <= 7 && (
        <div className={`notice ${daysLeft <= 0 ? "notice-err" : "notice-warn"} banner row`}>
          <span>
            {daysLeft <= 0
              ? t("Planının süresi doldu; Ücretsiz plan limitleri uygulanıyor.")
              : t("Planın {n} gün sonra bitiyor ({date}).", { n: daysLeft, date: f.day(s.org.planExpiresAt) })}
          </span>
          <NavLink to="/app/billing" className="btn btn-sm" style={{ marginLeft: "auto" }}>
            {t("Planı yönet")}
          </NavLink>
        </div>
      )}
    </>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const s = useSession();
  const { t, locale, setLocale } = useI18n();
  const [theme, setTheme] = useLocalState<"dark" | "light">("sp_theme", "dark");
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/api/dashboard"), refetchInterval: 30_000 });
  const d = dash.data;

  useEffect(() => {
    if (theme === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const changeLocale = (l: "tr" | "en") => {
    setLocale(l);
    api
      .patch("/api/auth/profile", { locale: l })
      .then(() => s.refresh())
      .catch(() => {});
  };

  const attention = d?.inbox.attention ?? 0;
  const unread = d?.inbox.unread ?? 0;
  const pending = d?.posts.pendingApproval ?? 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <OrgSwitcher />
        <nav className="nav">
          <NavLink to="/app" end className="nav-link">
            <LayoutDashboard /> {t("Panel")}
          </NavLink>
          <NavLink to="/app/channels" className="nav-link">
            <PlugZap /> {t("Kanallar")} {d && d.channels.problem > 0 && <span className="nav-badge">{d.channels.problem}</span>}
          </NavLink>
          <NavLink to="/app/posts" className="nav-link">
            <CalendarDays /> {t("Gönderiler")} {pending > 0 && s.can("admin") && <span className="nav-badge nav-badge-warn">{pending}</span>}
          </NavLink>
          <NavLink to="/app/campaigns" className="nav-link">
            <Flag /> {t("Kampanyalar")}
          </NavLink>
          <NavLink to="/app/inbox" className="nav-link">
            <Inbox /> {t("Gelen Kutusu")} {(attention > 0 || unread > 0) && <span className="nav-badge">{attention > 0 ? attention : unread}</span>}
          </NavLink>
          <NavLink to="/app/automation" className="nav-link">
            <Zap /> {t("Otomasyon")}
          </NavLink>
          <NavLink to="/app/analytics" className="nav-link">
            <BarChart3 /> {t("Analitik")}
          </NavLink>
          <NavLink to="/app/media" className="nav-link">
            <Image /> {t("Medya")}
          </NavLink>
          <div className="nav-sep" />
          <NavLink to="/app/team" className="nav-link">
            <Users /> {t("Ekip")}
          </NavLink>
          <NavLink to="/app/billing" className="nav-link">
            <CreditCard /> {t("Plan & kullanım")}
          </NavLink>
          <NavLink to="/app/settings" className="nav-link">
            <Settings /> {t("Ayarlar")}
          </NavLink>
          {s.user.isSuperadmin && (
            <NavLink to="/app/admin" className="nav-link">
              <Shield /> {t("Süper admin")}
            </NavLink>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="row-between">
            <span className="truncate" title={s.user.email} style={{ maxWidth: 130 }}>
              {s.user.name || s.user.email}
            </span>
            <div className="row" style={{ gap: 2 }}>
              <NotificationBell />
              <button className="btn btn-ghost btn-icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={t("Tema")}>
                {theme === "dark" ? <Sun /> : <Moon />}
              </button>
            </div>
          </div>
          <div className="row-between">
            <div className="segmented segmented-sm" role="group" aria-label={t("Dil")}>
              <button className={locale === "tr" ? "active" : ""} onClick={() => changeLocale("tr")}>
                TR
              </button>
              <button className={locale === "en" ? "active" : ""} onClick={() => changeLocale("en")}>
                EN
              </button>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => s.logout()}>
              <LogOut /> {t("Çıkış")}
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <Banners />
        {children}
      </main>
    </div>
  );
}
