import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Clock, Tag, X } from "lucide-react";
import { api, errMsg } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useFmt, useSession } from "../../lib/session";
import { useToast } from "../../components/ui";

/** Sunucudaki ContactView ile aynı */
interface ContactView {
  conversationId: string;
  participantId: string;
  name: string | null;
  tags: string[];
  fields: Record<string, string>;
  optedOutAt: string | null;
  optedOutReason: string | null;
  metaWindow: boolean;
  lastUserMessageAt: string | null;
  windowOpenUntil: string | null;
  humanAgentUntil: string | null;
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

function hoursLeft(iso: string | null, now: number): number {
  return iso ? Math.max(0, (new Date(iso).getTime() - now) / 3600_000) : 0;
}

/** Konuşmanın üstünde kişi kartı: mesajlaşma penceresi, çıkış durumu, etiketler, seviye ve e-posta */
export function ContactCard({ conversationId }: { conversationId: string }) {
  const { t } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [email, setEmail] = useState("");
  const key = ["contact", conversationId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<ContactView>(`/api/inbox/conversations/${conversationId}/contact`), refetchInterval: 30_000 });
  const c = q.data;
  useEffect(() => setEmail(c?.fields.eposta ?? ""), [c?.fields.eposta]);

  const save = useMutation({
    mutationFn: (body: { tags?: string[]; fields?: Record<string, string>; optedOut?: boolean }) => api.put<ContactView>(`/api/inbox/conversations/${conversationId}/contact`, body),
    onSuccess: (r) => qc.setQueryData(key, r),
    onError: (e) => toast(errMsg(e), "err"),
  });

  if (!c) return null;
  const now = Date.now();
  const left = hoursLeft(c.windowOpenUntil, now);
  const humanLeft = hoursLeft(c.humanAgentUntil, now);
  const canEdit = s.can("editor");
  const setField = (k: string, v: string) => save.mutate({ fields: { ...c.fields, [k]: v } });
  const addTag = () => {
    const v = tagInput.trim();
    if (!v) return;
    save.mutate({ tags: [...c.tags, v] });
    setTagInput("");
  };

  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "8px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {c.metaWindow &&
          (left > 0 ? (
            <span className="badge badge-ok small" title={c.lastUserMessageAt ? t("Son mesaj: {d}", { d: f.short(c.lastUserMessageAt) }) : undefined}>
              <Clock style={{ width: 12 }} /> {t("Pencere açık · {h} sa kaldı", { h: Math.floor(left) })}
            </span>
          ) : humanLeft > 0 ? (
            <span className="badge badge-warn small" title={t("Otomatik mesaj gitmez; insan cevabı HUMAN_AGENT etiketiyle gider.")}>
              <Clock style={{ width: 12 }} /> {t("Yalnızca insan cevabı · {d} gün kaldı", { d: Math.ceil(humanLeft / 24) })}
            </span>
          ) : (
            <span className="badge badge-err small" title={t("Kişi yeniden yazana kadar mesaj gönderilemez.")}>
              <Clock style={{ width: 12 }} /> {t("Mesaj penceresi kapalı")}
            </span>
          ))}
        {c.optedOutAt && (
          <span className="badge badge-err small" title={c.optedOutReason ?? undefined}>
            <BellOff style={{ width: 12 }} /> {t("Otomatik mesajları durdurdu")}
          </span>
        )}
        {c.fields.seviye && <span className="badge badge-info small">{c.fields.seviye}</span>}
        {c.tags.map((tag) => (
          <span key={tag} className="badge small">
            <Tag style={{ width: 11 }} /> {tag}
          </span>
        ))}
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t("Kişi kartını gizle") : t("Kişi kartı")}
        </button>
      </div>

      {open && (
        <div className="grid grid-2" style={{ gap: 10 }}>
          <div className="field">
            <label>{t("Etiketler")}</label>
            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              {c.tags.map((tag) => (
                <span key={tag} className="badge small">
                  {tag}
                  {canEdit && (
                    <button className="btn btn-ghost btn-icon" style={{ padding: 0, height: 16, width: 16 }} onClick={() => save.mutate({ tags: c.tags.filter((x) => x !== tag) })} aria-label={t("Etiketi kaldır: {t}", { t: tag })}>
                      <X style={{ width: 11 }} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {canEdit && (
              <input
                className="input"
                value={tagInput}
                maxLength={40}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                onBlur={addTag}
                placeholder={t("Etiket ekle, Enter'a bas")}
                aria-label={t("Etiket ekle")}
              />
            )}
          </div>
          <div className="field">
            <label>{t("Seviye")}</label>
            <select className="input" value={c.fields.seviye ?? ""} disabled={!canEdit} onChange={(e) => setField("seviye", e.target.value)}>
              <option value="">{t("Bilinmiyor")}</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t("E-posta")}</label>
            <input
              className="input"
              type="email"
              value={email}
              disabled={!canEdit}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => email !== (c.fields.eposta ?? "") && setField("eposta", email)}
              placeholder="ornek@eposta.com"
            />
          </div>
          <div className="field">
            <label>{t("Otomatik mesajlar")}</label>
            <label className="check">
              <input type="checkbox" checked={!c.optedOutAt} disabled={!canEdit || save.isPending} onChange={(e) => save.mutate({ optedOut: !e.target.checked })} />{" "}
              {c.optedOutAt ? t("Durduruldu ({d})", { d: f.short(c.optedOutAt) }) : t("Açık")}
            </label>
            <span className="help">{t("Kişi \"durdur\" ya da \"stop\" yazınca kapanır. Yalnızca kişi isterse yeniden aç.")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
