import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarDays, CheckCircle2, Eye, EyeOff, MailCheck, MessagesSquare, XCircle } from "lucide-react";
import "../../panel/auth.css";
import { api, errMsg, type PublicConfig, type Role } from "../../lib/api";
import { useI18n, useLabels } from "../../lib/i18n";
import { ME_KEY, useMeQuery } from "../../lib/session";
import { BROWSER_TZ } from "../../lib/tz";
import { PRERENDERED, PUBLIC_SNAPSHOT } from "../../lib/boot";
import { LogoMark } from "../../components/Logo";
import { SITE_NAME } from "../../config/site";

export function usePublicConfig() {
  return useQuery({
    queryKey: ["public-config"],
    queryFn: () => api.get<PublicConfig>("/api/public/config"),
    staleTime: 5 * 60_000,
    // Ön-render edilen sayfada ilk çizim derleme anındaki veriyle yapılır, ardından canlı değerler çekilir
    ...(PRERENDERED ? { initialData: PUBLIC_SNAPSHOT, initialDataUpdatedAt: 0 } : {}),
  });
}

/** Sadece uygulama içi yollara yönlendir (açık yönlendirme olmasın) */
export function safeNext(v: string | null, fallback = "/app"): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}

/** Sol paneldeki dekoratif sütun grafiği: logodaki leblebi tanesi en yüksek sütunun üstünde */
function AuthChart() {
  const bars = [38, 52, 44, 66, 58, 82, 74, 96, 88];
  return (
    <svg className="au-chart" viewBox="0 0 270 120" aria-hidden="true" focusable="false">
      {bars.map((h, i) => (
        <rect key={i} x={i * 30 + 4} y={120 - h} width={20} height={h} rx={4} fill={i === 7 ? "#5b49f2" : "rgba(244,241,234,0.14)"} />
      ))}
      <circle cx={7 * 30 + 14} cy={120 - 96 - 12} r={6} fill="#d9a441" />
    </svg>
  );
}

/**
 * Giriş, kayıt, şifre, davet, OAuth onay ve çalışma alanı ekranlarının ortak kabuğu (docs/panel/04-GIRIS-KAYIT-TASARIM.md).
 * Bölünmüş düzen: solda koyu marka paneli (doğrulanmış değer önerileri), sağda form. Akış ve alanlar bu bileşenin dışında.
 */
export function AuthLayout({ title, sub, children, footer, variant = "default" }: { title: string; sub?: ReactNode; children: ReactNode; footer?: ReactNode; variant?: "default" | "signup" }) {
  const { t, locale, setLocale } = useI18n();
  const cfg = usePublicConfig();
  const c = cfg.data;
  const appName = c?.appName ?? SITE_NAME;
  const trialPlan = c ? (c.plans.find((p) => p.id === c.trialPlan)?.name[locale] ?? c.trialPlan) : "";
  const note =
    variant === "signup" && c && c.trialDays > 0
      ? t("{days} gün {plan} ücretsiz · Kredi kartı gerekmez", { days: c.trialDays, plan: trialPlan })
      : t("Şifreni hiçbir platforma vermezsin: hesaplar resmî izin ekranından bağlanır.");
  return (
    <div className="au">
      <aside className="au-aside">
        <Link to="/" className="au-brand">
          <LogoMark size={34} />
          <span>{appName}</span>
        </Link>
        <div className="au-pitch">
          <p className="au-head">{t("Planla, yanıtla, ölç. Hepsi tek panelde.")}</p>
          <ul className="au-points">
            <li>
              <CalendarDays aria-hidden="true" />
              <div>
                <strong>{t("Dokuz platform, tek takvim")}</strong>
                <span>{t("Instagram'dan Telegram'a planla ve yayınla.")}</span>
              </div>
            </li>
            <li>
              <MessagesSquare aria-hidden="true" />
              <div>
                <strong>{t("DM'ler tek kutuda")}</strong>
                <span>{t("Instagram, Messenger, WhatsApp, Telegram ve X; kurallarla otomatik yanıt.")}</span>
              </div>
            </li>
            <li>
              <BarChart3 aria-hidden="true" />
              <div>
                <strong>{t("Ölç ve karşılaştır")}</strong>
                <span>{t("Takipçi, etkileşim ve en iyi saatler; CSV ve PDF.")}</span>
              </div>
            </li>
          </ul>
        </div>
        <AuthChart />
        <p className="au-note">{note}</p>
      </aside>
      <main className="au-main">
        <div className="au-top">
          <Link to="/" className="au-mobile-brand" aria-label={appName}>
            <LogoMark size={30} />
            <span>{appName}</span>
          </Link>
          <div className="segmented segmented-sm" role="group" aria-label={t("Dil")}>
            <button className={locale === "tr" ? "active" : ""} aria-pressed={locale === "tr"} onClick={() => setLocale("tr")}>
              TR
            </button>
            <button className={locale === "en" ? "active" : ""} aria-pressed={locale === "en"} onClick={() => setLocale("en")}>
              EN
            </button>
          </div>
        </div>
        <div className="au-card form">
          <div>
            <h1 className="au-title">{title}</h1>
            {sub && <p className="au-sub">{sub}</p>}
          </div>
          {children}
        </div>
        {footer && <div className="au-foot">{footer}</div>}
      </main>
    </div>
  );
}

