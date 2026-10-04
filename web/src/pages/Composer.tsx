import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, BookMarked, Check, Clock, ExternalLink, Heart, ImagePlus, Link2, MessageCircle, Monitor, Play, Plus, Save, Send, Smartphone, Sparkles, Trash2, Wand2, X } from "lucide-react";
import type { LibraryItem } from "./Library";
import {
  api,
  errMsg,
  PROVIDER_NAME,
  type Campaign,
  type Channel,
  type FreeSlot,
  type GeneratedContent,
  type Media,
  type OrgInfo,
  type Post,
  type PostComment,
  type PostDetail,
  type PostKind,
  type ProviderId,
  type Recurrence,
  type SettingField,
  type Signature,
  type Tag,
  type ValidationResult,
} from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Modal, ProviderIcon, StatusBadge, useLocalState, useToast } from "../components/ui";
import { copyText } from "../lib/clipboard";

interface TargetState {
  channelId: string;
  content: string | null;
  settings: Record<string, unknown>;
}

interface Preset {
  id: string;
  name: string;
  channelIds: string[];
  settings: Record<string, Record<string, unknown>>;
}

const KINDS: PostKind[] = ["post", "story", "reel", "video", "thread"];

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const h = setTimeout(() => setD(v), ms);
    return () => clearTimeout(h);
  }, [v, ms]);
  return d;
}

