import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, MessageCircle, Pencil, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { api, errMsg, type Channel, type CommentRule, type PrivateReply, type PrivateReplyStatus } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useFmt } from "../../lib/session";
import { Can, Empty, Modal, useToast } from "../../components/ui";

/** Sunucudaki BOT_NOTICE ile aynı (önizleme için) */
const BOT_NOTICE = "(Bu mesaj otomatik gönderildi.)";
const DM_MAX = 900;
/** Düğmeli mesaj (button template) Meta sınırı; otomatik mesaj notu da sayılır */
const DM_MAX_WITH_BUTTONS = 640;
const BUTTON_TITLE_MAX = 20;

type EditingCommentRule = Omit<CommentRule, "id" | "stats"> & { id?: string };

const EMPTY: EditingCommentRule = {
  name: "",
  enabled: 0,
  channelId: null,
  mediaIds: [],
  matchType: "keyword",
  pattern: "",
  dmText: "",
  publicReplies: [],
  includeReplies: 0,
  botNotice: 1,
  buttons: [],
  priority: 100,
};

type RuleButton = CommentRule["buttons"][number];
const isLink = (b: RuleButton) => b.url !== null && b.url !== undefined;

interface FeedItem {
  id: string;
  caption: string;
  imageUrl: string | null;
  permalink: string | null;
  timestamp: string;
}

const STATUS_BADGE: Record<PrivateReplyStatus, string> = {
  queued: "badge-info",
  sending: "badge-info",
  sent: "badge-ok",
  failed: "badge-err",
  skipped: "badge-warn",
  expired: "badge-warn",
};

/**
 * Yorumdan DM'e: gönderiye yorum yapan kişiye özel DM (Instagram/Facebook private reply).
 * Kurallar kapalı oluşur; açmak kullanıcının kararıdır.
 */
