import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { disablePush, enablePush, pushState, useInstallPrompt, type PushState } from "../lib/pwa";
import {
  AtSign,
  BarChart3,
  BookMarked,
  Bell,
  BellOff,
  BellRing,
  CalendarDays,
  Check,
  ChevronsUpDown,
  CreditCard,
  FileText,
  FileUp,
  Globe2,
  Grid3x3,
  Flag,
  Hash,
  Image,
  Link2,
  Trash2,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  ListRestart,
  LogOut,
  MonitorDown,
  Megaphone,
  Menu,
  Moon,
  PenSquare,
  PlugZap,
  Plus,
  Settings,
  Shield,
  Sun,
  Users,
  X,
  Zap,
} from "lucide-react";
import { api, errMsg, PROVIDER_NAME, type Channel, type Dashboard, type Notification, type ProviderId } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { LogoMark } from "./Logo";
import { Avatar, Modal, ProviderIcon, TIMEZONES, useLocalState, useToast } from "./ui";
import "../panel/shell.css";

function useOutside(ref: RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onOut]);
}

/** Açık menü Escape ile kapanır, odak tetikleyiciye döner */
function useEscape(open: boolean, close: () => void, trigger: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      trigger.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, trigger]);
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
  const btn = useRef<HTMLButtonElement>(null);
  useOutside(ref, () => setOpen(false));
  useEscape(open, () => setOpen(false), btn);

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
      <button ref={btn} className="org-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
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
  const btn = useRef<HTMLButtonElement>(null);
  useOutside(ref, () => setOpen(false));
  useEscape(open, () => setOpen(false), btn);
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<{ items: Notification[]; unread: number }>("/api/notifications"), refetchInterval: 30_000 });
  const markRead = useMutation({ mutationFn: () => api.post("/api/notifications/read"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const unread = q.data?.unread ?? 0;
  const color = { info: "var(--info)", success: "var(--ok)", warning: "var(--warn)", error: "var(--err)" };

  return (
    <div className="notif" ref={ref}>
      <button
        ref={btn}
        className="pn-icon-btn"
        aria-label={unread > 0 ? t("Bildirimler ({n} okunmamış)", { n: unread }) : t("Bildirimler")}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && unread > 0) markRead.mutate();
        }}
      >
        <Bell />
        {unread > 0 && <span className="notif-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="menu menu-wide pn-pop" role="menu">
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

/* ---------------- Gezinme haritası (docs/panel/03-PANEL-TASARIM.md §3) ---------------- */

type Section = "home" | "analytics" | "planning" | "inbox" | "automation" | "account";

function sectionOf(pathname: string): Section {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/app") return "home";
  if (p.startsWith("/app/analytics")) return "analytics";
  if (p.startsWith("/app/posts") || p.startsWith("/app/campaigns") || p.startsWith("/app/media") || p.startsWith("/app/bio") || p.startsWith("/app/library")) return "planning";
  if (p.startsWith("/app/inbox")) return "inbox";
  if (p.startsWith("/app/automation")) return "automation";
  return "account";
}

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  badge?: { n: number; tone?: "warn" };
  active?: boolean;
}

function SideLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const cls = ({ isActive }: { isActive: boolean }) => `pn-side-link${(item.active ?? isActive) ? " active" : ""}`;
  return (
    <NavLink to={item.to} end={item.end} className={cls} onClick={onNavigate} aria-current={item.active ? "page" : undefined}>
      {item.icon}
      <span className="truncate">{item.label}</span>
      {item.badge && item.badge.n > 0 && <span className={`nav-badge${item.badge.tone === "warn" ? " nav-badge-warn" : ""}`}>{item.badge.n}</span>}
    </NavLink>
  );
}

