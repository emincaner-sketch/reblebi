import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Loading, Modal, useToast } from "../components/ui";
import { copyText } from "../lib/clipboard";

interface KeyFieldInfo {
  id: string;
  label: string;
  secret: boolean;
  set: boolean;
  source: "none" | "env" | "panel";
  preview: string;
}
interface Guide {
  id: string;
  label: string;
  unlocks: string[];
  portalUrl: string;
  portalLabel: string;
  redirects: string[];
  scopes: string;
  steps: string[];
  reviewNote: string;
  fields: KeyFieldInfo[];
  configured: boolean;
}

/** Kanal sağlayıcı kimliğinden uygulama anahtarı grubuna */
export const PLATFORM_GROUP: Record<string, string> = { x: "x", tiktok: "tiktok", youtube: "google", gmb: "google", linkedin: "linkedin", instagram: "meta", facebook: "meta", whatsapp: "meta", threads: "threads" };

function CopyRow({ value }: { value: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <div className="row" style={{ gap: 8, alignItems: "center" }}>
      <code className="small" style={{ flex: 1, wordBreak: "break-all", padding: "6px 8px", background: "var(--bg-soft, rgba(0,0,0,.05))", borderRadius: 6 }}>
        {value}
      </code>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={t("Kopyala")}
        onClick={() => copyText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })}
      >
        {done ? <Check /> : <Copy />}
      </button>
    </div>
  );
}

function GuideBody({ g }: { g: Guide }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [vals, setVals] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put<Guide>(`/api/admin/platform-keys/${g.id}`, Object.fromEntries(Object.entries(vals).filter(([, v]) => v.trim()))),
    onSuccess: () => {
      setVals({});
      qc.invalidateQueries({ queryKey: ["platform-keys"] });
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["system"] });
      toast(t("Anahtarlar kaydedildi"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const reset = useMutation({
    mutationFn: () => api.put<Guide>(`/api/admin/platform-keys/${g.id}`, Object.fromEntries(g.fields.map((f) => [f.id, null]))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-keys"] });
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["system"] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  return (
    <div className="setup-guide">
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span className={`badge ${g.configured ? "badge-ok" : ""}`}>{g.configured ? t("Hazır") : t("Anahtar bekleniyor")}</span>
        {g.unlocks.map((u) => (
          <span key={u} className="badge">
            {u}
          </span>
        ))}
      </div>

      <ol className="setup-steps">
        {g.steps.map((s, i) => (
          <li key={i}>{t(s)}</li>
        ))}
      </ol>

      <a className="btn btn-sm" href={g.portalUrl} target="_blank" rel="noreferrer" style={{ margin: "6px 0 12px" }}>
        <ExternalLink /> {t(g.portalLabel)}
      </a>

      <div className="field">
        <label>{g.redirects.length > 1 ? t("Geri dönüş (redirect) adresleri") : t("Geri dönüş (redirect) adresi")}</label>
        <div style={{ display: "grid", gap: 6 }}>
          {g.redirects.map((r) => (
            <CopyRow key={r} value={r} />
          ))}
        </div>
      </div>
      <div className="field">
        <label>{t("İstenen izinler")}</label>
        <CopyRow value={g.scopes} />
      </div>

      <form
        className="form"
        style={{ marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {g.fields.map((f) => (
          <div className="field" key={f.id}>
            <label>
              {f.label}
              {f.set && (
                <span className="muted small" style={{ marginLeft: 8 }}>
                  {f.source === "panel" ? t("panelden girildi") : t("sunucudan (.env)")} · {f.preview}
                </span>
              )}
            </label>
            <input
              className="input"
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              value={vals[f.id] ?? ""}
              placeholder={f.set ? t("Değiştirmek için yeni değer yaz") : ""}
              onChange={(e) => setVals({ ...vals, [f.id]: e.target.value })}
            />
          </div>
        ))}
        <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
          <span className="muted small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <ShieldCheck style={{ width: 14 }} /> {t("Gizli değerler şifrelenerek saklanır ve bir daha gösterilmez.")}
          </span>
          <span className="row" style={{ gap: 8 }}>
            {g.fields.some((f) => f.source === "panel") && (
              <button type="button" className="btn btn-ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
                {t("Panel değerlerini sil")}
              </button>
            )}
            <button className="btn btn-primary" disabled={save.isPending || !Object.values(vals).some((v) => v.trim())}>
              {save.isPending ? t("Kaydediliyor…") : t("Kaydet")}
            </button>
          </span>
        </div>
      </form>
      <p className="muted small" style={{ marginTop: 12 }}>
        {t(g.reviewNote)}
      </p>
    </div>
  );
}

/** Yapılandırılmamış bir platformun kurulum rehberi; platform sahibi (süper yönetici) anahtarları buradan girer */
export function PlatformSetupModal({ initial, onClose }: { initial: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const s = useSession();
  const isOwner = s.user.isSuperadmin;
  const guides = useQuery({ queryKey: ["platform-keys"], queryFn: () => api.get<Guide[]>("/api/admin/platform-keys"), enabled: isOwner });
  const [sel, setSel] = useState(initial ?? "x");

  if (!isOwner) {
    return (
      <Modal title={t("Bu platform henüz açılmadı")} onClose={onClose}>
        <p>{t("Bu entegrasyon için platform yöneticisinin uygulama anahtarlarını girmesi gerekiyor. Yöneticiye bu kanalı istediğini ilet; anahtarlar girildiği anda buradan bağlayabilirsin.")}</p>
      </Modal>
    );
  }
  const g = guides.data?.find((x) => x.id === sel);
  return (
    <Modal
      large
      title={
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <KeyRound style={{ width: 18 }} /> {t("Platform kurulumu")}
        </span>
      }
      onClose={onClose}
    >
      {guides.isLoading || !guides.data ? (
        <Loading />
      ) : (
        <>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {guides.data.map((x) => (
              <button key={x.id} className={`btn btn-sm ${x.id === sel ? "btn-primary" : ""}`} onClick={() => setSel(x.id)}>
                {x.configured && <Check />} {x.label}
              </button>
            ))}
          </div>
          {g && <GuideBody key={g.id} g={g} />}
        </>
      )}
    </Modal>
  );
}