export function CommentToDmTab({ channels, inboxEnabled }: { channels: Channel[]; inboxEnabled: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const fmt = useFmt();
  const [editing, setEditing] = useState<EditingCommentRule | null>(null);

  const metaChannels = channels.filter((c) => c.provider === "instagram" || c.provider === "facebook");
  const rules = useQuery({ queryKey: ["comment-rules"], queryFn: () => api.get<CommentRule[]>("/api/comment-rules") });
  const log = useQuery({ queryKey: ["private-replies"], queryFn: () => api.get<PrivateReply[]>("/api/private-replies?limit=20") });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["comment-rules"] });
    void qc.invalidateQueries({ queryKey: ["private-replies"] });
  };

  const save = useMutation({
    mutationFn: ({ id, ...body }: EditingCommentRule) => (id ? api.put(`/api/comment-rules/${id}`, body) : api.post("/api/comment-rules", body)),
    onSuccess: () => {
      toast(t("Kural kaydedildi"), "ok");
      setEditing(null);
      refresh();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const toggle = useMutation({
    mutationFn: (r: CommentRule) => api.put(`/api/comment-rules/${r.id}`, { enabled: r.enabled ? 0 : 1 }),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), "err"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/comment-rules/${id}`),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), "err"),
  });

  const onToggle = (r: CommentRule) => {
    if (!r.enabled && !window.confirm(t("Kural açılınca, uyan yorumları yazan gerçek kişilere DM gider. Açılsın mı?"))) return;
    toggle.mutate(r);
  };
  const channelName = (id: string | null) => (id ? (channels.find((c) => c.id === id)?.name ?? "?") : t("Tüm Instagram/Facebook kanalları"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card small" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <AlertTriangle style={{ width: 18, color: "var(--warn)", flexShrink: 0 }} />
        <div>
          {t("Gönderine yorum yazan kişiye bir kez özel DM gider (yorum başına tek mesaj, yorumdan sonraki 7 gün içinde, kişi başına gönderi başına bir kez). Meta'nın mesaj ve yorum izinleri onaylanmadan yorumlar gelmez.")}
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Can role="admin">
          <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })} disabled={!inboxEnabled || !metaChannels.length}>
            <Plus /> {t("Yeni yorum kuralı")}
          </button>
        </Can>
      </div>

      {rules.isLoading ? (
        <div className="card muted small">{t("Kurallar yükleniyor…")}</div>
      ) : !rules.data?.length ? (
        <Empty
          icon={<MessageCircle style={{ width: 36, color: "var(--accent)" }} />}
          title={t("Henüz yorum kuralı yok")}
          text={
            metaChannels.length
              ? t("Örnek: \"link\" yazan herkese uygulama linkini DM ile gönder.")
              : t("Önce bir Instagram ya da Facebook kanalı bağla.")
          }
        />
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>{t("Kural")}</th>
                <th>{t("Tetikleyici")}</th>
                <th>{t("DM")}</th>
                <th>{t("Son 30 gün")}</th>
                <th>{t("Durum")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    <div className="muted small">{channelName(r.channelId)}</div>
                    <div className="muted small">{r.mediaIds.length ? t("{n} gönderi", { n: r.mediaIds.length }) : t("Tüm gönderiler")}</div>
                  </td>
                  <td>
                    <span className="badge small">{r.matchType === "any" ? t("Her yorum") : t("Anahtar Kelime")}</span>
                    {r.matchType === "keyword" && r.pattern && <div className="muted small pre">{r.pattern}</div>}
                  </td>
                  <td>
                    <div className="muted small pre truncate" style={{ maxWidth: 260 }}>
                      {r.dmText}
                    </div>
                    {r.publicReplies.length > 0 && <div className="muted small">{t("+ {n} açık cevap varyasyonu", { n: r.publicReplies.length })}</div>}
                  </td>
                  <td className="small">
                    {t("{sent} gönderildi", { sent: r.stats?.sent ?? 0 })}
                    {(r.stats?.queued ?? 0) + (r.stats?.sending ?? 0) > 0 && <div className="muted">{t("{n} kuyrukta", { n: (r.stats?.queued ?? 0) + (r.stats?.sending ?? 0) })}</div>}
                    {(r.stats?.failed ?? 0) > 0 && <div style={{ color: "var(--err)" }}>{t("{n} başarısız", { n: r.stats?.failed ?? 0 })}</div>}
                  </td>
                  <td>
                    <Can role="admin" fallback={r.enabled ? t("Açık") : t("Kapalı")}>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onToggle(r)} aria-label={r.enabled ? t("Kapat") : t("Aç")} title={r.enabled ? t("Kapat") : t("Aç")}>
                        {r.enabled ? <ToggleRight style={{ color: "var(--ok)", width: 22 }} /> : <ToggleLeft style={{ color: "var(--text-3)", width: 22 }} />}
                      </button>
                    </Can>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Can role="admin">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(r)} aria-label={t("Düzenle")}>
                        <Pencil style={{ width: 14 }} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: "var(--err)" }}
                        onClick={() => window.confirm(t("Kural silinsin mi?")) && remove.mutate(r.id)}
                        aria-label={t("Sil")}
                      >
                        <Trash2 style={{ width: 14 }} />
                      </button>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <div className="card-title" style={{ padding: "14px 16px 0" }}>
          <h3>{t("Son gönderimler")}</h3>
        </div>
        {!log.data?.length ? (
          <div className="muted small" style={{ padding: 16 }}>
            {t("Henüz yorumdan DM gönderimi yok.")}
          </div>
        ) : (
          <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>{t("Zaman")}</th>
                <th>{t("Kişi")}</th>
                <th>{t("Yorum")}</th>
                <th>{t("Durum")}</th>
              </tr>
            </thead>
            <tbody>
              {log.data.map((p) => (
                <tr key={`${p.channelId}:${p.commentId}`}>
                  <td className="small">{fmt.short(p.createdAt)}</td>
                  <td className="small">{p.commenterName ?? p.commenterId}</td>
                  <td className="small truncate" style={{ maxWidth: 280 }}>
                    {p.commentText}
                  </td>
                  <td className="small">
                    <span className={`badge small ${STATUS_BADGE[p.status]}`}>{statusLabel(p.status, t)}</span>
                    {p.error && <div className="muted small truncate" style={{ maxWidth: 260 }} title={p.error}>{p.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && <CommentRuleEditor rule={editing} channels={metaChannels} onChange={setEditing} onClose={() => setEditing(null)} onSave={(r) => save.mutate(r)} saving={save.isPending} />}
    </div>
  );
}

function statusLabel(s: PrivateReplyStatus, t: (k: string) => string): string {
  return { queued: t("Kuyrukta"), sending: t("Gönderiliyor"), sent: t("Gönderildi"), failed: t("Başarısız"), skipped: t("Atlandı"), expired: t("Süresi doldu") }[s];
}

function CommentRuleEditor({
  rule,
  channels,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  rule: EditingCommentRule;
  channels: Channel[];
  onChange: (r: EditingCommentRule) => void;
  onClose: () => void;
  onSave: (r: EditingCommentRule) => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<EditingCommentRule>) => onChange({ ...rule, ...patch });
  const channel = channels.find((c) => c.id === rule.channelId) ?? null;
  const feed = useQuery({
    queryKey: ["grid-feed", channel?.id],
    queryFn: () => api.get<{ items: FeedItem[]; live: boolean }>(`/api/channels/${channel!.id}/feed`),
    enabled: channel?.provider === "instagram",
    staleTime: 5 * 60_000,
  });
  // Önizlemede {{name}} örnek bir kullanıcı adıyla gösterilir (sunucudaki buildDmText ile aynı kural)
  const body = rule.dmText.replace(/\{\{\s*(name|isim)\s*\}\}/g, "ornek_ogrenci").trim();
  const preview = rule.botNotice ? `${body}\n\n${BOT_NOTICE}` : body;
  const dmLimit = rule.buttons.length ? DM_MAX_WITH_BUTTONS - (rule.botNotice ? BOT_NOTICE.length + 2 : 0) : DM_MAX;
  const setButton = (i: number, patch: Partial<RuleButton>) => set({ buttons: rule.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const buttonsValid = rule.buttons.every(
    (b) => b.title.trim() && b.title.trim().length <= BUTTON_TITLE_MAX && (isLink(b) ? /^https:\/\/\S+\.\S+/.test(b.url ?? "") : (b.replyText ?? "").trim()),
  );
  const toggleMedia = (id: string) => set({ mediaIds: rule.mediaIds.includes(id) ? rule.mediaIds.filter((m) => m !== id) : [...rule.mediaIds, id] });
  const valid = rule.name.trim() && rule.dmText.trim() && rule.dmText.length <= dmLimit && buttonsValid && (rule.matchType === "any" || (rule.pattern ?? "").trim());

  return (
    <Modal title={rule.id ? t("Yorum kuralını düzenle") : t("Yeni yorum kuralı")} onClose={onClose} large>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="field">
          <label>{t("Kural Adı")}</label>
          <input className="input" value={rule.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("Örn: Link isteyenlere DM")} />
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label>{t("Kanal")}</label>
            <select className="input" value={rule.channelId ?? ""} onChange={(e) => set({ channelId: e.target.value || null, mediaIds: [] })}>
              <option value="">{t("Tüm Instagram/Facebook kanalları")}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.provider})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t("Eşleşme Türü")}</label>
            <select className="input" value={rule.matchType} onChange={(e) => set({ matchType: e.target.value as CommentRule["matchType"] })}>
              <option value="keyword">{t("Anahtar Kelime")}</option>
              <option value="any">{t("Her yorum")}</option>
            </select>
          </div>
        </div>

        {rule.matchType === "keyword" && (
          <div className="field">
            <label>{t("Anahtar Kelimeler (Virgülle ayırın)")}</label>
            <input className="input" value={rule.pattern ?? ""} onChange={(e) => set({ pattern: e.target.value })} placeholder="link*, indir*, uygulama*" />
            <span className="help">{t("Tam kelime aranır: \"dur\" yazarsan \"durum\" eşleşmez. Ekli halleri için sonuna * koy: \"fiyat*\" → fiyatı, fiyatlar.")}</span>
          </div>
        )}

        <div className="field">
          <label>{t("Gönderiler")}</label>
          {channel?.provider === "instagram" && feed.data?.live && feed.data.items.length > 0 ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                {feed.data.items.map((m) => {
                  const on = rule.mediaIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMedia(m.id)}
                      title={m.caption.slice(0, 120)}
                      aria-pressed={on}
                      style={{
                        padding: 0,
                        aspectRatio: "1",
                        borderRadius: 8,
                        overflow: "hidden",
                        border: on ? "3px solid var(--accent)" : "1px solid var(--border)",
                        background: "var(--bg-2)",
                        cursor: "pointer",
                      }}
                    >
                      {m.imageUrl ? <img src={m.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span className="small muted">{m.caption.slice(0, 20)}</span>}
                    </button>
                  );
                })}
              </div>
              <span className="help">{rule.mediaIds.length ? t("{n} gönderi seçili", { n: rule.mediaIds.length }) : t("Hiçbiri seçili değilse tüm gönderilerde çalışır.")}</span>
            </>
          ) : (
            <>
              <input
                className="input"
                value={rule.mediaIds.join(", ")}
                onChange={(e) => set({ mediaIds: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder={t("Boş bırakırsan tüm gönderiler")}
              />
              <span className="help">{t("Gönderi kimliklerini virgülle ayır. Instagram kanalı seçersen gönderileri görselden seçebilirsin.")}</span>
            </>
          )}
        </div>

        <div className="field">
          <label>{t("DM metni")}</label>
          <textarea className="input" rows={4} value={rule.dmText} onChange={(e) => set({ dmText: e.target.value })} placeholder={t("Merhaba {{name}}! İstediğin link: https://…")} />
          <span className="help" style={{ color: rule.dmText.length > dmLimit ? "var(--err)" : undefined }}>
            {rule.dmText.length}/{dmLimit} · {"{{name}}"} {t("yerine kişinin kullanıcı adı gelir.")}
          </span>
        </div>

        <label className="check">
          <input type="checkbox" checked={Boolean(rule.botNotice)} onChange={(e) => set({ botNotice: e.target.checked ? 1 : 0 })} /> {t("Mesajın sonuna otomatik gönderildiğini belirten not ekle (önerilir)")}
        </label>

        {rule.dmText.trim() && (
          <div className="card small pre" style={{ background: "var(--bg-2)" }}>
            <div className="muted small" style={{ marginBottom: 4 }}>
              {t("Önizleme")}
            </div>
            {preview}
            {rule.buttons.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                {rule.buttons.map((b, i) => (
                  <span key={i} className="badge" style={{ justifyContent: "center" }}>
                    {b.title || "…"}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="field">
          <label>{t("Düğmeler (en fazla 3)")}</label>
          {rule.buttons.map((b, i) => (
            <div key={i} className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ flex: "1 1 140px" }}
                  value={b.title}
                  maxLength={BUTTON_TITLE_MAX}
                  onChange={(e) => setButton(i, { title: e.target.value })}
                  placeholder={t("Düğme yazısı")}
                  aria-label={t("Düğme yazısı")}
                />
                <select
                  className="input"
                  style={{ flex: "0 1 170px" }}
                  value={isLink(b) ? "url" : "reply"}
                  onChange={(e) => setButton(i, e.target.value === "url" ? { url: "", replyText: null } : { url: null, replyText: "" })}
                  aria-label={t("Düğme türü")}
                >
                  <option value="reply">{t("Basınca cevap gönder")}</option>
                  <option value="url">{t("Bağlantı aç")}</option>
                </select>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ buttons: rule.buttons.filter((_, j) => j !== i) })} aria-label={t("Düğmeyi kaldır")}>
                  <Trash2 style={{ width: 14 }} />
                </button>
              </div>
              {isLink(b) ? (
                <input className="input" value={b.url ?? ""} onChange={(e) => setButton(i, { url: e.target.value })} placeholder="https://ydsmatik.com" aria-label={t("Bağlantı")} />
              ) : (
                <textarea
                  className="input"
                  rows={2}
                  value={b.replyText ?? ""}
                  onChange={(e) => setButton(i, { replyText: e.target.value })}
                  placeholder={t("Kişi düğmeye basınca gönderilecek mesaj")}
                  aria-label={t("Kişi düğmeye basınca gönderilecek mesaj")}
                />
              )}
              <span className="help">
                {b.title.length}/{BUTTON_TITLE_MAX}
              </span>
            </div>
          ))}
          {rule.buttons.length < 3 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => set({ buttons: [...rule.buttons, { title: "", url: null, replyText: "" }] })}>
              <Plus style={{ width: 14 }} /> {t("Düğme ekle")}
            </button>
          )}
          <span className="help">{t("Kişi düğmeye basınca 24 saatlik mesajlaşma penceresi açılır; böylece sonraki cevaplar da gönderilebilir. Düğmeli DM en fazla 640 karakter.")}</span>
        </div>

        <div className="field">
          <label>{t("Açık yorum cevabı (isteğe bağlı)")}</label>
          <textarea
            className="input"
            rows={3}
            value={rule.publicReplies.join("\n")}
            onChange={(e) => set({ publicReplies: e.target.value.split("\n").map((s) => s.trimStart()).slice(0, 10) })}
            placeholder={t("DM'den yazdım 📩\nMesaj kutuna baktın mı? 📩")}
          />
          <span className="help">{t("Her satır bir varyasyon; her seferinde biri rastgele seçilir. Boşsa yorumun altına cevap yazılmaz.")}</span>
        </div>

        <label className="check">
          <input type="checkbox" checked={Boolean(rule.includeReplies)} onChange={(e) => set({ includeReplies: e.target.checked ? 1 : 0 })} /> {t("Başka yorumlara yazılan cevaplar da tetiklesin")}
        </label>

        {!rule.id && <div className="muted small">{t("Kural kapalı kaydedilir; metinleri kontrol ettikten sonra listeden açabilirsin.")}</div>}

        <button
          className="btn btn-primary"
          style={{ marginTop: 6 }}
          onClick={() =>
            onSave({
              ...rule,
              name: rule.name.trim(),
              publicReplies: rule.publicReplies.map((s) => s.trim()).filter(Boolean),
              buttons: rule.buttons.map((b) => (isLink(b) ? { title: b.title.trim(), url: (b.url ?? "").trim() } : { title: b.title.trim(), replyText: (b.replyText ?? "").trim() })),
            })
          }
          disabled={saving || !valid}
        >
          {t("Kuralı Kaydet")}
        </button>
      </div>
    </Modal>
  );
}
