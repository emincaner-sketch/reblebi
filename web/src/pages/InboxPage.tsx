import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCheck, ExternalLink, Hand, MessageCircle, MessageSquare, Send, Sparkles, Star, UserRound } from "lucide-react";
import { api, DM_PROVIDERS, errMsg, type Channel, type Conversation, type Member, type Message, type OrgInfo } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Avatar, Can, Empty, FeatureGate, Modal, PageHead, ProviderIcon, StatusBadge, useToast } from "../components/ui";

type ConversationDetail = Conversation & { messages: Message[] };

/** İşletme değerlendirmesi (Google Business Profile) */
const isReview = (c: Conversation) => c.metadata?.kind === "review";
/** Herkese açık konu: gönderi yorumu ya da değerlendirme ("Yorumlar" süzgeci, otomatik yanıt yok) */
const isComment = (c: Conversation) => c.metadata?.kind === "comment" || isReview(c);

/** Facebook gönderi kimliği "sayfa_gönderi" biçimindedir; Instagram medya kimliğinden adres çıkarılamaz */
function postLink(c: Conversation): string | null {
  const id = String(c.metadata?.mediaId ?? "");
  return c.provider === "facebook" && /^\d+_\d+$/.test(id) ? `https://www.facebook.com/${id}` : null;
}

