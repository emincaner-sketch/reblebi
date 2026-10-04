import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Globe, Mail, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { api, errMsg, type Channel, type Media } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { useToast } from "../../components/ui";
import { BrandSvg } from "../../components/BrandIcons";
import { BIO_NETWORKS, type BioGridItem, type BioLink, type BioPage, type BioSocial, type BioTheme, type GridCandidate, type SlugStatus } from "./types";
import { copyText } from "../../lib/clipboard";

type Draft = Pick<BioPage, "slug" | "title" | "bio" | "avatarUrl" | "theme" | "links" | "socials" | "grid" | "published">;

const toDraft = (p: BioPage): Draft => ({ slug: p.slug, title: p.title, bio: p.bio, avatarUrl: p.avatarUrl, theme: p.theme, links: p.links, socials: p.socials, grid: p.grid, published: p.published });

const ACCENTS = ["#5b49f2", "#1a1726", "#eb6834", "#1baf7a", "#d9a441", "#e34948", "#2a78d6", "#e87ba4"];

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

/** Bağlı kanalın kullanıcı adından herkese açık profil adresi (çıkarılabilenler) */
function profileUrl(c: Channel): string | null {
  const u = c.username?.replace(/^@/, "").trim();
  if (!u || /\s/.test(u)) return null;
  switch (c.provider) {
    case "instagram":
      return `https://www.instagram.com/${u}`;
    case "tiktok":
      return `https://www.tiktok.com/@${u}`;
    case "x":
      return `https://x.com/${u}`;
    case "threads":
      return `https://www.threads.net/@${u}`;
    case "bluesky":
      return `https://bsky.app/profile/${u}`;
    default:
      return null;
  }
}

