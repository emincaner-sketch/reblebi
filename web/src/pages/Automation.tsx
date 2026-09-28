import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";
import { api, DM_PROVIDERS, errMsg, PROVIDER_NAME, type Channel, type OrgInfo, type OrgSettings, type ProviderId, type Rule } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Can, Empty, FeatureGate, Modal, PageHead, ProviderIcon, useToast } from "../components/ui";

type Editing = Omit<Rule, "id"> & { id?: string };

const EMPTY_RULE: Omit<Rule, "id"> = {
  name: "",
  enabled: 1,
  channelId: null,
  provider: null,
  matchType: "keyword",
  pattern: "",
  replyMode: "template",
  replyText: "",
  aiInstructions: "",
  priority: 100,
  cooldownMinutes: 60,
  onlyBusinessHours: 0,
  handoffToHuman: 0,
};

export default function AutomationPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t, locale } = useI18n();
  const s = useSession();
  const DAYS = locale === "en" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const MATCH_LABEL: Record<Rule["matchType"], string> = { keyword: t("Anahtar kelime"), regex: "Regex", first_contact: t("İlk temas"), any: t("Her mesaj") };
  const TEMPLATES: Array<{ label: string; rule: Partial<Omit<Rule, "id">> }> = [
    { label: t("Hoş geldin (ilk mesaj)"), rule: { name: t("Hoş geldin"), matchType: "first_contact", replyText: t("Merhaba {{name}}! Mesajın için teşekkürler, en kısa sürede dönüş yapıyoruz."), priority: 50, cooldownMinutes: 0 } },
    { label: t("Fiyat sorusu"), rule: { name: t("Fiyat"), matchType: "keyword", pattern: t("fiyat, ücret, kaç para, ne kadar"), replyText: t("Merhaba {{name}}, güncel fiyat listemiz: [buraya linkini koy]. Detay istersen yazman yeterli."), priority: 20 } },
    { label: t("Kargo / teslimat"), rule: { name: t("Kargo"), matchType: "keyword", pattern: t("kargo, teslimat, ne zaman gelir, takip"), replyText: t("Siparişler 1-3 iş günü içinde kargoya verilir. Sipariş numaranı yazarsan hemen kontrol edelim."), priority: 30 } },
    { label: t("AI ile yanıtla (satış soruları)"), rule: { name: t("AI satış asistanı"), matchType: "keyword", pattern: t("ürün, stok, beden, renk, sipariş"), replyMode: "ai", aiInstructions: t("Ürün sorularını nazikçe yanıtla; kesin bilgi yoksa ekibin döneceğini söyle."), priority: 40 } },
    { label: t("Şikayet → insana devret"), rule: { name: t("Şikayet"), matchType: "keyword", pattern: t("şikayet, iade, bozuk, kırık, memnun değil"), replyText: t("Üzgünüz {{name}}. Konuyu hemen ilgili arkadaşımıza iletiyoruz, kısa sürede seninle iletişime geçecek."), handoffToHuman: 1, priority: 5 } },
  ];

  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api.get<Rule[]>("/api/rules") });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<OrgSettings>("/api/settings") });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<OrgSettings | null>(null);
  const features = org.data?.usage.plan.features;
  const isAdmin = s.can("admin");

  const sv = form ?? settings.data;
  const onError = (e: unknown) => toast(errMsg(e), "err");

  const saveRule = useMutation({
    mutationFn: (r: Editing) => {
      const { id, ...rest } = r;
      return id ? api.put(`/api/rules/${id}`, rest) : api.post("/api/rules", rest);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      setEditing(null);
      toast(t("Kural kaydedildi"), "ok");
    },
    onError,
  });
  const toggleRule = useMutation({ mutationFn: (r: Rule) => api.put(`/api/rules/${r.id}`, { enabled: r.enabled ? 0 : 1 }), onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }), onError });
  const removeRule = useMutation({ mutationFn: (id: string) => api.del(`/api/rules/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }), onError });
  const saveSettings = useMutation({
    mutationFn: (v: OrgSettings) =>
      api.put<OrgSettings>("/api/settings", {
        aiAutoReplyFallback: v.aiAutoReplyFallback,
        aiReplyInstructions: v.aiReplyInstructions,
        welcomeMessage: v.welcomeMessage,
        handoffKeywords: v.handoffKeywords,
        replyDelaySeconds: v.replyDelaySeconds,
        businessHoursEnabled: v.businessHoursEnabled,
        businessHoursStart: v.businessHoursStart,
        businessHoursEnd: v.businessHoursEnd,
        businessDays: v.businessDays,
        outsideHoursMessage: v.outsideHoursMessage,
      }),
    onSuccess: (r) => {
      qc.setQueryData(["settings"], r);
      setForm(null);
      toast(t("Ayarlar kaydedildi"), "ok");
    },
    onError,
  });

  const upd = (patch: Partial<OrgSettings>) => sv && setForm({ ...sv, ...patch });

  return (
    <>
      <PageHead
        title={t("Otomasyon")}
        sub={t("DM oto-yanıt kuralları, çalışma saatleri ve AI yedek yanıt. Kurallar öncelik sırasıyla denenir; ilk eşleşen kazanır.")}
        actions={
          <Can role="admin">
            <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_RULE })} disabled={features?.inbox === false}>
              <Plus /> {t("Yeni kural")}
            </button>
          </Can>
        }
      />
      <FeatureGate feature="inbox" has={features?.inbox}>
        <span />
      </FeatureGate>

      <div className="grid grid-2" style={{ alignItems: "start", marginTop: 12 }}>
        <div>
          <div className="card">
            <div className="card-title">
              <h2>{t("Kurallar")}</h2>
              <span className="muted small">{t("{n} kural", { n: rules.data?.length ?? 0 })}</span>
            </div>
            {rules.data?.length === 0 ? (
              <Empty icon={<Zap />} title={t("Henüz kural yok")} text={t("Şablonlardan başla ya da yeni kural oluştur.")} />
            ) : (
              <table className="table">
                <tbody>
                  {rules.data?.map((r) => (
                    <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                      <td style={{ width: 40 }}>
                        <label className="check">
                          <input type="checkbox" checked={Boolean(r.enabled)} disabled={!isAdmin} onChange={() => toggleRule.mutate(r)} aria-label={t("Aç/kapat")} />
                        </label>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>
                          {r.name} <span className="muted small">#{r.priority}</span>
                        </div>
                        <div className="small muted">
                          {MATCH_LABEL[r.matchType]}
                          {r.pattern ? `: ${r.pattern}` : ""} → {r.replyMode === "ai" ? t("AI yanıt") : t("Şablon")}
                          {r.handoffToHuman ? ` · ${t("insana devret")}` : ""}
                          {r.onlyBusinessHours ? ` · ${t("mesai içi")}` : ""}
                          {r.provider ? ` · ${PROVIDER_NAME[r.provider]}` : ""}
                          {r.channelId ? ` · ${channels.data?.find((c) => c.id === r.channelId)?.name ?? t("kanal")}` : ""}
                        </div>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Can role="admin">
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...r })} aria-label={t("Düzenle")}>
                            <Pencil />
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => confirm(t("Kural silinsin mi?")) && removeRule.mutate(r.id)} aria-label={t("Sil")}>
                            <Trash2 />
                          </button>
                        </Can>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Can role="admin">
            <div className="card">
              <div className="card-title">
                <h2>{t("Hazır şablonlar")}</h2>
              </div>
              <div className="row">
                {TEMPLATES.map((tp) => (
                  <button key={tp.label} className="btn btn-sm" disabled={features?.inbox === false || (tp.rule.replyMode === "ai" && features?.aiReplies === false)} onClick={() => setEditing({ ...EMPTY_RULE, ...tp.rule })}>
                    <Plus /> {tp.label}
                  </button>
                ))}
              </div>
            </div>
          </Can>
        </div>

        {sv && (
          <div className="card form">
            <div className="card-title">
              <h2>{t("Genel davranış")}</h2>
              {form && isAdmin && (
                <button className="btn btn-primary btn-sm" onClick={() => saveSettings.mutate(form)} disabled={saveSettings.isPending}>
                  {t("Kaydet")}
                </button>
              )}
            </div>
            <fieldset disabled={!isAdmin} className="plain">
              <div className="form">
                <label className="check">
                  <input type="checkbox" checked={sv.aiAutoReplyFallback} disabled={features?.aiReplies === false} onChange={(e) => upd({ aiAutoReplyFallback: e.target.checked })} />
                  <span>
                    <strong>{t("AI yedek yanıt")}</strong> <span className="muted small">— {t("hiçbir kural eşleşmezse AI marka sesiyle yanıtlar")}</span>
                  </span>
                </label>
                {features?.aiReplies === false && <span className="help">{t("AI DM yanıtları mevcut planında yok.")}</span>}
                <div className="field">
                  <label>{t("AI yanıt talimatı")}</label>
                  <textarea className="textarea" style={{ minHeight: 80 }} value={sv.aiReplyInstructions} onChange={(e) => upd({ aiReplyInstructions: e.target.value })} />
                </div>
                <div className="field">
                  <label>{t("Hoş geldin mesajı (kural yoksa ilk temasta)")}</label>
                  <input className="input" value={sv.welcomeMessage} onChange={(e) => upd({ welcomeMessage: e.target.value })} placeholder={t("Boş bırakılırsa gönderilmez. {{name}} kullanılabilir.")} />
                </div>
                <div className="field">
                  <label>{t("İnsana devretme anahtar kelimeleri")}</label>
                  <input className="input" value={sv.handoffKeywords} onChange={(e) => upd({ handoffKeywords: e.target.value })} />
                  <span className="help">{t("Bu kelimeler geçince konuşma manuel moda alınır ve dikkat bayrağı kalkar.")}</span>
                </div>
                <div className="field">
                  <label>{t("Yanıt gecikmesi (saniye)")}</label>
                  <input className="input" type="number" min={0} max={60} style={{ width: 120 }} value={sv.replyDelaySeconds} onChange={(e) => upd({ replyDelaySeconds: Number(e.target.value) })} />
                </div>
                <div className="divider" />
                <label className="check">
                  <input type="checkbox" checked={sv.businessHoursEnabled} onChange={(e) => upd({ businessHoursEnabled: e.target.checked })} />
                  <strong>{t("Çalışma saatleri")}</strong>
                </label>
                <div className="row">
                  <input className="input" type="time" style={{ width: 120 }} value={sv.businessHoursStart} onChange={(e) => upd({ businessHoursStart: e.target.value })} aria-label={t("Başlangıç")} />
                  <span className="muted">–</span>
                  <input className="input" type="time" style={{ width: 120 }} value={sv.businessHoursEnd} onChange={(e) => upd({ businessHoursEnd: e.target.value })} aria-label={t("Bitiş")} />
                  <span className="muted small">{s.org.timezone}</span>
                </div>
                <div className="row">
                  {DAYS.map((d, i) => (
                    <label key={i} className="check small">
                      <input type="checkbox" checked={sv.businessDays.includes(i)} onChange={(e) => upd({ businessDays: e.target.checked ? [...sv.businessDays, i].sort((a, b) => a - b) : sv.businessDays.filter((x) => x !== i) })} /> {d}
                    </label>
                  ))}
                </div>
                <div className="field">
                  <label>{t("Mesai dışı mesajı")}</label>
                  <textarea className="textarea" style={{ minHeight: 70 }} value={sv.outsideHoursMessage} onChange={(e) => upd({ outsideHoursMessage: e.target.value })} />
                </div>
                {form && (
                  <button className="btn btn-primary" onClick={() => saveSettings.mutate(form)} disabled={saveSettings.isPending}>
                    {t("Ayarları kaydet")}
                  </button>
                )}
              </div>
            </fieldset>
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing.id ? t("Kuralı düzenle") : t("Yeni kural")}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                {t("Vazgeç")}
              </button>
              <button className="btn btn-primary" disabled={!editing.name || saveRule.isPending} onClick={() => saveRule.mutate(editing)}>
                {t("Kaydet")}
              </button>
            </>
          }
        >
          <div className="form">
            <div className="grid grid-2">
              <div className="field">
                <label>{t("Ad")}</label>
                <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="field">
                <label>{t("Öncelik (küçük önce)")}</label>
                <input className="input" type="number" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) })} />
              </div>
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label>{t("Eşleşme")}</label>
                <select className="select" value={editing.matchType} onChange={(e) => setEditing({ ...editing, matchType: e.target.value as Rule["matchType"] })}>
                  {(Object.keys(MATCH_LABEL) as Rule["matchType"][]).map((k) => (
                    <option key={k} value={k}>
                      {MATCH_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              {(editing.matchType === "keyword" || editing.matchType === "regex") && (
                <div className="field">
                  <label>{editing.matchType === "keyword" ? t("Kelimeler (virgülle)") : t("Regex deseni")}</label>
                  <input className="input" value={editing.pattern ?? ""} onChange={(e) => setEditing({ ...editing, pattern: e.target.value })} placeholder={editing.matchType === "keyword" ? t("fiyat, ücret") : "(fiyat|ücret)\\b"} />
                </div>
              )}
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label>{t("Platform (boş = hepsi)")}</label>
                <select className="select" value={editing.provider ?? ""} onChange={(e) => setEditing({ ...editing, provider: (e.target.value || null) as ProviderId | null })}>
                  <option value="">{t("Tümü")}</option>
                  {DM_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_NAME[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t("Kanal (boş = hepsi)")}</label>
                <select className="select" value={editing.channelId ?? ""} onChange={(e) => setEditing({ ...editing, channelId: e.target.value || null })}>
                  <option value="">{t("Tümü")}</option>
                  {channels.data
                    ?.filter((c) => DM_PROVIDERS.includes(c.provider))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>{t("Yanıt biçimi")}</label>
              <div className="segmented">
                <button className={editing.replyMode === "template" ? "active" : ""} onClick={() => setEditing({ ...editing, replyMode: "template" })}>
                  {t("Şablon metin")}
                </button>
                <button className={editing.replyMode === "ai" ? "active" : ""} disabled={features?.aiReplies === false} onClick={() => setEditing({ ...editing, replyMode: "ai" })}>
                  {t("AI üretsin")}
                </button>
              </div>
            </div>
            {editing.replyMode === "template" ? (
              <div className="field">
                <label>{t("Yanıt metni")}</label>
                <textarea className="textarea" value={editing.replyText ?? ""} onChange={(e) => setEditing({ ...editing, replyText: e.target.value })} />
                <span className="help">{t("Değişkenler: {{name}} müşteri adı, {{kanal}} kanal adı. Boş bırakılırsa yanıt gönderilmez (sadece devretme için kullanılabilir).")}</span>
              </div>
            ) : (
              <div className="field">
                <label>{t("AI talimatı")}</label>
                <textarea className="textarea" value={editing.aiInstructions ?? ""} onChange={(e) => setEditing({ ...editing, aiInstructions: e.target.value })} placeholder={t("Örn. Fiyat sorulursa 500ml 450 TL, 1L 800 TL de; kargo ücretsiz.")} />
              </div>
            )}
            <div className="grid grid-3">
              <div className="field">
                <label>{t("Tekrar aralığı (dk)")}</label>
                <input className="input" type="number" value={editing.cooldownMinutes} onChange={(e) => setEditing({ ...editing, cooldownMinutes: Number(e.target.value) })} />
              </div>
              <label className="check" style={{ marginTop: 22 }}>
                <input type="checkbox" checked={Boolean(editing.onlyBusinessHours)} onChange={(e) => setEditing({ ...editing, onlyBusinessHours: e.target.checked ? 1 : 0 })} /> {t("Sadece mesai içinde")}
              </label>
              <label className="check" style={{ marginTop: 22 }}>
                <input type="checkbox" checked={Boolean(editing.handoffToHuman)} onChange={(e) => setEditing({ ...editing, handoffToHuman: e.target.checked ? 1 : 0 })} /> {t("Sonra insana devret")}
              </label>
            </div>
            <div className="row small muted">
              {DM_PROVIDERS.map((p) => (
                <ProviderIcon key={p} provider={p} size={14} />
              ))}{" "}
              {t("DM destekleyen platformlarda çalışır.")}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
