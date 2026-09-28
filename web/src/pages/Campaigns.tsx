import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, CalendarPlus, Flag, Plus, Sparkles, Trash2 } from "lucide-react";
import { api, errMsg, type Campaign, type CampaignDetail, type Channel, type PlannerResult, type PostKind } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt } from "../lib/session";
import { Can, Empty, Loading, Modal, PageHead, ProviderIcon, StatusBadge, useToast } from "../components/ui";

const ALL_KINDS: PostKind[] = ["post", "story", "reel", "video", "thread"];

function PlannerModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const [form, setForm] = useState({ brief: "", goal: "", tone: "", days: 14, postsPerWeek: 4, startDate: "", mode: "draft" as "draft" | "schedule" });
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [kinds, setKinds] = useState<PostKind[]>(["post", "reel", "story"]);
  const [preview, setPreview] = useState<PlannerResult | null>(null);

  const payload = (previewOnly: boolean) => ({
    brief: form.brief,
    goal: form.goal || undefined,
    tone: form.tone || undefined,
    channelIds,
    days: form.days,
    postsPerWeek: form.postsPerWeek,
    kinds,
    startDate: form.startDate || undefined,
    mode: form.mode,
    previewOnly,
  });
  const run = useMutation({
    mutationFn: (previewOnly: boolean) => api.post<PlannerResult>("/api/planner", payload(previewOnly)),
    onSuccess: (r, previewOnly) => {
      if (previewOnly) {
        setPreview(r);
        return;
      }
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["posts"] });
      toast(t("Kampanya oluşturuldu: {n} gönderi", { n: r.items.filter((i) => i.postId).length }), "ok");
      onClose();
      if (r.campaignId) nav(`/app/campaigns/${r.campaignId}`);
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const ready = form.brief.trim().length >= 5 && channelIds.length > 0;

  return (
    <Modal
      large
      title={
        <span className="row">
          <Sparkles /> {t("AI içerik planlayıcı")}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button className="btn" disabled={!ready || run.isPending} onClick={() => run.mutate(true)}>
            {t("Önizle")}
          </button>
          <button className="btn btn-primary" disabled={!ready || run.isPending} onClick={() => run.mutate(false)}>
            <Sparkles className={run.isPending ? "spin" : ""} /> {run.isPending ? t("Planlanıyor…") : form.mode === "draft" ? t("Taslakları oluştur") : t("Oluştur ve planla")}
          </button>
        </>
      }
    >
      <div className="form">
        <div className="field">
          <label>{t("Brief")}</label>
          <textarea className="textarea" value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} placeholder={t("Örn. Kasım'da yeni kış koleksiyonunu tanıtacağız; hedef kitle 25-40 yaş kadın, ilk hafta %15 indirim kodu KIS15.")} />
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label>{t("Amaç")}</label>
            <input className="input" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder={t("satış, bilinirlik, etkileşim…")} />
          </div>
          <div className="field">
            <label>{t("Ton")}</label>
            <input className="input" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} placeholder={t("samimi, esprili, premium…")} />
          </div>
        </div>
        <div className="field">
          <label>{t("Kanallar")}</label>
          <div className="channel-pick">
            {channels.data?.map((c) => {
              const active = channelIds.includes(c.id);
              return (
                <button key={c.id} className={`pick ${active ? "active" : ""}`} aria-pressed={active} onClick={() => setChannelIds(active ? channelIds.filter((x) => x !== c.id) : [...channelIds, c.id])}>
                  <ProviderIcon provider={c.provider} size={18} /> {c.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <label>{t("İçerik türleri")}</label>
          <div className="row">
            {ALL_KINDS.map((k) => (
              <label key={k} className="check small">
                <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} /> {L.kind(k)}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-4">
          <div className="field">
            <label>{t("Kaç gün")}</label>
            <input className="input" type="number" min={1} max={60} value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>{t("Haftada gönderi")}</label>
            <input className="input" type="number" min={1} max={21} value={form.postsPerWeek} onChange={(e) => setForm({ ...form, postsPerWeek: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>{t("Başlangıç")}</label>
            <input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div className="field">
            <label>{t("Sonuç")}</label>
            <select className="select" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "draft" | "schedule" })}>
              <option value="draft">{t("Taslak (önerilen)")}</option>
              <option value="schedule">{t("Doğrudan planla")}</option>
            </select>
          </div>
        </div>
        <p className="muted small">{t("Taslak modunda gönderiler tarihli taslak olarak oluşur; medyaları ekleyip kampanya sayfasından tek tıkla planlarsın.")}</p>

        {preview && (
          <>
            <div className="divider" />
            <h3>{preview.plan.name}</h3>
            <p className="small">{preview.plan.strategy}</p>
            <div className="row">
              {preview.plan.pillars.map((p) => (
                <span key={p} className="badge">
                  {p}
                </span>
              ))}
            </div>
            <table className="table">
              <tbody>
                {preview.items.map((i) => (
                  <tr key={i.index}>
                    <td className="small muted" style={{ width: 150 }}>
                      {i.publishAt ? f.short(i.publishAt) : t("sonraki boş saat")}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{i.title}</div>
                      <div className="muted small">
                        {preview.plan.items[i.index] ? `${L.kind(preview.plan.items[i.index].kind)} · ${preview.plan.items[i.index].angle}` : ""} · {i.channels.join(", ")}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Modal>
  );
}

export function CampaignsPage() {
  const { t } = useI18n();
  const f = useFmt();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => api.get<Campaign[]>("/api/campaigns") });
  const [planner, setPlanner] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", goal: "", brief: "" });
  const create = useMutation({
    mutationFn: () => api.post<Campaign>("/api/campaigns", { name: form.name, goal: form.goal || null, brief: form.brief || null }),
    onSuccess: () => {
      setCreating(false);
      setForm({ name: "", goal: "", brief: "" });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  return (
    <>
      <PageHead
        title={t("Kampanyalar")}
        sub={t("Gönderileri bir hedef etrafında grupla; AI planlayıcıyla dakikalar içinde içerik takvimi çıkar.")}
        actions={
          <Can role="editor">
            <button className="btn" onClick={() => setCreating(true)}>
              <Plus /> {t("Boş kampanya")}
            </button>
            <button className="btn btn-primary" onClick={() => setPlanner(true)}>
              <Sparkles /> {t("AI ile planla")}
            </button>
          </Can>
        }
      />
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <div className="card">
          <Empty
            icon={<Flag />}
            title={t("Henüz kampanya yok")}
            text={t("Bir brief yaz, AI planlayıcı her kanal için metinleri ve tarihleri hazırlasın.")}
            action={
              <Can role="editor">
                <button className="btn btn-primary" onClick={() => setPlanner(true)}>
                  <Sparkles /> {t("AI ile planla")}
                </button>
              </Can>
            }
          />
        </div>
      ) : (
        <div className="grid grid-3">
          {list.data.map((c) => {
            const pct = c.postCount ? Math.round(((c.publishedCount ?? 0) / c.postCount) * 100) : 0;
            return (
              <Link key={c.id} to={`/app/campaigns/${c.id}`} className="card card-link">
                <div className="row-between">
                  <h3 className="truncate">{c.name}</h3>
                  <StatusBadge status={c.status} />
                </div>
                {c.goal && <p className="muted small truncate" style={{ marginTop: 4 }}>{c.goal}</p>}
                <div className="bar" style={{ marginTop: 12 }}>
                  <div style={{ width: `${pct}%`, background: "var(--ok)" }} />
                </div>
                <div className="row-between small muted" style={{ marginTop: 6 }}>
                  <span>{t("{p}/{n} yayınlandı", { p: c.publishedCount ?? 0, n: c.postCount ?? 0 })}</span>
                  <span>{c.nextAt ? t("sıradaki: {d}", { d: f.short(c.nextAt) }) : c.startsAt ? f.day(c.startsAt) : ""}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {planner && <PlannerModal onClose={() => setPlanner(false)} />}
      {creating && (
        <Modal
          title={t("Yeni kampanya")}
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)}>
                {t("Vazgeç")}
              </button>
              <button className="btn btn-primary" disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate()}>
                {t("Oluştur")}
              </button>
            </>
          }
        >
          <div className="form">
            <div className="field">
              <label>{t("Ad")}</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus maxLength={120} />
            </div>
            <div className="field">
              <label>{t("Amaç")}</label>
              <input className="input" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} maxLength={500} />
            </div>
            <div className="field">
              <label>{t("Brief")}</label>
              <textarea className="textarea" value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} maxLength={5000} />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function CampaignDetailPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["campaign", id], queryFn: () => api.get<CampaignDetail>(`/api/campaigns/${id}`) });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const chMap = new Map((channels.data ?? []).map((c) => [c.id, c]));
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["campaign", id] });
    qc.invalidateQueries({ queryKey: ["campaigns"] });
    qc.invalidateQueries({ queryKey: ["posts"] });
  };
  const schedule = useMutation({
    mutationFn: () => api.post<{ scheduled: number; failed: Array<{ title: string | null; error: string }> }>(`/api/campaigns/${id}/schedule`),
    onSuccess: (r) => {
      inv();
      toast(t("{n} gönderi planlandı", { n: r.scheduled }), "ok");
      if (r.failed.length) toast(r.failed.map((x) => `${x.title ?? "?"}: ${x.error}`).join("\n"), "err");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const update = useMutation({ mutationFn: (status: Campaign["status"]) => api.patch(`/api/campaigns/${id}`, { status }), onSuccess: inv, onError: (e) => toast(errMsg(e), "err") });
  const remove = useMutation({
    mutationFn: (deletePosts: boolean) => api.del(`/api/campaigns/${id}?deletePosts=${deletePosts}`),
    onSuccess: () => {
      inv();
      nav("/app/campaigns");
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  if (!q.data) return <Loading />;
  const c = q.data;
  const drafts = c.posts.filter((p) => p.status === "draft" && p.publishAt).length;

  return (
    <>
      <div className="page-head">
        <div className="row">
          <button className="btn btn-ghost btn-icon" onClick={() => nav("/app/campaigns")} aria-label={t("Geri")}>
            <ArrowLeft />
          </button>
          <div>
            <h1>{c.name}</h1>
            <p>
              {c.goal ?? ""} {c.startsAt && `· ${f.day(c.startsAt)} – ${f.day(c.endsAt)}`}
            </p>
          </div>
        </div>
        <Can role="editor">
          <div className="page-actions">
            <select className="select" style={{ width: 140 }} value={c.status} onChange={(e) => update.mutate(e.target.value as Campaign["status"])} aria-label={t("Durum")}>
              <option value="draft">{t("Taslak")}</option>
              <option value="active">{t("Aktif")}</option>
              <option value="done">{t("Bitti")}</option>
              <option value="archived">{t("Arşiv")}</option>
            </select>
            <button
              className="btn btn-danger"
              onClick={() => {
                if (!confirm(t("Kampanya silinsin mi?"))) return;
                remove.mutate(confirm(t("Kampanyadaki gönderiler de silinsin mi? (İptal: gönderiler kalır)")));
              }}
            >
              <Trash2 /> {t("Sil")}
            </button>
            <Link to={`/app/posts/new?campaign=${c.id}`} className="btn">
              <CalendarPlus /> {t("Gönderi ekle")}
            </Link>
            <button className="btn btn-primary" disabled={!drafts || schedule.isPending} onClick={() => confirm(t("{n} tarihli taslak planlansın mı?", { n: drafts })) && schedule.mutate()}>
              <CalendarCheck /> {t("Taslakları planla ({n})", { n: drafts })}
            </button>
          </div>
        </Can>
      </div>
      {c.brief && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">
            <h2>{t("Brief ve strateji")}</h2>
          </div>
          <p className="pre small">{c.brief}</p>
        </div>
      )}
      <div className="card">
        {c.posts.length === 0 ? (
          <Empty title={t("Bu kampanyada gönderi yok")} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t("Tarih")}</th>
                <th>{t("İçerik")}</th>
                <th>{t("Kanallar")}</th>
                <th>{t("Durum")}</th>
              </tr>
            </thead>
            <tbody>
              {c.posts.map((p) => (
                <tr key={p.id}>
                  <td className="small muted" style={{ width: 150 }}>
                    {p.publishAt ? f.short(p.publishAt) : "-"}
                  </td>
                  <td>
                    <Link to={`/app/posts/${p.id}`} className="truncate" style={{ display: "block", maxWidth: 380, color: "inherit" }}>
                      {p.title || p.content || t("(metin yok)")}
                    </Link>
                    <span className="muted small">
                      {L.kind(p.kind)}
                      {p.mediaIds.length === 0 && (p.kind === "reel" || p.kind === "story" || p.kind === "video") ? ` · ${t("medya eksik")}` : ""}
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: 4 }}>
                      {p.targets.map((tg) => {
                        const ch = chMap.get(tg.channelId);
                        return ch ? <ProviderIcon key={tg.id} provider={ch.provider} size={18} /> : null;
                      })}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
