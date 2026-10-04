import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image, ImagePlus, Link2, Trash2 } from "lucide-react";
import { api, errMsg, type Media, type OrgInfo } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useFmt } from "../lib/session";
import { Can, Copyable, Empty, Loading, Modal, PageHead, UsageBar, useToast } from "../components/ui";

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function MediaPage() {
  const { t } = useI18n();
  const f = useFmt();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<"" | "image" | "video">("");
  const [sel, setSel] = useState<Media | null>(null);
  const [alt, setAlt] = useState("");
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const list = useQuery({ queryKey: ["media", kind], queryFn: () => api.get<Media[]>(`/api/media?limit=500${kind ? `&kind=${kind}` : ""}`) });
  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["media"] });
    qc.invalidateQueries({ queryKey: ["org"] });
  };
  const onError = (e: unknown) => toast(errMsg(e), "err");
  const upload = useMutation({
    mutationFn: (files: FileList) => {
      const fd = new FormData();
      for (const file of Array.from(files)) fd.append("files", file);
      return api.upload<Media[]>("/api/media", fd);
    },
    onSuccess: (r) => (toast(t("{n} dosya yüklendi", { n: r.length }), "ok"), inv()),
    onError,
  });
  const importUrl = useMutation({ mutationFn: () => api.post<Media>("/api/media/import", { url }), onSuccess: () => (setUrl(""), inv()), onError });
  const saveAlt = useMutation({
    mutationFn: () => api.patch<Media>(`/api/media/${sel!.id}`, { altText: alt || null }),
    onSuccess: () => {
      inv();
      setSel(null);
      toast(t("Kaydedildi"), "ok");
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/media/${id}`),
    onSuccess: () => {
      inv();
      setSel(null);
    },
    onError,
  });

  return (
    <>
      <PageHead
        title={t("Medya")}
        sub={t("Yüklenen görsel ve videolar. Gönderi oluştururken buradan seçebilirsin.")}
        actions={
          <Can role="editor">
            <input ref={fileRef} type="file" multiple accept="image/*,video/*" style={{ display: "none" }} onChange={(e) => e.target.files && upload.mutate(e.target.files)} />
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              <ImagePlus /> {upload.isPending ? t("Yükleniyor…") : t("Yükle")}
            </button>
          </Can>
        }
      />
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        {org.data && (
          <div className="card">
            <UsageBar label={t("Depolama")} q={org.data.usage.storageMb} unit=" MB" />
          </div>
        )}
        <Can role="editor">
          <div className="card row">
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder={t("Görsel/video bağlantısı (Drive, Dropbox da olur)")}
              title={t("Google Drive'da dosya \"bağlantıya sahip herkes\" ile paylaşılmış olmalı")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label={t("URL")}
            />
            <button className="btn" disabled={!/^https?:\/\//.test(url) || importUrl.isPending} onClick={() => importUrl.mutate()}>
              <Link2 /> {t("URL'den al")}
            </button>
          </div>
        </Can>
      </div>
      <div className="segmented" style={{ marginBottom: 12 }}>
        {(["", "image", "video"] as const).map((k) => (
          <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
            {{ "": t("Tümü"), image: t("Görsel"), video: t("Video") }[k]}
          </button>
        ))}
      </div>
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <div className="card">
          <Empty icon={<Image />} title={t("Medya yok")} text={t("Dosya yükle ya da bir URL'den içe aktar.")} />
        </div>
      ) : (
        <div className="media-grid media-grid-lg">
          {list.data.map((m) => (
            <div
              key={m.id}
              className="media-thumb"
              title={m.originalName}
              role="button"
              tabIndex={0}
              onClick={() => {
                setSel(m);
                setAlt(m.altText ?? "");
              }}
            >
              {m.kind === "video" ? <video src={m.url} muted /> : <img src={m.url} alt={m.altText ?? ""} loading="lazy" />}
            </div>
          ))}
        </div>
      )}
      {sel && (
        <Modal
          title={sel.originalName}
          onClose={() => setSel(null)}
          footer={
            <Can role="editor">
              <button className="btn btn-danger" onClick={() => confirm(t("Dosya silinsin mi? Planlı gönderilerde kullanılıyorsa yayın başarısız olur.")) && remove.mutate(sel.id)} style={{ marginRight: "auto" }}>
                <Trash2 /> {t("Sil")}
              </button>
              <button className="btn btn-primary" onClick={() => saveAlt.mutate()} disabled={saveAlt.isPending}>
                {t("Kaydet")}
              </button>
            </Can>
          }
        >
          <div className="form">
            {sel.kind === "video" ? <video src={sel.url} controls style={{ width: "100%", borderRadius: 8 }} /> : <img src={sel.url} alt="" style={{ width: "100%", borderRadius: 8 }} />}
            <dl className="kv">
              <dt>{t("Tür")}</dt>
              <dd>{sel.mime}</dd>
              <dt>{t("Boyut")}</dt>
              <dd>{size(sel.size)}</dd>
              <dt>{t("Yüklendi")}</dt>
              <dd>{f.date(sel.createdAt)}</dd>
              <dt>{t("Herkese açık URL")}</dt>
              <dd>
                <Copyable text={sel.publicUrl} />
              </dd>
            </dl>
            <div className="field">
              <label>{t("Alt metin (erişilebilirlik)")}</label>
              <input className="input" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={1000} placeholder={t("Görselde ne var?")} />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
