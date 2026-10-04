import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock, X } from "lucide-react";
import { PROVIDER_COLOR, PROVIDER_NAME, PROVIDER_SHORT, type Channel, type PlanFeature, type PostStatus, type ProviderId, type Quota, type Role } from "../lib/api";
import { useLabels, useT } from "../lib/i18n";
import { useOptionalSession } from "../lib/session";
import { SITE_NAME } from "../config/site";
import { BrandSvg } from "./BrandIcons";
import { copyText } from "../lib/clipboard";

/* ---------------- Toast ---------------- */

interface Toast {
  id: number;
  text: string;
  kind: "ok" | "err" | "info";
}
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});
export function useToast() {
  return useContext(ToastCtx);
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({ title, onClose, children, footer, large }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; large?: boolean }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${large ? "modal-lg" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t("Kapat")}>
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Sayfa iskeleti ---------------- */

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  // Panel sekme başlığı sayfanın adı olur (ör. "Studio · Reblebi")
  useEffect(() => {
    if (typeof title === "string") document.title = `${title} · ${SITE_NAME}`;
  }, [title]);
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="card">
      <div className="skeleton" style={{ width: "40%", marginBottom: 10 }} />
      <div className="skeleton" style={{ width: "80%", marginBottom: 10 }} />
      <div className="skeleton" style={{ width: "60%" }} />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="card notice notice-err">{error instanceof Error ? error.message : String(error)}</div>;
}

/* ---------------- Yetki ---------------- */

/** Rolü yetmiyorsa çocukları göstermez */
export function Can({ role, children, fallback = null }: { role: Role; children: ReactNode; fallback?: ReactNode }) {
  const s = useOptionalSession();
  return <>{s?.can(role) ? children : fallback}</>;
}

/** Plan özelliği kapalıysa yükseltme notu */
export function FeatureGate({ feature, has, children }: { feature: PlanFeature; has: boolean | undefined; children: ReactNode }) {
  const t = useT();
  if (has !== false) return <>{children}</>;
  return (
    <div className="notice notice-warn row">
      <Lock style={{ width: 16 }} />
      <span>{t("Bu özellik ({feature}) mevcut planında yok.", { feature })}</span>
      <Link to="/app/billing" className="btn btn-sm" style={{ marginLeft: "auto" }}>
        {t("Planları gör")}
      </Link>
    </div>
  );
}

/* ---------------- Küçük parçalar ---------------- */

export function ProviderIcon({ provider, size = 26 }: { provider: ProviderId | "shopify"; size?: number }) {
  const iconSize = Math.round(size * 0.6);
  const color = PROVIDER_COLOR[provider as ProviderId] ?? "#96bf48";
  const name = PROVIDER_NAME[provider as ProviderId] ?? "Shopify";
  const short = PROVIDER_SHORT[provider as ProviderId] ?? "SP";
  const svg = BrandSvg({ id: provider, size: iconSize });

  let background: string = color;
  if (provider === "instagram" || (provider as string) === "meta") {
    background = "radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)";
  } else if (provider === "tiktok" || provider === "x" || provider === "threads") {
    background = "#000000";
  }

  return (
    <span
      className="icon"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size / 3.6)),
        background,
        color: "#ffffff",
        display: "inline-grid",
        placeItems: "center",
        fontWeight: 800,
        fontSize: Math.round(size * 0.4),
        flexShrink: 0,
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.18)",
      }}
      title={name}
    >
      {svg ?? short}
    </span>
  );
}

export function Avatar({ name, url, size = 36 }: { name: string | null | undefined; url?: string | null; size?: number }) {
  const initials = (name ?? "?")
    .split(/[\s@._-]+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : initials}
    </div>
  );
}

export function ChannelChip({ channel }: { channel: Channel }) {
  return (
    <span className="provider-chip">
      <ProviderIcon provider={channel.provider} size={18} />
      <span className="truncate" style={{ maxWidth: 160 }}>
        {channel.name}
      </span>
    </span>
  );
}