function useSidebar(section: Section, d: Dashboard | undefined): Array<{ title?: string; items: NavItem[]; action?: ReactNode }> | null {
  const s = useSession();
  const { t } = useI18n();
  const loc = useLocation();
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels"), enabled: section === "analytics", staleTime: 60_000 });
  const pending = d?.posts.pendingApproval ?? 0;

  if (section === "analytics") {
    const params = new URLSearchParams(loc.search);
    const current = params.get("network");
    const onReport = loc.pathname.startsWith("/app/analytics/report");
    const onCompetitors = loc.pathname.startsWith("/app/analytics/competitors");
    const onAds = loc.pathname.startsWith("/app/analytics/ads");
    const onTags = loc.pathname.startsWith("/app/analytics/hashtags");
    const onStudio = loc.pathname.startsWith("/app/analytics/studio");
    const onSite = loc.pathname.startsWith("/app/analytics/website");
    const onMentions = loc.pathname.startsWith("/app/analytics/mentions");
    // Ağ bağlantıları bulunulan sayfada kalır: raporda ağ seçmek raporu süzer
    const keep = (network: string | null, base = onReport ? "/app/analytics/report" : "/app/analytics") => {
      // Rakipler sayfasında ağ seçimi analitiğe döner
      const next = new URLSearchParams(params);
      if (network) next.set("network", network);
      else next.delete("network");
      const qs = next.toString();
      return `${base}${qs ? `?${qs}` : ""}`;
    };
    const providers = [...new Set((channels.data ?? []).map((c) => c.provider))] as ProviderId[];
    return [
      {
        items: [
          { to: keep(null, "/app/analytics"), label: t("Özet"), icon: <LayoutDashboard />, active: !current && !onReport && !onCompetitors && !onAds && !onTags && !onStudio && !onSite && !onMentions },
          { to: keep(current, "/app/analytics/report"), label: t("Rapor"), icon: <FileText />, active: onReport },
          { to: "/app/analytics/studio", label: t("Studio"), icon: <LayoutGrid />, active: onStudio },
          { to: "/app/analytics/competitors", label: t("Rakipler"), icon: <Users />, active: onCompetitors },
          { to: "/app/analytics/hashtags", label: t("Hashtag takibi"), icon: <Hash />, active: onTags },
          { to: "/app/analytics/mentions", label: t("Bahsetmeler"), icon: <AtSign />, active: onMentions },
          { to: "/app/analytics/ads", label: t("Reklamlar"), icon: <Megaphone />, active: onAds },
          { to: "/app/analytics/website", label: t("Web sitesi"), icon: <Globe2 />, active: onSite },
        ],
      },
      {
        title: t("Ağlar"),
        items: providers.map((p) => ({ to: keep(p), label: PROVIDER_NAME[p], icon: <ProviderIcon provider={p} size={20} />, active: current === p && !onCompetitors && !onAds && !onTags && !onStudio && !onSite && !onMentions })),
        action: (
          <Link to="/app/channels" className="pn-side-add">
            <Plus aria-hidden="true" /> {t("Kanal bağla")}
          </Link>
        ),
      },
    ];
  }
  if (section === "planning") {
    return [
      {
        items: [
          { to: "/app/posts", label: t("Takvim ve liste"), icon: <CalendarDays />, end: true, badge: s.can("admin") ? { n: pending, tone: "warn" } : undefined },
          { to: "/app/posts/new", label: t("Yeni gönderi"), icon: <PenSquare /> },
          { to: "/app/campaigns", label: t("Kampanyalar"), icon: <Flag /> },
          { to: "/app/library", label: t("Kütüphane"), icon: <BookMarked /> },
          { to: "/app/posts/grid", label: t("Instagram ızgarası"), icon: <Grid3x3 /> },
          { to: "/app/posts/autolists", label: t("Otomatik listeler"), icon: <ListRestart /> },
          { to: "/app/posts/import", label: t("Toplu yükleme (CSV)"), icon: <FileUp /> },
          { to: "/app/media", label: t("Medya"), icon: <Image /> },
          { to: "/app/bio", label: t("Link in bio"), icon: <Link2 /> },
          { to: "/app/posts/trash", label: t("Silinenler"), icon: <Trash2 /> },
        ],
      },
    ];
  }
  if (section === "account") {
    return [
      {
        title: t("Hesap"),
        items: [
          { to: "/app/channels", label: t("Kanallar"), icon: <PlugZap />, badge: d && d.channels.problem > 0 ? { n: d.channels.problem } : undefined },
          { to: "/app/team", label: t("Ekip"), icon: <Users /> },
          { to: "/app/billing", label: t("Plan & kullanım"), icon: <CreditCard /> },
          { to: "/app/settings", label: t("Ayarlar"), icon: <Settings /> },
          ...(s.user.isSuperadmin ? [{ to: "/app/admin", label: t("Süper admin"), icon: <Shield /> }] : []),
        ],
      },
    ];
  }
  return null;
}