function NetworkIcon({ id }: { id: string }) {
  if (id === "website") return <Globe aria-hidden="true" />;
  if (id === "email") return <Mail aria-hidden="true" />;
  return <BrandSvg id={id} size={16} />;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

export function BioEditor({ page, onDeleted }: { page: BioPage; onDeleted: () => void }) {
  const { t } = useI18n();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = s.can("editor");
  const [draft, setDraft] = useState<Draft>(() => toDraft(page));
  useEffect(() => setDraft(toDraft(page)), [page]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(page));

  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const media = useQuery({ queryKey: ["media", "image"], queryFn: () => api.get<Media[]>("/api/media?kind=image&limit=60") });
  const candidates = useQuery({ queryKey: ["bio-grid-candidates"], queryFn: () => api.get<GridCandidate[]>("/api/bio/grid-candidates") });

  // Adres kontrolü (yazarken)
  const slugQ = useDebounced(draft.slug.trim().toLowerCase(), 400);
  const slugCheck = useQuery({
    queryKey: ["bio-slug", slugQ, page.id],
    queryFn: () => api.get<{ status: SlugStatus }>(`/api/bio/check?${new URLSearchParams({ slug: slugQ, exceptId: page.id })}`),
    enabled: slugQ !== page.slug && slugQ.length > 0,
  });
  const slugStatus: SlugStatus | null = slugQ === page.slug ? "ok" : (slugCheck.data?.status ?? null);

  // Canlı önizleme: kaydedilmemiş taslak sunucuda aynı şablonla çizilir
  const previewKey = useDebounced(JSON.stringify(draft), 350);
  const [html, setHtml] = useState("");
  useEffect(() => {
    let alive = true;
    api
      .post<{ html: string }>(`/api/bio/${page.id}/preview`, JSON.parse(previewKey))
      .then((r) => alive && setHtml(r.html))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [previewKey, page.id]);

  const save = useMutation({
    mutationFn: () => api.patch<BioPage>(`/api/bio/${page.id}`, draft),
    onSuccess: () => {
      toast(t("Kaydedildi"), "ok");
      qc.invalidateQueries({ queryKey: ["bio-pages"] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/bio/${page.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bio-pages"] });
      onDeleted();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const links = draft.links;
  const setLink = (i: number, patch: Partial<BioLink>) => set({ links: links.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const moveLink = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= links.length) return;
    const next = links.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set({ links: next });
  };
  const setSocial = (i: number, patch: Partial<BioSocial>) => set({ socials: draft.socials.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const fillFromChannels = () => {
    const have = new Set(draft.socials.map((x) => x.network));
    const add: BioSocial[] = [];
    for (const c of channels.data ?? []) {
      const url = profileUrl(c);
      if (url && !have.has(c.provider)) {
        add.push({ network: c.provider, url });
        have.add(c.provider);
      }
    }
    if (!add.length) return toast(t("Bağlı kanallardan eklenecek yeni hesap bulunamadı."), "info");
    set({ socials: [...draft.socials, ...add] });
  };
  const gridSelected = new Map(draft.grid.map((g) => [g.postId, g]));
  const toggleGrid = (c: GridCandidate) =>
    set({ grid: gridSelected.has(c.postId) ? draft.grid.filter((g) => g.postId !== c.postId) : [...draft.grid, { id: newId("grd"), postId: c.postId, url: "" }] });
  const setGrid = (i: number, patch: Partial<BioGridItem>) => set({ grid: draft.grid.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
  const candMap = useMemo(() => new Map((candidates.data ?? []).map((c) => [c.postId, c])), [candidates.data]);
  const setTheme = (patch: Partial<BioTheme>) => set({ theme: { ...draft.theme, ...patch } });

  const prefix = page.url.slice(0, page.url.length - page.slug.length);
  const liveUrl = `${prefix}${draft.slug}`;
  const copy = async () => {
    if (await copyText(page.url)) toast(t("Adres kopyalandı"), "ok");
    else toast(page.url, "info");
  };
  const slugMsg: Record<SlugStatus, string> = {
    ok: t("Adres kullanılabilir"),
    invalid: t("3–40 karakter; küçük harf, rakam ve tire"),
    reserved: t("Bu adres ayrılmış"),
    taken: t("Bu adres alınmış"),
  };
  const ro = !canEdit;

  return (
    <div className="bio-ed">
      <div className="bio-form">
        <div className="bio-savebar" role="region" aria-label={t("Kaydet")}>
          <span className="small muted" aria-live="polite">
            {dirty ? t("Kaydedilmemiş değişiklikler var") : t("Tüm değişiklikler kaydedildi")}
          </span>
          <span className="row" style={{ gap: 8 }}>
            {dirty && (
              <button className="btn btn-sm" onClick={() => setDraft(toDraft(page))} disabled={save.isPending}>
                {t("Vazgeç")}
              </button>
            )}
            <button className="btn btn-primary btn-sm" disabled={ro || !dirty || save.isPending || (slugStatus !== null && slugStatus !== "ok")} onClick={() => save.mutate()}>
              <Save aria-hidden="true" /> {t("Kaydet")}
            </button>
          </span>
        </div>

        <section className="card form" aria-labelledby="bio-prof">
          <h2 id="bio-prof" className="bio-h">
            {t("Profil")}
          </h2>
          <div className="field">
            <label htmlFor="bio-title">{t("Başlık")}</label>
            <input id="bio-title" className="input" value={draft.title} maxLength={80} disabled={ro} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="bio-desc">{t("Açıklama")}</label>
            <textarea id="bio-desc" className="input" rows={3} maxLength={300} value={draft.bio ?? ""} disabled={ro} onChange={(e) => set({ bio: e.target.value || null })} />
            <span className="help">{t("{n}/300 karakter", { n: (draft.bio ?? "").length })}</span>
          </div>
          <div className="field">
            <label htmlFor="bio-avatar">{t("Profil fotoğrafı")}</label>
            <div className="bio-avatar-row">
              <span className="bio-av" aria-hidden="true">
                {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : <span>{(draft.title.trim()[0] ?? "R").toUpperCase()}</span>}
              </span>
              <input id="bio-avatar" className="input" placeholder="https://…" value={draft.avatarUrl ?? ""} disabled={ro} onChange={(e) => set({ avatarUrl: e.target.value || null })} />
              {(media.data?.length ?? 0) > 0 && (
                <select className="input select-sm" aria-label={t("Medyadan seç")} value="" disabled={ro} onChange={(e) => e.target.value && set({ avatarUrl: e.target.value })}>
                  <option value="">{t("Medyadan seç…")}</option>
                  {media.data!.map((m) => (
                    <option key={m.id} value={m.url}>
                      {m.originalName}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <span className="help">{t("Boş bırakırsan başlığın ilk harfi vurgu renginde gösterilir.")}</span>
          </div>
        </section>

        <section className="card form" aria-labelledby="bio-links">
          <div className="row-between">
            <h2 id="bio-links" className="bio-h">
              {t("Bağlantılar")}
            </h2>
            <button className="btn btn-sm" disabled={ro || links.length >= 50} onClick={() => set({ links: [...links, { id: newId("lnk"), label: "", url: "", enabled: true }] })}>
              <Plus aria-hidden="true" /> {t("Bağlantı ekle")}
            </button>
          </div>
          {!links.length && <p className="muted small">{t("Mağaza, menü, rezervasyon ya da kampanya sayfan gibi bağlantılar ekle. Sayfada düğme olarak görünürler.")}</p>}
          <ol className="bio-list">
            {links.map((l, i) => (
              <li key={l.id} className={`bio-link ${l.enabled ? "" : "off"}`}>
                <label className="bio-on" title={l.enabled ? t("Görünür") : t("Gizli")}>
                  <input type="checkbox" checked={l.enabled} disabled={ro} onChange={(e) => setLink(i, { enabled: e.target.checked })} />
                  <span className="sr-only">{t("Görünür")}</span>
                </label>
                <input className="input" aria-label={t("Düğme metni")} placeholder={t("Düğme metni")} value={l.label} maxLength={80} disabled={ro} onChange={(e) => setLink(i, { label: e.target.value })} />
                <input className="input" aria-label={t("Adres")} placeholder="https://…" value={l.url} disabled={ro} onChange={(e) => setLink(i, { url: e.target.value })} />
                <span className="bio-tools">
                  <button className="btn btn-ghost btn-sm" aria-label={t("Yukarı taşı")} title={t("Yukarı taşı")} disabled={ro || i === 0} onClick={() => moveLink(i, -1)}>
                    <ArrowUp />
                  </button>
                  <button className="btn btn-ghost btn-sm" aria-label={t("Aşağı taşı")} title={t("Aşağı taşı")} disabled={ro || i === links.length - 1} onClick={() => moveLink(i, 1)}>
                    <ArrowDown />
                  </button>
                  <button className="btn btn-ghost btn-sm" aria-label={t("Sil")} title={t("Sil")} disabled={ro} onClick={() => set({ links: links.filter((_, k) => k !== i) })}>
                    <Trash2 />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card form" aria-labelledby="bio-soc">
          <div className="row-between">
            <h2 id="bio-soc" className="bio-h">
              {t("Sosyal hesaplar")}
            </h2>
            <span className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm" disabled={ro} onClick={fillFromChannels} title={t("Bağlı kanalların kullanıcı adlarından profil adreslerini ekler")}>
                <Wand2 aria-hidden="true" /> {t("Kanallardan doldur")}
              </button>
              <button className="btn btn-sm" disabled={ro || draft.socials.length >= 12} onClick={() => set({ socials: [...draft.socials, { network: "instagram", url: "" }] })}>
                <Plus aria-hidden="true" /> {t("Hesap ekle")}
              </button>
            </span>
          </div>
          {!draft.socials.length && <p className="muted small">{t("Sayfanın üstünde ikon olarak görünür.")}</p>}
          <ul className="bio-list">
            {draft.socials.map((x, i) => (
              <li key={i} className="bio-soc">
                <span className="bio-soc-ic" aria-hidden="true">
                  <NetworkIcon id={x.network} />
                </span>
                <select className="input" aria-label={t("Ağ")} value={x.network} disabled={ro} onChange={(e) => setSocial(i, { network: e.target.value })}>
                  {BIO_NETWORKS.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.id === "website" ? t("Web sitesi") : n.id === "email" ? t("E-posta") : n.label}
                    </option>
                  ))}
                </select>
                <input className="input" aria-label={t("Adres")} placeholder={x.network === "email" ? "ornek@alanadi.com" : "https://…"} value={x.url} disabled={ro} onChange={(e) => setSocial(i, { url: e.target.value })} />
                <button className="btn btn-ghost btn-sm" aria-label={t("Sil")} title={t("Sil")} disabled={ro} onClick={() => set({ socials: draft.socials.filter((_, k) => k !== i) })}>
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card form" aria-labelledby="bio-grid">
          <div>
            <h2 id="bio-grid" className="bio-h">
              {t("Gönderi ızgarası")}
            </h2>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              {t("Yayınlanmış görselli gönderilerini sayfada ızgara olarak göster; her görsel kendi bağlantısına gider. Instagram'daki bir gönderinin ürününü ya da yazısını takipçine böyle ulaştırırsın.")}
            </p>
          </div>
          {candidates.isLoading ? (
            <p className="muted small">{t("Yükleniyor…")}</p>
          ) : !(candidates.data?.length ?? 0) ? (
            <p className="muted small">{t("Görselli yayınlanmış gönderi yok. Görsel içeren bir gönderi yayınladığında burada seçebilirsin.")}</p>
          ) : (
            <div className="bio-cands" role="group" aria-label={t("Izgaraya eklenecek gönderiler")}>
              {candidates.data!.slice(0, 24).map((c) => {
                const on = gridSelected.has(c.postId);
                return (
                  <button key={c.postId} className={`bio-cand ${on ? "on" : ""}`} aria-pressed={on} disabled={ro} onClick={() => toggleGrid(c)} title={c.text}>
                    <img src={c.image} alt={c.text.slice(0, 80)} loading="lazy" />
                    {on && (
                      <span className="bio-cand-check" aria-hidden="true">
                        <Check />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {draft.grid.length > 0 && (
            <ol className="bio-list">
              {draft.grid.map((g, i) => {
                const c = candMap.get(g.postId);
                return (
                  <li key={g.id} className="bio-gridrow">
                    {c ? <img src={c.image} alt="" className="bio-thumb" /> : <span className="bio-thumb" />}
                    <input className="input" aria-label={t("Görselin bağlantısı")} placeholder={t("Bu görsel nereye gitsin? https://…")} value={g.url} disabled={ro} onChange={(e) => setGrid(i, { url: e.target.value })} />
                    <button className="btn btn-ghost btn-sm" aria-label={t("Izgaradan çıkar")} title={t("Izgaradan çıkar")} disabled={ro} onClick={() => set({ grid: draft.grid.filter((_, k) => k !== i) })}>
                      <Trash2 />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="card form" aria-labelledby="bio-look">
          <h2 id="bio-look" className="bio-h">
            {t("Görünüm")}
          </h2>
          <div className="field">
            <span className="bio-lbl" id="bio-bg-l">
              {t("Zemin")}
            </span>
            <div className="segmented" role="group" aria-labelledby="bio-bg-l">
              {(
                [
                  ["cream", t("Krem")],
                  ["light", t("Açık")],
                  ["dark", t("Koyu")],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={draft.theme.background === k ? "active" : ""} aria-pressed={draft.theme.background === k} disabled={ro} onClick={() => setTheme({ background: k })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="bio-lbl" id="bio-bt-l">
              {t("Düğmeler")}
            </span>
            <div className="segmented" role="group" aria-labelledby="bio-bt-l">
              {(
                [
                  ["rounded", t("Yuvarlak köşe")],
                  ["pill", t("Hap")],
                  ["square", t("Köşeli")],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={draft.theme.buttons === k ? "active" : ""} aria-pressed={draft.theme.buttons === k} disabled={ro} onClick={() => setTheme({ buttons: k })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="bio-lbl" id="bio-ac-l">
              {t("Vurgu rengi")}
            </span>
            <div className="bio-swatches" role="group" aria-labelledby="bio-ac-l">
              {ACCENTS.map((c) => (
                <button key={c} className={`bio-sw ${draft.theme.accent === c ? "on" : ""}`} style={{ background: c }} aria-label={c} aria-pressed={draft.theme.accent === c} disabled={ro} onClick={() => setTheme({ accent: c })} />
              ))}
              <label className="bio-sw-custom">
                <input type="color" value={draft.theme.accent} disabled={ro} onChange={(e) => setTheme({ accent: e.target.value })} />
                <span className="small">{t("Özel")}</span>
              </label>
            </div>
            <span className="help">{t("Düğme yazısının rengi okunabilirliğe göre otomatik seçilir.")}</span>
          </div>
        </section>

        <section className="card form" aria-labelledby="bio-pub">
          <h2 id="bio-pub" className="bio-h">
            {t("Yayın")}
          </h2>
          <div className="field">
            <label htmlFor="bio-slug">{t("Adres")}</label>
            <div className="bio-slug">
              <span className="bio-prefix">{prefix.replace(/^https?:\/\//, "")}</span>
              <input id="bio-slug" className="input" value={draft.slug} maxLength={40} disabled={ro} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} aria-describedby="bio-slug-h" />
            </div>
            <span id="bio-slug-h" className={`help ${slugStatus && slugStatus !== "ok" ? "bio-err" : ""}`}>
              {slugStatus ? slugMsg[slugStatus] : " "}
              {draft.slug !== page.slug && slugStatus === "ok" && ` · ${t("Eski adres çalışmayı bırakır.")}`}
            </span>
          </div>
          <label className="row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={draft.published} disabled={ro} onChange={(e) => set({ published: e.target.checked })} /> {t("Yayında (kapalıyken adres 404 döner)")}
          </label>
          {canEdit && (
            <div>
              <button className="btn btn-danger btn-sm" disabled={remove.isPending} onClick={() => confirm(t("Bu bağlantı sayfası ve istatistikleri silinsin mi? Bu işlem geri alınamaz.")) && remove.mutate()}>
                <Trash2 aria-hidden="true" /> {t("Sayfayı sil")}
              </button>
            </div>
          )}
        </section>
      </div>

      <aside className="bio-side" aria-label={t("Önizleme")}>
        <div className="card bio-urlcard">
          <span className="small muted">{t("Sayfa adresi")}</span>
          <a href={page.url} target="_blank" rel="noreferrer" className="bio-url">
            {page.url.replace(/^https?:\/\//, "")}
          </a>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={copy}>
              <Copy aria-hidden="true" /> {t("Kopyala")}
            </button>
            <a className="btn btn-sm" href={page.url} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" /> {t("Aç")}
            </a>
          </span>
          {draft.slug !== page.slug && <span className="small muted">{t("Kaydedince adres {url} olur.", { url: liveUrl.replace(/^https?:\/\//, "") })}</span>}
          {!page.published && <span className="small bio-err">{t("Sayfa yayında değil.")}</span>}
        </div>
        <div className="bio-phone">
          {html ? <iframe title={t("Bağlantı sayfası önizlemesi")} srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" /> : <div className="bio-phone-empty muted small">{t("Yükleniyor…")}</div>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {t("Önizlemede tıklamalar sayılmaz.")}
        </p>
      </aside>
    </div>
  );
}