const STATUS_CLS: Record<string, string> = {
  active: "badge-ok",
  expired: "badge-err",
  error: "badge-err",
  disabled: "",
  draft: "",
  pending_approval: "badge-warn",
  scheduled: "badge-info",
  publishing: "badge-warn",
  published: "badge-ok",
  partial: "badge-warn",
  failed: "badge-err",
  cancelled: "",
  pending: "",
  skipped: "",
  open: "badge-ok",
  closed: "",
  auto: "badge-accent",
  manual: "badge-warn",
  done: "badge-ok",
  archived: "",
};

const OTHER_LABEL: Record<string, string> = {
  active: "Aktif",
  expired: "Süresi doldu",
  error: "Hata",
  disabled: "Devre dışı",
  pending: "Bekliyor",
  skipped: "Atlandı",
  open: "Açık",
  closed: "Kapalı",
  auto: "Otomatik",
  manual: "Manuel",
  done: "Bitti",
  archived: "Arşiv",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const L = useLabels();
  const label = OTHER_LABEL[status] ? t(OTHER_LABEL[status]) : L.statuses.includes(status as PostStatus) ? L.status(status as PostStatus) : status;
  return <span className={`badge ${STATUS_CLS[status] ?? ""}`}>{label}</span>;
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div style={{ marginTop: 14, display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 8 }}>{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function UsageBar({ label, q, unit = "" }: { label: string; q: Quota; unit?: string }) {
  const t = useT();
  const pct = q.limit ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 0;
  const color = pct >= 90 ? "var(--err)" : pct >= 70 ? "var(--warn)" : "var(--accent)";
  return (
    <div className="usage">
      <div className="row-between small">
        <span>{label}</span>
        <span className="muted">
          {q.used}
          {unit} / {q.limit === null ? t("sınırsız") : `${q.limit}${unit}`}
        </span>
      </div>
      <div className="bar">
        <div style={{ width: q.limit === null ? "4%" : `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function Sparkline({ values, color = "var(--accent)" }: { values: number[]; color?: string }) {
  const t = useT();
  const path = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const w = 200;
    const h = 40;
    const span = max - min || 1;
    return values.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 6) - 3}`).join(" ");
  }, [values]);
  if (!path) return <div className="muted small">{t("Yeterli veri yok")}</div>;
  return (
    <svg className="spark" viewBox="0 0 200 40" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, JSON.stringify(nv));
      } catch {
        /* yoksay */
      }
    },
    [key],
  );
  return [v, set];
}

export function Copyable({ text, display }: { text: string; display?: string }) {
  const toast = useToast();
  const t = useT();
  return (
    <code
      className="copy"
      title={t("Kopyala")}
      role="button"
      tabIndex={0}
      onClick={() => {
        void copyText(text).then((ok) => toast(ok ? t("Kopyalandı") : t("Kopyalanamadı; metni seçip elle kopyala"), ok ? "ok" : "err"));
      }}
    >
      {display ?? text}
    </code>
  );
}

/** Onay gerektiren tehlikeli işlem: kullanıcı adı birebir yazmalı */
export function ConfirmTyped({ title, text, expected, danger, onConfirm, onClose, busy }: { title: string; text: string; expected: string; danger: string; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  const t = useT();
  const [v, setV] = useState("");
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button className="btn btn-danger" disabled={v !== expected || busy} onClick={onConfirm}>
            {danger}
          </button>
        </>
      }
    >
      <div className="form">
        <p>{text}</p>
        <div className="field">
          <label>{t("Onaylamak için yaz: {x}", { x: expected })}</label>
          <input className="input" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
        </div>
      </div>
    </Modal>
  );
}

export const TIMEZONES: string[] = (() => {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list?.length) return list;
  } catch {
    /* yoksay */
  }
  return ["Europe/Istanbul", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Tokyo", "UTC"];
})();
