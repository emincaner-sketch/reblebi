import { useState, type FormEvent } from "react";
import { api } from "../lib/api";

export default function LoginPage({ needsSetup, onDone }: { needsSetup: boolean; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { email, password });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hata");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card form" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-logo">S</div>
          <div>
            <div className="brand-name">SosyalPilot</div>
            <div className="brand-sub">{needsSetup ? "İlk kurulum: yönetici hesabı oluştur" : "Panele giriş"}</div>
          </div>
        </div>
        {needsSetup && (
          <p className="muted small">Bu hesap paneli yönetecek tek hesaptır. E-posta ve en az 8 karakterlik bir şifre belirle.</p>
        )}
        <div className="field">
          <label>E-posta</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label>Şifre</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        {error && <div className="badge badge-err" style={{ alignSelf: "flex-start" }}>{error}</div>}
        <button className="btn btn-primary" disabled={busy} style={{ justifyContent: "center" }}>
          {busy ? "…" : needsSetup ? "Hesabı oluştur ve gir" : "Giriş yap"}
        </button>
      </form>
    </div>
  );
}
