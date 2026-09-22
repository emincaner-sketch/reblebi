import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2, Power, ExternalLink } from "lucide-react";
import { api, fmtDate, PROVIDER_SHORT, type Channel, type ProviderInfo } from "../lib/api";
import { Avatar, Empty, Modal, ProviderIcon, StatusBadge, useToast } from "../components/ui";

export default function ChannelsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [formProvider, setFormProvider] = useState<ProviderInfo | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api.get<ProviderInfo[]>("/api/providers") });

  useEffect(() => {
    const ok = params.get("baglandi");
    const err = params.get("hata");
    if (ok) toast(`Bağlandı: ${ok}`, "ok");
    if (err) toast(`Bağlantı hatası: ${err}`, "err");
    if (ok || err) {
      setParams({}, { replace: true });
      qc.invalidateQueries({ queryKey: ["channels"] });
    }
  }, [params, setParams, toast, qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["channels"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const startOAuth = async (p: ProviderInfo) => {
    try {
      const r = await api.get<{ url: string }>(`/api/oauth/${p.oauthGroup}/start`);
      window.location.href = r.url;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Hata", "err");
    }
  };

  const connectForm = useMutation({
    mutationFn: () => api.post<Channel[]>(`/api/channels/connect/${formProvider!.id}`, formValues),
    onSuccess: (r) => {
      toast(`Bağlandı: ${r.map((c) => c.name).join(", ")}`, "ok");
      setFormProvider(null);
      setOpen(false);
      setFormValues({});
      refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Hata", "err"),
  });

  const check = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; detail?: string }>(`/api/channels/${id}/check`),
    onSuccess: (r) => {
      toast(r.ok ? "Bağlantı sağlıklı" : `Sorun: ${r.detail}`, r.ok ? "ok" : "err");
      refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (c: Channel) => api.patch(`/api/channels/${c.id}`, { status: c.status === "disabled" ? "active" : "disabled" }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/channels/${id}`),
    onSuccess: () => {
      toast("Kanal kaldırıldı", "ok");
      refresh();
    },
  });
  const toggleXDm = useMutation({
    mutationFn: (c: Channel) => api.patch(`/api/channels/${c.id}`, { metadata: { dmPolling: !c.metadata.dmPolling } }),
    onSuccess: refresh,
  });

  // Aynı Meta OAuth akışını tek kutucukta göster
  const tiles = (providers.data ?? []).reduce<ProviderInfo[]>((acc, p) => {
    if (p.oauthGroup === "meta" && acc.some((x) => x.oauthGroup === "meta")) return acc;
    acc.push(p);
    return acc;
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kanallar</h1>
          <p>Bağlı hesaplar. Her kanal ayrı bir hedef: gönderi, hikaye ve DM'ler buradan akar.</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={refresh}><RefreshCw /> Yenile</button>
          <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus /> Kanal bağla</button>
        </div>
      </div>

      {channels.data?.length === 0 && (
        <div className="card">
          <Empty title="Henüz kanal yok" text="Instagram, Facebook, TikTok, X, LinkedIn, YouTube, Threads, Telegram ya da WhatsApp bağlayarak başla." action={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus /> Kanal bağla</button>} />
        </div>
      )}

      <div className="grid grid-2">
        {channels.data?.map((c) => (
          <div key={c.id} className="card">
            <div className="channel-card">
              <div style={{ position: "relative" }}>
                <Avatar name={c.name} url={c.avatarUrl} size={44} />
                <span style={{ position: "absolute", right: -4, bottom: -4 }}><ProviderIcon provider={c.provider} size={18} /></span>
              </div>
              <div className="meta">
                <div className="name truncate">{c.name}</div>
                <div className="muted small truncate">
                  {c.username ? `@${c.username.replace(/^@/, "")} · ` : ""}
                  {PROVIDER_SHORT[c.provider]} · {c.metadata.type === "organization" ? "Şirket sayfası" : c.metadata.pageName ? `Sayfa: ${c.metadata.pageName}` : c.metadata.chatTitle ? `Hedef: ${c.metadata.chatTitle}` : `id ${c.externalId}`}
                </div>
                <div className="row" style={{ marginTop: 6, gap: 6 }}>
                  <StatusBadge status={c.status} />
                  {c.tokenExpiresAt && <span className="badge" title="Token bitiş">token: {fmtDate(c.tokenExpiresAt, { dateStyle: "short" })}</span>}
                  {c.provider === "x" && (
                    <label className="check small" title="X DM okuma ücretli API katmanı ister">
                      <input type="checkbox" checked={Boolean(c.metadata.dmPolling)} onChange={() => toggleXDm.mutate(c)} /> DM tara
                    </label>
                  )}
                </div>
                {c.lastError && <div className="small" style={{ color: "var(--err)", marginTop: 4 }}>{c.lastError}</div>}
              </div>
              <div className="row" style={{ gap: 4, flexDirection: "column", alignItems: "flex-end" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => check.mutate(c.id)} title="Bağlantıyı test et"><RefreshCw className={check.isPending ? "spin" : ""} /></button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle.mutate(c)} title={c.status === "disabled" ? "Etkinleştir" : "Devre dışı bırak"}><Power /></button>
                <button className="btn btn-ghost btn-sm" onClick={() => confirm(`${c.name} kaldırılsın mı? Konuşma geçmişi de silinir.`) && remove.mutate(c.id)} title="Kaldır"><Trash2 /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <Modal title={formProvider ? `${formProvider.label} bağla` : "Kanal bağla"} onClose={() => { setOpen(false); setFormProvider(null); }}>
          {!formProvider ? (
            <>
              <p className="muted" style={{ marginBottom: 14 }}>OAuth ile bağlananlar seni platforma yönlendirir; Telegram ve WhatsApp token ile bağlanır. Gri olanlar için .env'de uygulama anahtarı tanımlı değil.</p>
              <div className="connect-grid">
                {tiles.map((p) => (
                  <button
                    key={p.id}
                    className="connect-tile"
                    disabled={!p.configured}
                    title={p.configured ? "" : ".env içinde anahtar yok"}
                    onClick={() => (p.connectMode === "oauth" ? startOAuth(p) : setFormProvider(p))}
                  >
                    <ProviderIcon provider={p.id} size={34} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.oauthGroup === "meta" ? "Instagram + Facebook" : p.label}</div>
                      <div className="muted small">{p.connectMode === "oauth" ? "OAuth" : "Token"}{p.oauthGroup === "meta" ? " · Meta" : ""}</div>
                    </div>
                    {p.connectMode === "oauth" && <ExternalLink style={{ marginLeft: "auto", width: 14, opacity: 0.5 }} />}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                connectForm.mutate();
              }}
            >
              {formProvider.connectFields.map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input className="input" value={formValues[f.key] ?? ""} onChange={(e) => setFormValues({ ...formValues, [f.key]: e.target.value })} />
                  {f.help && <span className="help">{f.help}</span>}
                </div>
              ))}
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setFormProvider(null)}>Geri</button>
                <button className="btn btn-primary" disabled={connectForm.isPending}>{connectForm.isPending ? "Bağlanıyor…" : "Bağla"}</button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