export default function InboxPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const f = useFmt();
  const s = useSession();
  const [filter, setFilter] = useState<"all" | "attention" | "mine" | "closed">("all");
  const [channelFilter, setChannelFilter] = useState("");
  const [kind, setKind] = useState<"all" | "dm" | "comment">("all");
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  const [simText, setSimText] = useState("");
  const [simChannel, setSimChannel] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const members = useQuery({ queryKey: ["members"], queryFn: () => api.get<{ members: Member[] }>("/api/org/members") });
  const qs = new URLSearchParams();
  if (filter === "attention") qs.set("attention", "true");
  if (filter === "mine") qs.set("mine", "true");
  qs.set("status", filter === "closed" ? "closed" : "open");
  if (channelFilter) qs.set("channelId", channelFilter);
  if (search.trim()) qs.set("q", search.trim());
  const convs = useQuery({ queryKey: ["conversations", qs.toString()], queryFn: () => api.get<Conversation[]>(`/api/inbox/conversations?${qs.toString()}`), refetchInterval: 8000 });
  const detail = useQuery({ queryKey: ["conversation", id], queryFn: () => api.get<ConversationDetail>(`/api/inbox/conversations/${id}`), enabled: Boolean(id), refetchInterval: 5000 });
  const memberMap = new Map((members.data?.members ?? []).map((m) => [m.userId, m]));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail.data?.messages.length]);

  useEffect(() => {
    if (id && detail.data && detail.data.unread > 0 && s.can("editor")) {
      api.patch(`/api/inbox/conversations/${id}`, { read: true }).then(() => {
        qc.invalidateQueries({ queryKey: ["conversations"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      });
    }
  }, [id, detail.data, qc, s]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["conversation", id] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const onError = (e: unknown) => toast(errMsg(e), "err");

  const reply = useMutation({
    mutationFn: () => api.post<Message>(`/api/inbox/conversations/${id}/reply`, { text }),
    onSuccess: () => {
      setText("");
      invalidate();
    },
    onError: (e) => {
      onError(e);
      invalidate();
    },
  });
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/api/inbox/conversations/${id}`, body), onSuccess: invalidate, onError });
  const draft = useMutation({
    mutationFn: () => api.post<{ reply: string; intent: string; handoff: boolean; summary: string }>(`/api/inbox/conversations/${id}/ai-draft`),
    onSuccess: (r) => {
      setText(r.reply);
      toast(t("Niyet: {i}{h} · {s}", { i: r.intent, h: r.handoff ? ` · ${t("insan devralmalı")}` : "", s: r.summary }), "info");
    },
    onError,
  });
  const summarize = useMutation({ mutationFn: () => api.post<{ summary: string }>("/api/inbox/summary"), onSuccess: (r) => setSummary(r.summary), onError });
  const simulate = useMutation({
    mutationFn: () => api.post("/api/inbox/simulate", { channelId: simChannel, text: simText }),
    onSuccess: () => {
      toast(t("Test mesajı işlendi; kural sonucu birkaç saniye içinde görünür"), "ok");
      setSimOpen(false);
      setSimText("");
      setTimeout(invalidate, 4500);
      invalidate();
    },
    onError,
  });

  const d = detail.data;
  const dmChannels = (channels.data ?? []).filter((c) => DM_PROVIDERS.includes(c.provider));
  const hasInbox = org.data?.usage.plan.features.inbox;

  return (
    <>
      <PageHead
        title={t("Gelen Kutusu")}
        sub={t("DM'ler, Instagram/Facebook/YouTube yorumları ve Google işletme değerlendirmeleri tek yerde. Otomatik yanıtlar yalnızca mesajlara kurallara göre gider; istediğinde devral.")}
        actions={
          <>
            <button className="btn" onClick={() => summarize.mutate()} disabled={summarize.isPending}>
              <Sparkles className={summarize.isPending ? "spin" : ""} /> {t("AI özet")}
            </button>
            <Can role="admin">
              <button
                className="btn"
                disabled={!dmChannels.length}
                onClick={() => {
                  setSimChannel(dmChannels[0]?.id ?? "");
                  setSimOpen(true);
                }}
              >
                {t("Test mesajı")}
              </button>
            </Can>
          </>
        }
      />

      <FeatureGate feature="inbox" has={hasInbox}>
        <span />
      </FeatureGate>

      {summary && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">
            <h2>{t("Gelen kutusu özeti")}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setSummary(null)}>
              {t("Kapat")}
            </button>
          </div>
          <p className="pre">{summary}</p>
        </div>
      )}

      <div className="inbox">
        <div className="card" style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }} className="form">
            <div className="segmented" style={{ width: "100%" }} role="tablist">
              {(["all", "attention", "mine", "closed"] as const).map((k) => (
                <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)} style={{ flex: 1 }}>
                  {{ all: t("Açık"), attention: t("Dikkat"), mine: t("Bana"), closed: t("Kapalı") }[k]}
                </button>
              ))}
            </div>
            <div className="segmented segmented-sm" style={{ width: "100%" }} role="group" aria-label={t("Tür")}>
              {(["all", "dm", "comment"] as const).map((k) => (
                <button key={k} className={kind === k ? "active" : ""} aria-pressed={kind === k} onClick={() => setKind(k)} style={{ flex: 1 }}>
                  {{ all: t("Tümü"), dm: t("Mesajlar"), comment: t("Yorumlar") }[k]}
                </button>
              ))}
            </div>
            <input className="input" placeholder={t("Kişi ya da mesaj ara…")} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("Ara")} />
            <select className="select" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} aria-label={t("Kanal")}>
              <option value="">{t("Tüm kanallar")}</option>
              {dmChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="conv-list">
            {convs.data?.length === 0 && <Empty icon={<MessageSquare />} title={t("Konuşma yok")} text={t("Webhook'lar kurulunca mesajlar burada birikir.")} />}
            {convs.data?.filter((c) => kind === "all" || (kind === "comment") === isComment(c)).map((c) => (
              <div key={c.id} className={`conv ${c.id === id ? "active" : ""}`} onClick={() => nav(`/app/inbox/${c.id}`)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && nav(`/app/inbox/${c.id}`)}>
                <div style={{ position: "relative" }}>
                  <Avatar name={c.participantName ?? c.participantId} url={c.participantAvatar} size={38} />
                  {c.provider && (
                    <span style={{ position: "absolute", right: -3, bottom: -3 }}>
                      <ProviderIcon provider={c.provider} size={15} />
                    </span>
                  )}
                </div>
                <div className="meta">
                  <div className="row-between">
                    <span className="name truncate">
                      {c.participantName ?? c.participantId} {c.needsAttention ? <Hand style={{ width: 13, color: "var(--warn)" }} /> : null}
                    </span>
                    <span className="time">{f.ago(c.lastMessageAt)}</span>
                  </div>
                  <div className="row-between">
                    <span className="prev truncate">
                      {isReview(c) ? (
                        <span className="conv-kind" title={t("İşletme değerlendirmesi")}>
                          <Star aria-hidden="true" /> {t("Değerlendirme")}
                        </span>
                      ) : (
                        isComment(c) && (
                          <span className="conv-kind" title={t("Gönderi yorumu")}>
                            <MessageCircle aria-hidden="true" /> {t("Yorum")}
                          </span>
                        )
                      )}
                      {c.lastMessagePreview}
                    </span>
                    {c.unread > 0 && <span className="unread">{c.unread}</span>}
                  </div>
                  {c.assignedTo && <div className="muted small truncate">→ {memberMap.get(c.assignedTo)?.name || memberMap.get(c.assignedTo)?.email || "?"}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card thread">
          {!id || !d ? (
            <Empty icon={<MessageSquare />} title={t("Bir konuşma seç")} text={t("Soldaki listeden bir kişiye tıkla.")} />
          ) : (
            <>
              <div className="thread-head">
                <Avatar name={d.participantName ?? d.participantId} url={d.participantAvatar} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{d.participantName ?? d.participantId}</div>
                  <div className="muted small row" style={{ gap: 6 }}>
                    {d.provider && <ProviderIcon provider={d.provider} size={14} />} {d.channelName} · {isReview(d) ? (
                      <span className="conv-kind">
                        <Star aria-hidden="true" /> {t("İşletme değerlendirmesi")}
                        {typeof d.metadata?.rating === "number" && <span aria-label={t("{n} yıldız", { n: d.metadata.rating as number })}>{" · "}{"★".repeat(d.metadata.rating as number)}</span>}
                      </span>
                    ) : isComment(d) ? (
                      <span className="conv-kind">
                        <MessageCircle aria-hidden="true" /> {t("Gönderi yorumu")}
                        {postLink(d) && (
                          <a href={postLink(d)!} target="_blank" rel="noreferrer" aria-label={t("Gönderiyi aç")}>
                            <ExternalLink aria-hidden="true" />
                          </a>
                        )}
                      </span>
                    ) : (
                      <StatusBadge status={d.mode} />
                    )}{" "}
                    {d.needsAttention ? <span className="badge badge-warn">{t("dikkat")}</span> : null}
                  </div>
                </div>
                <Can role="editor">
                  <div className="row">
                    <select className="select select-sm" style={{ width: 160 }} value={d.assignedTo ?? ""} onChange={(e) => patch.mutate({ assignedTo: e.target.value || null })} aria-label={t("Ata")}>
                      <option value="">{t("Atanmamış")}</option>
                      {members.data?.members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name || m.email}
                        </option>
                      ))}
                    </select>
                    {isComment(d) ? null : d.mode === "auto" ? (
                      <button className="btn btn-sm" onClick={() => patch.mutate({ mode: "manual" })}>
                        <UserRound /> {t("Devral")}
                      </button>
                    ) : (
                      <button className="btn btn-sm" onClick={() => patch.mutate({ mode: "auto" })}>
                        <Bot /> {t("Otomatiğe bırak")}
                      </button>
                    )}
                    {d.status === "open" ? (
                      <button className="btn btn-sm" onClick={() => patch.mutate({ status: "closed" })}>
                        <CheckCheck /> {t("Kapat")}
                      </button>
                    ) : (
                      <button className="btn btn-sm" onClick={() => patch.mutate({ status: "open" })}>
                        {t("Yeniden aç")}
                      </button>
                    )}
                  </div>
                </Can>
              </div>
              <div className="messages">
                {d.messages.map((m) => (
                  <div key={m.id} className={`msg ${m.direction} ${m.status === "failed" ? "failed" : ""}`}>
                    {m.direction === "out" && (
                      <div className="who">
                        {m.sentBy === "ai" ? "AI" : m.sentBy === "rule" ? t("KURAL") : t("SEN")}
                        {m.status === "failed" ? ` · ${t("GÖNDERİLEMEDİ")}` : ""}
                      </div>
                    )}
                    <div className="pre">{m.text}</div>
                    {m.attachments.length > 0 && (
                      <div className="small" style={{ marginTop: 4, opacity: 0.8 }}>
                        {m.attachments.map((a, i) =>
                          a.url ? (
                            <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline", marginRight: 6 }}>
                              {a.type}
                            </a>
                          ) : (
                            <span key={i}>{a.type} </span>
                          ),
                        )}
                      </div>
                    )}
                    {m.error && <div className="small" style={{ marginTop: 4 }}>{m.error}</div>}
                    <div className="when">{f.short(m.createdAt)}</div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <Can role="editor" fallback={<p className="muted small">{t("İzleyici rolüyle yanıt veremezsin.")}</p>}>
                <div className="reply-box">
                  <textarea
                    className="textarea"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={isReview(d) ? t("Değerlendirmeyi yanıtla: yanıtın Google'da herkese açık görünür; yeni yanıt öncekinin yerine geçer (Ctrl+Enter gönderir).") : isComment(d) ? t("Yorumu yanıtla: yanıtın gönderinin altında herkese açık görünür (Ctrl+Enter gönderir).") : d.mode === "auto" ? t("Yanıt yaz (Ctrl+Enter gönderir). Konuşma otomatik modda kalır; devralmak için 'Devral'.") : t("Yanıt yaz… (Ctrl+Enter gönderir)")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) reply.mutate();
                    }}
                  />
                  <button className="btn" title={t("AI taslak")} aria-label={t("AI taslak")} onClick={() => draft.mutate()} disabled={draft.isPending}>
                    <Sparkles className={draft.isPending ? "spin" : ""} />
                  </button>
                  <button className="btn btn-primary" onClick={() => reply.mutate()} disabled={!text.trim() || reply.isPending}>
                    <Send /> {t("Gönder")}
                  </button>
                </div>
              </Can>
            </>
          )}
        </div>
      </div>

      {simOpen && (
        <Modal
          title={t("Test mesajı gönder")}
          onClose={() => setSimOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setSimOpen(false)}>
                {t("Vazgeç")}
              </button>
              <button className="btn btn-primary" disabled={!simChannel || !simText.trim() || simulate.isPending} onClick={() => simulate.mutate()}>
                {t("Gönder")}
              </button>
            </>
          }
        >
          <div className="form">
            <p className="muted small">{t("Sahte bir müşteri mesajı enjekte eder; oto-yanıt kurallarını dener. Kural yanıtı gerçek kanal API'sine gönderilmeye çalışılır; test kullanıcısı gerçek olmadığı için platform hata dönebilir, bu normal.")}</p>
            <div className="field">
              <label>{t("Kanal")}</label>
              <select className="select" value={simChannel} onChange={(e) => setSimChannel(e.target.value)}>
                {dmChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t("Müşteri mesajı")}</label>
              <textarea className="textarea" value={simText} onChange={(e) => setSimText(e.target.value)} placeholder={t("Merhaba, fiyat bilgisi alabilir miyim?")} />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
