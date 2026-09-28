import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Power, RefreshCw, Settings2, Trash2, Users } from "lucide-react";
import { api, errMsg, PROVIDER_NAME, type Channel, type Customer, type OrgInfo, type ProviderInfo } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Avatar, Can, Empty, Modal, PageHead, ProviderIcon, StatusBadge, UsageBar, useToast } from "../components/ui";

function ChannelSettings({ c, customers, onClose }: { c: Channel; customers: Customer[] | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(c.name);
  const [times, setTimes] = useState(c.postingTimes.join(", "));
  const [customerId, setCustomerId] = useState(c.customerId ?? "");
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/channels/${c.id}`, {
        name: name.trim() || c.name,
        postingTimes: times
          .split(/[,\s]+/)
          .map((x) => x.trim())
          .filter((x) => /^\d{1,2}:\d{2}$/.test(x)),
        ...(customers ? { customerId: customerId || null } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      toast(t("Kaydedildi"), "ok");
      onClose();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  return (
    <Modal
      title={t("{name} ayarları", { name: c.name })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {t("Kaydet")}
          </button>
        </>
      }
    >
      <div className="form">
        <div className="field">
          <label>{t("Panelde görünen ad")}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <div className="field">
          <label>{t("Tercih edilen paylaşım saatleri")}</label>
          <input className="input" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="10:00, 13:00, 19:00" />
          <span className="help">{t("Virgülle ayır. 'Sonraki boş saat' ve AI planlayıcı bu saatleri kullanır. Boş bırakırsan çalışma alanı varsayılanı geçerli olur.")}</span>
        </div>
        {customers && (
          <div className="field">
            <label>{t("Müşteri")}</label>
            <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{t("— yok —")}</option>
              {customers.map((cu) => (
                <option key={cu.id} value={cu.id}>
                  {cu.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {c.capabilities.mediaNote && <span className="help">{c.capabilities.mediaNote}</span>}
      </div>
    </Modal>
  );
}

function CustomersModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["customers"], queryFn: () => api.get<Customer[]>("/api/customers") });
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6d5dfc");
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["channels"] });
  };
  const add = useMutation({ mutationFn: () => api.post("/api/customers", { name, color }), onSuccess: () => (setName(""), inv()), onError: (e) => toast(errMsg(e), "err") });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/customers/${id}`), onSuccess: inv, onError: (e) => toast(errMsg(e), "err") });
  return (
    <Modal title={t("Müşteriler")} onClose={onClose}>
      <div className="form">
        <p className="muted small">{t("Ajans modu: kanalları müşterilere grupla, gönderileri müşteriye göre filtrele.")}</p>
        <div className="row">
          <input className="input" style={{ flex: 1 }} placeholder={t("Müşteri adı")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t("Renk")} className="color-input" />
          <button className="btn btn-primary" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
            <Plus /> {t("Ekle")}
          </button>
        </div>
        <table className="table">
          <tbody>
            {list.data?.map((c) => (
              <tr key={c.id}>
                <td>
                  <span className="dot" style={{ color: c.color, display: "inline-block", marginRight: 8 }} />
                  {c.name}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn btn-ghost btn-sm" aria-label={t("Sil")} onClick={() => confirm(t("{name} silinsin mi?", { name: c.name })) && remove.mutate(c.id)}>
                    <Trash2 />
                  </button>
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td className="muted">{t("Henüz müşteri yok.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export default function ChannelsPage() {
  const { t } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [formProvider, setFormProvider] = useState<ProviderInfo | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Channel | null>(null);
  const [customersOpen, setCustomersOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api.get<ProviderInfo[]>("/api/providers") });
  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const agency = Boolean(org.data?.usage.plan.features.customers);
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api.get<Customer[]>("/api/customers"), enabled: agency });

  useEffect(() => {
    const ok = params.get("connected");
    const err = params.get("error");
    if (ok) toast(t("Bağlandı: {names}", { names: ok }), "ok");
    if (err) toast(t("Bağlantı hatası: {msg}", { msg: err }), "err");
    if (ok || err) {
      setParams({}, { replace: true });
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["org"] });
    }
  }, [params, setParams, toast, qc, t]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["channels"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["org"] });
  };

  const startOAuth = async (p: ProviderInfo) => {
    try {
      const r = await api.get<{ url: string }>(`/api/oauth/${p.oauthGroup}/start`);
      window.location.href = r.url;
    } catch (e) {
      toast(errMsg(e), "err");
    }
  };

  const connectForm = useMutation({
    mutationFn: () => api.post<Channel[]>(`/api/channels/connect/${formProvider!.id}`, formValues),
    onSuccess: (r) => {
      toast(t("Bağlandı: {names}", { names: r.map((c) => c.name).join(", ") }), "ok");
      setFormProvider(null);
      setOpen(false);
      setFormValues({});
      refresh();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const check = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; detail?: string }>(`/api/channels/${id}/check`),
    onSuccess: (r) => {
      toast(r.ok ? t("Bağlantı sağlıklı") : t("Sorun: {msg}", { msg: r.detail ?? "" }), r.ok ? "ok" : "err");
      refresh();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const toggle = useMutation({
    mutationFn: (c: Channel) => api.patch(`/api/channels/${c.id}`, { status: c.status === "disabled" ? "active" : "disabled" }),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), "err"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/channels/${id}`),
    onSuccess: () => {
      toast(t("Kanal kaldırıldı"), "ok");
      refresh();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const toggleXDm = useMutation({
    mutationFn: (c: Channel) => api.patch(`/api/channels/${c.id}`, { dmPolling: !c.metadata.dmPolling }),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), "err"),
  });

  // Aynı Meta OAuth akışını tek kutucukta göster
  const tiles = (providers.data ?? []).reduce<ProviderInfo[]>((acc, p) => {
    if (p.oauthGroup === "meta" && acc.some((x) => x.oauthGroup === "meta")) return acc;
    acc.push(p);
    return acc;
  }, []);

  const list = (channels.data ?? []).filter((c) => !filter || c.customerId === filter);
  const quota = org.data?.usage.channels;
  const full = quota?.limit !== null && quota !== undefined && quota.used >= (quota.limit ?? Infinity);

  return (
    <>
      <PageHead
        title={t("Kanallar")}
        sub={t("Bağlı hesaplar. Her kanal ayrı bir hedef: gönderi, hikaye ve DM'ler buradan akar.")}
        actions={
          <>
            {agency && s.can("admin") && (
              <button className="btn" onClick={() => setCustomersOpen(true)}>
                <Users /> {t("Müşteriler")}
              </button>
            )}
            <button className="btn" onClick={refresh}>
              <RefreshCw /> {t("Yenile")}
            </button>
            <Can role="admin">
              <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={full} title={full ? t("Plan sınırı doldu") : ""}>
                <Plus /> {t("Kanal bağla")}
              </button>
            </Can>
          </>
        }
      />

      {quota && (
        <div className="card" style={{ marginBottom: 16, maxWidth: 420 }}>
          <UsageBar label={t("Kanal kotası")} q={quota} />
        </div>
      )}

      {agency && (customers.data?.length ?? 0) > 0 && (
        <div className="row" style={{ marginBottom: 12 }}>
          <select className="select" style={{ width: 240 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Müşteri filtresi")}>
            <option value="">{t("Tüm müşteriler")}</option>
            {customers.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {channels.data?.length === 0 && (
        <div className="card">
          <Empty
            title={t("Henüz kanal yok")}
            text={t("Instagram, Facebook, TikTok, X, LinkedIn, YouTube, Threads, Telegram ya da WhatsApp bağlayarak başla.")}
            action={
              <Can role="admin">
                <button className="btn btn-primary" onClick={() => setOpen(true)}>
                  <Plus /> {t("Kanal bağla")}
                </button>
              </Can>
            }
          />
        </div>
      )}

      <div className="grid grid-2">
        {list.map((c) => (
          <div key={c.id} className="card">
            <div className="channel-card">
              <div style={{ position: "relative" }}>
                <Avatar name={c.name} url={c.avatarUrl} size={44} />
                <span style={{ position: "absolute", right: -4, bottom: -4 }}>
                  <ProviderIcon provider={c.provider} size={18} />
                </span>
              </div>
              <div className="meta">
                <div className="name truncate">{c.name}</div>
                <div className="muted small truncate">
                  {c.username ? `@${c.username.replace(/^@/, "")} · ` : ""}
                  {PROVIDER_NAME[c.provider]} ·{" "}
                  {c.metadata.type === "organization"
                    ? t("Şirket sayfası")
                    : c.metadata.pageName
                      ? t("Sayfa: {name}", { name: String(c.metadata.pageName) })
                      : c.metadata.chatTitle
                        ? t("Hedef: {name}", { name: String(c.metadata.chatTitle) })
                        : `id ${c.externalId}`}
                </div>
                <div className="row" style={{ marginTop: 6, gap: 6 }}>
                  <StatusBadge status={c.status} />
                  {c.customerName && <span className="badge">{c.customerName}</span>}
                  {c.tokenExpiresAt && (
                    <span className="badge" title={t("Token bitiş")}>
                      token: {f.day(c.tokenExpiresAt)}
                    </span>
                  )}
                  {c.provider === "x" && s.can("admin") && (
                    <label className="check small" title={t("X DM okuma ücretli API katmanı ister")}>
                      <input type="checkbox" checked={Boolean(c.metadata.dmPolling)} onChange={() => toggleXDm.mutate(c)} /> {t("DM tara")}
                    </label>
                  )}
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  {t("Paylaşım saatleri")}: {c.postingTimes.join(", ") || "-"}
                </div>
                {c.lastError && (
                  <div className="small" style={{ color: "var(--err)", marginTop: 4 }}>
                    {c.lastError}
                  </div>
                )}
              </div>
              <div className="row" style={{ gap: 4, flexDirection: "column", alignItems: "flex-end" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => check.mutate(c.id)} title={t("Bağlantıyı test et")} aria-label={t("Bağlantıyı test et")}>
                  <RefreshCw className={check.isPending && check.variables === c.id ? "spin" : ""} />
                </button>
                <Can role="admin">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(c)} title={t("Ayarlar")} aria-label={t("Ayarlar")}>
                    <Settings2 />
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggle.mutate(c)} title={c.status === "disabled" ? t("Etkinleştir") : t("Devre dışı bırak")} aria-label={t("Aç/kapat")}>
                    <Power />
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => confirm(t("{name} kaldırılsın mı? Konuşma geçmişi de silinir.", { name: c.name })) && remove.mutate(c.id)} title={t("Kaldır")} aria-label={t("Kaldır")}>
                    <Trash2 />
                  </button>
                </Can>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && <ChannelSettings c={editing} customers={agency ? (customers.data ?? []) : null} onClose={() => setEditing(null)} />}
      {customersOpen && <CustomersModal onClose={() => setCustomersOpen(false)} />}

      {open && (
        <Modal
          title={formProvider ? t("{name} bağla", { name: formProvider.label }) : t("Kanal bağla")}
          onClose={() => {
            setOpen(false);
            setFormProvider(null);
          }}
        >
          {!formProvider ? (
            <>
              <p className="muted" style={{ marginBottom: 14 }}>
                {t("OAuth ile bağlananlar seni platformun kendi giriş ekranına yönlendirir; Telegram ve WhatsApp token ile bağlanır.")}
              </p>
              <div className="connect-grid">
                {tiles.map((p) => (
                  <button
                    key={p.id}
                    className="connect-tile"
                    disabled={!p.configured}
                    title={p.configured ? "" : t("Platform yöneticisi bu entegrasyonu henüz yapılandırmadı")}
                    onClick={() => (p.connectMode === "oauth" ? startOAuth(p) : setFormProvider(p))}
                  >
                    <ProviderIcon provider={p.id} size={34} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.oauthGroup === "meta" ? "Instagram + Facebook" : p.label}</div>
                      <div className="muted small">
                        {!p.configured ? t("Yapılandırılmadı") : p.connectMode === "oauth" ? "OAuth" : "Token"}
                        {p.oauthGroup === "meta" ? " · Meta" : ""}
                      </div>
                    </div>
                    {p.connectMode === "oauth" && <ExternalLink style={{ marginLeft: "auto", width: 14, opacity: 0.5 }} />}
                  </button>
                ))}
              </div>
              {tiles.some((p) => p.oauthGroup === "meta") && (
                <p className="muted small" style={{ marginTop: 14 }}>
                  {t("Instagram için hesabın Profesyonel (İşletme/İçerik Üreticisi) olmalı ve bir Facebook Sayfası'na bağlı olmalı. İzin ekranında sayfalarını seçmeyi unutma.")}
                </p>
              )}
              {s.user.isSuperadmin && tiles.some((p) => !p.configured) && (
                <p className="muted small" style={{ marginTop: 8 }}>
                  {t("Gri olanlar için sunucu .env dosyasına uygulama anahtarlarını ekle (docs/KURULUM.md).")}
                </p>
              )}
            </>
          ) : (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                connectForm.mutate();
              }}
            >
              {formProvider.connectFields.map((fld) => (
                <div className="field" key={fld.key}>
                  <label>{fld.label}</label>
                  <input className="input" value={formValues[fld.key] ?? ""} onChange={(e) => setFormValues({ ...formValues, [fld.key]: e.target.value })} />
                  {fld.help && <span className="help">{fld.help}</span>}
                </div>
              ))}
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setFormProvider(null)}>
                  {t("Geri")}
                </button>
                <button className="btn btn-primary" disabled={connectForm.isPending}>
                  {connectForm.isPending ? t("Bağlanıyor…") : t("Bağla")}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
