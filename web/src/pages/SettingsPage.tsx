import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { api, fmtDate, type Settings, type SystemInfo } from "../lib/api";
import { Copyable, Modal, ProviderIcon, useToast } from "../components/ui";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"marka" | "sistem" | "api" | "hesap">("marka");
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });
  const system = useQuery({ queryKey: ["system"], queryFn: () => api.get<SystemInfo>("/api/system") });
  const keys = useQuery({ queryKey: ["keys"], queryFn: () => api.get<ApiKeyRow[]>("/api/keys") });
  const [form, setForm] = useState<Settings | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const s = form ?? settings.data;

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.put<Settings>("/api/settings", patch),
    onSuccess: (r) => {
      qc.setQueryData(["settings"], r);
      setForm(null);
      qc.invalidateQueries({ queryKey: ["system"] });
      toast("Kaydedildi", "ok");
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Hata", "err"),
  });
  const createKey = useMutation({
    mutationFn: () => api.post<{ key: string }>("/api/keys", { name: newKeyName }),
    onSuccess: (r) => {
      setCreatedKey(r.key);
      setNewKeyName("");
      qc.invalidateQueries({ queryKey: ["keys"] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Hata", "err"),
  });
  const removeKey = useMutation({ mutationFn: (id: string) => api.del(`/api/keys/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["keys"] }) });
  const changePw = useMutation({
    mutationFn: () => api.post("/api/auth/password", pw),
    onSuccess: () => {
      toast("Şifre değişti", "ok");
      setPw({ current: "", next: "" });
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Hata", "err"),
  });

  const upd = (patch: Partial<Settings>) => setForm({ ...(s as Settings), ...patch });
  const sys = system.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ayarlar</h1>
          <p>Marka sesi, sistem bilgileri, API anahtarları (MCP) ve hesap.</p>
        </div>
      </div>
      <div className="tabs">
        {(["marka", "sistem", "api", "hesap"] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {{ marka: "Marka & AI", sistem: "Sistem & Webhook", api: "API / MCP", hesap: "Hesap" }[t]}
          </button>
        ))}
      </div>

      {tab === "marka" && s && (
        <div className="card form">
          <div className="card-title">
            <h2>Marka hafızası</h2>
            <span className="muted small">
              {sys?.ai.enabled ? `AI açık · ${sys.ai.model}` : "AI kapalı (ANTHROPIC_API_KEY yok)"}
              {sys?.ai.brandSources.length ? ` · kaynaklar: ${sys.ai.brandSources.join(", ")}` : ""}
            </span>
          </div>
          <p className="muted small">Bu bilgiler her AI üretiminin (gönderi metni, DM yanıtı) sistem promptuna eklenir. <code>BRAND_MEMORY_DIR</code> ile sistemler/marka-hafizasi klasörü de otomatik okunur.</p>
          <div className="grid grid-2">
            <div className="field"><label>Marka adı</label><input className="input" value={s.brandName} onChange={(e) => upd({ brandName: e.target.value })} /></div>
            <div className="field"><label>Ses tonu (3-5 sıfat)</label><input className="input" value={s.brandVoice} onChange={(e) => upd({ brandVoice: e.target.value })} placeholder="sıcak, dürüst, bilgili ama ukala değil" /></div>
          </div>
          <div className="field"><label>Hedef kitle</label><input className="input" value={s.brandAudience} onChange={(e) => upd({ brandAudience: e.target.value })} placeholder="30-45 yaş, büyük şehir, etiket okuyan aileler" /></div>
          <div className="field"><label>Teklifler / ürünler (fiyat, kime uygun)</label><textarea className="textarea" value={s.brandOffers} onChange={(e) => upd({ brandOffers: e.target.value })} placeholder={"- Erken hasat 500ml · 450 TL · hediyelik\n- 5L teneke · 2.900 TL · aile"} /></div>
          <div className="field"><label>Yasak kelimeler / kalıplar</label><input className="input" value={s.brandBannedWords} onChange={(e) => upd({ brandBannedWords: e.target.value })} placeholder="kaçırma, son fırsat, efsane, ünlem yağmuru" /></div>
          <div className="field"><label>Markanın sesinden örnek cümleler</label><textarea className="textarea" value={s.brandExamples} onChange={(e) => upd({ brandExamples: e.target.value })} /></div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-primary" disabled={!form || save.isPending} onClick={() => form && save.mutate(form)}>Kaydet</button>
          </div>
        </div>
      )}

      {tab === "sistem" && sys && (
        <>
          <div className="card">
            <div className="card-title"><h2>Adresler</h2>{!sys.secure && <span className="badge badge-warn">PUBLIC_URL https değil: OAuth/webhook/medya çekme çalışmaz</span>}</div>
            <dl className="kv">
              <dt>PUBLIC_URL</dt><dd><Copyable text={sys.publicUrl} /></dd>
              <dt>Zaman dilimi</dt><dd>{sys.timezone}</dd>
              <dt>Meta webhook URL</dt><dd><Copyable text={sys.webhooks.meta.url} /></dd>
              <dt>Meta verify token</dt><dd><Copyable text={sys.webhooks.meta.verifyToken} /></dd>
              {Object.entries(sys.oauthRedirects).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}><dt>{k} redirect URI</dt><dd><Copyable text={v} /></dd></div>
              ))}
            </dl>
            <p className="muted small" style={{ marginTop: 12 }}>Meta App &gt; Webhooks: Instagram (messages), Page (messages), WhatsApp (messages) alanlarına abone ol. Redirect URI'ları ilgili geliştirici panellerine ekle. Detay: <code>docs/KURULUM.md</code></p>
          </div>
          <div className="card">
            <div className="card-title"><h2>Platform yapılandırması</h2></div>
            <table className="table">
              <tbody>
                {sys.providers.map((p) => (
                  <tr key={p.id}>
                    <td style={{ width: 40 }}><ProviderIcon provider={p.id} size={24} /></td>
                    <td><strong>{p.label}</strong><div className="muted small">{p.connectMode === "oauth" ? "OAuth" : "Token ile"} · gönderi {p.capabilities.post ? "✓" : "–"} · hikaye {p.capabilities.story ? "✓" : "–"} · reel {p.capabilities.reel ? "✓" : "–"} · DM {p.capabilities.dm ? (p.capabilities.inbound === "webhook" ? "webhook" : "polling") : "–"}</div></td>
                    <td style={{ textAlign: "right" }}><span className={`badge ${p.configured ? "badge-ok" : "badge-warn"}`}>{p.configured ? "hazır" : ".env eksik"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-title"><h2>Son webhook olayları</h2></div>
            {sys.recentWebhooks.length === 0 ? <p className="muted">Henüz webhook gelmedi.</p> : (
              <table className="table">
                <tbody>
                  {sys.recentWebhooks.map((w) => (
                    <tr key={w.id}><td className="small">{fmtDate(w.receivedAt)}</td><td>{w.provider}</td><td>{w.processed ? <span className="badge badge-ok">işlendi</span> : <span className="badge badge-warn">bekliyor</span>}</td><td className="small" style={{ color: "var(--err)" }}>{w.error}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "api" && (
        <>
          <div className="card">
            <div className="card-title"><h2>API anahtarları</h2></div>
            <p className="muted small" style={{ marginBottom: 12 }}>MCP sunucusu ve dış entegrasyonlar bu anahtarla <code>Authorization: Bearer sp_...</code> başlığıyla API'ye erişir. Anahtar sadece oluşturulurken gösterilir.</p>
            <div className="row" style={{ marginBottom: 12 }}>
              <input className="input" style={{ width: 260 }} placeholder="Anahtar adı (ör. claude-code)" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
              <button className="btn btn-primary" disabled={!newKeyName || createKey.isPending} onClick={() => createKey.mutate()}><Plus /> Oluştur</button>
            </div>
            <table className="table">
              <tbody>
                {keys.data?.map((k) => (
                  <tr key={k.id}>
                    <td><KeyRound style={{ width: 14, verticalAlign: "middle", marginRight: 6 }} /><strong>{k.name}</strong> <code>{k.prefix}…</code></td>
                    <td className="small muted">oluşturuldu {fmtDate(k.createdAt, { dateStyle: "short" })}{k.lastUsedAt ? ` · son kullanım ${fmtDate(k.lastUsedAt)}` : " · hiç kullanılmadı"}</td>
                    <td style={{ textAlign: "right" }}><button className="btn btn-ghost btn-sm" onClick={() => confirm("Anahtar iptal edilsin mi?") && removeKey.mutate(k.id)}><Trash2 /></button></td>
                  </tr>
                ))}
                {keys.data?.length === 0 && <tr><td className="muted">Henüz anahtar yok.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-title"><h2>Claude Code'a MCP olarak bağla</h2></div>
            <p className="muted small">Proje kökündeki <code>.mcp.json</code> hazır. Anahtarı ortam değişkeni olarak ver ve Claude Code'u projede aç:</p>
            <pre className="preview mono pre" style={{ marginTop: 10 }}>{`# .env dosyasına ekle
SOSYALPILOT_API_KEY=sp_...

# ya da MCP sunucusunu elle kaydet
claude mcp add sosyalpilot -e SOSYALPILOT_API_URL=${sys?.publicUrl ?? "http://localhost:4100"} -e SOSYALPILOT_API_KEY=sp_... -- npm run mcp --prefix "${"<proje-yolu>"}"`}</pre>
            <p className="muted small" style={{ marginTop: 10 }}>Araçlar: list_channels, create_post, list_posts, publish_post_now, list_conversations, reply_conversation, draft_reply, create_rule, generate_content, analytics_overview, dashboard…</p>
          </div>
        </>
      )}

      {tab === "hesap" && (
        <div className="card form" style={{ maxWidth: 480 }}>
          <div className="card-title"><h2>Şifre değiştir</h2></div>
          <div className="field"><label>Mevcut şifre</label><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
          <div className="field"><label>Yeni şifre (en az 8)</label><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
          <button className="btn btn-primary" disabled={pw.next.length < 8 || changePw.isPending} onClick={() => changePw.mutate()}>Güncelle</button>
        </div>
      )}

      {createdKey && (
        <Modal title="Yeni API anahtarı" onClose={() => setCreatedKey(null)} footer={<button className="btn btn-primary" onClick={() => setCreatedKey(null)}>Kaydettim</button>}>
          <p className="muted small" style={{ marginBottom: 10 }}>Bu anahtar bir daha gösterilmeyecek. Güvenli bir yere kopyala.</p>
          <Copyable text={createdKey} />
        </Modal>
      )}
    </>
  );
}