/** Şifre alanı + göster/gizle (yalnızca istemci; gönderilen değer değişmez) */
function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div className="au-pw">
      <input {...props} className="input" type={show ? "text" : "password"} />
      <button type="button" className="au-pw-btn" aria-pressed={show} aria-label={show ? t("Şifreyi gizle") : t("Şifreyi göster")} onClick={() => setShow(!show)}>
        {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return text ? (
    <div className="notice notice-err small" role="alert">
      {text}
    </div>
  ) : null;
}

/** Sunucunun döndüğü Google giriş hata anahtarları → mesaj */
const GOOGLE_ERRORS: Record<string, string> = {
  "auth.google_disabled": "Google ile giriş bu sunucuda açık değil.",
  "auth.google_state": "Google oturumu zaman aşımına uğradı, tekrar dene.",
  "auth.google_failed": "Google ile giriş tamamlanamadı.",
  "auth.google_unverified": "Google hesabının e-postası doğrulanmamış.",
  "auth.facebook_disabled": "Facebook ile giriş bu sunucuda açık değil.",
  "auth.facebook_failed": "Facebook ile giriş tamamlanamadı.",
  "auth.facebook_no_email": "Facebook hesabında onaylı bir e-posta yok; e-postayla kaydol.",
  "auth.signup_closed": "Kayıtlar şu an kapalı.",
  "auth.signup_invite_only": "Kayıt yalnızca davetle yapılabilir. Ekibinden bir davet bağlantısı iste.",
  "auth.user_disabled": "Bu hesap devre dışı bırakılmış.",
};

/**
 * "Google ile devam et": tam sayfa yönlendirme (OAuth), yalnızca sunucuda Google istemcisi tanımlıysa görünür.
 * Google marka kuralları: beyaz zemin, çok renkli G, "Google ile devam et" metni.
 */
function SocialButtons({ next }: { next: string }) {
  const { t, locale } = useI18n();
  const cfg = usePublicConfig();
  const google = Boolean(cfg.data?.googleLogin);
  const facebook = Boolean(cfg.data?.facebookLogin);
  if (!google && !facebook) return null;
  const href = (provider: string) => `/api/auth/${provider}/start?${new URLSearchParams({ next, locale, tz: BROWSER_TZ })}`;
  return (
    <>
      {google && (
      <a className="btn btn-block au-google" href={href("google")}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        {t("Google ile devam et")}
      </a>
      )}
      {facebook && (
        <a className="btn btn-block au-facebook" href={href("facebook")}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              fill="#fff"
              d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
            />
          </svg>
          {t("Facebook ile devam et")}
        </a>
      )}
      <div className="au-or" role="separator">
        <span>{t("ya da e-postayla")}</span>
      </div>
    </>
  );
}

function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

/* ---------------- Giriş ---------------- */