/** Sağ üst kullanıcı menüsü: hesap sayfaları, tema, dil, çıkış (Metricool'un hamburger menüsünün karşılığı) */
function UserMenu({ theme, setTheme, problems }: { theme: "light" | "dark"; setTheme: (t: "light" | "dark") => void; problems: number }) {
  const s = useSession();
  const { t, locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useOutside(ref, () => setOpen(false));
  useEscape(open, () => setOpen(false), btn);

  const changeLocale = (l: "tr" | "en") => {
    setLocale(l);
    api
      .patch("/api/auth/profile", { locale: l })
      .then(() => s.refresh())
      .catch(() => {});
  };
  const pwa = useInstallPrompt();
  const [push, setPush] = useState<PushState>("unsupported");
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    if (open) void pushState().then(setPush);
  }, [open]);
  const togglePush = async () => {
    setPushBusy(true);
    try {
      setPush(push === "on" ? await disablePush(api) : await enablePush(api));
    } catch {
      setPush(await pushState());
    } finally {
      setPushBusy(false);
    }
  };
  const item = (to: string, icon: ReactNode, label: string, badge?: number) => (
    <NavLink to={to} className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </NavLink>
  );

  return (
    <div className="pn-user" ref={ref}>
      <button ref={btn} className="pn-user-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t("Hesap menüsü")} onClick={() => setOpen(!open)}>
        <Avatar name={s.user.name || s.user.email} size={30} />
        {problems > 0 && <span className="pn-user-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="menu pn-pop pn-user-menu" role="menu">
          <div className="pn-user-head">
            <strong className="truncate">{s.user.name || s.user.email}</strong>
            <span className="muted small truncate">{s.user.email}</span>
          </div>
          <div className="menu-sep" />
          {item("/app/channels", <PlugZap />, t("Kanallar"), problems)}
          {item("/app/team", <Users />, t("Ekip"))}
          {item("/app/billing", <CreditCard />, t("Plan & kullanım"))}
          {item("/app/settings", <Settings />, t("Ayarlar"))}
          {s.user.isSuperadmin && item("/app/admin", <Shield />, t("Süper admin"))}
          <div className="menu-sep" />
          <div className="pn-user-row">
            <span>{t("Tema")}</span>
            <div className="segmented segmented-sm" role="group" aria-label={t("Tema")}>
              <button className={theme === "light" ? "active" : ""} aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
                <Sun aria-hidden="true" /> {t("Açık")}
              </button>
              <button className={theme === "dark" ? "active" : ""} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
                <Moon aria-hidden="true" /> {t("Koyu")}
              </button>
            </div>
          </div>
          <div className="pn-user-row">
            <span>{t("Dil")}</span>
            <div className="segmented segmented-sm" role="group" aria-label={t("Dil")}>
              <button className={locale === "tr" ? "active" : ""} aria-pressed={locale === "tr"} onClick={() => changeLocale("tr")}>
                TR
              </button>
              <button className={locale === "en" ? "active" : ""} aria-pressed={locale === "en"} onClick={() => changeLocale("en")}>
                EN
              </button>
            </div>
          </div>
          <div className="menu-sep" />
          {(push === "on" || push === "off") && (
            <button className="menu-item" role="menuitem" disabled={pushBusy} onClick={() => void togglePush()}>
              {push === "on" ? <BellOff /> : <BellRing />} {push === "on" ? t("Bu cihazda bildirimleri kapat") : t("Bu cihazda bildirimleri aç")}
            </button>
          )}
          {push === "denied" && <p className="menu-note muted small">{t("Bildirimler tarayıcıda engellenmiş; site ayarlarından izin verebilirsin.")}</p>}
          {push === "needs-install" && <p className="menu-note muted small">{t("iPhone/iPad'de bildirim için önce Paylaş > Ana Ekrana Ekle ile uygulamayı yükle.")}</p>}
          {pwa.canInstall && (
            <button className="menu-item" role="menuitem" onClick={() => (setOpen(false), void pwa.install())}>
              <MonitorDown /> {t("Uygulamayı yükle")}
            </button>
          )}
          <button className="menu-item" role="menuitem" onClick={() => s.logout()}>
            <LogOut /> {t("Çıkış")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const s = useSession();
  const { t } = useI18n();
  const loc = useLocation();
  const [theme, setTheme] = useLocalState<"dark" | "light">("sp_theme", "light");
  const [drawer, setDrawer] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/api/dashboard"), refetchInterval: 30_000 });
  const d = dash.data;
  const section = sectionOf(loc.pathname);
  const sidebar = useSidebar(section, d);

  // Tema yalnızca panelde: herkese açık sayfalara geçince kalkar
  useEffect(() => {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  useEffect(() => setDrawer(false), [loc.pathname, loc.search]);
  useEscape(drawer, () => setDrawer(false), burger);
  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawer]);

  const attention = d?.inbox.attention ?? 0;
  const unread = d?.inbox.unread ?? 0;
  const pending = d?.posts.pendingApproval ?? 0;
  const problems = d?.channels.problem ?? 0;

  const sections: Array<NavItem & { key: Section }> = [
    { key: "home", to: "/app", end: true, label: t("Panel"), icon: <LayoutDashboard /> },
    { key: "analytics", to: "/app/analytics", label: t("Analitik"), icon: <BarChart3 /> },
    { key: "planning", to: "/app/posts", label: t("Planlama"), icon: <CalendarDays />, badge: s.can("admin") ? { n: pending, tone: "warn" } : undefined },
    { key: "inbox", to: "/app/inbox", label: t("Gelen Kutusu"), icon: <Inbox />, badge: { n: attention > 0 ? attention : unread } },
    { key: "automation", to: "/app/automation", label: t("Otomasyon"), icon: <Zap /> },
  ];

  const sideNav = (onNavigate?: () => void) =>
    sidebar?.map((g, i) => (
      <div key={i} className="pn-side-group">
        {g.title && <div className="pn-side-title">{g.title}</div>}
        {g.items.map((it) => (
          <SideLink key={it.to + it.label} item={it} onNavigate={onNavigate} />
        ))}
        {g.action}
      </div>
    ));

  return (
    <div className="pn">
      <a className="pn-skip" href="#pn-main">
        {t("İçeriğe geç")}
      </a>
      <header className="pn-top">
        <div className="pn-top-in">
          <Link to="/app" className="pn-logo" aria-label={t("Panel")}>
            <LogoMark size={28} />
          </Link>
          <OrgSwitcher />
          <nav className="pn-sections" aria-label={t("Ana bölümler")}>
            {sections.map((it) => (
              <NavLink key={it.key} to={it.to} end={it.end} className={() => `pn-sec${section === it.key ? " active" : ""}`} aria-current={section === it.key ? "page" : undefined}>
                {it.icon}
                <span>{it.label}</span>
                {it.badge && it.badge.n > 0 && <span className={`nav-badge${it.badge.tone === "warn" ? " nav-badge-warn" : ""}`}>{it.badge.n}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="pn-top-actions">
            <Link to="/app/posts/new" className="btn btn-primary btn-sm pn-new">
              <Plus aria-hidden="true" /> <span>{t("Yeni gönderi")}</span>
            </Link>
            <NotificationBell />
            <UserMenu theme={theme} setTheme={setTheme} problems={problems} />
            <button ref={burger} className="pn-icon-btn pn-burger" aria-label={t("Menü")} aria-expanded={drawer} aria-controls="pn-drawer" onClick={() => setDrawer(true)}>
              <Menu />
            </button>
          </div>
        </div>
      </header>

      <div className={`pn-body${sidebar ? " pn-body--side" : ""}`}>
        {sidebar && (
          <aside className="pn-side" aria-label={t("Bölüm menüsü")}>
            {sideNav()}
          </aside>
        )}
        <main className="pn-main" id="pn-main" tabIndex={-1}>
          <Banners />
          {children}
        </main>
      </div>

      {drawer && (
        <div className="pn-drawer-wrap" onClick={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div id="pn-drawer" className="pn-drawer" role="dialog" aria-modal="true" aria-label={t("Menü")}>
            <div className="pn-drawer-head">
              <LogoMark size={26} />
              <button className="pn-icon-btn" aria-label={t("Menüyü kapat")} onClick={() => setDrawer(false)} autoFocus>
                <X />
              </button>
            </div>
            <nav aria-label={t("Ana bölümler")} className="pn-drawer-nav">
              <SideLink item={{ to: "/app/posts/new", label: t("Yeni gönderi"), icon: <PenSquare /> }} onNavigate={() => setDrawer(false)} />
              {sections.map((it) => (
                <SideLink key={it.key} item={{ ...it, active: section === it.key }} onNavigate={() => setDrawer(false)} />
              ))}
            </nav>
            {sidebar && <div className="pn-drawer-nav">{sideNav(() => setDrawer(false))}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
