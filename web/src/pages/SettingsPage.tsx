import { useEffect, useState, type ReactNode } from "react";
import { McpGuide } from "../components/McpGuide";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, KeyRound, Plus, Send, Trash2 } from "lucide-react";
import {
  api,
  errMsg,
  type AiConnection,
  type AiProviderKind,
  type AiStatus,
  type ApiKeyRow,
  type OrgInfo,
  type OrgSettings,
  type OutboundWebhook,
  type Signature,
  type SystemInfo,
  type Tag,
  type WebhookEvent,
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Can, ConfirmTyped, Copyable, FeatureGate, Loading, Modal, PageHead, ProviderIcon, TIMEZONES, useToast } from "../components/ui";

type Tab = "workspace" | "profile" | "brand" | "ai" | "publishing" | "webhooks" | "api" | "connections" | "system";

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card form">
      <div className="card-title">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** Ayar formu: yalnızca değişen alanları gönderir */
function useSettingsForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<OrgSettings>("/api/settings") });
  const [draft, setDraft] = useState<Partial<OrgSettings> & { aiApiKey?: string }>({});
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.put<OrgSettings>("/api/settings", patch),
    onSuccess: (r) => {
      qc.setQueryData(["settings"], r);
      qc.invalidateQueries({ queryKey: ["ai-status"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setDraft({});
      toast(t("Kaydedildi"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const v = q.data ? { ...q.data, ...draft } : null;
  const dirty = Object.keys(draft).length > 0;
  return { v, set: (p: Partial<OrgSettings> & { aiApiKey?: string }) => setDraft((d) => ({ ...d, ...p })), dirty, save: () => save.mutate(draft), saving: save.isPending, reset: () => setDraft({}) };
}

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  const { t } = useI18n();
  if (!dirty) return null;
  return (
    <div className="save-bar">
      <span>{t("Kaydedilmemiş değişiklikler var")}</span>
      <button className="btn btn-ghost btn-sm" onClick={onReset}>
        {t("Geri al")}
      </button>
      <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
        {t("Kaydet")}
      </button>
    </div>
  );
}

/* ---------------- Çalışma alanı ---------------- */

function WorkspaceTab() {
  const { t } = useI18n();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(s.org.name);
  const [tz, setTz] = useState(s.org.timezone);
  const [locale, setLocale] = useState(s.org.locale);
  const [deleting, setDeleting] = useState(false);
  const save = useMutation({
    mutationFn: () => api.patch("/api/org", { name, timezone: tz, locale }),
    onSuccess: async () => {
      await s.refresh();
      qc.invalidateQueries({ queryKey: ["org"] });
      toast(t("Kaydedildi"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const del = useMutation({
    mutationFn: () => api.del("/api/org", { confirm: s.org.name }),
    onSuccess: () => {
      qc.clear();
      window.location.href = "/app";
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const changed = name !== s.org.name || tz !== s.org.timezone || locale !== s.org.locale;
  return (
    <>
      <Section title={t("Çalışma alanı")}>
        <fieldset className="plain" disabled={!s.can("admin")}>
          <div className="form">
            <div className="field">
              <label>{t("Ad")}</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label>{t("Saat dilimi")}</label>
                <select className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
                  {TIMEZONES.map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
                <span className="help">{t("Takvim, planlama, çalışma saatleri ve 'sonraki boş saat' bu saat dilimine göre çalışır.")}</span>
              </div>
              <div className="field">
                <label>{t("Varsayılan dil")}</label>
                <select className="select" value={locale} onChange={(e) => setLocale(e.target.value as "tr" | "en")}>
                  <option value="tr">Türkçe</option>
                  <option value="en">English</option>
                </select>
                <span className="help">{t("E-postalar, bildirimler ve AI varsayılanları için.")}</span>
              </div>
            </div>
            <div className="muted small">
              {t("Kısa ad")}: <code>{s.org.slug}</code>
            </div>
            <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={!changed || save.isPending || !name.trim()} onClick={() => save.mutate()}>
              {t("Kaydet")}
            </button>
          </div>
        </fieldset>
      </Section>
      <Can role="owner">
        <div className="card danger-zone">
          <div className="card-title">
            <h2>{t("Tehlikeli bölge")}</h2>
          </div>
          <div className="row-between">
            <div>
              <strong>{t("Çalışma alanını sil")}</strong>
              <div className="muted small">{t("Tüm kanallar, gönderiler, konuşmalar ve medya kalıcı olarak silinir. Geri alınamaz.")}</div>
            </div>
            <button className="btn btn-danger" onClick={() => setDeleting(true)}>
              <Trash2 /> {t("Sil")}
            </button>
          </div>
        </div>
      </Can>
      {deleting && (
        <ConfirmTyped
          title={t("Çalışma alanını sil")}
          text={t("{org} ve içindeki her şey kalıcı olarak silinecek.", { org: s.org.name })}
          expected={s.org.name}
          danger={t("Kalıcı olarak sil")}
          busy={del.isPending}
          onConfirm={() => del.mutate()}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

/* ---------------- Profil ---------------- */

function ProfileTab() {
  const { t, setLocale } = useI18n();
  const s = useSession();
  const toast = useToast();
  const [name, setName] = useState(s.user.name ?? "");
  const [pw, setPw] = useState({ current: "", next: "", next2: "" });
  const saveProfile = useMutation({
    mutationFn: (body: { name?: string | null; locale?: "tr" | "en" }) => api.patch("/api/auth/profile", body),
    onSuccess: async (_r, v) => {
      if (v.locale) setLocale(v.locale);
      await s.refresh();
      toast(t("Kaydedildi"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const changePw = useMutation({
    mutationFn: () => api.post("/api/auth/password", { current: pw.current, next: pw.next }),
    onSuccess: () => {
      toast(t("Şifre değişti. Diğer cihazlardaki oturumlar kapatıldı."), "ok");
      setPw({ current: "", next: "", next2: "" });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <Section title={t("Profil")}>
        <div className="field">
          <label>{t("E-posta")}</label>
          <input className="input" value={s.user.email} disabled />
        </div>
        <div className="field">
          <label>{t("Ad")}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="field">
          <label>{t("Arayüz dili")}</label>
          <select className="select" value={s.user.locale} onChange={(e) => saveProfile.mutate({ locale: e.target.value as "tr" | "en" })}>
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
        </div>
        <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={name === (s.user.name ?? "") || saveProfile.isPending} onClick={() => saveProfile.mutate({ name: name || null })}>
          {t("Kaydet")}
        </button>
      </Section>
      <Section title={t("Şifre değiştir")}>
        <div className="field">
          <label>{t("Mevcut şifre")}</label>
          <input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("Yeni şifre (en az 8)")}</label>
          <input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("Yeni şifre (tekrar)")}</label>
          <input className="input" type="password" autoComplete="new-password" value={pw.next2} onChange={(e) => setPw({ ...pw, next2: e.target.value })} />
        </div>
        {pw.next2 && pw.next !== pw.next2 && <div className="notice notice-err small">{t("Şifreler eşleşmiyor")}</div>}
        <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={!pw.current || pw.next.length < 8 || pw.next !== pw.next2 || changePw.isPending} onClick={() => changePw.mutate()}>
          {t("Güncelle")}
        </button>
      </Section>
    </div>
  );
}

/* ---------------- Marka ---------------- */

function BrandTab() {
  const { t } = useI18n();
  const s = useSession();
  const form = useSettingsForm();
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AiStatus>("/api/ai/status") });
  const v = form.v;
  if (!v) return <Loading />;
  return (
    <>
      <Section title={t("Marka hafızası")} actions={<span className="muted small">{ai.data?.brandSources.length ? t("ek kaynaklar: {s}", { s: ai.data.brandSources.join(", ") }) : ""}</span>}>
        <p className="muted small">{t("Bu bilgiler her AI üretiminin (gönderi metni, DM yanıtı, içerik planı) sistem promptuna eklenir. Ne kadar net yazarsan metinler o kadar senin gibi olur.")}</p>
        <fieldset className="plain" disabled={!s.can("admin")}>
          <div className="form">
            <div className="grid grid-2">
              <div className="field">
                <label>{t("Marka adı")}</label>
                <input className="input" value={v.brandName} onChange={(e) => form.set({ brandName: e.target.value })} maxLength={120} />
              </div>
              <div className="field">
                <label>{t("Ses tonu (3-5 sıfat)")}</label>
                <input className="input" value={v.brandVoice} onChange={(e) => form.set({ brandVoice: e.target.value })} placeholder={t("sıcak, dürüst, bilgili ama ukala değil")} maxLength={500} />
              </div>
            </div>
            <div className="field">
              <label>{t("Hedef kitle")}</label>
              <input className="input" value={v.brandAudience} onChange={(e) => form.set({ brandAudience: e.target.value })} placeholder={t("30-45 yaş, büyük şehir, etiket okuyan aileler")} maxLength={1000} />
            </div>
            <div className="field">
              <label>{t("Teklifler / ürünler (fiyat, kime uygun)")}</label>
              <textarea className="textarea" value={v.brandOffers} onChange={(e) => form.set({ brandOffers: e.target.value })} placeholder={t("- Erken hasat 500ml · 450 TL · hediyelik\n- 5L teneke · 2.900 TL · aile")} maxLength={4000} />
            </div>
            <div className="field">
              <label>{t("Yasak kelimeler / kalıplar")}</label>
              <input className="input" value={v.brandBannedWords} onChange={(e) => form.set({ brandBannedWords: e.target.value })} placeholder={t("kaçırma, son fırsat, efsane, ünlem yağmuru")} maxLength={1000} />
            </div>
            <div className="field">
              <label>{t("Markanın sesinden örnek cümleler")}</label>
              <textarea className="textarea" value={v.brandExamples} onChange={(e) => form.set({ brandExamples: e.target.value })} maxLength={4000} />
            </div>
          </div>
        </fieldset>
      </Section>
      <SaveBar dirty={form.dirty} saving={form.saving} onSave={form.save} onReset={form.reset} />
    </>
  );
}

/* ---------------- AI ---------------- */

const AI_PROVIDERS: Array<{ id: AiProviderKind; label: string }> = [
  { id: "platform", label: "Platform (plana dahil)" },
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Google Gemini" },
  { id: "xai", label: "xAI (Grok)" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "custom", label: "OpenAI uyumlu özel uç nokta" },
];

function AiTab() {
  const { t } = useI18n();
  const s = useSession();
  const toast = useToast();
  const form = useSettingsForm();
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AiStatus>("/api/ai/status") });
  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const [key, setKey] = useState("");
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; detail: string }>("/api/ai/test"),
    onSuccess: (r) => toast(r.detail, r.ok ? "ok" : "err"),
    onError: (e) => toast(errMsg(e), "err"),
  });
  const v = form.v;
  if (!v) return <Loading />;
  const byok = org.data?.usage.plan.features.byokAi;
  const st = ai.data;
  return (
    <>
      <Section
        title={t("AI sağlayıcı")}
        actions={
          st && (
            <span className={`badge ${st.available ? "badge-ok" : "badge-warn"}`}>
              {st.available ? `${st.provider} · ${st.model}` : t("AI kapalı")}
            </span>
          )
        }
      >
        <fieldset className="plain" disabled={!s.can("admin")}>
          <div className="form">
            <div className="field">
              <label>{t("Sağlayıcı")}</label>
              <select className="select" value={v.aiProvider} onChange={(e) => form.set({ aiProvider: e.target.value as AiProviderKind })}>
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id !== "platform" && byok === false}>
                    {t(p.label)}
                    {p.id === "platform" && st && !st.platformAvailable ? ` (${t("tanımlı değil")})` : ""}
                  </option>
                ))}
              </select>
              {byok === false && <span className="help">{t("Kendi AI anahtarını kullanmak mevcut planında yok.")}</span>}
              {v.aiProvider === "platform" && st && <span className="help">{t("Bu ay {u}/{l} AI üretimi kullanıldı.", { u: st.usage.used, l: st.usage.limit ?? "∞" })}</span>}
            </div>
            {v.aiProvider !== "platform" && (
              <>
                <div className="grid grid-2">
                  <div className="field">
                    <label>{t("Model")}</label>
                    <input className="input" value={v.aiModel} onChange={(e) => form.set({ aiModel: e.target.value })} placeholder={st?.defaults[v.aiProvider] ?? ""} />
                    <span className="help">{t("Boş bırakırsan varsayılan: {m}", { m: st?.defaults[v.aiProvider] || "-" })}</span>
                  </div>
                  <div className="field">
                    <label>{t("API anahtarı")}</label>
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(e) => {
                        setKey(e.target.value);
                        form.set({ aiApiKey: e.target.value });
                      }}
                      placeholder={v.aiApiKeySet ? t("•••• kayıtlı (değiştirmek için yaz)") : t("anahtarı yapıştır")}
                    />
                    {v.aiApiKeySet && (
                      <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => form.set({ aiApiKey: "" })}>
                        {t("Kayıtlı anahtarı sil")}
                      </button>
                    )}
                    <span className="help">{t("Şifreli saklanır, bir daha gösterilmez.")}</span>
                  </div>
                </div>
                {(v.aiProvider === "custom" || v.aiProvider === "openrouter") && (
                  <div className="field">
                    <label>{t("Base URL")}</label>
                    <input className="input" value={v.aiBaseUrl} onChange={(e) => form.set({ aiBaseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
                  </div>
                )}
              </>
            )}
            <button className="btn" style={{ alignSelf: "flex-start" }} disabled={form.dirty || test.isPending || !st?.available} onClick={() => test.mutate()}>
              <Bot /> {test.isPending ? t("Deneniyor…") : t("Bağlantıyı test et")}
            </button>
          </div>
        </fieldset>
      </Section>
      <SaveBar
        dirty={form.dirty}
        saving={form.saving}
        onSave={() => {
          form.save();
          setKey("");
        }}
        onReset={() => {
          form.reset();
          setKey("");
        }}
      />
    </>
  );
}

/* ---------------- Yayın ---------------- */

function PublishingTab() {
  const { t } = useI18n();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const form = useSettingsForm();
  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const sigs = useQuery({ queryKey: ["signatures"], queryFn: () => api.get<Signature[]>("/api/signatures") });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/api/tags") });
  const [times, setTimes] = useState<string | null>(null);
  const [sig, setSig] = useState<{ id?: string; name: string; content: string; autoAdd: boolean } | null>(null);
  const onError = (e: unknown) => toast(errMsg(e), "err");
  const saveSig = useMutation({
    mutationFn: () => (sig!.id ? api.patch(`/api/signatures/${sig!.id}`, { name: sig!.name, content: sig!.content, autoAdd: sig!.autoAdd }) : api.post("/api/signatures", { name: sig!.name, content: sig!.content, autoAdd: sig!.autoAdd })),
    onSuccess: () => {
      setSig(null);
      qc.invalidateQueries({ queryKey: ["signatures"] });
    },
    onError,
  });
  const delSig = useMutation({ mutationFn: (id: string) => api.del(`/api/signatures/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["signatures"] }), onError });
  const updTag = useMutation({ mutationFn: ({ id, color }: { id: string; color: string }) => api.patch(`/api/tags/${id}`, { color }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }), onError });
  const delTag = useMutation({ mutationFn: (id: string) => api.del(`/api/tags/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }), onError });
  const v = form.v;
  useEffect(() => {
    if (v && times === null) setTimes(v.defaultPostingTimes.join(", "));
  }, [v, times]);
  if (!v) return <Loading />;
  const approvals = org.data?.usage.plan.features.approvals;
  return (
    <>
      <Section title={t("Yayın kuralları")}>
        <fieldset className="plain" disabled={!s.can("admin")}>
          <div className="form">
            <div className="field">
              <label>{t("Onay akışı")}</label>
              <select className="select" value={v.approvalMode} onChange={(e) => form.set({ approvalMode: e.target.value as OrgSettings["approvalMode"] })}>
                <option value="none">{t("Kapalı: gönderiler doğrudan planlanır")}</option>
                <option value="ai" disabled={approvals === false}>
                  {t("AI/MCP gönderileri onay bekler")}
                </option>
                <option value="all" disabled={approvals === false}>
                  {t("Editörlerin tüm gönderileri onay bekler")}
                </option>
              </select>
              {approvals === false && <span className="help">{t("Onay akışı mevcut planında yok.")}</span>}
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label>{t("Varsayılan paylaşım saatleri")}</label>
                <input
                  className="input"
                  value={times ?? ""}
                  onChange={(e) => {
                    setTimes(e.target.value);
                    form.set({ defaultPostingTimes: e.target.value.split(/[,\s]+/).filter((x) => /^\d{1,2}:\d{2}$/.test(x)) });
                  }}
                  placeholder="10:00, 13:00, 19:00"
                />
                <span className="help">{t("Kendi saati olmayan kanallar için ({tz}).", { tz: s.org.timezone })}</span>
              </div>
              <div className="field">
                <label>{t("Aynı kanalda iki gönderi arası en az (dk)")}</label>
                <input className="input" type="number" min={0} max={1440} value={v.minGapMinutes} onChange={(e) => form.set({ minGapMinutes: Number(e.target.value) })} />
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={v.notifyOnFailureEmail} onChange={(e) => form.set({ notifyOnFailureEmail: e.target.checked })} /> {t("Yayın başarısız olursa sahip ve yöneticilere e-posta gönder")}
            </label>
          </div>
        </fieldset>
      </Section>

      <Section
        title={t("İmzalar")}
        actions={
          <Can role="editor">
            <button className="btn btn-sm" onClick={() => setSig({ name: "", content: "", autoAdd: false })}>
              <Plus /> {t("Yeni imza")}
            </button>
          </Can>
        }
      >
        <p className="muted small">{t("Otomatik işaretli imza yeni gönderilerin sonuna eklenir (gönderi oluştururken kapatılabilir).")}</p>
        <table className="table">
          <tbody>
            {sigs.data?.map((x) => (
              <tr key={x.id}>
                <td>
                  <strong>{x.name}</strong> {x.autoAdd ? <span className="badge badge-accent">{t("otomatik")}</span> : null}
                  <div className="muted small truncate" style={{ maxWidth: 420 }}>
                    {x.content}
                  </div>
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Can role="editor">
                    <button className="btn btn-ghost btn-sm" onClick={() => setSig({ id: x.id, name: x.name, content: x.content, autoAdd: Boolean(x.autoAdd) })}>
                      {t("Düzenle")}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => confirm(t("İmza silinsin mi?")) && delSig.mutate(x.id)} aria-label={t("Sil")}>
                      <Trash2 />
                    </button>
                  </Can>
                </td>
              </tr>
            ))}
            {sigs.data?.length === 0 && (
              <tr>
                <td className="muted">{t("Henüz imza yok.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title={t("Etiketler")}>
        <p className="muted small">{t("Etiketler gönderi oluştururken yazılarak eklenir; burada renklerini düzenleyebilir ya da silebilirsin.")}</p>
        <div className="row">
          {tags.data?.map((x) => (
            <span key={x.id} className="tag" style={{ borderColor: x.color, color: x.color }}>
              <input type="color" className="color-dot" value={x.color} onChange={(e) => updTag.mutate({ id: x.id, color: e.target.value })} aria-label={t("Renk")} disabled={!s.can("editor")} />
              {x.name}
              {s.can("editor") && (
                <button onClick={() => confirm(t("Etiket silinsin mi?")) && delTag.mutate(x.id)} aria-label={t("Sil")}>
                  ×
                </button>
              )}
            </span>
          ))}
          {tags.data?.length === 0 && <span className="muted small">{t("Henüz etiket yok.")}</span>}
        </div>
      </Section>

      <SaveBar dirty={form.dirty} saving={form.saving} onSave={form.save} onReset={() => (form.reset(), setTimes(null))} />

      {sig && (
        <Modal
          title={sig.id ? t("İmzayı düzenle") : t("Yeni imza")}
          onClose={() => setSig(null)}
          footer={
            <>
              <button className="btn" onClick={() => setSig(null)}>
                {t("Vazgeç")}
              </button>
              <button className="btn btn-primary" disabled={!sig.name.trim() || !sig.content.trim() || saveSig.isPending} onClick={() => saveSig.mutate()}>
                {t("Kaydet")}
              </button>
            </>
          }
        >
          <div className="form">
            <div className="field">
              <label>{t("Ad")}</label>
              <input className="input" value={sig.name} onChange={(e) => setSig({ ...sig, name: e.target.value })} maxLength={60} />
            </div>
            <div className="field">
              <label>{t("İçerik")}</label>
              <textarea className="textarea" value={sig.content} onChange={(e) => setSig({ ...sig, content: e.target.value })} maxLength={3000} placeholder={t("🌿 Sipariş için profildeki link\n#markam")} />
            </div>
            <label className="check">
              <input type="checkbox" checked={sig.autoAdd} onChange={(e) => setSig({ ...sig, autoAdd: e.target.checked })} /> {t("Yeni gönderilere otomatik ekle")}
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- Webhook'lar ---------------- */

const EVENT_LABEL: Record<WebhookEvent, string> = {
  "post.published": "Gönderi yayınlandı",
  "post.failed": "Gönderi başarısız",
  "post.partial": "Gönderi kısmen yayınlandı",
  "post.scheduled": "Gönderi planlandı",
  "message.received": "Yeni mesaj",
  "channel.error": "Kanal hatası",
};

function WebhooksTab() {
  const { t } = useI18n();
  const f = useFmt();
  const qc = useQueryClient();
  const toast = useToast();
  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const q = useQuery({ queryKey: ["webhooks"], queryFn: () => api.get<{ events: WebhookEvent[]; items: OutboundWebhook[] }>("/api/webhooks") });
  const [form, setForm] = useState<{ name: string; url: string; events: WebhookEvent[] } | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ["webhooks"] });
  const onError = (e: unknown) => toast(errMsg(e), "err");
  const create = useMutation({ mutationFn: () => api.post("/api/webhooks", form), onSuccess: () => (setForm(null), inv()), onError });
  const toggle = useMutation({ mutationFn: (w: OutboundWebhook) => api.patch(`/api/webhooks/${w.id}`, { enabled: !w.enabled }), onSuccess: inv, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/webhooks/${id}`), onSuccess: inv, onError });
  const test = useMutation({
    mutationFn: (id: string) => api.post<{ status: number | null; error: string | null }>(`/api/webhooks/${id}/test`),
    onSuccess: (r) => {
      toast(r.error ? t("Hata: {e}", { e: r.error.slice(0, 160) }) : t("Yanıt: HTTP {s}", { s: r.status ?? "-" }), r.error ? "err" : "ok");
      inv();
    },
    onError,
  });
  const has = org.data?.usage.plan.features.webhooks;
  return (
    <>
      <FeatureGate feature="webhooks" has={has}>
        <span />
      </FeatureGate>
      <Section
        title={t("Giden webhook'lar")}
        actions={
          <button className="btn btn-sm" disabled={has === false} onClick={() => setForm({ name: "", url: "", events: ["post.published", "post.failed"] })}>
            <Plus /> {t("Yeni webhook")}
          </button>
        }
      >
        <p className="muted small">{t("Olaylar JSON olarak POST edilir. İmza: X-Reblebi-Signature başlığında gizli anahtarla HMAC-SHA256 (eski entegrasyonlar için X-SosyalPilot-Signature da gönderilir). Webhook entegrasyonları, n8n, Make ya da kendi sunucunla kullan.")}</p>
        <table className="table">
          <tbody>
            {q.data?.items.map((w) => (
              <tr key={w.id} style={{ opacity: w.enabled ? 1 : 0.5 }}>
                <td>
                  <strong>{w.name}</strong>
                  <div className="muted small truncate" style={{ maxWidth: 360 }}>
                    {w.url}
                  </div>
                  <div className="small muted">{w.events.map((e) => t(EVENT_LABEL[e] ?? e)).join(" · ")}</div>
                  <div className="small">
                    {t("Gizli anahtar")}: <Copyable text={w.secret} display={`${w.secret.slice(0, 8)}…`} />
                  </div>
                </td>
                <td className="small">
                  {w.lastAt ? (
                    <span style={{ color: w.lastError ? "var(--err)" : "var(--ok)" }}>
                      {w.lastStatus ?? "-"} · {f.ago(w.lastAt)}
                    </span>
                  ) : (
                    <span className="muted">{t("hiç tetiklenmedi")}</span>
                  )}
                  {w.lastError && <div className="small truncate" style={{ color: "var(--err)", maxWidth: 260 }} title={w.lastError}>{w.lastError.slice(0, 160)}</div>}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <label className="check small" style={{ display: "inline-flex" }}>
                    <input type="checkbox" checked={Boolean(w.enabled)} onChange={() => toggle.mutate(w)} /> {t("Açık")}
                  </label>
                  <button className="btn btn-ghost btn-sm" onClick={() => test.mutate(w.id)} disabled={test.isPending} aria-label={t("Test et")}>
                    <Send />
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => confirm(t("Webhook silinsin mi?")) && remove.mutate(w.id)} aria-label={t("Sil")}>
                    <Trash2 />
                  </button>
                </td>
              </tr>
            ))}
            {q.data?.items.length === 0 && (
              <tr>
                <td className="muted">{t("Henüz webhook yok.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
      {form && (
        <Modal
          title={t("Yeni webhook")}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                {t("Vazgeç")}
              </button>
              <button className="btn btn-primary" disabled={!form.name.trim() || !/^https?:\/\//.test(form.url) || !form.events.length || create.isPending} onClick={() => create.mutate()}>
                {t("Oluştur")}
              </button>
            </>
          }
        >
          <div className="form">
            <div className="field">
              <label>{t("Ad")}</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} />
            </div>
            <div className="field">
              <label>URL</label>
              <input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://api.domain.com/webhook/…" />
            </div>
            <div className="field">
              <label>{t("Olaylar")}</label>
              {(q.data?.events ?? (Object.keys(EVENT_LABEL) as WebhookEvent[])).map((e) => (
                <label key={e} className="check small">
                  <input type="checkbox" checked={form.events.includes(e)} onChange={(ev) => setForm({ ...form, events: ev.target.checked ? [...form.events, e] : form.events.filter((x) => x !== e) })} /> {t(EVENT_LABEL[e])} <code>{e}</code>
                </label>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- API / MCP ---------------- */

function ApiTab() {
  const { t } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const sys = useQuery({ queryKey: ["system"], queryFn: () => api.get<SystemInfo>("/api/system") });
  const keys = useQuery({ queryKey: ["keys"], queryFn: () => api.get<ApiKeyRow[]>("/api/org/api-keys"), enabled: s.can("admin") });
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const createKey = useMutation({
    mutationFn: () => api.post<{ key: string }>("/api/org/api-keys", { name: newKeyName }),
    onSuccess: (r) => {
      setCreatedKey(r.key);
      setNewKeyName("");
      qc.invalidateQueries({ queryKey: ["keys"] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const removeKey = useMutation({ mutationFn: (id: string) => api.del(`/api/org/api-keys/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["keys"] }), onError: (e) => toast(errMsg(e), "err") });
  const mcpUrl = sys.data?.mcp.url ?? `${window.location.origin}/mcp`;
  return (
    <>
      {sys.data && !sys.data.mcp.enabled && <div className="notice notice-warn" style={{ marginBottom: 16 }}>{t("MCP erişimi mevcut planında yok.")}</div>}
      <Section title={t("Claude, ChatGPT, Gemini ve Grok'u bağla")}>
        <McpGuide mcpUrl={mcpUrl} appName={sys.data?.appName ?? "Reblebi"} showKeyHint={false} />
      </Section>
      <Can role="admin">
        <Section title={t("API anahtarları")}>
          <p className="muted small">{t("Sunucudan sunucuya entegrasyonlar ve yerel MCP için: Authorization: Bearer sp_... başlığı. Anahtar sadece oluşturulurken gösterilir.")}</p>
          <div className="row">
            <input className="input" style={{ width: 260 }} placeholder={t("Anahtar adı (ör. otomasyon)")} value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} maxLength={60} />
            <button className="btn btn-primary" disabled={!newKeyName || createKey.isPending} onClick={() => createKey.mutate()}>
              <Plus /> {t("Oluştur")}
            </button>
          </div>
          <table className="table">
            <tbody>
              {keys.data?.map((k) => (
                <tr key={k.id}>
                  <td>
                    <KeyRound style={{ width: 14, verticalAlign: "middle", marginRight: 6 }} />
                    <strong>{k.name}</strong> <code>{k.prefix}…</code>
                  </td>
                  <td className="small muted">
                    {t("oluşturuldu {d}", { d: f.day(k.createdAt) })}
                    {k.lastUsedAt ? ` · ${t("son kullanım {d}", { d: f.ago(k.lastUsedAt) })}` : ` · ${t("hiç kullanılmadı")}`}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => confirm(t("Anahtar iptal edilsin mi?")) && removeKey.mutate(k.id)} aria-label={t("İptal et")}>
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
              {keys.data?.length === 0 && (
                <tr>
                  <td className="muted">{t("Henüz anahtar yok.")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Section>
      </Can>
      {createdKey && (
        <Modal
          title={t("Yeni API anahtarı")}
          onClose={() => setCreatedKey(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setCreatedKey(null)}>
              {t("Kaydettim")}
            </button>
          }
        >
          <p className="muted small" style={{ marginBottom: 10 }}>
            {t("Bu anahtar bir daha gösterilmeyecek. Güvenli bir yere kopyala.")}
          </p>
          <Copyable text={createdKey} />
        </Modal>
      )}
    </>
  );
}

/* ---------------- Bağlı AI uygulamaları ---------------- */

function ConnectionsTab() {
  const { t } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["connections"], queryFn: () => api.get<AiConnection[]>("/api/org/connections") });
  const revoke = useMutation({
    mutationFn: (c: AiConnection) => api.del(`/api/org/connections/${encodeURIComponent(c.clientId)}?userId=${encodeURIComponent(c.userId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connections"] }),
    onError: (e) => toast(errMsg(e), "err"),
  });
  return (
    <Section title={t("Bağlı AI uygulamaları")}>
      <p className="muted small">{s.can("admin") ? t("Bu çalışma alanına MCP ile bağlanmış tüm AI uygulamaları.") : t("Senin bağladığın AI uygulamaları.")}</p>
      <table className="table">
        <tbody>
          {q.data?.map((c) => (
            <tr key={`${c.clientId}:${c.userId}`}>
              <td>
                <Bot style={{ width: 14, verticalAlign: "middle", marginRight: 6 }} />
                <strong>{c.clientName}</strong>
                <div className="muted small">{c.email}</div>
              </td>
              <td className="small muted">
                {t("bağlandı {d}", { d: f.day(c.createdAt) })}
                {c.lastUsedAt ? ` · ${t("son kullanım {d}", { d: f.ago(c.lastUsedAt) })}` : ""}
              </td>
              <td style={{ textAlign: "right" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => confirm(t("{app} erişimi kaldırılsın mı?", { app: c.clientName })) && revoke.mutate(c)}>
                  {t("Erişimi kaldır")}
                </button>
              </td>
            </tr>
          ))}
          {q.data?.length === 0 && (
            <tr>
              <td className="muted">{t("Bağlı AI uygulaması yok.")}</td>
            </tr>
          )}
        </tbody>
      </table>
    </Section>
  );
}

/* ---------------- Sistem ---------------- */

function SystemTab() {
  const { t } = useI18n();
  const f = useFmt();
  const s = useSession();
  const q = useQuery({ queryKey: ["system"], queryFn: () => api.get<SystemInfo>("/api/system") });
  const sys = q.data;
  if (!sys) return <Loading />;
  return (
    <>
      <Section title={t("Adresler")} actions={!sys.secure && <span className="badge badge-warn">{t("PUBLIC_URL https değil: OAuth/webhook/medya çekme çalışmaz")}</span>}>
        <dl className="kv">
          <dt>PUBLIC_URL</dt>
          <dd>
            <Copyable text={sys.publicUrl} />
          </dd>
          <dt>{t("Zaman dilimi")}</dt>
          <dd>{sys.timezone}</dd>
          <dt>MCP</dt>
          <dd>
            <Copyable text={sys.mcp.url} />
          </dd>
          {sys.webhooks && (
            <div style={{ display: "contents" }}>
              <dt>{t("Meta webhook URL")}</dt>
              <dd>
                <Copyable text={sys.webhooks.meta.url} />
              </dd>
              <dt>{t("Meta verify token")}</dt>
              <dd>
                <Copyable text={sys.webhooks.meta.verifyToken} />
              </dd>
              <dt>{t("Meta veri silme URL")}</dt>
              <dd>
                <Copyable text={`${sys.publicUrl}/webhooks/meta/data-deletion`} />
              </dd>
              <dt>{t("Meta yetki kaldırma URL")}</dt>
              <dd>
                <Copyable text={`${sys.publicUrl}/webhooks/meta/deauthorize`} />
              </dd>
              <dt>{t("Gizlilik politikası URL")}</dt>
              <dd>
                <Copyable text={`${sys.publicUrl}/privacy`} />
              </dd>
            </div>
          )}
          {Object.entries(sys.oauthRedirects ?? {}).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{t("{p} redirect URI", { p: k })}</dt>
              <dd>
                <Copyable text={v} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="muted small">{t("Meta App > Webhooks: Instagram (messages), Page (messages), WhatsApp (messages) alanlarına abone ol. Redirect URI'ları ilgili geliştirici panellerine ekle. Detay: docs/KURULUM.md")}</p>
      </Section>
      <Section title={t("Platform yapılandırması")}>
        <table className="table">
          <tbody>
            {sys.providers.map((p) => (
              <tr key={p.id}>
                <td style={{ width: 40 }}>
                  <ProviderIcon provider={p.id} size={24} />
                </td>
                <td>
                  <strong>{p.label}</strong>
                  <div className="muted small">
                    {p.connectMode === "oauth" ? "OAuth" : t("Token ile")} · {t("gönderi")} {p.capabilities.post ? "✓" : "–"} · {t("hikaye")} {p.capabilities.story ? "✓" : "–"} · reel {p.capabilities.reel ? "✓" : "–"} · DM{" "}
                    {p.capabilities.dm ? (p.capabilities.inbound === "webhook" ? "webhook" : "polling") : "–"}
                  </div>
                </td>
                <td style={{ textAlign: "right" }}>
                  <span className={`badge ${p.configured ? "badge-ok" : "badge-warn"}`}>{p.configured ? t("hazır") : t(".env eksik")}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      {s.user.isSuperadmin && (
        <Section title={t("Son webhook olayları")}>
          {sys.recentWebhooks.length === 0 ? (
            <p className="muted">{t("Henüz webhook gelmedi.")}</p>
          ) : (
            <table className="table">
              <tbody>
                {sys.recentWebhooks.map((w) => (
                  <tr key={w.id}>
                    <td className="small">{f.date(w.receivedAt)}</td>
                    <td>{w.provider}</td>
                    <td>{w.processed ? <span className="badge badge-ok">{t("işlendi")}</span> : <span className="badge badge-warn">{t("bekliyor")}</span>}</td>
                    <td className="small" style={{ color: "var(--err)" }}>
                      {w.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}
    </>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: "workspace", label: t("Çalışma alanı"), show: true },
    { id: "profile", label: t("Profil"), show: true },
    { id: "brand", label: t("Marka"), show: true },
    { id: "ai", label: "AI", show: true },
    { id: "publishing", label: t("Yayın"), show: true },
    { id: "webhooks", label: "Webhook", show: s.can("admin") },
    { id: "api", label: "API / MCP", show: true },
    { id: "connections", label: t("Bağlantılar"), show: true },
    { id: "system", label: t("Sistem"), show: s.can("admin") },
  ];
  const visible = tabs.filter((x) => x.show);
  const current = (visible.find((x) => x.id === params.get("tab"))?.id ?? "workspace") as Tab;
  return (
    <>
      <PageHead title={t("Ayarlar")} sub={t("Çalışma alanı, profil, marka sesi, AI, yayın kuralları ve entegrasyonlar.")} />
      <div className="tabs" role="tablist">
        {visible.map((x) => (
          <button key={x.id} role="tab" aria-selected={current === x.id} className={`tab ${current === x.id ? "active" : ""}`} onClick={() => setParams({ tab: x.id }, { replace: true })}>
            {x.label}
          </button>
        ))}
      </div>
      {current === "workspace" && <WorkspaceTab />}
      {current === "profile" && <ProfileTab />}
      {current === "brand" && <BrandTab />}
      {current === "ai" && <AiTab />}
      {current === "publishing" && <PublishingTab />}
      {current === "webhooks" && <WebhooksTab />}
      {current === "api" && <ApiTab />}
      {current === "connections" && <ConnectionsTab />}
      {current === "system" && <SystemTab />}
    </>
  );
}