export function LoginPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const me = useMeQuery();
  const cfg = usePublicConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => {
    const k = params.get("error");
    return k && GOOGLE_ERRORS[k] ? t(GOOGLE_ERRORS[k]) : "";
  });
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (me.data?.needsSetup) nav("/signup", { replace: true });
    else if (me.data?.user) nav(next, { replace: true });
  }, [me.data, nav, next]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/api/auth/login", { email, password });
      await qc.invalidateQueries({ queryKey: ME_KEY });
      nav(next, { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t("Panele giriş")}
      footer={
        cfg.data?.signupMode === "open" ? (
          <span>
            {t("Hesabın yok mu?")} <Link to={`/signup${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}>{t("Ücretsiz dene")}</Link>
          </span>
        ) : null
      }
    >
      <SocialButtons next={next} />
      <form className="form" onSubmit={submit}>
        <Field label={t("E-posta")}>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label={t("Şifre")}>
          <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <div className="row-between small">
          <span />
          <Link to="/forgot">{t("Şifremi unuttum")}</Link>
        </div>
        <ErrorLine text={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "…" : t("Giriş yap")}
        </button>
      </form>
    </AuthLayout>
  );
}

/* ---------------- Kayıt ---------------- */

export function SignupPage() {
  const { t, locale } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const me = useMeQuery();
  const cfg = usePublicConfig();
  const invite = params.get("invite");
  const [form, setForm] = useState({ name: "", email: params.get("email") ?? "", password: "", orgName: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const setup = Boolean(me.data?.needsSetup);
  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (me.data?.user) nav(next, { replace: true });
  }, [me.data, nav, next]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ ok: boolean; loggedIn: boolean }>("/api/auth/signup", {
        email: form.email,
        password: form.password,
        name: form.name || undefined,
        orgName: invite ? undefined : form.orgName || undefined,
        locale,
        timezone: BROWSER_TZ,
        inviteToken: invite ?? undefined,
      });
      if (!r.loggedIn) {
        setSent(true);
        return;
      }
      await qc.invalidateQueries({ queryKey: ME_KEY });
      nav(next, { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout title={t("E-postanı kontrol et")}>
        <div className="center-col">
          <MailCheck style={{ width: 40, height: 40, color: "var(--accent)" }} />
          <p>{t("{email} adresine bir doğrulama bağlantısı gönderdik. Bağlantıya tıkladıktan sonra giriş yapabilirsin.", { email: form.email })}</p>
          <Link to="/login" className="btn">
            {t("Giriş sayfasına dön")}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  const closed = !setup && !invite && cfg.data && cfg.data.signupMode !== "open";
  if (closed) {
    return (
      <AuthLayout title={t("Kayıt")}>
        <p>{cfg.data?.signupMode === "invite" ? t("Kayıt yalnızca davetle yapılabilir. Ekibinden bir davet bağlantısı iste.") : t("Kayıtlar şu an kapalı.")}</p>
        <Link to="/login" className="btn">
          {t("Giriş yap")}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      variant="signup"
      title={setup ? t("İlk kurulum") : invite ? t("Daveti kabul et ve hesap oluştur") : t("Hesap oluştur")}
      sub={
        setup
          ? t("Bu ilk hesap platformun sahibi (süper admin) olur ve sınırsız planla başlar.")
          : invite
            ? undefined
            : cfg.data && cfg.data.trialDays > 0
              ? t("{days} gün boyunca {plan} planı ücretsiz. Kredi kartı gerekmez.", { days: cfg.data.trialDays, plan: cfg.data.plans.find((p) => p.id === cfg.data!.trialPlan)?.name[locale] ?? cfg.data.trialPlan })
              : undefined
      }
      footer={
        !setup && (
          <span>
            {t("Zaten hesabın var mı?")} <Link to={`/login${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}>{t("Giriş yap")}</Link>
          </span>
        )
      }
    >
      {!setup && !invite && <SocialButtons next={next} />}
      <form className="form" onSubmit={submit}>
        <Field label={t("Adın")}>
          <input className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} autoFocus />
        </Field>
        <Field label={t("E-posta")}>
          <input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required readOnly={Boolean(invite && params.get("email"))} />
        </Field>
        <Field label={t("Şifre")} help={t("En az 8 karakter")}>
          <PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
        </Field>
        {!invite && (
          <Field label={t("Marka / şirket adı")} help={t("Çalışma alanının adı olur; sonradan değiştirebilirsin.")}>
            <input className="input" value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} maxLength={80} />
          </Field>
        )}
        <ErrorLine text={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "…" : setup ? t("Hesabı oluştur ve başla") : t("Hesap oluştur")}
        </button>
        {!setup && (
          <p className="muted small center">
            {t("Kaydolarak")} <Link to="/terms">{t("Kullanım Koşulları")}</Link> {t("ve")} <Link to="/privacy">{t("Gizlilik Politikası")}</Link>
            {t("'nı kabul etmiş olursun.")}
          </p>
        )}
      </form>
    </AuthLayout>
  );
}

/* ---------------- Şifremi unuttum ---------------- */