export default function ComposerPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const [device, setDevice] = useLocalState<"mobile" | "desktop">("sp_preview_device", "mobile");
  const L = useLabels();
  const f = useFmt();
  const s = useSession();

  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const media = useQuery({ queryKey: ["media"], queryFn: () => api.get<Media[]>("/api/media") });
  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/api/tags") });
  const campaigns = useQuery({ queryKey: ["campaigns"], queryFn: () => api.get<Campaign[]>("/api/campaigns") });
  const signatures = useQuery({ queryKey: ["signatures"], queryFn: () => api.get<Signature[]>("/api/signatures") });
  const presets = useQuery({ queryKey: ["presets"], queryFn: () => api.get<Preset[]>("/api/presets") });
  const library = useQuery({ queryKey: ["library"], queryFn: () => api.get<LibraryItem[]>("/api/library") });
  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const existing = useQuery({
    queryKey: ["post", id],
    queryFn: () => api.get<PostDetail>(`/api/posts/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.status === "publishing" ? 3000 : false),
  });

  const initialDate = search.get("date");
  const [kind, setKind] = useState<PostKind>("post");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [targets, setTargets] = useState<TargetState[]>([]);
  const initialTime = search.get("time");
  const [publishAt, setPublishAt] = useState<string>(
    initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? `${initialDate}T${initialTime && /^\d{2}:\d{2}$/.test(initialTime) ? initialTime : "10:00"}` : "",
  );
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [campaignId, setCampaignId] = useState<string>(search.get("campaign") ?? "");
  const [comments, setComments] = useState<PostComment[]>([]);
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [notes, setNotes] = useState("");
  const [applySignature, setApplySignature] = useState(true);
  const [openOverride, setOpenOverride] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [aiTone, setAiTone] = useState("");
  const [aiGoal, setAiGoal] = useState("");
  const [aiResult, setAiResult] = useState<GeneratedContent | null>(null);
  const [slots, setSlots] = useState<FreeSlot[] | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [noteText, setNoteText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (existing.data && !loaded) {
      const p = existing.data;
      setKind(p.kind);
      setTitle(p.title ?? "");
      setContent(p.content);
      setMediaIds(p.mediaIds);
      setTargets(p.targets.map((x) => ({ channelId: x.channelId, content: x.content, settings: x.settings })));
      setPublishAt(f.toInput(p.publishAt));
      setTags(p.tags);
      setCampaignId(p.campaignId ?? "");
      setComments(p.comments);
      setRecurrence(p.recurrence);
      setNotes(p.notes ?? "");
      setApplySignature(false);
      setLoaded(true);
    }
  }, [existing.data, loaded, f]);

  // Kütüphaneden şablonla başla: /app/posts/new?template=…
  const templateId = !id ? search.get("template") : null;
  useEffect(() => {
    if (!templateId || loaded) return;
    api
      .post<LibraryItem>(`/api/library/${templateId}/use`)
      .then((tpl) => {
        setKind(tpl.kind);
        setTitle(tpl.name);
        setContent(tpl.content);
        setMediaIds(tpl.mediaIds);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [templateId, loaded]);

  /** Hashtag grubu metnin sonuna eklenir; gönderi şablonu metni, medyayı ve türü getirir */
  const applyLibrary = (itemId: string) => {
    const it = library.data?.find((x) => x.id === itemId);
    if (!it) return;
    if (it.type === "hashtags") setContent((c) => `${c.trimEnd()}${c.trim() ? "\n\n" : ""}${it.content}`);
    else {
      if (content.trim() && !confirm(t("Mevcut metnin yerine şablon gelsin mi?"))) return;
      setKind(it.kind);
      setContent(it.content);
      if (it.mediaIds.length) setMediaIds(it.mediaIds);
    }
    void api.post(`/api/library/${it.id}/use`).catch(() => undefined);
  };
  const saveToLibrary = useMutation({
    mutationFn: (name: string) => api.post<LibraryItem>("/api/library", { type: "post", name, kind, content, mediaIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library"] });
      toast(t("Kütüphaneye kaydedildi"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const chMap = useMemo(() => new Map((channels.data ?? []).map((c) => [c.id, c])), [channels.data]);
  const supports = (c: Channel) => c.capabilities[kind] ?? false;
  const selectedMedia = mediaIds.map((m) => media.data?.find((x) => x.id === m)).filter((m): m is Media => Boolean(m));
  const selectedChannels = targets.map((x) => chMap.get(x.channelId)).filter((c): c is Channel => Boolean(c));
  const selectedProviders = [...new Set(selectedChannels.map((c) => c.provider))];
  const commentsSupported = selectedChannels.some((c) => c.capabilities.comments);
  const features = org.data?.usage.plan.features;
  const post = existing.data;
  const readOnly = post?.status === "publishing" || !s.can("editor");
  const hasAutoSignature = (signatures.data ?? []).some((x) => x.autoAdd);

  // Tür değişince desteklemeyen kanalları çıkar
  useEffect(() => {
    if (!channels.data || !loaded) return;
    setTargets((ts) => ts.filter((x) => {
      const c = chMap.get(x.channelId);
      return !c || c.capabilities[kind];
    }));
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id) setLoaded(true);
  }, [id]);

  const toggleTarget = (c: Channel) => {
    setTargets((ts) => (ts.some((x) => x.channelId === c.id) ? ts.filter((x) => x.channelId !== c.id) : [...ts, { channelId: c.id, content: null, settings: {} }]));
    setSlots(null);
  };
  const updateTarget = (channelId: string, patch: Partial<TargetState>) => setTargets((ts) => ts.map((x) => (x.channelId === channelId ? { ...x, ...patch } : x)));

  const body = (publish: string | null, draft: boolean) => ({
    title: title || null,
    kind,
    content,
    mediaIds,
    publishAt: publish,
    draft,
    targets: targets.map((x) => ({ channelId: x.channelId, content: x.content, settings: x.settings })),
    tags,
    campaignId: campaignId || null,
    comments: comments.filter((c) => c.text.trim()),
    recurrence,
    notes: notes || null,
    applySignature: id ? false : applySignature,
  });

  // Canlı doğrulama (kaydetmeden)
  const validationInput = useDebounced(JSON.stringify(targets.length ? body(publishAt ? f.fromInput(publishAt) : null, false) : null), 700);
  const validation = useQuery({
    queryKey: ["validate", validationInput],
    queryFn: () => api.post<ValidationResult>("/api/posts/validate", JSON.parse(validationInput)),
    enabled: validationInput !== "null" && !readOnly,
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["posts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["post", id] });
    qc.invalidateQueries({ queryKey: ["org"] });
  };

  const save = useMutation({
    mutationFn: async (mode: "draft" | "schedule" | "now") => {
      const when = publishAt ? f.fromInput(publishAt) : null;
      if (mode === "schedule" && !when) throw new Error(t("Planlamak için tarih seç"));
      if (id) {
        if (mode === "now") {
          await api.put<Post>(`/api/posts/${id}`, body(null, true));
          return api.post<Post>(`/api/posts/${id}/publish`);
        }
        return api.put<Post>(`/api/posts/${id}`, body(when, mode === "draft"));
      }
      return api.post<Post>("/api/posts", body(mode === "now" ? "now" : when, mode === "draft"));
    },
    onSuccess: (p, mode) => {
      invalidate();
      setLoaded(false);
      if (p.status === "pending_approval") toast(t("Onaya gönderildi. Bir yönetici onaylayınca yayınlanacak."), "info");
      else if (mode === "now") toast(p.status === "published" ? t("Yayınlandı") : p.status === "partial" ? t("Kısmen yayınlandı; hata detayı aşağıda") : p.status === "publishing" ? t("Yayınlanıyor…") : t("Yayın başarısız; hata detayı aşağıda"), p.status === "failed" || p.status === "partial" ? "err" : "ok");
      else toast(mode === "draft" ? t("Taslak kaydedildi") : t("Planlandı: {date}", { date: f.date(p.publishAt) }), "ok");
      if (!id) nav(`/app/posts/${p.id}`, { replace: true });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/api/posts/${id}`),
    onSuccess: () => {
      toast(t("Gönderi silindi; 30 gün içinde Silinenler bölümünden geri alabilirsin."), "ok");
      invalidate();
      nav("/app/posts");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const decide = useMutation({
    mutationFn: (ok: boolean) => {
      if (ok) return api.post<Post>(`/api/posts/${id}/approve`);
      const reason = prompt(t("Red nedeni (isteğe bağlı)"));
      if (reason === null) return Promise.reject(new Error(t("İptal edildi")));
      return api.post<Post>(`/api/posts/${id}/reject`, { reason: reason || null });
    },
    onSuccess: (_p, ok) => {
      invalidate();
      setLoaded(false);
      toast(ok ? t("Onaylandı") : t("Reddedildi, taslağa döndü"), "ok");
    },
    onError: (e) => errMsg(e) !== t("İptal edildi") && toast(errMsg(e), "err"),
  });

  const cancelPlan = useMutation({
    mutationFn: () => api.post<Post>(`/api/posts/${id}/cancel`),
    onSuccess: () => {
      invalidate();
      setLoaded(false);
      toast(t("Plan iptal edildi, taslağa döndü"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const fd = new FormData();
      for (const file of Array.from(files)) fd.append("files", file);
      return api.upload<Media[]>("/api/media", fd);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["media"] });
      setMediaIds((m) => [...m, ...r.map((x) => x.id)]);
      toast(t("{n} dosya yüklendi", { n: r.length }), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const importMedia = useMutation({
    mutationFn: () => api.post<Media>("/api/media/import", { url: importUrl }),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["media"] });
      setMediaIds((x) => [...x, m.id]);
      setImportUrl("");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const findSlots = useMutation({
    mutationFn: () => api.get<FreeSlot[]>(`/api/slots?channelIds=${targets.map((x) => x.channelId).join(",")}&count=6`),
    onSuccess: (r) => {
      setSlots(r);
      if (!r.length) toast(t("Önümüzdeki günlerde boş saat bulunamadı"), "info");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const generate = useMutation({
    mutationFn: () =>
      api.post<GeneratedContent>("/api/ai/generate", {
        topic: aiTopic,
        kind,
        platforms: selectedProviders,
        tone: aiTone || undefined,
        goal: aiGoal || undefined,
      }),
    onSuccess: (r) => setAiResult(r),
    onError: (e) => toast(errMsg(e), "err"),
  });

  const improve = useMutation({
    mutationFn: (instruction: string) => api.post<{ text: string }>("/api/ai/improve", { text: content, instruction, platform: selectedProviders.length === 1 ? selectedProviders[0] : undefined }),
    onSuccess: (r) => setContent(r.text),
    onError: (e) => toast(errMsg(e), "err"),
  });

  const addNote = useMutation({
    mutationFn: () => api.post(`/api/posts/${id}/notes`, { text: noteText }),
    onSuccess: () => {
      setNoteText("");
      qc.invalidateQueries({ queryKey: ["post", id] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const removeNote = useMutation({ mutationFn: (noteId: string) => api.del(`/api/posts/${id}/notes/${noteId}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["post", id] }) });

  const createPreview = useMutation({
    mutationFn: () => api.post<{ token: string }>(`/api/posts/${id}/preview-links`, { days: 14 }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["post", id] });
      const url = `${window.location.origin}/preview/${r.token}`;
      void copyText(url).then((ok) => toast(ok ? t("Önizleme linki kopyalandı") : url, ok ? "ok" : "info"));
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const revokePreview = useMutation({ mutationFn: (token: string) => api.del(`/api/preview-links/${token}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["post", id] }) });

  const savePreset = useMutation({
    mutationFn: (name: string) => api.post("/api/presets", { name, channelIds: targets.map((x) => x.channelId) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["presets"] });
      toast(t("Kanal seti kaydedildi"), "ok");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const applyAi = () => {
    if (!aiResult) return;
    const first = aiResult.variants[0];
    if (first) setContent(first.text);
    for (const x of targets) {
      const prov = chMap.get(x.channelId)?.provider;
      const v = aiResult.variants.find((y) => y.platform === prov);
      if (v) {
        const settings = { ...x.settings };
        if (v.title && (prov === "youtube" || prov === "tiktok")) settings.title = v.title;
        updateTarget(x.channelId, { content: aiResult.variants.length > 1 ? v.text : null, settings });
      }
    }
    if (first?.firstComment && commentsSupported && !comments.length) setComments([{ text: first.firstComment, delayMinutes: 0 }]);
    if (!title && first?.hook) setTitle(first.hook.slice(0, 80));
    setAiOpen(false);
    toast(t("AI metinleri uygulandı; kanal-özel metinler için kanal kartlarına bak"), "ok");
  };

  const addTag = (v: string) => {
    const x = v.trim().replace(/^#/, "");
    if (x && !tags.includes(x)) setTags([...tags, x]);
    setTagInput("");
  };

  const errors = validation.data?.errors ?? [];
  const warnings = validation.data?.warnings ?? [];
  const canPublishStatus = !post || ["draft", "scheduled", "failed", "partial", "cancelled", "pending_approval"].includes(post.status);

  return (
    <>
      <div className="page-head">
        <div className="row">
          <button className="btn btn-ghost btn-icon" onClick={() => nav("/app/posts")} aria-label={t("Geri")}>
            <ArrowLeft />
          </button>
          <div>
            <h1>{id ? (readOnly && !s.can("editor") ? t("Gönderi") : t("Gönderiyi düzenle")) : t("Yeni gönderi")}</h1>
            <p>
              {post ? (
                <span className="row">
                  <StatusBadge status={post.status} /> {post.publishAt && <span className="muted small">{f.date(post.publishAt)}</span>} {post.publishedAt && <span className="muted small">{t("yayın: {date}", { date: f.date(post.publishedAt) })}</span>}
                  <span className="muted small">· {post.source}</span>
                </span>
              ) : (
                t("Bir metin yaz, kanalları seç, medya ekle ve planla.")
              )}
            </p>
          </div>
        </div>
        {s.can("editor") && (
          <div className="page-actions">
            {post?.status === "pending_approval" && s.can("admin") && (
              <>
                <button className="btn" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
                  <X /> {t("Reddet")}
                </button>
                <button className="btn btn-primary" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
                  <Check /> {t("Onayla")}
                </button>
              </>
            )}
            {id && post?.status !== "publishing" && (
              <button className="btn btn-danger" onClick={() => confirm(t("Gönderi silinsin mi?")) && remove.mutate()}>
                <Trash2 /> {t("Sil")}
              </button>
            )}
            {(post?.status === "scheduled" || post?.status === "pending_approval") && (
              <button className="btn" onClick={() => cancelPlan.mutate()} disabled={cancelPlan.isPending}>
                {t("Planı iptal et")}
              </button>
            )}
            <button className="btn" disabled={readOnly || save.isPending || !targets.length} onClick={() => save.mutate("draft")}>
              <Save /> {t("Taslak")}
            </button>
            <button className="btn" disabled={readOnly || save.isPending || !targets.length || !publishAt || errors.length > 0} onClick={() => save.mutate("schedule")}>
              <Clock /> {t("Planla")}
            </button>
            {canPublishStatus && (
              <button className="btn btn-primary" disabled={readOnly || save.isPending || !targets.length || errors.length > 0} onClick={() => confirm(t("Seçili kanallara şimdi yayınlansın mı?")) && save.mutate("now")}>
                <Play /> {save.isPending ? "…" : t("Şimdi yayınla")}
              </button>
            )}
          </div>
        )}
      </div>

      {post?.rejectionReason !== null && post?.rejectionReason !== undefined && post.status === "draft" && (
        <div className="notice notice-err" style={{ marginBottom: 16 }}>
          <strong>{t("Reddedildi.")}</strong> {post.rejectionReason || t("Neden belirtilmedi.")}
        </div>
      )}

      <div className="composer">
        <div className="form">
          <div className="card form">
            <div className="field">
              <label>{t("Tür")}</label>
              <div className="segmented" role="group">
                {KINDS.map((k) => (
                  <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)} disabled={readOnly}>
                    {L.kind(k)}
                  </button>
                ))}
              </div>
              <span className="help">
                {kind === "story" && t("Hikaye: 1 görsel (9:16) ya da kısa video. Instagram ve Facebook Sayfası destekler.")}
                {kind === "reel" && t("Reel: dikey MP4. Instagram, Facebook, TikTok, YouTube (Shorts).")}
                {kind === "thread" && t("Zincir: parçaları --- ile ayır. X ve Threads.")}
                {kind === "video" && t("Video: YouTube/TikTok/LinkedIn/Facebook/Telegram; başlığı kanal ayarından gir.")}
                {kind === "post" && t("Normal gönderi: metin + isteğe bağlı görsel/video.")}
              </span>
            </div>

            <div className="field">
              <div className="row-between">
                <label>{t("Kanallar")}</label>
                <div className="row" style={{ gap: 6 }}>
                  {(presets.data?.length ?? 0) > 0 && (
                    <select
                      className="select select-sm"
                      value=""
                      disabled={readOnly}
                      onChange={(e) => {
                        const p = presets.data?.find((x) => x.id === e.target.value);
                        if (p) setTargets(p.channelIds.filter((cid) => chMap.has(cid)).map((cid) => ({ channelId: cid, content: null, settings: p.settings[cid] ?? {} })));
                      }}
                      aria-label={t("Kanal seti")}
                    >
                      <option value="">{t("Kanal seti…")}</option>
                      {presets.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {targets.length > 1 && !readOnly && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        const n = prompt(t("Set adı"));
                        if (n?.trim()) savePreset.mutate(n.trim());
                      }}
                    >
                      {t("Seti kaydet")}
                    </button>
                  )}
                </div>
              </div>
              {channels.data?.length === 0 && (
                <span className="help">
                  <Link to="/app/channels">{t("Önce Kanallar sayfasından bir hesap bağla.")}</Link>
                </span>
              )}
              <div className="channel-pick">
                {channels.data?.map((c) => {
                  const ok = supports(c) && c.status !== "disabled";
                  const active = targets.some((x) => x.channelId === c.id);
                  return (
                    <button
                      key={c.id}
                      className={`pick ${active ? "active" : ""}`}
                      disabled={!ok || readOnly}
                      title={ok ? c.name : c.status === "disabled" ? t("Kanal devre dışı") : t("{p} bu türü desteklemiyor", { p: PROVIDER_NAME[c.provider] })}
                      onClick={() => toggleTarget(c)}
                      aria-pressed={active}
                    >
                      <ProviderIcon provider={c.provider} size={18} />
                      <span className="truncate" style={{ maxWidth: 150 }}>
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <label>{t("Başlık (panelde görünür, isteğe bağlı)")}</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} placeholder={t("Örn. Eylül kampanyası duyurusu")} maxLength={200} />
            </div>

            <div className="field">
              <div className="row-between">
                <label>{t("Metin")}</label>
                {!readOnly && (
                  <div className="row" style={{ gap: 6 }}>
                    {(library.data?.length ?? 0) > 0 && (
                      <select className="select select-sm" value="" aria-label={t("Kütüphaneden ekle")} onChange={(e) => e.target.value && applyLibrary(e.target.value)}>
                        <option value="">{t("Şablon / hashtag…")}</option>
                        {library.data!.some((x) => x.type === "hashtags") && (
                          <optgroup label={t("Hashtag grupları")}>
                            {library.data!.filter((x) => x.type === "hashtags").map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {library.data!.some((x) => x.type === "post") && (
                          <optgroup label={t("Gönderi şablonları")}>
                            {library.data!.filter((x) => x.type === "post").map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    )}
                    {(content.trim() || mediaIds.length > 0) && (
                      <button
                        className="btn btn-sm"
                        title={t("Kütüphaneye kaydet")}
                        aria-label={t("Kütüphaneye kaydet")}
                        disabled={saveToLibrary.isPending}
                        onClick={() => {
                          const n = prompt(t("Şablon adı"), title || content.slice(0, 40));
                          if (n?.trim()) saveToLibrary.mutate(n.trim());
                        }}
                      >
                        <BookMarked />
                      </button>
                    )}
                    {content.trim() && (
                      <select
                        className="select select-sm"
                        value=""
                        disabled={improve.isPending}
                        onChange={(e) => e.target.value && improve.mutate(e.target.value)}
                        aria-label={t("AI ile düzenle")}
                      >
                        <option value="">{improve.isPending ? t("Düzenleniyor…") : t("AI ile düzenle…")}</option>
                        <option value={t("Daha kısa ve vurucu yap")}>{t("Daha kısa ve vurucu yap")}</option>
                        <option value={t("Daha samimi bir dille yeniden yaz")}>{t("Daha samimi yap")}</option>
                        <option value={t("Daha profesyonel bir dille yeniden yaz")}>{t("Daha profesyonel yap")}</option>
                        <option value={t("Uygun yerlere birkaç emoji ekle")}>{t("Emoji ekle")}</option>
                        <option value={t("Sonuna 5 alakalı hashtag ekle")}>{t("Hashtag ekle")}</option>
                        <option value="Translate to English, keep the tone">{t("İngilizceye çevir")}</option>
                        <option value="Türkçeye çevir, tonu koru">{t("Türkçeye çevir")}</option>
                        <option value={t("Yazım ve dil bilgisi hatalarını düzelt")}>{t("Yazımı düzelt")}</option>
                      </select>
                    )}
                    <button className="btn btn-sm" onClick={() => setAiOpen(true)} disabled={!targets.length}>
                      <Sparkles /> {t("AI ile yaz")}
                    </button>
                  </div>
                )}
              </div>
              <textarea
                className="textarea"
                style={{ minHeight: 180 }}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={readOnly}
                placeholder={kind === "thread" ? t("Parça 1\n---\nParça 2\n---\nParça 3") : t("Ne paylaşmak istiyorsun?")}
              />
              <div className="row-between">
                {!id && hasAutoSignature ? (
                  <label className="check small">
                    <input type="checkbox" checked={applySignature} onChange={(e) => setApplySignature(e.target.checked)} /> {t("Otomatik imzayı ekle")}
                  </label>
                ) : (
                  <span />
                )}
                <div className="row" style={{ gap: 12 }}>
                  {selectedProviders.map((p) => {
                    const ch = selectedChannels.find((c) => c.provider === p);
                    const max = ch?.capabilities.maxTextLength ?? 0;
                    const tg = targets.find((x) => chMap.get(x.channelId)?.provider === p);
                    const len = (tg?.content ?? content).length;
                    return (
                      <span key={p} className={`counter ${max && len > max ? "over" : ""}`}>
                        {PROVIDER_NAME[p]}: {len}/{max}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="field">
              <div className="row-between">
                <label>{t("Medya ({n})", { n: selectedMedia.length })}</label>
                {!readOnly && (
                  <div className="row">
                    <input ref={fileRef} type="file" multiple accept="image/*,video/*" style={{ display: "none" }} onChange={(e) => e.target.files && upload.mutate(e.target.files)} />
                    <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                      <ImagePlus /> {upload.isPending ? t("Yükleniyor…") : t("Yükle")}
                    </button>
                  </div>
                )}
              </div>
              {selectedMedia.length > 0 && (
                <div className="media-grid">
                  {selectedMedia.map((m, i) => (
                    <div key={m.id} className="media-thumb selected" title={m.originalName}>
                      {m.kind === "video" ? <video src={m.url} muted /> : <img src={m.url} alt={m.altText ?? ""} />}
                      {!readOnly && (
                        <button className="rm" onClick={() => setMediaIds((x) => x.filter((y) => y !== m.id))} aria-label={t("Kaldır")}>
                          ✕
                        </button>
                      )}
                      {!readOnly && i > 0 && (
                        <button className="rm" style={{ left: 4, right: "auto" }} onClick={() => setMediaIds((x) => { const n = [...x]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} aria-label={t("Öne al")}>
                          ◀
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!readOnly && (
                <details>
                  <summary className="small muted" style={{ cursor: "pointer" }}>
                    {t("Kütüphaneden seç ({n}) ya da URL'den al", { n: media.data?.length ?? 0 })}
                  </summary>
                  <div className="row" style={{ marginTop: 8 }}>
                    <input className="input" style={{ flex: 1 }} placeholder="https://…/image.jpg" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} />
                    <button className="btn btn-sm" disabled={!/^https?:\/\//.test(importUrl) || importMedia.isPending} onClick={() => importMedia.mutate()}>
                      <Link2 /> {t("URL'den al")}
                    </button>
                  </div>
                  <div className="media-grid" style={{ marginTop: 8 }}>
                    {media.data?.map((m) => (
                      <div
                        key={m.id}
                        className={`media-thumb ${mediaIds.includes(m.id) ? "selected" : ""}`}
                        title={m.originalName}
                        role="button"
                        tabIndex={0}
                        onClick={() => setMediaIds((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))}
                      >
                        {m.kind === "video" ? <video src={m.url} muted /> : <img src={m.url} alt={m.altText ?? ""} />}
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <span className="help">{t("Instagram, TikTok ve Threads medyayı herkese açık URL'den çeker; sunucu adresi https olmalı.")}</span>
            </div>

            <div className="field">
              <label>{t("Zamanlama ({tz})", { tz: f.tz })}</label>
              <div className="row">
                <input className="input" type="datetime-local" style={{ width: 240 }} value={publishAt} onChange={(e) => setPublishAt(e.target.value)} disabled={readOnly} />
                {!readOnly && (
                  <>
                    <button className="btn btn-sm" onClick={() => setPublishAt(f.toInput(new Date(Date.now() + 3600_000).toISOString()))}>
                      {t("+1 saat")}
                    </button>
                    <button className="btn btn-sm" onClick={() => setPublishAt(`${f.toInput(new Date(Date.now() + 86400_000).toISOString()).slice(0, 10)}T10:00`)}>
                      {t("Yarın 10:00")}
                    </button>
                    <button className="btn btn-sm" disabled={!targets.length || findSlots.isPending} onClick={() => findSlots.mutate()}>
                      <Clock /> {t("Sonraki boş saat")}
                    </button>
                    {publishAt && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setPublishAt("")}>
                        {t("Temizle")}
                      </button>
                    )}
                  </>
                )}
              </div>
              {slots && slots.length > 0 && (
                <div className="row" style={{ gap: 6 }}>
                  {slots.map((sl) => (
                    <button key={sl.at} className={`chip ${f.toInput(sl.at) === publishAt ? "active" : ""}`} onClick={() => setPublishAt(f.toInput(sl.at))}>
                      {sl.local}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <details className="field" open={Boolean(recurrence)}>
              <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>
                {t("Tekrar")} {recurrence && <span className="badge badge-accent">{t("her {n} {unit}", { n: recurrence.every, unit: t(recurrence.unit === "day" ? "gün" : recurrence.unit === "week" ? "hafta" : "ay") })}</span>}
              </summary>
              <div className="row" style={{ marginTop: 8 }}>
                <label className="check">
                  <input type="checkbox" checked={Boolean(recurrence)} disabled={readOnly} onChange={(e) => setRecurrence(e.target.checked ? { every: 1, unit: "week", until: null, remaining: null } : null)} /> {t("Tekrarlayan gönderi")}
                </label>
                {recurrence && (
                  <>
                    <span className="muted">{t("her")}</span>
                    <input className="input" type="number" min={1} max={365} style={{ width: 80 }} value={recurrence.every} disabled={readOnly} onChange={(e) => setRecurrence({ ...recurrence, every: Math.max(1, Number(e.target.value)) })} />
                    <select className="select" style={{ width: 110 }} value={recurrence.unit} disabled={readOnly} onChange={(e) => setRecurrence({ ...recurrence, unit: e.target.value as Recurrence["unit"] })}>
                      <option value="day">{t("gün")}</option>
                      <option value="week">{t("hafta")}</option>
                      <option value="month">{t("ay")}</option>
                    </select>
                    <span className="muted">{t("en fazla")}</span>
                    <input className="input" type="number" min={1} max={1000} style={{ width: 90 }} placeholder="∞" value={recurrence.remaining ?? ""} disabled={readOnly} onChange={(e) => setRecurrence({ ...recurrence, remaining: e.target.value ? Number(e.target.value) : null })} />
                    <span className="muted">{t("kez")}</span>
                  </>
                )}
              </div>
            </details>

            {commentsSupported && (
              <div className="field">
                <div className="row-between">
                  <label>{t("Otomatik yorumlar")}</label>
                  {!readOnly && comments.length < 10 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setComments([...comments, { text: "", delayMinutes: comments.length ? 5 : 0 }])}>
                      <Plus /> {t("Yorum ekle")}
                    </button>
                  )}
                </div>
                {comments.map((c, i) => (
                  <div key={i} className="row" style={{ alignItems: "flex-start" }}>
                    <textarea className="textarea" style={{ minHeight: 44, flex: 1 }} value={c.text} disabled={readOnly} placeholder={i === 0 ? t("İlk yorum: link, ek hashtag…") : t("Yorum metni")} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                    <input className="input" type="number" min={0} max={10080} style={{ width: 90 }} value={c.delayMinutes} disabled={readOnly} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, delayMinutes: Number(e.target.value) } : x)))} title={t("Yayından kaç dakika sonra")} />
                    <span className="muted small" style={{ marginTop: 10 }}>{t("dk")}</span>
                    {!readOnly && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setComments(comments.filter((_, j) => j !== i))} aria-label={t("Kaldır")}>
                        <X />
                      </button>
                    )}
                  </div>
                ))}
                {comments.length === 0 && <span className="help">{t("Yorum destekleyen kanallarda yayından sonra otomatik yorum atılır (ör. link ilk yorumda).")}</span>}
              </div>
            )}

            <div className="grid grid-2">
              <div className="field">
                <label>{t("Etiketler")}</label>
                <div className="tag-input">
                  {tags.map((x) => (
                    <span key={x} className="tag">
                      {tagsQ.data?.find((y) => y.id === x)?.name ?? x}
                      {!readOnly && (
                        <button onClick={() => setTags(tags.filter((y) => y !== x))} aria-label={t("Kaldır")}>
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  {!readOnly && (
                    <input
                      list="tag-suggest"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          addTag(tagInput);
                        }
                      }}
                      onBlur={() => tagInput && addTag(tagInput)}
                      placeholder={tags.length ? "" : t("ürün, duyuru…")}
                    />
                  )}
                  <datalist id="tag-suggest">
                    {tagsQ.data?.map((x) => (
                      <option key={x.id} value={x.name} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="field">
                <label>{t("Kampanya")}</label>
                <select className="select" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={readOnly}>
                  <option value="">{t("— yok —")}</option>
                  {campaigns.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>{t("İç not (yayınlanmaz)")}</label>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} placeholder={t("Örn. görseli tasarımcı güncelleyecek")} maxLength={5000} />
            </div>
          </div>

          {targets.length > 0 && (
            <div className="card">
              <div className="card-title">
                <h2>{t("Kanal bazlı ayarlar")}</h2>
                <span className="muted small">{t("Metni ve platform seçeneklerini kanal başına özelleştir")}</span>
              </div>
              {targets.map((x) => {
                const c = chMap.get(x.channelId);
                if (!c) return null;
                const fields = c.settingFields.filter((fl) => !fl.appliesTo || fl.appliesTo.includes(kind));
                const result = post?.targets.find((y) => y.channelId === x.channelId);
                const isOpen = openOverride === x.channelId;
                return (
                  <div key={x.channelId} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
                    <div className="row-between" style={{ cursor: "pointer" }} onClick={() => setOpenOverride(isOpen ? null : x.channelId)} role="button" aria-expanded={isOpen}>
                      <span className="row">
                        <ProviderIcon provider={c.provider} size={20} /> <strong>{c.name}</strong> {x.content !== null && <span className="badge badge-accent">{t("özel metin")}</span>}{" "}
                        {Object.keys(x.settings).length > 0 && <span className="badge">{t("{n} ayar", { n: Object.keys(x.settings).length })}</span>}
                      </span>
                      <span className="row">
                        {result && <StatusBadge status={result.status} />}
                        {result?.externalUrl && (
                          <a href={result.externalUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" onClick={(e) => e.stopPropagation()}>
                            <ExternalLink /> {t("Aç")}
                          </a>
                        )}
                        <span className="muted small">{isOpen ? "▲" : "▼"}</span>
                      </span>
                    </div>
                    {result?.error && (
                      <div className="small" style={{ color: "var(--err)", marginTop: 6 }}>
                        {result.error}
                        {result.nextAttemptAt && ` · ${t("tekrar: {date}", { date: f.time(result.nextAttemptAt) })}`}
                      </div>
                    )}
                    {result?.metrics && Object.keys(result.metrics).length > 0 && (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        {Object.entries(result.metrics).map(([k, v]) => `${k}: ${f.num(v)}`).join(" · ")}
                      </div>
                    )}
                    {isOpen && (
                      <div className="form" style={{ marginTop: 10 }}>
                        <div className="field">
                          <div className="row-between">
                            <label>{t("Bu kanala özel metin")}</label>
                            {!readOnly &&
                              (x.content !== null ? (
                                <button className="btn btn-ghost btn-sm" onClick={() => updateTarget(x.channelId, { content: null })}>
                                  {t("Ana metni kullan")}
                                </button>
                              ) : (
                                <button className="btn btn-ghost btn-sm" onClick={() => updateTarget(x.channelId, { content })}>
                                  {t("Özelleştir")}
                                </button>
                              ))}
                          </div>
                          {x.content !== null && <textarea className="textarea" value={x.content} onChange={(e) => updateTarget(x.channelId, { content: e.target.value })} disabled={readOnly} />}
                        </div>
                        {fields.length > 0 && (
                          <div className="grid grid-2">
                            {fields.map((fl) => (
                              <FieldInput key={fl.key} field={fl} value={x.settings[fl.key]} onChange={(v) => updateTarget(x.channelId, { settings: { ...x.settings, [fl.key]: v } })} disabled={readOnly} />
                            ))}
                          </div>
                        )}
                        {c.capabilities.mediaNote && <span className="help">{c.capabilities.mediaNote}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {post && (
            <div className="card">
              <div className="card-title">
                <h2>{t("Ekip notları")}</h2>
              </div>
              <div className="form">
                {post.notesList.length === 0 && <p className="muted small">{t("Henüz not yok. Onay, düzeltme ya da soruları burada konuşun.")}</p>}
                {post.notesList.map((n) => (
                  <div key={n.id} className="note">
                    <div className="row-between small">
                      <span>
                        <strong>{n.authorName}</strong> {n.source === "preview" && <span className="badge">{t("müşteri")}</span>} <span className="muted">· {f.ago(n.createdAt)}</span>
                      </span>
                      {s.can("editor") && (
                        <button className="btn btn-ghost btn-sm" onClick={() => removeNote.mutate(n.id)} aria-label={t("Sil")}>
                          <X />
                        </button>
                      )}
                    </div>
                    <div className="pre">{n.text}</div>
                  </div>
                ))}
                <div className="row">
                  <input className="input" style={{ flex: 1 }} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("Not yaz…")} onKeyDown={(e) => e.key === "Enter" && noteText.trim() && addNote.mutate()} />
                  <button className="btn" disabled={!noteText.trim() || addNote.isPending} onClick={() => addNote.mutate()} aria-label={t("Gönder")}>
                    <Send />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="form">
          {!readOnly && targets.length > 0 && (errors.length > 0 || warnings.length > 0 || validation.data) && (
            <div className={`card ${errors.length ? "card-err" : warnings.length ? "card-warn" : ""}`}>
              <div className="card-title">
                <h2>{t("Kontrol")}</h2>
                {validation.isFetching && <span className="muted small">…</span>}
              </div>
              {errors.length === 0 && warnings.length === 0 && (
                <p className="small" style={{ color: "var(--ok)" }}>
                  <Check style={{ width: 14, verticalAlign: "middle" }} /> {t("Yayına hazır")}
                  {validation.data?.status === "pending_approval" && ` · ${t("onaya gidecek")}`}
                </p>
              )}
              <ul className="bullets small">
                {errors.map((e) => (
                  <li key={e} style={{ color: "var(--err)" }}>
                    {e}
                  </li>
                ))}
                {warnings.map((w) => (
                  <li key={w} style={{ color: "var(--warn)" }}>
                    <AlertTriangle style={{ width: 12, verticalAlign: "middle" }} /> {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <div className="card-title">
              <h2>{t("Önizleme")}</h2>
              <div className="segmented segmented-sm" role="group" aria-label={t("Önizleme cihazı")}>
                <button type="button" className={device === "mobile" ? "active" : ""} aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>
                  <Smartphone aria-hidden="true" /> {t("Mobil")}
                </button>
                <button type="button" className={device === "desktop" ? "active" : ""} aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>
                  <Monitor aria-hidden="true" /> {t("Masaüstü")}
                </button>
              </div>
            </div>
            {targets.length === 0 ? (
              <p className="muted">{t("Kanal seçince her platform için önizleme burada görünür.")}</p>
            ) : (
              <div className={`pv-device pv-${device}`}>
                <div className="pv-screen form">
                {targets.map((x) => {
                  const c = chMap.get(x.channelId);
                  if (!c) return null;
                  const text = x.content ?? content;
                  const parts = kind === "thread" ? text.split(/\n\s*---\s*\n/) : [text];
                  const max = c.capabilities.maxTextLength ?? 0;
                  const over = max > 0 && text.length > max;
                  return (
                    <div key={x.channelId} className="preview">
                      <div className="preview-head">
                        <ProviderIcon provider={c.provider} size={22} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                          <div className="muted small">
                            {PROVIDER_NAME[c.provider]} · {L.kind(kind)}
                            {x.settings.title ? ` · ${String(x.settings.title)}` : ""}
                          </div>
                        </div>
                        {max > 0 && (
                          <span className={`pv-count${over ? " pv-count--over" : ""}`}>
                            {over && <AlertTriangle aria-hidden="true" />}
                            {text.length}/{max}
                            {over && <span className="sr-only"> {t("sınır aşıldı")}</span>}
                          </span>
                        )}
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
                      {parts.map((p, i) => (
                        <p key={i} className="pre" style={{ fontSize: 13, paddingLeft: kind === "thread" ? 10 : 0, borderLeft: kind === "thread" ? "2px solid var(--border-2)" : "none", marginBottom: 6 }}>
                          {p || <span className="muted">{t("(boş)")}</span>}
                        </p>
                      ))}
                      {comments[0]?.text && c.capabilities.comments && <p className="muted small">💬 {comments[0].text}</p>}
                      <div className="pv-actions" aria-hidden="true">
                        <Heart />
                        <MessageCircle />
                        <Send />
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            )}
            <p className="muted small" style={{ marginTop: 10 }}>{t("Önizleme yaklaşıktır; platform yayında küçük farklar gösterebilir.")}</p>
          </div>

          {post && s.can("editor") && (
            <div className="card">
              <div className="card-title">
                <h2>{t("Müşteri önizlemesi")}</h2>
              </div>
              {features?.previewLinks === false ? (
                <p className="muted small">
                  {t("Bu özellik mevcut planında yok.")} <Link to="/app/billing">{t("Planları gör")}</Link>
                </p>
              ) : (
                <div className="form">
                  <p className="muted small">{t("Giriş gerektirmeyen bir link oluştur; müşterin gönderiyi görüp yorum bırakabilir. 14 gün geçerli.")}</p>
                  {post.previewLinks.map((pl) => (
                    <div key={pl.token} className="row-between small">
                      <a href={`/preview/${pl.token}`} target="_blank" rel="noreferrer" className="truncate" style={{ maxWidth: 240 }}>
                        /preview/{pl.token.slice(0, 8)}…
                      </a>
                      <span className="row" style={{ gap: 4 }}>
                        <span className="muted">{pl.expiresAt ? f.day(pl.expiresAt) : "∞"}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => void copyText(`${window.location.origin}/preview/${pl.token}`).then((ok) => toast(ok ? t("Kopyalandı") : t("Kopyalanamadı; metni seçip elle kopyala"), ok ? "ok" : "err"))}>
                          {t("Kopyala")}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => revokePreview.mutate(pl.token)} aria-label={t("İptal et")}>
                          <X />
                        </button>
                      </span>
                    </div>
                  ))}
                  <button className="btn btn-sm" onClick={() => createPreview.mutate()} disabled={createPreview.isPending}>
                    <Link2 /> {t("Yeni önizleme linki")}
                  </button>
                </div>
              )}
            </div>
          )}

          {post && post.commentJobs.length > 0 && (
            <div className="card">
              <div className="card-title">
                <h2>{t("Yorum işleri")}</h2>
              </div>
              <table className="table">
                <tbody>
                  {post.commentJobs.map((j) => (
                    <tr key={j.id}>
                      <td className="small truncate" style={{ maxWidth: 200 }}>{j.text}</td>
                      <td className="small muted">{f.short(j.runAt)}</td>
                      <td>
                        <span className={`badge ${j.status === "done" ? "badge-ok" : j.status === "failed" ? "badge-err" : ""}`} title={j.error ?? ""}>
                          {j.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {aiOpen && (
        <Modal
          title={
            <span className="row">
              <Sparkles /> {t("AI ile içerik üret")}
            </span>
          }
          onClose={() => setAiOpen(false)}
          large
          footer={
            <>
              <button className="btn" onClick={() => setAiOpen(false)}>
                {t("Kapat")}
              </button>
              {aiResult && (
                <button className="btn btn-primary" onClick={applyAi}>
                  <Wand2 /> {t("Metinleri uygula")}
                </button>
              )}
            </>
          }
        >
          <div className="form">
            <div className="field">
              <label>{t("Konu / brief")}</label>
              <textarea className="textarea" style={{ minHeight: 80 }} value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} placeholder={t("Örn. Yeni sezon zeytinyağı hasadı başladı; ilk 100 siparişe ücretsiz kargo. Ürün: 500ml erken hasat.")} />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label>{t("Ton (isteğe bağlı)")}</label>
                <input className="input" value={aiTone} onChange={(e) => setAiTone(e.target.value)} placeholder={t("samimi, sakin, bilgilendirici")} />
              </div>
              <div className="field">
                <label>{t("Amaç (isteğe bağlı)")}</label>
                <input className="input" value={aiGoal} onChange={(e) => setAiGoal(e.target.value)} placeholder={t("satış, etkileşim, duyuru, takipçi")} />
              </div>
            </div>
            <div className="row-between">
              <span className="muted small">
                {t("Hedef: {p} · Tür: {k} · Marka hafızası otomatik eklenir", { p: selectedProviders.map((p) => PROVIDER_NAME[p]).join(", "), k: L.kind(kind) })}
              </span>
              <button className="btn btn-primary" disabled={generate.isPending || aiTopic.length < 3} onClick={() => generate.mutate()}>
                <Sparkles className={generate.isPending ? "spin" : ""} /> {generate.isPending ? t("Üretiliyor…") : t("Üret")}
              </button>
            </div>
            {aiResult && (
              <>
                <div className="divider" />
                <div className="field">
                  <label>{t("Alternatif kancalar")}</label>
                  {aiResult.alternativeHooks.map((h, i) => (
                    <div key={i} className="row-between preview" style={{ padding: 10 }}>
                      <span>{h}</span>
                      <button className="btn btn-sm" onClick={() => setContent((c) => h + "\n\n" + c)}>
                        {t("Başa ekle")}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="grid grid-2">
                  {aiResult.variants.map((v) => (
                    <div key={v.platform} className="preview">
                      <div className="preview-head">
                        <ProviderIcon provider={v.platform as ProviderId} size={20} />
                        <strong>{PROVIDER_NAME[v.platform as ProviderId] ?? v.platform}</strong>
                      </div>
                      {v.title && (
                        <div className="small" style={{ marginBottom: 6 }}>
                          <strong>{t("Başlık:")}</strong> {v.title}
                        </div>
                      )}
                      <p className="pre" style={{ fontSize: 13 }}>{v.text}</p>
                      {v.firstComment && <p className="small muted" style={{ marginTop: 6 }}>💬 {v.firstComment}</p>}
                      {v.visualDirection && (
                        <p className="small muted" style={{ marginTop: 8 }}>
                          <strong>{t("Görsel:")}</strong> {v.visualDirection}
                        </p>
                      )}
                      <div className="row" style={{ marginTop: 8 }}>
                        <button className="btn btn-sm" onClick={() => setContent(v.text)}>
                          {t("Ana metin yap")}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            void copyText(v.text).then((ok) => toast(ok ? t("Kopyalandı") : t("Kopyalanamadı; metni seçip elle kopyala"), ok ? "ok" : "err"));
                          }}
                        >
                          {t("Kopyala")}
                        </button>
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
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {field.help && <span className="help">{field.help}</span>}
      </div>
    );
  }
  return (
    <div className="field">
      <label>{field.label}</label>
      <input
        className="input"
        type={field.type === "number" ? "number" : "text"}
        value={String(value ?? field.default ?? "")}
        onChange={(e) => onChange(field.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
        disabled={disabled}
      />
      {field.help && <span className="help">{field.help}</span>}
    </div>
  );
}
