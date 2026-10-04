import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Empty, PageHead } from "../components/ui";
import { BioEditor } from "../panel/bio/BioEditor";
import { BioStatsView } from "../panel/bio/BioStatsView";
import type { BioPage } from "../panel/bio/types";
import "../panel/bio/bio.css";

/** "Leblebi Kuruyemiş" → "leblebi-kuruyemis" */
function slugify(s: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
  return s
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function CreateForm({ onCreated, onCancel }: { onCreated: (p: BioPage) => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const s = useSession();
  const qc = useQueryClient();
  const base = s.org.name.replace(/\(.*?\)/g, "").trim();
  const [title, setTitle] = useState(base);
  const [slug, setSlug] = useState(slugify(base));
  const create = useMutation({
    mutationFn: () => api.post<BioPage>("/api/bio", { title, slug }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["bio-pages"] });
      onCreated(p);
    },
  });
  return (
    <form
      className="card form bio-create"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="field">
        <label htmlFor="bio-new-title">{t("Sayfa başlığı")}</label>
        <input id="bio-new-title" className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="bio-new-slug">{t("Adres")}</label>
        <div className="bio-slug">
          <span className="bio-prefix">{`${window.location.host}/l/`}</span>
          <input id="bio-new-slug" className="input" value={slug} maxLength={40} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required />
        </div>
        <span className="help">{t("3–40 karakter; küçük harf, rakam ve tire. Sonra değiştirebilirsin.")}</span>
      </div>
      {create.error && <div className="notice notice-err small">{errMsg(create.error)}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={!title.trim() || slug.length < 3 || create.isPending}>
          {t("Sayfayı oluştur")}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {t("Vazgeç")}
          </button>
        )}
      </div>
    </form>
  );
}

/** Link in bio (Metricool SmartLinks karşılığı): /app/bio?page=…&tab=stats */
export default function BioPageScreen() {
  const { t } = useI18n();
  const s = useSession();
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const pages = useQuery({ queryKey: ["bio-pages"], queryFn: () => api.get<BioPage[]>("/api/bio") });
  const list = pages.data ?? [];
  const selectedId = sp.get("page") && list.some((p) => p.id === sp.get("page")) ? sp.get("page")! : list[0]?.id;
  const page = list.find((p) => p.id === selectedId) ?? null;
  const tab = sp.get("tab") === "stats" ? "stats" : "edit";
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };

  const head = (
    <PageHead
      title={t("Link in bio")}
      sub={t("Biyografine koyacağın tek adres: bağlantılar, sosyal hesaplar ve tıklanabilir gönderi ızgarası. Görüntülenme ve tıklamalar burada ölçülür.")}
      actions={
        list.length > 0 &&
        s.can("editor") &&
        list.length < 10 && (
          <button className="btn" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> {t("Yeni sayfa")}
          </button>
        )
      }
    />
  );

  if (pages.isLoading) return head;
  if (pages.isError)
    return (
      <>
        {head}
        <div className="notice notice-err small">{errMsg(pages.error)}</div>
      </>
    );

  if (!list.length || creating)
    return (
      <>
        {head}
        {!list.length && (
          <div className="card" style={{ marginBottom: 16 }}>
            <Empty icon={<Link2 />} title={t("Henüz bağlantı sayfan yok")} text={t("Instagram, TikTok ya da X biyografine koyacağın sayfayı birkaç saniyede oluştur. Ziyaret ve tıklamaları kişisel veri toplamadan sayarız.")} />
          </div>
        )}
        {s.can("editor") ? (
          <CreateForm
            onCreated={(p) => {
              setCreating(false);
              go({ page: p.id, tab: null });
            }}
            onCancel={list.length ? () => setCreating(false) : undefined}
          />
        ) : (
          <p className="muted small">{t("Sayfa oluşturmak için düzenleyici yetkisi gerekir.")}</p>
        )}
      </>
    );

  return (
    <>
      {head}
      <div className="bio-top">
        {list.length > 1 && (
          <select className="input select-sm" aria-label={t("Sayfa")} value={selectedId} onChange={(e) => go({ page: e.target.value })}>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · /l/{p.slug}
              </option>
            ))}
          </select>
        )}
        <div className="tabs" role="tablist" aria-label={t("Bölüm")}>
          <button role="tab" aria-selected={tab === "edit"} className={`tab ${tab === "edit" ? "active" : ""}`} onClick={() => go({ tab: null })}>
            {t("Düzenle")}
          </button>
          <button role="tab" aria-selected={tab === "stats"} className={`tab ${tab === "stats" ? "active" : ""}`} onClick={() => go({ tab: "stats" })}>
            {t("İstatistikler")}
            {page?.last30 ? <span className="bio-tabnum">{page.last30.views}</span> : null}
          </button>
        </div>
      </div>
      {page && (tab === "stats" ? <BioStatsView page={page} /> : <BioEditor key={page.id} page={page} onDeleted={() => go({ page: null, tab: null })} />)}
    </>
  );
}
