import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react";
import { api, errMsg, type PublicConfig, type Role } from "../../lib/api";
import { useI18n, useLabels } from "../../lib/i18n";
import { ME_KEY, useMeQuery } from "../../lib/session";
import { BROWSER_TZ } from "../../lib/tz";

export function usePublicConfig() {
  return useQuery({ queryKey: ["public-config"], queryFn: () => api.get<PublicConfig>("/api/public/config"), staleTime: 5 * 60_000 });
}

/** Sadece uygulama içi yollara yönlendir (açık yönlendirme olmasın) */
export function safeNext(v: string | null, fallback = "/app"): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}

export function AuthLayout({ title, sub, children, footer }: { title: string; sub?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { locale, setLocale } = useI18n();
  const cfg = usePublicConfig();
  return (
    <div className="login">
      <div className="auth-wrap">
        <div className="card form">
          <div className="row-between">
            <Link to="/" className="brand" style={{ padding: 0, color: "inherit" }}>
              <div className="brand-logo">{(cfg.data?.appName ?? "S").slice(0, 1)}</div>
              <div className="brand-name">{cfg.data?.appName ?? "SosyalPilot"}</div>
            </Link>
            <div className="segmented segmented-sm">
              <button className={locale === "tr" ? "active" : ""} onClick={() => setLocale("tr")}>
                TR
              </button>
              <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>
                EN
              </button>
            </div>
          </div>
          <div>
            <h1 style={{ fontSize: 20 }}>{title}</h1>
            {sub && <p className="muted" style={{ marginTop: 4 }}>{sub}</p>}
          </div>
          {children}
        </div>
        {footer && <div className="auth-foot">{footer}</div>}
      </div>
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
  const [error, setError] = useState("");
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
      <form className="form" onSubmit={submit}>
        <Field label={t("E-posta")}>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label={t("Şifre")}>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
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
      <form className="form" onSubmit={submit}>
        <Field label={t("Adın")}>
          <input className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} autoFocus />
        </Field>
        <Field label={t("E-posta")}>
          <input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required readOnly={Boolean(invite && params.get("email"))} />
        </Field>
        <Field label={t("Şifre")} help={t("En az 8 karakter")}>
          <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
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
          <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoFocus />
        </Field>
        <Field label={t("Yeni şifre (tekrar)")}>
          <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
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
