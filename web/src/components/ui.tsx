import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { PROVIDER_COLOR, PROVIDER_SHORT, type Channel, type ProviderId } from "../lib/api";

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
      <div className="toasts">
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${large ? "modal-lg" : ""}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Küçük parçalar ---------------- */

export function ProviderIcon({ provider, size = 26 }: { provider: ProviderId; size?: number }) {
  return (
    <span
      className="icon"
      style={{ width: size, height: size, borderRadius: Math.round(size / 4), background: PROVIDER_COLOR[provider], color: "#fff", display: "inline-grid", placeItems: "center", fontWeight: 800, fontSize: Math.round(size * 0.4), flexShrink: 0 }}
      title={provider}
    >
      {PROVIDER_SHORT[provider]}
    </span>
  );
}

export function Avatar({ name, url, size = 36 }: { name: string | null | undefined; url?: string | null; size?: number }) {
  const initials = (name ?? "?")
    .split(" ")
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

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: "badge-ok", label: "Aktif" },
    expired: { cls: "badge-err", label: "Süresi doldu" },
    error: { cls: "badge-err", label: "Hata" },
    disabled: { cls: "", label: "Devre dışı" },
    draft: { cls: "", label: "Taslak" },
    scheduled: { cls: "badge-info", label: "Planlandı" },
    publishing: { cls: "badge-warn", label: "Yayınlanıyor" },
    published: { cls: "badge-ok", label: "Yayınlandı" },
    partial: { cls: "badge-warn", label: "Kısmen" },
    failed: { cls: "badge-err", label: "Başarısız" },
    pending: { cls: "", label: "Bekliyor" },
    skipped: { cls: "", label: "Atlandı" },
    open: { cls: "badge-ok", label: "Açık" },
    closed: { cls: "", label: "Kapalı" },
    auto: { cls: "badge-accent", label: "Otomatik" },
    manual: { cls: "badge-warn", label: "Manuel" },
  };
  const m = map[status] ?? { cls: "", label: status };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
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

export function Sparkline({ values, color = "var(--accent)" }: { values: number[]; color?: string }) {
  const path = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const w = 200;
    const h = 40;
    const span = max - min || 1;
    return values.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 6) - 3}`).join(" ");
  }, [values]);
  if (!path) return <div className="muted small">Yeterli veri yok</div>;
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

export function Copyable({ text }: { text: string }) {
  const toast = useToast();
  return (
    <code
      className="copy"
      title="Kopyala"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => toast("Kopyalandı", "ok"));
      }}
    >
      {text}
    </code>
  );
}
