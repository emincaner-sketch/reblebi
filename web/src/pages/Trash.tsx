import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { api, errMsg, type Channel, type Post, type PostKind } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt } from "../lib/session";
import { Can, Empty, PageHead, ProviderIcon, StatusBadge, useToast } from "../components/ui";

interface DeletedPost {
  id: string;
  title: string | null;
  preview: string;
  kind: PostKind;
  status: string;
  publishAt: string | null;
  channelIds: string[];
  campaignId: string | null;
  deletedBy: string | null;
  deletedAt: string;
  expiresAt: string;
}

/** Silinen gönderiler (Metricool "Deleted posts" karşılığı): 30 gün saklanır, geri alınabilir */
export default function TrashPage() {
  const { t } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const qc = useQueryClient();
  const toast = useToast();
  const trash = useQuery({ queryKey: ["posts-trash"], queryFn: () => api.get<{ items: DeletedPost[]; days: number }>("/api/posts/trash") });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const chMap = new Map((channels.data ?? []).map((c) => [c.id, c]));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["posts-trash"] });
    qc.invalidateQueries({ queryKey: ["posts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["campaigns"] });
  };
  const onError = (e: unknown) => toast(errMsg(e), "err");

  const restore = useMutation({
    mutationFn: (id: string) => api.post<Post & { droppedTargets: number; toDraft: boolean }>(`/api/posts/trash/${id}/restore`),
    onSuccess: (p) => {
      const notes = [p.toDraft ? t("yayın saati geçtiği için taslak olarak döndü") : "", p.droppedTargets ? t("{n} kaldırılmış kanal atlandı", { n: p.droppedTargets }) : ""].filter(Boolean);
      toast(notes.length ? `${t("Geri alındı")}: ${notes.join(", ")}` : t("Geri alındı"), "ok");
      refresh();
    },
    onError,
  });
  const purge = useMutation({ mutationFn: (id: string) => api.del(`/api/posts/trash/${id}`), onSuccess: refresh, onError });
  const empty = useMutation({
    mutationFn: () => api.del<{ removed: number }>("/api/posts/trash"),
    onSuccess: (r) => (toast(t("{n} gönderi kalıcı olarak silindi", { n: r.removed }), "ok"), refresh()),
    onError,
  });

  const items = trash.data?.items ?? [];
  const days = trash.data?.days ?? 30;
  const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

  return (
    <>
      <PageHead
        title={t("Silinen gönderiler")}
        sub={t("Silinen gönderiler {days} gün burada kalır, sonra kalıcı olarak silinir. Geri aldığında gönderi kanallarıyla birlikte geri gelir.", { days })}
        actions={
          items.length > 0 && (
            <Can role="admin">
              <button className="btn btn-danger" disabled={empty.isPending} onClick={() => confirm(t("Çöp kutusundaki {n} gönderi kalıcı olarak silinsin mi? Bu işlem geri alınamaz.", { n: items.length })) && empty.mutate()}>
                <Trash2 aria-hidden="true" /> {t("Çöp kutusunu boşalt")}
              </button>
            </Can>
          )
        }
      />
      <div className="card">
        {trash.isLoading ? (
          <p className="muted small">{t("Yükleniyor…")}</p>
        ) : trash.isError ? (
          <div className="notice notice-err small">{errMsg(trash.error)}</div>
        ) : !items.length ? (
          <Empty icon={<Trash2 />} title={t("Çöp kutusu boş")} text={t("Sildiğin gönderiler burada {days} gün boyunca geri alınabilir.", { days })} action={<Link to="/app/posts" className="btn">{t("Takvime dön")}</Link>} />
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <caption className="sr-only">{t("Silinen gönderiler")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("İçerik")}</th>
                  <th scope="col">{t("Kanallar")}</th>
                  <th scope="col">{t("Durum")}</th>
                  <th scope="col">{t("Silinme")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("İşlemler")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const left = daysLeft(p.expiresAt);
                  return (
                    <tr key={p.id}>
                      <td style={{ maxWidth: 380 }}>
                        <span className="truncate" style={{ display: "block", fontWeight: 500 }}>
                          {p.title || p.preview || t("(metin yok)")}
                        </span>
                        <span className="muted small">
                          {L.kind(p.kind)}
                          {p.publishAt ? ` · ${f.short(p.publishAt)}` : ""}
                        </span>
                      </td>
                      <td>
                        <span className="row" style={{ gap: 4 }}>
                          {p.channelIds.map((id) => {
                            const c = chMap.get(id);
                            return c ? (
                              <span key={id} title={c.name}>
                                <ProviderIcon provider={c.provider} size={20} />
                              </span>
                            ) : (
                              <span key={id} className="muted small" title={t("Kanal kaldırılmış")}>
                                —
                              </span>
                            );
                          })}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="small">
                        <span title={f.date(p.deletedAt)}>{f.ago(p.deletedAt)}</span>
                        <span className="muted" style={{ display: "block" }}>
                          {left <= 1 ? t("yarın kalıcı olarak silinir") : t("{n} gün kaldı", { n: left })}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        <Can role="editor">
                          <button className="btn btn-sm" disabled={restore.isPending} onClick={() => restore.mutate(p.id)}>
                            <RotateCcw aria-hidden="true" /> {t("Geri al")}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            title={t("Kalıcı olarak sil")}
                            aria-label={t("Kalıcı olarak sil")}
                            disabled={purge.isPending}
                            onClick={() => confirm(t("Gönderi kalıcı olarak silinsin mi? Bu işlem geri alınamaz.")) && purge.mutate(p.id)}
                          >
                            <Trash2 />
                          </button>
                        </Can>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        {t("Yayınlanmış bir gönderiyi burada silmek, onu sosyal ağdan kaldırmaz.")}
      </p>
    </>
  );
}
