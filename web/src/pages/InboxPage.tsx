import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCheck, Hand, MessageSquare, Send, Sparkles, UserRound } from "lucide-react";
import { api, fmtDate, timeAgo, type Channel, type Conversation, type Message } from "../lib/api";
import { Avatar, Empty, Modal, ProviderIcon, StatusBadge, useToast } from "../components/ui";

type ConversationDetail = Conversation & { messages: Message[] };

export default function InboxPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<"all" | "attention" | "closed">("all");
  const [channelFilter, setChannelFilter] = useState("");
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  const [simText, setSimText] = useState("");
  const [simChannel, setSimChannel] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const convs = useQuery({
    queryKey: ["conversations", filter, channelFilter],
    queryFn: () => api.get<Conversation[]>(`/api/inbox/conversations?${filter === "attention" ? "attention=true&" : filter === "closed" ? "status=closed&" : "status=open&"}${channelFilter ? `channelId=${channelFilter}` : ""}`),
    refetchInterval: 8000,
  });
  const detail = useQuery({ queryKey: ["conversation", id], queryFn: () => api.get<ConversationDetail>(`/api/inbox/conversations/${id}`), enabled: Boolean(id), refetchInterval: 5000 });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail.data?.messages.length]);

  useEffect(() => {
    if (id && detail.data && detail.data.unread > 0) {
      api.patch(`/api/inbox/conversations/${id}`, { read: true }).then(() => {
        qc.invalidateQueries({ queryKey: ["conversations"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      });
    }
  }, [id, detail.data, qc]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["conversation", id] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const reply = useMutation({
    mutationFn: () => api.post<Message>(`/api/inbox/conversations/${id}/reply`, { text }),
    onSuccess: () => {
      setText("");
      invalidate();
    },
    onError: (e) => {
      toast(e instanceof Error ? e.message : "Gönderilemedi", "err");
      invalidate();
    },
  });
  const setMode = useMutation({ mutationFn: (mode: "auto" | "manual") => api.patch(`/api/inbox/conversations/${id}`, { mode }), onSuccess: invalidate });
  const setStatus = useMutation({ mutationFn: (status: "open" | "closed") => api.patch(`/api/inbox/conversations/${id}`, { status }), onSuccess: invalidate });
  const draft = useMutation({
    mutationFn: () => api.post<{ reply: string; intent: string; handoff: boolean; summary: string }>(`/api/inbox/conversations/${id}/ai-draft`),
    onSuccess: (r) => {
      setText(r.reply);
      toast(`Niyet: ${r.intent}${r.handoff ? " · insan devralmalı" : ""} · ${r.summary}`, "info");
    },
    onError: (e) => toast(e instanceof Error ? e.message : "AI hatası", "err"),
  });
  const summarize = useMutation({
    mutationFn: () => api.post<{ summary: string }>("/api/inbox/summary"),
    onSuccess: (r) => setSummary(r.summary),
    onError: (e) => toast(e instanceof Error ? e.message : "AI hatası", "err"),
  });
  const simulate = useMutation({
    mutationFn: () => api.post("/api/inbox/simulate", { channelId: simChannel, text: simText }),
    onSuccess: () => {
      toast("Test mesajı işlendi; kural sonucu birkaç saniye içinde görünür", "ok");
      setSimOpen(false);
      setSimText("");
      setTimeout(invalidate, 4500);
      invalidate();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Hata", "err"),
  });

  const d = detail.data;
  const dmChannels = (channels.data ?? []).filter((c) => ["instagram", "facebook", "whatsapp", "telegram", "x"].includes(c.provider));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Gelen Kutusu</h1>
          <p>Instagram DM, Messenger, WhatsApp, Telegram ve X mesajları tek yerde. Otomatik yanıtlar kurallara göre gider; istediğinde devral.</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => summarize.mutate()} disabled={summarize.isPending}><Sparkles className={summarize.isPending ? "spin" : ""} /> AI özet</button>
          <button className="btn" onClick={() => { setSimChannel(dmChannels[0]?.id ?? ""); setSimOpen(true); }}>Test mesajı</button>
        </div>
      </div>

      {summary && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title"><h2>Gelen kutusu özeti</h2><button className="btn btn-ghost btn-sm" onClick={() => setSummary(null)}>Kapat</button></div>
          <p className="pre">{summary}</p>
        </div>
      )}

      <div className="inbox">
        <div className="card" style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }} className="form">
            <div className="segmented" style={{ width: "100%" }}>
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")} style={{ flex: 1 }}>Açık</button>
              <button className={filter === "attention" ? "active" : ""} onClick={() => setFilter("attention")} style={{ flex: 1 }}>Dikkat</button>
              <button className={filter === "closed" ? "active" : ""} onClick={() => setFilter("closed")} style={{ flex: 1 }}>Kapalı</button>
            </div>
            <select className="select" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
              <option value="">Tüm kanallar</option>
              {dmChannels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="conv-list">
            {convs.data?.length === 0 && <Empty icon={<MessageSquare />} title="Konuşma yok" text="Webhook'lar kurulunca mesajlar burada birikir." />}
            {convs.data?.map((c) => (
              <div key={c.id} className={`conv ${c.id === id ? "active" : ""}`} onClick={() => nav(`/gelen-kutusu/${c.id}`)}>
                <div style={{ position: "relative" }}>
                  <Avatar name={c.participantName ?? c.participantId} url={c.participantAvatar} size={38} />
                  {c.provider && <span style={{ position: "absolute", right: -3, bottom: -3 }}><ProviderIcon provider={c.provider} size={15} /></span>}
                </div>
                <div className="meta">
                  <div className="row-between">
                    <span className="name truncate">{c.participantName ?? c.participantId} {c.needsAttention ? <Hand style={{ width: 13, color: "var(--warn)" }} /> : null}</span>
                    <span className="time">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <div className="row-between">
                    <span className="prev truncate">{c.lastMessagePreview}</span>
                    {c.unread > 0 && <span className="unread">{c.unread}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card thread">
          {!id || !d ? (
            <Empty icon={<MessageSquare />} title="Bir konuşma seç" text="Soldaki listeden bir kişiye tıkla." />
          ) : (
            <>
              <div className="thread-head">
                <Avatar name={d.participantName ?? d.participantId} url={d.participantAvatar} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{d.participantName ?? d.participantId}</div>
                  <div className="muted small row" style={{ gap: 6 }}>{d.provider && <ProviderIcon provider={d.provider} size={14} />} {d.channelName} · <StatusBadge status={d.mode} /> {d.needsAttention ? <span className="badge badge-warn">dikkat</span> : null}</div>
                </div>
                <div className="row">
                  {d.mode === "auto" ? (
                    <button className="btn btn-sm" onClick={() => setMode.mutate("manual")}><UserRound /> Devral</button>
                  ) : (
                    <button className="btn btn-sm" onClick={() => setMode.mutate("auto")}><Bot /> Otomatiğe bırak</button>
                  )}
                  {d.status === "open" ? (
                    <button className="btn btn-sm" onClick={() => setStatus.mutate("closed")}><CheckCheck /> Kapat</button>
                  ) : (
                    <button className="btn btn-sm" onClick={() => setStatus.mutate("open")}>Yeniden aç</button>
                  )}
                </div>
              </div>
              <div className="messages">
                {d.messages.map((m) => (
                  <div key={m.id} className={`msg ${m.direction} ${m.status === "failed" ? "failed" : ""}`}>
                    {m.direction === "out" && <div className="who">{m.sentBy === "ai" ? "AI" : m.sentBy === "rule" ? "KURAL" : "SEN"}{m.status === "failed" ? " · GÖNDERİLEMEDİ" : ""}</div>}
                    <div className="pre">{m.text}</div>
                    {m.attachments.length > 0 && (
                      <div className="small" style={{ marginTop: 4, opacity: 0.8 }}>
                        {m.attachments.map((a, i) => (a.url ? <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline", marginRight: 6 }}>{a.type}</a> : <span key={i}>{a.type} </span>))}
                      </div>
                    )}
                    {m.error && <div className="small" style={{ marginTop: 4 }}>{m.error}</div>}
                    <div className="when">{fmtDate(m.createdAt, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="reply-box">
                <textarea
                  className="textarea"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={d.mode === "auto" ? "Yanıt yaz (gönderince konuşma manuel moda geçmez; devralmak için 'Devral')" : "Yanıt yaz…"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) reply.mutate();
                  }}
                />
                <button className="btn" title="AI taslak" onClick={() => draft.mutate()} disabled={draft.isPending}><Sparkles className={draft.isPending ? "spin" : ""} /></button>
                <button className="btn btn-primary" onClick={() => reply.mutate()} disabled={!text.trim() || reply.isPending}><Send /> Gönder</button>
              </div>
            </>
          )}
        </div>
      </div>

      {simOpen && (
        <Modal title="Test mesajı gönder" onClose={() => setSimOpen(false)} footer={<><button className="btn" onClick={() => setSimOpen(false)}>Vazgeç</button><button className="btn btn-primary" disabled={!simChannel || !simText.trim() || simulate.isPending} onClick={() => simulate.mutate()}>Gönder</button></>}>
          <div className="form">
            <p className="muted small">Sahte bir müşteri mesajı enjekte eder; oto-yanıt kurallarını gerçek platforma gitmeden önce dener. Kural yanıtı gerçek kanal API'sine gönderilmeye çalışılır (test kullanıcısı gerçek olmadığı için platform hata dönebilir; bu normal).</p>
            <div className="field">
              <label>Kanal</label>
              <select className="select" value={simChannel} onChange={(e) => setSimChannel(e.target.value)}>
                {dmChannels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Müşteri mesajı</label>
              <textarea className="textarea" value={simText} onChange={(e) => setSimText(e.target.value)} placeholder="Merhaba, fiyat bilgisi alabilir miyim?" />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