export function ForgotPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const m = useMutation({ mutationFn: () => api.post("/api/auth/forgot", { email }) });
  return (
    <AuthLayout title={t("Şifreni sıfırla")} sub={t("Hesabına bağlı e-postayı yaz; sıfırlama bağlantısı gönderelim.")} footer={<Link to="/login">{t("Giriş sayfasına dön")}</Link>}>
      {m.isSuccess ? (
        <div className="notice notice-ok">{t("Bu e-posta ile bir hesap varsa sıfırlama bağlantısı gönderildi. Bağlantı 1 saat geçerli.")}</div>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <Field label={t("E-posta")}>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <ErrorLine text={m.error ? errMsg(m.error) : ""} />
          <button className="btn btn-primary btn-block" disabled={m.isPending}>
            {t("Bağlantı gönder")}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

/* ---------------- Yeni şifre ---------------- */

export function ResetPasswordPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const m = useMutation({
    mutationFn: () => api.post("/api/auth/reset", { token, password: pw }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      nav("/app", { replace: true });
    },
  });
  if (!token) return <AuthLayout title={t("Geçersiz bağlantı")}><Link to="/forgot" className="btn">{t("Yeni bağlantı iste")}</Link></AuthLayout>;
  return (
    <AuthLayout title={t("Yeni şifre belirle")}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label={t("Yeni şifre")} help={t("En az 8 karakter")}>
          <PasswordInput autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoFocus />
        </Field>
        <Field label={t("Yeni şifre (tekrar)")}>
          <PasswordInput autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        </Field>
        {pw2 && pw !== pw2 && <ErrorLine text={t("Şifreler eşleşmiyor")} />}
        <ErrorLine text={m.error ? errMsg(m.error) : ""} />
        <button className="btn btn-primary btn-block" disabled={m.isPending || pw.length < 8 || pw !== pw2}>
          {t("Şifreyi kaydet ve giriş yap")}
        </button>
      </form>
    </AuthLayout>
  );
}

/* ---------------- E-posta doğrulama ---------------- */

export function VerifyPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const started = useRef(false);
  const m = useMutation({ mutationFn: () => api.post("/api/auth/verify", { token }), onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }) });
  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      m.mutate();
    }
  }, [token, m]);
  return (
    <AuthLayout title={t("E-posta doğrulama")}>
      <div className="center-col">
        {m.isPending && <p className="muted">{t("Doğrulanıyor…")}</p>}
        {m.isSuccess && (
          <>
            <CheckCircle2 style={{ width: 40, height: 40, color: "var(--ok)" }} />
            <p>{t("E-posta adresin doğrulandı.")}</p>
            <Link to="/app" className="btn btn-primary">
              {t("Panele git")}
            </Link>
          </>
        )}
        {(m.isError || !token) && (
          <>
            <XCircle style={{ width: 40, height: 40, color: "var(--err)" }} />
            <p>{m.error ? errMsg(m.error) : t("Bağlantı geçersiz ya da süresi dolmuş")}</p>
            <Link to="/login" className="btn">
              {t("Giriş yap")}
            </Link>
          </>
        )}
      </div>
    </AuthLayout>
  );
}

/* ---------------- Davet ---------------- */

interface InviteInfo {
  email?: string;
  orgName?: string;
  role?: Role;
  hasAccount?: boolean;
  invalid?: boolean;
}

export function InvitePage() {
  const { t } = useI18n();
  const L = useLabels();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const me = useMeQuery();
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api.get<InviteInfo>(`/api/auth/invite?token=${encodeURIComponent(token)}`), enabled: Boolean(token), retry: false });
  const accept = useMutation({
    mutationFn: () => api.post("/api/auth/invite/accept", { token }),
    onSuccess: async () => {
      qc.clear();
      await qc.refetchQueries({ queryKey: ME_KEY });
      nav("/app", { replace: true });
    },
  });
  const here = `/invite?token=${encodeURIComponent(token)}`;
  const i = info.data;

  if (!token || i?.invalid || info.isError) {
    return (
      <AuthLayout title={t("Davet geçersiz")}>
        <p>{t("Bu davet bağlantısı geçersiz, kullanılmış ya da süresi dolmuş. Seni davet eden kişiden yeni bir davet iste.")}</p>
        <Link to="/login" className="btn">
          {t("Giriş yap")}
        </Link>
      </AuthLayout>
    );
  }
  if (!i || me.isLoading) return <AuthLayout title={t("Davet")}><p className="muted">…</p></AuthLayout>;

  const user = me.data?.user;
  return (
    <AuthLayout title={t("{org} çalışma alanına davet edildin", { org: i.orgName ?? "" })} sub={t("Rol: {role} · {email}", { role: i.role ? L.role(i.role) : "", email: i.email ?? "" })}>
      {user ? (
        user.email === i.email ? (
          <>
            <ErrorLine text={accept.error ? errMsg(accept.error) : ""} />
            <button className="btn btn-primary btn-block" onClick={() => accept.mutate()} disabled={accept.isPending}>
              {t("Daveti kabul et")}
            </button>
          </>
        ) : (
          <>
            <div className="notice notice-warn">{t("Şu an {current} olarak giriş yaptın; davet {email} adresine gönderilmiş.", { current: user.email, email: i.email ?? "" })}</div>
            <button
              className="btn btn-block"
              onClick={async () => {
                await api.post("/api/auth/logout");
                await qc.resetQueries();
                nav(here, { replace: true });
              }}
            >
              {t("Çıkış yap ve doğru hesapla gir")}
            </button>
          </>
        )
      ) : i.hasAccount ? (
        <Link to={`/login?next=${encodeURIComponent(here)}`} className="btn btn-primary btn-block">
          {t("Giriş yap ve kabul et")}
        </Link>
      ) : (
        <Link to={`/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(i.email ?? "")}`} className="btn btn-primary btn-block">
          {t("Hesap oluştur ve katıl")}
        </Link>
      )}
    </AuthLayout>
  );
}
