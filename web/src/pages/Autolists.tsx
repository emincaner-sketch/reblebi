import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, BookMarked, Clock, ListRestart, Paperclip, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api, errMsg, type Channel, type PostKind } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Empty, Modal, PageHead, ProviderIcon, useLocalState, useToast } from "../components/ui";
import "../panel/analytics/autolists.css";

interface Slot {
  day: number;
  time: string;
}
interface Item {
  id: string;
  kind: PostKind;
  content: string;
  mediaIds: string[];
  position: number;
  useCount: number;
  lastUsedAt: string | null;
}
interface Upcoming {
  at: string;
  itemId: string;
  preview: string;
}
interface Autolist {
  id: string;
  name: string;
  channelIds: string[];
  slots: Slot[];
  repeat: boolean;
  enabled: boolean;
  position: number;
  lastRunAt: string | null;
  lastError: string | null;
  itemCount?: number;
  upcoming: Upcoming[];
}
type Detail = Autolist & { items: Item[] };
interface LibItem {
  id: string;
  type: "post" | "hashtags";
  name: string;
  kind: PostKind;
  content: string;
  mediaIds: string[];
}

const KINDS: PostKind[] = ["post", "reel", "story", "video", "thread"];

/** Otomatik listeler (Metricool "Autolists"): her zaman geçerli içerikler seçilen saatlerde sırayla, döngüyle paylaşılır */
export default function AutolistsPage() {
  const { t } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = s.can("editor");
  const days = [t("Pzt"), t("Sal"), t("Çar"), t("Per"), t("Cum"), t("Cmt"), t("Paz")];
  const list = useQuery({ queryKey: ["autolists"], queryFn: () => api.get<{ items: Autolist[]; max: number }>("/api/autolists") });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels"), staleTime: 60_000 });
  const [selRaw, setSel] = useLocalState<string>("sp_autolist", "");
  const lists = list.data?.items ?? [];
  const sel = lists.find((l) => l.id === selRaw)?.id ?? lists[0]?.id ?? "";
  const detail = useQuery({ queryKey: ["autolist", sel], queryFn: () => api.get<Detail>(`/api/autolists/${sel}`), enabled: Boolean(sel) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["autolists"] });
    qc.invalidateQueries({ queryKey: ["autolist"] });
  };
  const onErr = (e: unknown) => toast(errMsg(e), "err");

  const create = useMutation({
    mutationFn: () => api.post<Autolist>("/api/autolists", { name: t("Yeni liste"), channelIds: [], slots: [{ day: 0, time: "10:00" }], repeat: true }),
    onSuccess: (l) => {
      setSel(l.id);
      refresh();
    },
    onError: onErr,
  });
  const patch = useMutation({
    mutationFn: (v: Partial<Pick<Autolist, "name" | "channelIds" | "slots" | "repeat" | "enabled" | "position">>) => api.patch<Autolist>(`/api/autolists/${sel}`, v),
    onSuccess: refresh,
    onError: onErr,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/autolists/${id}`), onSuccess: () => (setSel(""), refresh()), onError: onErr });

  const d = detail.data;
  const chans = channels.data ?? [];
  const slotsText = (slots: Slot[]) =>
    slots.length
      ? slots
          .slice(0, 4)
          .map((x) => `${days[x.day]} ${x.time}`)
          .join(" · ") + (slots.length > 4 ? ` +${slots.length - 4}` : "")
      : t("Saat yok");

  return (
    <div className="al">
      <PageHead
        title={t("Otomatik listeler")}
        sub={t("Her zaman geçerli içeriklerini (ipuçları, SSS, ürün tanıtımları) bir kuyruğa koy; seçtiğin gün ve saatlerde sırayla paylaşılsın, liste bitince başa dönsün.")}
        actions={
          canEdit && (
            <button className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending || lists.length >= (list.data?.max ?? 20)}>
              <Plus aria-hidden="true" /> {t("Yeni liste")}
            </button>
          )
        }
      />

      {list.isLoading ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : !lists.length ? (
        <div className="card">
          <Empty icon={<ListRestart />} title={t("Henüz otomatik liste yok")} text={t("Bir liste oluştur, kanal ve yayın saatlerini seç, içerikleri ekle ve listeyi aç.")} />
        </div>
      ) : (
        <div className="al-layout">
          <ul className="al-lists" aria-label={t("Listeler")}>
            {lists.map((l) => (
              <li key={l.id}>
                <button type="button" className={`al-list${l.id === sel ? " on" : ""}`} aria-current={l.id === sel ? "true" : undefined} onClick={() => setSel(l.id)}>
                  <span className="al-list-top">
                    <strong>{l.name}</strong>
                    <span className={`al-state ${l.enabled ? "on" : ""}`}>{l.enabled ? t("Açık") : t("Kapalı")}</span>
                  </span>
                  <span className="al-icons" aria-hidden="true">
                    {l.channelIds
                      .map((id) => chans.find((c) => c.id === id))
                      .filter(Boolean)
                      .slice(0, 6)
                      .map((c) => (
                        <ProviderIcon key={c!.id} provider={c!.provider} size={18} />
                      ))}
                  </span>
                  <span className="muted small">
                    {t("{n} öğe", { n: l.itemCount ?? 0 })} · {slotsText(l.slots)}
                  </span>
                  {l.enabled && l.upcoming[0] && (
                    <span className="small al-next">
                      <Clock aria-hidden="true" /> {t("Sıradaki: {d}", { d: f.short(l.upcoming[0].at) })}
                    </span>
                  )}
                  {l.lastError && (
                    <span className="small al-err">
                      <AlertTriangle aria-hidden="true" /> {t("Son paylaşımda sorun var")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {!d ? (
            <p className="muted small">{t("Yükleniyor…")}</p>
          ) : (
            <section className="al-detail" aria-label={d.name}>
              <div className="card al-head">
                <NameField key={d.id} value={d.name} disabled={!canEdit} onSave={(name) => patch.mutate({ name })} />
                <label className="check al-switch">
                  <input type="checkbox" checked={d.enabled} disabled={!canEdit || patch.isPending} onChange={(e) => patch.mutate({ enabled: e.target.checked })} />
                  <span>{d.enabled ? t("Liste açık: saatleri gelince paylaşılır") : t("Liste kapalı")}</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={d.repeat} disabled={!canEdit} onChange={(e) => patch.mutate({ repeat: e.target.checked })} />
                  <span>{t("Bitince başa dön")}</span>
                </label>
                {canEdit && (
                  <span className="al-head-actions">
                    <button className="btn btn-ghost btn-sm" disabled={d.position === 0} onClick={() => patch.mutate({ position: 0 })}>
                      <RotateCcw aria-hidden="true" /> {t("Baştan başlat")}
                    </button>
                    <button className="btn btn-ghost btn-sm al-danger" onClick={() => confirm(t("“{name}” listesi ve öğeleri silinsin mi? Planlanmış gönderiler etkilenmez.", { name: d.name })) && remove.mutate(d.id)}>
                      <Trash2 aria-hidden="true" /> {t("Sil")}
                    </button>
                  </span>
                )}
                {d.lastError && (
                  <p className="al-err small">
                    <AlertTriangle aria-hidden="true" /> {errorText(d.lastError, t)}
                  </p>
                )}
              </div>

              <div className="al-grid">
                <div className="card">
                  <h2 className="al-h">{t("Kanallar")}</h2>
                  {!chans.length ? (
                    <p className="muted small">{t("Önce bir kanal bağla.")}</p>
                  ) : (
                    <div className="al-chans">
                      {chans.map((c) => {
                        const on = d.channelIds.includes(c.id);
                        return (
                          <label key={c.id} className={`al-chan${on ? " on" : ""}`}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!canEdit}
                              onChange={() => patch.mutate({ channelIds: on ? d.channelIds.filter((x) => x !== c.id) : [...d.channelIds, c.id] })}
                            />
                            <ProviderIcon provider={c.provider} size={20} />
                            <span>{c.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="card">
                  <h2 className="al-h">{t("Yayın saatleri")}</h2>
                  <SlotsEditor key={d.id} slots={d.slots} days={days} disabled={!canEdit} onSave={(slots) => patch.mutate({ slots })} />
                </div>
              </div>

              <div className="card">
                <h2 className="al-h">{t("Sıradaki paylaşımlar")}</h2>
                {!d.upcoming.length ? (
                  <p className="muted small">{t("Öğe ve yayın saati ekleyince burada görünür.")}</p>
                ) : (
                  <ol className="al-up">
                    {d.upcoming.slice(0, 6).map((u, i) => (
                      <li key={`${u.at}-${i}`}>
                        <time dateTime={u.at}>{f.short(u.at)}</time>
                        <span>{u.preview || t("(metin yok)")}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {!d.enabled && d.upcoming.length > 0 && <p className="muted small">{t("Liste kapalıyken bu paylaşımlar yapılmaz.")}</p>}
              </div>

              <Items detail={d} canEdit={canEdit} onChange={refresh} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function errorText(code: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (code === "no_channels") return t("Seçili kanalların hiçbiri etkin değil; gönderi oluşturulmadı.");
  if (code === "empty") return t("Listede öğe yok.");
  if (code.startsWith("quota") || code.startsWith("limit")) return t("Aylık gönderi kotası doldu; bu saat atlandı.");
  return t("Son paylaşım atlandı: {msg}", { msg: code });
}

function NameField({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="al-name">
      <span className="sr-only">{t("Liste adı")}</span>
      <input className="input" value={v} maxLength={80} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v !== value && onSave(v.trim())} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

function SlotsEditor({ slots, days, disabled, onSave }: { slots: Slot[]; days: string[]; disabled: boolean; onSave: (s: Slot[]) => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<Slot[]>(slots);
  const [everyDay, setEveryDay] = useState("09:00");
  const dirty = JSON.stringify(list) !== JSON.stringify(slots);
  return (
    <div className="al-slots">
      {!list.length && <p className="muted small">{t("Henüz saat yok.")}</p>}
      <ul>
        {list.map((x, i) => (
          <li key={i}>
            <select className="select" value={x.day} disabled={disabled} aria-label={t("Gün")} onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, day: Number(e.target.value) } : y)))}>
              {days.map((dn, k) => (
                <option key={k} value={k}>
                  {dn}
                </option>
              ))}
            </select>
            <input className="input" type="time" value={x.time} disabled={disabled} aria-label={t("Saat")} onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, time: e.target.value } : y)))} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} aria-label={t("Saati kaldır")} onClick={() => setList(list.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className="al-slot-actions">
          <button type="button" className="btn btn-sm" onClick={() => setList([...list, { day: list.length ? (list[list.length - 1].day + 1) % 7 : 0, time: list[list.length - 1]?.time ?? "10:00" }])}>
            <Plus aria-hidden="true" /> {t("Saat ekle")}
          </button>
          <span className="al-everyday">
            <input className="input" type="time" value={everyDay} aria-label={t("Her gün için saat")} onChange={(e) => setEveryDay(e.target.value)} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setList([...list, ...[0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, time: everyDay }))])}>
              {t("Her güne ekle")}
            </button>
          </span>
          <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || list.some((x) => !/^\d{2}:\d{2}$/.test(x.time))} onClick={() => onSave(list)}>
            {t("Saatleri kaydet")}
          </button>
        </div>
      )}
    </div>
  );
}

function Items({ detail, canEdit, onChange }: { detail: Detail; canEdit: boolean; onChange: () => void }) {
  const { t } = useI18n();
  const L = useLabels();
  const toast = useToast();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<PostKind>("post");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const base = `/api/autolists/${detail.id}`;
  const onErr = (e: unknown) => toast(errMsg(e), "err");
  const add = useMutation({ mutationFn: () => api.post(`${base}/items`, { kind, content: text, mediaIds: [] }), onSuccess: () => (setText(""), onChange()), onError: onErr });
  const save = useMutation({ mutationFn: (v: { id: string; content: string }) => api.patch(`${base}/items/${v.id}`, { content: v.content }), onSuccess: () => (setEditing(null), onChange()), onError: onErr });
  const del = useMutation({ mutationFn: (id: string) => api.del(`${base}/items/${id}`), onSuccess: onChange, onError: onErr });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.post(`${base}/reorder`, { ids }), onSuccess: onChange, onError: onErr });
  const items = detail.items;
  const move = (i: number, dir: -1 | 1) => {
    const ids = items.map((x) => x.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };

  return (
    <div className="card">
      <div className="al-items-head">
        <h2 className="al-h">{t("Öğeler ({n})", { n: items.length })}</h2>
        {canEdit && (
          <button className="btn btn-sm" onClick={() => setImporting(true)}>
            <BookMarked aria-hidden="true" /> {t("Kütüphaneden ekle")}
          </button>
        )}
      </div>
      {canEdit && (
        <form
          className="al-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate();
          }}
        >
          <label className="sr-only" htmlFor="al-new">
            {t("Yeni öğe metni")}
          </label>
          <textarea id="al-new" className="input" rows={3} maxLength={20000} placeholder={t("Paylaşılacak metin… (görselli içerikleri Kütüphane'den ekleyebilirsin)")} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="al-add-row">
            <select className="select" value={kind} aria-label={t("Tür")} onChange={(e) => setKind(e.target.value as PostKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {L.kind(k)}
                </option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" disabled={!text.trim() || add.isPending}>
              <Plus aria-hidden="true" /> {t("Listeye ekle")}
            </button>
          </div>
        </form>
      )}
      {!items.length ? (
        <p className="muted small">{t("Liste boş.")}</p>
      ) : (
        <ol className="al-items">
          {items.map((it, i) => {
            const next = i === (detail.position >= items.length ? (detail.repeat ? 0 : -1) : detail.position);
            return (
              <li key={it.id} className={next ? "next" : ""}>
                <span className="al-num">{i + 1}</span>
                <div className="al-item-main">
                  {editing?.id === it.id ? (
                    <>
                      <textarea className="input" rows={3} value={editing.text} aria-label={t("Öğe metni")} onChange={(e) => setEditing({ id: it.id, text: e.target.value })} />
                      <span className="al-item-edit">
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                          {t("Vazgeç")}
                        </button>
                        <button className="btn btn-primary btn-sm" disabled={save.isPending || (!editing.text.trim() && !it.mediaIds.length)} onClick={() => save.mutate({ id: it.id, content: editing.text })}>
                          {t("Kaydet")}
                        </button>
                      </span>
                    </>
                  ) : (
                    <p className="al-item-text">{it.content || t("(metin yok)")}</p>
                  )}
                  <span className="muted small al-item-meta">
                    {next && <span className="badge al-next-badge">{t("sıradaki")}</span>}
                    <span>{L.kind(it.kind)}</span>
                    {it.mediaIds.length > 0 && (
                      <span>
                        <Paperclip aria-hidden="true" /> {t("{n} medya", { n: it.mediaIds.length })}
                      </span>
                    )}
                    <span>{it.useCount ? t("{n} kez paylaşıldı", { n: it.useCount }) : t("henüz paylaşılmadı")}</span>
                  </span>
                </div>
                {canEdit && editing?.id !== it.id && (
                  <span className="al-item-actions">
                    <button className="btn btn-ghost btn-sm" aria-label={t("Yukarı taşı")} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button className="btn btn-ghost btn-sm" aria-label={t("Aşağı taşı")} disabled={i === items.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>
                      <ArrowDown aria-hidden="true" />
                    </button>
                    <button className="btn btn-ghost btn-sm" aria-label={t("Düzenle")} onClick={() => setEditing({ id: it.id, text: it.content })}>
                      <Pencil aria-hidden="true" />
                    </button>
                    <button className="btn btn-ghost btn-sm al-danger" aria-label={t("Kaldır")} onClick={() => confirm(t("Bu öğe listeden kaldırılsın mı?")) && del.mutate(it.id)}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {importing && <ImportDialog base={base} onClose={() => setImporting(false)} onDone={onChange} />}
    </div>
  );
}

function ImportDialog({ base, onClose, onDone }: { base: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const q = useQuery({ queryKey: ["library", "post"], queryFn: () => api.get<LibItem[]>("/api/library?type=post") });
  const [pick, setPick] = useState<string[]>([]);
  const m = useMutation({
    mutationFn: () => api.post<{ added: number }>(`${base}/items/import`, { libraryIds: pick }),
    onSuccess: (r) => {
      toast(t("{n} öğe eklendi", { n: r.added }), "ok");
      onDone();
      onClose();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const items = q.data ?? [];
  return (
    <Modal
      title={t("Kütüphaneden ekle")}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button className="btn btn-primary" disabled={!pick.length || m.isPending} onClick={() => m.mutate()}>
            {t("{n} şablonu ekle", { n: pick.length })}
          </button>
        </>
      }
    >
      {q.isLoading ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : !items.length ? (
        <Empty icon={<BookMarked />} title={t("Kütüphanede gönderi şablonu yok")} text={t("Oluşturucuda bir gönderiyi şablon olarak kaydet.")} />
      ) : (
        <ul className="al-import">
          {items.map((it) => (
            <li key={it.id}>
              <label className="check">
                <input type="checkbox" checked={pick.includes(it.id)} onChange={(e) => setPick(e.target.checked ? [...pick, it.id] : pick.filter((x) => x !== it.id))} />
                <span>
                  <strong>{it.name}</strong>
                  <span className="muted small al-import-text">{it.content.slice(0, 120) || t("(metin yok)")}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
