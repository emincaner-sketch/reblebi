import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Hash, Pencil, PenSquare, Plus, Trash2 } from "lucide-react";
import { api, errMsg, type Media } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Empty, PageHead, useLocalState, useToast } from "../components/ui";

export interface LibraryItem {
  id: string;
  type: "post" | "hashtags";
  name: string;
  kind: "post" | "story" | "reel" | "video" | "thread";
  content: string;
  mediaIds: string[];
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

type Draft = { id?: string; type: "post" | "hashtags"; name: string; content: string };

/** Gönderi kütüphanesi (Metricool "Posts library"): şablonlar ve hashtag grupları */
export default function LibraryPage() {
  const { t } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useLocalState<"post" | "hashtags">("sp_library_tab", "post");
  const [draft, setDraft] = useState<Draft | null>(null);
  const items = useQuery({ queryKey: ["library"], queryFn: () => api.get<LibraryItem[]>("/api/library") });
  const media = useQuery({ queryKey: ["media"], queryFn: () => api.get<Media[]>("/api/media") });
  const mediaMap = new Map((media.data ?? []).map((m) => [m.id, m]));
  const canEdit = s.can("editor");
  const list = (items.data ?? []).filter((x) => x.type === tab);

  const save = useMutation({
    mutationFn: (d: Draft) => (d.id ? api.patch<LibraryItem>(`/api/library/${d.id}`, { name: d.name, content: d.content }) : api.post<LibraryItem>("/api/library", d)),
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["library"] });
      toast(t("Kaydedildi"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/library/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }), onError: (e) => toast(errMsg(e), "err") });

  return (
    <>
      <PageHead
        title={t("Kütüphane")}
        sub={t("Sık kullandığın gönderileri şablon, hashtag'leri grup olarak sakla; düzenleyicide tek tıkla ekle.")}
        actions={
          canEdit && (
            <button className="btn btn-primary" onClick={() => setDraft({ type: tab, name: "", content: "" })}>
              <Plus aria-hidden="true" /> {tab === "post" ? t("Yeni şablon") : t("Yeni hashtag grubu")}
            </button>
          )
        }
      />
      <div className="tabs" role="tablist" aria-label={t("Bölüm")} style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={tab === "post"} className={`tab ${tab === "post" ? "active" : ""}`} onClick={() => setTab("post")}>
          {t("Gönderi şablonları")}
        </button>
        <button role="tab" aria-selected={tab === "hashtags"} className={`tab ${tab === "hashtags" ? "active" : ""}`} onClick={() => setTab("hashtags")}>
          {t("Hashtag grupları")}
        </button>
      </div>

      {draft && (
        <form
          className="card form"
          style={{ marginBottom: 16, maxWidth: 720 }}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          <div className="field">
            <label htmlFor="lib-name">{t("Ad")}</label>
            <input id="lib-name" className="input" value={draft.name} maxLength={120} required autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="lib-content">{draft.type === "post" ? t("Metin") : t("Hashtag'ler")}</label>
            <textarea
              id="lib-content"
              className="textarea"
              style={{ minHeight: draft.type === "post" ? 160 : 90 }}
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder={draft.type === "post" ? t("Şablon metni") : "#leblebi #kuruyemiş #yerelüretim"}
            />
            {draft.type === "hashtags" && <span className="help">{t("Boşluk ya da virgülle ayır; # yazmasan da eklenir. En fazla 60.")}</span>}
            {draft.type === "post" && !draft.id && <span className="help">{t("Medyalı şablonu düzenleyicide \"Kütüphaneye kaydet\" ile oluşturabilirsin.")}</span>}
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={save.isPending || !draft.name.trim() || !draft.content.trim()}>
              {t("Kaydet")}
            </button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              {t("Vazgeç")}
            </button>
          </div>
        </form>
      )}

      {items.isLoading ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : !list.length ? (
        <div className="card">
          <Empty
            icon={tab === "post" ? <BookMarked /> : <Hash />}
            title={tab === "post" ? t("Henüz şablon yok") : t("Henüz hashtag grubu yok")}
            text={tab === "post" ? t("Düzenleyicide bir gönderiyi \"Kütüphaneye kaydet\" ile şablon yapabilir ya da buradan yazabilirsin.") : t("Markana, kampanyana ya da konuna göre hashtag gruplarını bir kez yaz, her gönderide tekrar kullan.")}
          />
        </div>
      ) : (
        <ul className="lib-grid">
          {list.map((it) => (
            <li key={it.id} className="card lib-item">
              <div className="row-between" style={{ gap: 8 }}>
                <strong className="truncate">{it.name}</strong>
                {it.type === "post" && <span className="badge">{L.kind(it.kind)}</span>}
              </div>
              {it.mediaIds.length > 0 && (
                <div className="lib-media">
                  {it.mediaIds.slice(0, 4).map((mid) => {
                    const m = mediaMap.get(mid);
                    return m?.kind === "image" ? <img key={mid} src={m.url} alt="" /> : <span key={mid} className="lib-media-x">{m?.kind === "video" ? "▶" : "?"}</span>;
                  })}
                </div>
              )}
              <p className={`lib-text ${it.type === "hashtags" ? "lib-tags" : ""}`}>{it.content || t("(metin yok)")}</p>
              <div className="row-between small muted">
                <span>{t("{n} kez kullanıldı", { n: it.useCount })} · {f.day(it.updatedAt)}</span>
                <span className="row" style={{ gap: 2 }}>
                  {it.type === "post" && (
                    <Link className="btn btn-ghost btn-sm" to={`/app/posts/new?template=${it.id}`} title={t("Bu şablonla gönderi oluştur")} aria-label={t("Bu şablonla gönderi oluştur")}>
                      <PenSquare />
                    </Link>
                  )}
                  {canEdit && (
                    <>
                      <button className="btn btn-ghost btn-sm" title={t("Düzenle")} aria-label={t("Düzenle")} onClick={() => setDraft({ id: it.id, type: it.type, name: it.name, content: it.content })}>
                        <Pencil />
                      </button>
                      <button className="btn btn-ghost btn-sm" title={t("Sil")} aria-label={t("Sil")} onClick={() => confirm(t("\"{name}\" silinsin mi?", { name: it.name })) && remove.mutate(it.id)}>
                        <Trash2 />
                      </button>
                    </>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
