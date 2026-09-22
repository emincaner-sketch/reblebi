import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImagePlus, Play, Save, Sparkles, Trash2, Wand2, ExternalLink } from "lucide-react";
import {
  api,
  fmtDate,
  fromLocalInput,
  KIND_LABEL,
  PROVIDER_LABEL,
  toLocalInput,
  type Channel,
  type GeneratedContent,
  type Media,
  type Post,
  type PostKind,
  type ProviderId,
  type ProviderInfo,
  type SettingField,
} from "../lib/api";
import { Modal, ProviderIcon, StatusBadge, useToast } from "../components/ui";

interface TargetState {
  channelId: string;
  content: string | null;
  settings: Record<string, unknown>;
}

const KINDS: PostKind[] = ["post", "story", "reel", "video", "thread"];

export default function ComposerPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api.get<ProviderInfo[]>("/api/providers") });
  const media = useQuery({ queryKey: ["media"], queryFn: () => api.get<Media[]>("/api/media") });
  const existing = useQuery({ queryKey: ["post", id], queryFn: () => api.get<Post>(`/api/posts/${id}`), enabled: Boolean(id), refetchInterval: (q) => (q.state.data?.status === "publishing" ? 3000 : false) });

  const [kind, setKind] = useState<PostKind>("post");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [targets, setTargets] = useState<TargetState[]>([]);
  const [publishAt, setPublishAt] = useState<string>(search.get("tarih") ? toLocalInput(search.get("tarih")) : "");
  const [openOverride, setOpenOverride] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [aiTone, setAiTone] = useState("");
  const [aiGoal, setAiGoal] = useState("");
  const [aiResult, setAiResult] = useState<GeneratedContent | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (existing.data && !loaded) {
      const p = existing.data;
      setKind(p.kind);
      setTitle(p.title ?? "");
      setContent(p.content);
      setMediaIds(p.mediaIds);
      setTargets(p.targets.map((t) => ({ channelId: t.channelId, content: t.content, settings: t.settings })));
      setPublishAt(toLocalInput(p.publishAt));
      setLoaded(true);
    }
  }, [existing.data, loaded]);

  const provMap = useMemo(() => new Map((providers.data ?? []).map((p) => [p.id, p])), [providers.data]);
  const chMap = useMemo(() => new Map((channels.data ?? []).map((c) => [c.id, c])), [channels.data]);
  const supports = (c: Channel) => provMap.get(c.provider)?.capabilities[kind] ?? false;
  const selectedMedia = mediaIds.map((m) => media.data?.find((x) => x.id === m)).filter((m): m is Media => Boolean(m));

  const toggleTarget = (c: Channel) => {
    setTargets((t) => (t.some((x) => x.channelId === c.id) ? t.filter((x) => x.channelId !== c.id) : [...t, { channelId: c.id, content: null, settings: {} }]));
  };
  const updateTarget = (channelId: string, patch: Partial<TargetState>) => setTargets((t) => t.map((x) => (x.channelId === channelId ? { ...x, ...patch } : x)));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["posts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["post", id] });
  };

  const save = useMutation({
    mutationFn: async (mode: "draft" | "schedule" | "now") => {
      const body = {
        title: title || null,
        kind,
        content,
        mediaIds,
        publishAt: mode === "now" ? "now" : mode === "schedule" ? fromLocalInput(publishAt) : null,
        status: mode === "draft" ? "draft" : "scheduled",
        targets: targets.map((t) => ({ channelId: t.channelId, content: t.content, settings: t.settings })),
      };
      if (mode === "schedule" && !body.publishAt) throw new Error("Planlamak için tarih seç");
      if (id) {
        const updated = await api.put<Post>(`/api/posts/${id}`, { ...body, publishAt: mode === "now" ? new Date().toISOString() : body.publishAt });
        if (mode === "now") return api.post<Post>(`/api/posts/${id}/publish`);
        return updated;
      }
      return api.post<Post>("/api/posts", body);
    },
    onSuccess: (p, mode) => {
      invalidate();
      if (mode === "now") toast(p.status === "published" ? "Yayınlandı" : p.status === "partial" ? "Kısmen yayınlandı; hata detayı aşağıda" : "Yayın başarısız; hata detayı aşağıda", p.status === "published" ? "ok" : "err");
      else toast(mode === "draft" ? "Taslak kaydedildi" : "Planlandı", "ok");
      if (!id) nav(`/gonderiler/${p.id}`, { replace: true });
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Hata", "err"),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/api/posts/${id}`),
    onSuccess: () => {
      invalidate();
      nav("/gonderiler");
    },
  });

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      return api.upload<Media[]>("/api/media", fd);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["media"] });
      setMediaIds((m) => [...m, ...r.map((x) => x.id)]);
      toast(`${r.length} dosya yüklendi`, "ok");
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Yükleme hatası", "err"),
  });

  const generate = useMutation({
    mutationFn: () =>
      api.post<GeneratedContent>("/api/ai/generate", {
        topic: aiTopic,
        kind,
        platforms: Array.from(new Set(targets.map((t) => chMap.get(t.channelId)?.provider).filter(Boolean))) as ProviderId[],
        tone: aiTone || undefined,
        goal: aiGoal || undefined,
      }),
    onSuccess: (r) => setAiResult(r),
    onError: (e) => toast(e instanceof Error ? e.message : "AI hatası", "err"),
  });

  const applyAi = () => {
    if (!aiResult) return;
    const first = aiResult.variants[0];
    if (first) setContent(first.text);
    for (const t of targets) {
      const prov = chMap.get(t.channelId)?.provider;
      const v = aiResult.variants.find((x) => x.platform === prov);
      if (v) {
        const settings = { ...t.settings };
        if (v.title && (prov === "youtube" || prov === "tiktok")) settings.title = v.title;
        updateTarget(t.channelId, { content: aiResult.variants.length > 1 ? v.text : null, settings });
      }
    }
    if (!title && first?.hook) setTitle(first.hook.slice(0, 80));
    setAiOpen(false);
    toast("AI metinleri uygulandı; kanal-özel metinler için kanal kartlarına bak", "ok");
  };

  const post = existing.data;
  const readOnly = post?.status === "publishing";
  const selectedProviders = Array.from(new Set(targets.map((t) => chMap.get(t.channelId)?.provider).filter(Boolean))) as ProviderId[];

  return (
    <>
      <div className="page-head">
        <div className="row">
          <button className="btn btn-ghost btn-icon" onClick={() => nav("/gonderiler")}><ArrowLeft /></button>
          <div>
            <h1>{id ? "Gönderiyi düzenle" : "Yeni gönderi"}</h1>
            <p>{post ? <span className="row"><StatusBadge status={post.status} /> {post.publishedAt && <span className="muted small">yayın: {fmtDate(post.publishedAt)}</span>}</span> : "Bir metin yaz, kanalları seç, medya ekle ve planla."}</p>
          </div>
        </div>
        <div className="page-actions">
          {id && <button className="btn btn-danger" onClick={() => confirm("Gönderi silinsin mi?") && remove.mutate()}><Trash2 /> Sil</button>}
          <button className="btn" disabled={readOnly || save.isPending || !targets.length} onClick={() => save.mutate("draft")}><Save /> Taslak</button>
          <button className="btn" disabled={readOnly || save.isPending || !targets.length || !publishAt} onClick={() => save.mutate("schedule")}>Planla</button>
          <button className="btn btn-primary" disabled={readOnly || save.isPending || !targets.length} onClick={() => confirm("Seçili kanallara şimdi yayınlansın mı?") && save.mutate("now")}><Play /> {save.isPending ? "…" : "Şimdi yayınla"}</button>
        </div>
      </div>

      <div className="composer">
        <div className="form">
          <div className="card form">
            <div className="field">
              <label>Tür</label>
              <div className="segmented">
                {KINDS.map((k) => <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)} disabled={readOnly}>{KIND_LABEL[k]}</button>)}
              </div>
              <span className="help">
                {kind === "story" && "Hikaye: 1 görsel (9:16) ya da kısa video. Instagram ve Facebook Sayfası destekler."}
                {kind === "reel" && "Reel: dikey MP4. Instagram, Facebook, TikTok, YouTube (Shorts)."}
                {kind === "thread" && "Zincir: parçaları --- ile ayır. X ve Threads."}
                {kind === "video" && "Video: YouTube/TikTok/LinkedIn/Facebook/Telegram; başlığı kanal ayarından gir."}
                {kind === "post" && "Normal gönderi: metin + isteğe bağlı görsel/video."}
              </span>
            </div>

            <div className="field">
              <label>Kanallar</label>
              {channels.data?.length === 0 && <span className="help">Önce Kanallar sayfasından bir hesap bağla.</span>}
              <div className="channel-pick">
                {channels.data?.map((c) => {
                  const ok = supports(c) && c.status !== "disabled";
                  const active = targets.some((t) => t.channelId === c.id);
                  return (
                    <button key={c.id} className={`pick ${active ? "active" : ""}`} disabled={!ok || readOnly} title={ok ? c.name : `${PROVIDER_LABEL[c.provider]} bu türü desteklemiyor`} onClick={() => toggleTarget(c)}>
                      <ProviderIcon provider={c.provider} size={18} />
                      <span className="truncate" style={{ maxWidth: 150 }}>{c.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <label>Başlık (panelde görünür, isteğe bağlı)</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} placeholder="Örn. Eylül kampanyası duyurusu" />
            </div>

            <div className="field">
              <div className="row-between">
                <label>Metin</label>
                <button className="btn btn-sm" onClick={() => setAiOpen(true)} disabled={!targets.length}><Sparkles /> AI ile yaz</button>
              </div>
              <textarea className="textarea" style={{ minHeight: 180 }} value={content} onChange={(e) => setContent(e.target.value)} disabled={readOnly} placeholder={kind === "thread" ? "Parça 1\n---\nParça 2\n---\nParça 3" : "Ne paylaşmak istiyorsun?"} />
              <div className="row" style={{ justifyContent: "flex-end", gap: 12 }}>
                {selectedProviders.map((p) => {
                  const max = provMap.get(p)?.capabilities.maxTextLength ?? 0;
                  const t = targets.find((x) => chMap.get(x.channelId)?.provider === p);
                  const len = (t?.content ?? content).length;
                  return <span key={p} className={`counter ${max && len > max ? "over" : ""}`}>{PROVIDER_LABEL[p]}: {len}/{max}</span>;
                })}
              </div>
            </div>

            <div className="field">
              <div className="row-between">
                <label>Medya ({selectedMedia.length})</label>
                <div className="row">
                  <input ref={fileRef} type="file" multiple accept="image/*,video/*" style={{ display: "none" }} onChange={(e) => e.target.files && upload.mutate(e.target.files)} />
                  <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={readOnly || upload.isPending}><ImagePlus /> {upload.isPending ? "Yükleniyor…" : "Yükle"}</button>
                </div>
              </div>
              {selectedMedia.length > 0 && (
                <div className="media-grid">
                  {selectedMedia.map((m) => (
                    <div key={m.id} className="media-thumb selected" title={m.originalName}>
                      {m.kind === "video" ? <video src={m.url} muted /> : <img src={m.url} alt="" />}
                      {!readOnly && <button className="rm" onClick={() => setMediaIds((x) => x.filter((i) => i !== m.id))}>✕</button>}
                    </div>
                  ))}
                </div>
              )}
              <details>
                <summary className="small muted" style={{ cursor: "pointer" }}>Kütüphaneden seç ({media.data?.length ?? 0})</summary>
                <div className="media-grid" style={{ marginTop: 8 }}>
                  {media.data?.map((m) => (
                    <div key={m.id} className={`media-thumb ${mediaIds.includes(m.id) ? "selected" : ""}`} title={m.originalName} onClick={() => !readOnly && setMediaIds((x) => (x.includes(m.id) ? x.filter((i) => i !== m.id) : [...x, m.id]))}>
                      {m.kind === "video" ? <video src={m.url} muted /> : <img src={m.url} alt="" />}
                    </div>
                  ))}
                </div>
              </details>
              <span className="help">Instagram, TikTok ve Threads medyayı <strong>herkese açık URL</strong>'den çeker: PUBLIC_URL https olmalı (Ayarlar &gt; Sistem).</span>
            </div>

            <div className="field">
              <label>Zamanlama</label>
              <div className="row">
                <input className="input" type="datetime-local" style={{ width: 240 }} value={publishAt} onChange={(e) => setPublishAt(e.target.value)} disabled={readOnly} />
                <button className="btn btn-sm" onClick={() => setPublishAt(toLocalInput(new Date(Date.now() + 3600_000).toISOString()))}>+1 saat</button>
                <button className="btn btn-sm" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); setPublishAt(toLocalInput(d.toISOString())); }}>Yarın 10:00</button>
                {publishAt && <button className="btn btn-ghost btn-sm" onClick={() => setPublishAt("")}>Temizle</button>}
              </div>
            </div>
          </div>

          {targets.length > 0 && (
            <div className="card">
              <div className="card-title"><h2>Kanal bazlı ayarlar</h2><span className="muted small">Metni ve platform seçeneklerini kanal başına özelleştir</span></div>
              {targets.map((t) => {
                const c = chMap.get(t.channelId);
                if (!c) return null;
                const prov = provMap.get(c.provider);
                const fields = (prov?.settingFields ?? []).filter((f) => !f.appliesTo || f.appliesTo.includes(kind));
                const result = post?.targets.find((x) => x.channelId === t.channelId);
                const isOpen = openOverride === t.channelId;
                return (
                  <div key={t.channelId} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
                    <div className="row-between" style={{ cursor: "pointer" }} onClick={() => setOpenOverride(isOpen ? null : t.channelId)}>
                      <span className="row"><ProviderIcon provider={c.provider} size={20} /> <strong>{c.name}</strong> {t.content !== null && <span className="badge badge-accent">özel metin</span>} {Object.keys(t.settings).length > 0 && <span className="badge">{Object.keys(t.settings).length} ayar</span>}</span>
                      <span className="row">
                        {result && <StatusBadge status={result.status} />}
                        {result?.externalUrl && <a href={result.externalUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm"><ExternalLink /> Aç</a>}
                        <span className="muted small">{isOpen ? "▲" : "▼"}</span>
                      </span>
                    </div>
                    {result?.error && <div className="small" style={{ color: "var(--err)", marginTop: 6 }}>{result.error}{result.nextAttemptAt && ` · tekrar: ${fmtDate(result.nextAttemptAt, { hour: "2-digit", minute: "2-digit" })}`}</div>}
                    {isOpen && (
                      <div className="form" style={{ marginTop: 10 }}>
                        <div className="field">
                          <div className="row-between">
                            <label>Bu kanala özel metin</label>
                            {t.content !== null ? <button className="btn btn-ghost btn-sm" onClick={() => updateTarget(t.channelId, { content: null })}>Ana metni kullan</button> : <button className="btn btn-ghost btn-sm" onClick={() => updateTarget(t.channelId, { content })}>Özelleştir</button>}
                          </div>
                          {t.content !== null && <textarea className="textarea" value={t.content} onChange={(e) => updateTarget(t.channelId, { content: e.target.value })} disabled={readOnly} />}
                        </div>
                        {fields.length > 0 && (
                          <div className="grid grid-2">
                            {fields.map((f) => <FieldInput key={f.key} field={f} value={t.settings[f.key]} onChange={(v) => updateTarget(t.channelId, { settings: { ...t.settings, [f.key]: v } })} disabled={readOnly} />)}
                          </div>
                        )}
                        {prov?.capabilities.mediaNote && <span className="help">{prov.capabilities.mediaNote}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <div className="card-title"><h2>Önizleme</h2></div>
            {targets.length === 0 ? (
              <p className="muted">Kanal seçince her platform için önizleme burada görünür.</p>
            ) : (
              <div className="form">
                {targets.map((t) => {
                  const c = chMap.get(t.channelId);
                  if (!c) return null;
                  const text = t.content ?? content;
                  const parts = kind === "thread" ? text.split(/\n\s*---\s*\n/) : [text];
                  return (
                    <div key={t.channelId} className="preview">
                      <div className="preview-head">
                        <ProviderIcon provider={c.provider} size={22} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                          <div className="muted small">{PROVIDER_LABEL[c.provider]} · {KIND_LABEL[kind]}{t.settings.title ? ` · ${String(t.settings.title)}` : ""}</div>
                        </div>
                      </div>
                      {selectedMedia.length > 0 && (
                        <div className="media-grid" style={{ marginBottom: 8, gridTemplateColumns: kind === "story" ? "120px" : undefined }}>
                          {selectedMedia.slice(0, kind === "story" ? 1 : 4).map((m) => (
                            <div key={m.id} className="media-thumb" style={kind === "story" ? { aspectRatio: "9/16" } : undefined}>
                              {m.kind === "video" ? <video src={m.url} muted /> : <img src={m.url} alt="" />}
                            </div>
                          ))}
                        </div>
                      )}
                      {parts.map((p, i) => <p key={i} className="pre" style={{ fontSize: 13, paddingLeft: kind === "thread" ? 10 : 0, borderLeft: kind === "thread" ? "2px solid var(--border-2)" : "none", marginBottom: 6 }}>{p || <span className="muted">(boş)</span>}</p>)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {aiOpen && (
        <Modal
          title={<span className="row"><Sparkles /> AI ile içerik üret</span>}
          onClose={() => setAiOpen(false)}
          large
          footer={
            <>
              <button className="btn" onClick={() => setAiOpen(false)}>Kapat</button>
              {aiResult && <button className="btn btn-primary" onClick={applyAi}><Wand2 /> Metinleri uygula</button>}
            </>
          }
        >
          <div className="form">
            <div className="field">
              <label>Konu / brief</label>
              <textarea className="textarea" style={{ minHeight: 80 }} value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} placeholder="Örn. Yeni sezon zeytinyağı hasadı başladı; ilk 100 siparişe ücretsiz kargo. Ürün: 500ml erken hasat." />
            </div>
            <div className="grid grid-2">
              <div className="field"><label>Ton (isteğe bağlı)</label><input className="input" value={aiTone} onChange={(e) => setAiTone(e.target.value)} placeholder="samimi, sakin, bilgilendirici" /></div>
              <div className="field"><label>Amaç (isteğe bağlı)</label><input className="input" value={aiGoal} onChange={(e) => setAiGoal(e.target.value)} placeholder="satış, etkileşim, duyuru, takipçi" /></div>
            </div>
            <div className="row-between">
              <span className="muted small">Hedef: {selectedProviders.map((p) => PROVIDER_LABEL[p]).join(", ")} · Tür: {KIND_LABEL[kind]} · Marka hafızası otomatik eklenir</span>
              <button className="btn btn-primary" disabled={generate.isPending || aiTopic.length < 3} onClick={() => generate.mutate()}><Sparkles className={generate.isPending ? "spin" : ""} /> {generate.isPending ? "Üretiliyor…" : "Üret"}</button>
            </div>
            {aiResult && (
              <>
                <div className="divider" />
                <div className="field">
                  <label>Alternatif kancalar</label>
                  {aiResult.alternativeHooks.map((h, i) => (
                    <div key={i} className="row-between preview" style={{ padding: 10 }}>
                      <span>{h}</span>
                      <button className="btn btn-sm" onClick={() => setContent((c) => h + "\n\n" + c)}>Başa ekle</button>
                    </div>
                  ))}
                </div>
                <div className="grid grid-2">
                  {aiResult.variants.map((v) => (
                    <div key={v.platform} className="preview">
                      <div className="preview-head">
                        <ProviderIcon provider={v.platform as ProviderId} size={20} />
                        <strong>{PROVIDER_LABEL[v.platform as ProviderId] ?? v.platform}</strong>
                        {v.bestTimeHint && <span className="badge" style={{ marginLeft: "auto" }}>{v.bestTimeHint}</span>}
                      </div>
                      {v.title && <div className="small" style={{ marginBottom: 6 }}><strong>Başlık:</strong> {v.title}</div>}
                      <p className="pre" style={{ fontSize: 13 }}>{v.text}</p>
                      {v.visualDirection && <p className="small muted" style={{ marginTop: 8 }}><strong>Görsel:</strong> {v.visualDirection}</p>}
                      <div className="row" style={{ marginTop: 8 }}>
                        <button className="btn btn-sm" onClick={() => setContent(v.text)}>Ana metin yap</button>
                        <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(v.text); toast("Kopyalandı", "ok"); }}>Kopyala</button>
                      </div>
                    </div>
                  ))}
                </div>
                {aiResult.notes && <p className="muted small">{aiResult.notes}</p>}
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function FieldInput({ field, value, onChange, disabled }: { field: SettingField; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  if (field.type === "boolean") {
    return (
      <label className="check">
        <input type="checkbox" checked={Boolean(value ?? field.default ?? false)} onChange={(e) => onChange(e.target.checked)} disabled={disabled} /> {field.label}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <div className="field">
        <label>{field.label}</label>
        <select className="select" value={String(value ?? field.default ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {field.help && <span className="help">{field.help}</span>}
      </div>
    );
  }
  return (
    <div className="field">
      <label>{field.label}</label>
      <input className="input" type={field.type === "number" ? "number" : "text"} value={String(value ?? field.default ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      {field.help && <span className="help">{field.help}</span>}
    </div>
  );
}
