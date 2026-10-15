import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Brain,
  Calendar,
  CheckCircle2,
  Clock,
  Code,
  Copy,
  DollarSign,
  ExternalLink,
  FileText,
  Filter,
  GitFork,
  History,
  Layers,
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Rss,
  Send,
  ShoppingCart,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Wand2,
  Webhook,
  XCircle,
  Zap,
} from "lucide-react";
import {
  api,
  DM_PROVIDERS,
  errMsg,
  PROVIDER_NAME,
  type Channel,
  type OrgInfo,
  type OrgSettings,
  type Rule,
  type Workflow,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowStepType,
  type WorkflowTemplate,
  type WorkflowTriggerType,
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Can, Empty, FeatureGate, Modal, PageHead, ProviderIcon, Stat, useToast } from "../components/ui";
import { copyText } from "../lib/clipboard";
import { CommentToDmTab } from "../panel/automation/CommentToDm";

type TabMode = "workflows" | "rules" | "comments" | "settings";
type EditingRule = Omit<Rule, "id"> & { id?: string };

const EMPTY_RULE: Omit<Rule, "id"> = {
  name: "",
  enabled: 1,
  channelId: null,
  provider: null,
  matchType: "keyword",
  pattern: "",
  replyMode: "template",
  replyText: "",
  aiInstructions: "",
  priority: 100,
  cooldownMinutes: 60,
  onlyBusinessHours: 0,
  handoffToHuman: 0,
};

/** Kural listesinde tetikleyici adı */
const MATCH_LABELS: Record<string, string> = {
  keyword: "Anahtar Kelime",
  first_contact: "İlk Temas (Hoş Geldin)",
  any: "Her Mesaj",
  regex: "Regex",
  story_mention: "Hikâyede Bahsetme (Instagram)",
  story_reply: "Hikâyeye Cevap (Instagram)",
  ref: "Bağlantı (ig.me / m.me ref)",
};

const TRIGGER_LABELS: Record<WorkflowTriggerType, { title: string; desc: string; icon: any; color: string }> = {
  "webhook.inbound": { title: "Gelen Özel Webhook (Catch Hook)", desc: "Benzersiz bir URL'ye POST/GET isteği geldiğinde tetiklenir (Genel Webhook)", icon: Webhook, color: "var(--accent)" },
  "shopify.order_created": { title: "Shopify: Yeni Sipariş Oluştu", desc: "Shopify mağazanızda yeni bir sipariş verildiğinde veya ödendiğinde tetiklenir", icon: ShoppingCart, color: "var(--ok)" },
  "shopify.cart_abandoned": { title: "Shopify: Terk Edilen Sepet", desc: "Müşteri ödeme yapmadan ayrıldığında otomatik geri kazanım başlatır", icon: ShoppingCart, color: "var(--err)" },
  "stripe.payment_succeeded": { title: "Stripe: Başarılı Ödeme", desc: "Stripe üzerinden yeni bir ödeme veya abonelik alındığında", icon: DollarSign, color: "#635bff" },
  "forms.submission": { title: "Form Yanıtı (Typeform / Google)", desc: "Web sitenizdeki veya anketinizdeki yeni form yanıtı geldiğinde", icon: FileText, color: "#10b981" },
  "post.published": { title: "Gönderi Yayınlandığında", desc: "Reblebi üzerinden bir gönderi başarıyla yayınlandığında", icon: Send, color: "var(--ok)" },
  "post.failed": { title: "Yayın Hatası Oluştuğunda", desc: "Herhangi bir kanalda paylaşım başarısız olduğunda", icon: AlertTriangle, color: "var(--err)" },
  "post.scheduled": { title: "Yeni Gönderi Planlandığında", desc: "Takvime yeni bir gönderi eklendiğinde", icon: Clock, color: "var(--info)" },
  "message.received": { title: "Yeni DM / Mesaj Geldiğinde", desc: "Instagram, WhatsApp, Telegram vb. kanallardan mesaj alındığında", icon: MessageSquare, color: "#a855f7" },
  "rss.new_item": { title: "RSS Akışında Yeni İçerik", desc: "Blog veya haber sitenizdeki RSS kaynağında yeni yazı çıktığında", icon: Rss, color: "#f97316" },
  "schedule.cron": { title: "Zamanlanmış Tetikleyici (Periyodik)", desc: "Her saat başı veya her gün belirli saatte otomatik çalışır", icon: Clock, color: "var(--accent-2)" },
  manual: { title: "Manuel / Test Tetikleme", desc: "Yalnızca panelden veya API'den tetiklendiğinde çalışır", icon: Play, color: "var(--text-2)" },
};

const STEP_TYPE_INFO: Record<WorkflowStepType, { title: string; desc: string; icon: any; color: string }> = {
  filter: { title: "Filtre (Koşul)", desc: "Metin, sayı veya duruma göre akışı durdurur veya devam ettirir", icon: Filter, color: "var(--warn)" },
  paths: { title: "Paths (Dallanma)", desc: "Koşullara göre Path A veya Path B yollarına ayrılır", icon: GitFork, color: "#8b5cf6" },
  formatter: { title: "Biçimlendirici (Formatter)", desc: "Metin dönüştürme, kırpma, regex veya matematik işlemleri", icon: Wand2, color: "var(--info)" },
  code: { title: "JavaScript Kod Motoru (JS)", desc: "Özel JavaScript kodu çalıştırarak verileri hesaplar veya dönüştürür", icon: Code, color: "#f59e0b" },
  looping: { title: "Döngü Motoru (Looping)", desc: "Siparişteki ürünler veya dizi elemanlarını tek tek döngüyle işler", icon: Repeat, color: "#06b6d4" },
  ai: { title: "AI Asistanı (Otomasyon AI)", desc: "Özetleme, sosyal medyaya uyarlama, hashtag çıkarma, duygu analizi", icon: Sparkles, color: "var(--accent)" },
  sistemler: { title: "Sistemler Ajanı", desc: "Marka Hafızası, Carousel Üretici, Trend Radarı, Konsept Fabrikası", icon: Brain, color: "#ec4899" },
  delay: { title: "Gecikme (Delay)", desc: "Sonraki adıma geçmeden önce belirli bir süre bekler", icon: Clock, color: "var(--text-2)" },
  action_post: { title: "27+ Kanala Gönderi Paylaş / Planla", desc: "Reblebi'ye bağlı sosyal medya hesaplarında gönderi oluşturur", icon: Send, color: "var(--ok)" },
  action_reply: { title: "Mesaja Yanıt Ver", desc: "Gelen kutusundaki konuşmaya otomatik yanıt gönderir", icon: MessageSquare, color: "#a855f7" },
  action_slack: { title: "Slack Mesajı Gönder", desc: "Slack kanalına veya webhook'una zengin formatlı bildirim yollar", icon: MessageSquare, color: "#e11d48" },
  action_discord: { title: "Discord Embed Gönder", desc: "Discord kanalına renkli kart ve bildirim gönderir", icon: MessageSquare, color: "#5865f2" },
  action_telegram: { title: "Telegram Bildirimi", desc: "Telegram kanal veya grubuna bot ile anlık mesaj atar", icon: Send, color: "#229ed9" },
  action_calendar_event: { title: "Takvime Etkinlik / Görev Ekle", desc: "Reblebi takvimine veya Google Calendar'a içerik/görev ekler", icon: Calendar, color: "#10b981" },
  action_shopify: { title: "Shopify Sipariş Güncelle", desc: "Siparişe etiket veya not ekler, durumunu günceller", icon: ShoppingCart, color: "var(--ok)" },
  action_webhook: { title: "Dış Webhook İsteği", desc: "Harici API'lere özel HTTP isteği gönderir (POST, GET, PUT)", icon: ExternalLink, color: "#3b82f6" },
  action_email: { title: "E-posta Bildirimi", desc: "Ekip üyelerine veya belirtilen adrese uyarı e-postası yollar", icon: Mail, color: "#f59e0b" },
  action_notify: { title: "İç Bildirim", desc: "Reblebi paneli bildirim çanına uyarı ekler", icon: Zap, color: "var(--accent)" },
};

const SISTEMLER_OPTIONS = [
  { id: "marka-hafizasi", name: "Marka Hafızası", desc: "Markanın ses tonunu korur, samimi ve kurumsal dili uygular, yasaklı kelimeleri eler." },
  { id: "carousel-uretici", name: "Carousel & Hook Üretici", desc: "3 vurucu kanca (hook) + 7 slaytlık kaydırmalı gönderi senaryosu ve görsel yönergeleri üretir." },
  { id: "trend-radari", name: "Trend Radarı", desc: "Sektörel trendleri analiz eder, viral kancalar ve bu haftalık 3 içerik açısı çıkarır." },
  { id: "konsept-fabrikasi", name: "Konsept Fabrikası", desc: "Kanca x hedef kitle x duygu rotasyonuyla 3 yaratıcı reklam ve içerik konsepti geliştirir." },
  { id: "review-madenci", name: "Yorum & İtiraz Madencisi", desc: "Müşteri itirazlarını analiz eder, ikna edici ve güven veren satış yanıtı hazırlar." },
  { id: "satis-sayfasi", name: "Satış Sayfası & CTA Metni", desc: "Yüksek dönüşümlü başlık, 3 fayda maddesi ve güçlü eylem çağrısı (CTA) yazar." },
];

export default function AutomationPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t, locale } = useI18n();
  const s = useSession();

  const [activeTab, setActiveTab] = useState<TabMode>("workflows");

  // İş Akışları Verileri
  const workflows = useQuery({ queryKey: ["workflows"], queryFn: () => api.get<Workflow[]>("/api/workflows") });
  const templates = useQuery({ queryKey: ["workflow-templates"], queryFn: () => api.get<WorkflowTemplate[]>("/api/workflows/templates") });
  const allRuns = useQuery({ queryKey: ["workflow-runs"], queryFn: () => api.get<WorkflowRun[]>("/api/workflows/runs"), enabled: activeTab === "workflows" });

  // Mevcut DM Kuralları & Ayarlar
  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api.get<Rule[]>("/api/rules") });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<OrgSettings>("/api/settings") });

  // Modal Durumları
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [isNewWorkflow, setIsNewWorkflow] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [inspectingRun, setInspectingRun] = useState<WorkflowRun | null>(null);
  const [testingWorkflow, setTestingWorkflow] = useState<Workflow | null>(null);
  const [testPayloadText, setTestPayloadText] = useState("");
  const [testResult, setTestResult] = useState<WorkflowRun | null>(null);

  // DM Rule Form
  const [editingRule, setEditingRule] = useState<EditingRule | null>(null);
  const [settingsForm, setSettingsForm] = useState<OrgSettings | null>(null);

  const features = org.data?.usage.plan.features;
  const isAdmin = s.can("admin");
  const sv = settingsForm ?? settings.data;
  const onError = (e: unknown) => toast(errMsg(e), "err");

  /* ---------- İş Akışı Mutasyonları ---------- */
  const saveWorkflow = useMutation({
    mutationFn: (wf: Partial<Workflow>) => (wf.id ? api.put<Workflow>(`/api/workflows/${wf.id}`, wf) : api.post<Workflow>("/api/workflows", wf)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      setEditingWorkflow(null);
      setIsNewWorkflow(false);
      toast(t("İş akışı kaydedildi"), "ok");
    },
    onError,
  });

  const toggleWorkflow = useMutation({
    mutationFn: (id: string) => api.post(`/api/workflows/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
    onError,
  });

  const deleteWorkflow = useMutation({
    mutationFn: (id: string) => api.del(`/api/workflows/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      toast(t("İş akışı silindi"), "ok");
    },
    onError,
  });

  const runTestWorkflow = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.post<WorkflowRun>(`/api/workflows/${id}/test`, payload),
    onSuccess: (res) => {
      setTestResult(res);
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflow-runs"] });
      toast(t("Test çalıştırması tamamlandı"), res.status === "success" ? "ok" : "err");
    },
    onError,
  });

  /* ---------- DM Kuralları Mutasyonları ---------- */
  const saveRule = useMutation({
    mutationFn: (r: EditingRule) => {
      const { id, ...rest } = r;
      return id ? api.put(`/api/rules/${id}`, rest) : api.post("/api/rules", rest);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      setEditingRule(null);
      toast(t("Kural kaydedildi"), "ok");
    },
    onError,
  });

  const toggleRule = useMutation({
    mutationFn: (r: Rule) => api.put(`/api/rules/${r.id}`, { enabled: r.enabled ? 0 : 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    onError,
  });

  const removeRule = useMutation({
    mutationFn: (id: string) => api.del(`/api/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    onError,
  });

  const saveSettings = useMutation({
    mutationFn: (v: OrgSettings) =>
      api.put<OrgSettings>("/api/settings", {
        aiAutoReplyFallback: v.aiAutoReplyFallback,
        aiReplyInstructions: v.aiReplyInstructions,
        welcomeMessage: v.welcomeMessage,
        handoffKeywords: v.handoffKeywords,
        optOutKeywords: v.optOutKeywords,
        optOutReply: v.optOutReply,
        replyDelaySeconds: v.replyDelaySeconds,
        businessHoursEnabled: v.businessHoursEnabled,
        businessHoursStart: v.businessHoursStart,
        businessHoursEnd: v.businessHoursEnd,
        businessDays: v.businessDays,
        outsideHoursMessage: v.outsideHoursMessage,
      }),
    onSuccess: (r) => {
      qc.setQueryData(["settings"], r);
      setSettingsForm(null);
      toast(t("Ayarlar kaydedildi"), "ok");
    },
    onError,
  });

  const startNewWorkflow = (tpl?: WorkflowTemplate) => {
    const wf: Workflow = {
      id: "",
      orgId: "",
      name: tpl ? tpl.name : t("Yeni Zap / İş Akışı"),
      description: tpl ? tpl.description : "",
      enabled: 1,
      triggerType: tpl ? tpl.triggerType : "webhook.inbound",
      triggerConfig: tpl ? tpl.triggerConfig : {},
      webhookSlug: null,
      steps: tpl
        ? tpl.steps
        : [
            {
              id: "step_1",
              type: "ai",
              name: t("AI ile Sosyal Medya Metni"),
              config: { mode: "rewrite", input: "{{trigger.text}}" },
            },
            {
              id: "step_2",
              type: "action_notify",
              name: t("Bildirim Gönder"),
              config: { title: "Otomasyon Tamamlandı", body: "{{steps.step_1.output}}", kind: "success" },
            },
          ],
      createdBy: null,
      runCount: 0,
      lastRunAt: null,
      lastStatus: "idle",
      createdAt: "",
      updatedAt: "",
    };
    setEditingWorkflow(wf);
    setIsNewWorkflow(true);
    setShowTemplatesModal(false);
  };

  const copyToClipboard = (text: string) => {
    void copyText(text).then((ok) => toast(ok ? t("Panoya kopyalandı") : t("Kopyalanamadı; metni seçip elle kopyala"), ok ? "ok" : "err"));
  };

  const publicOrigin = window.location.origin;

  return (
    <>
      <PageHead
        title={t("Otomasyon & İş Akışları")}
        sub={t("Çok adımlı iş akışları, harici webhook tetikleyicileri, AI & Sistemler ajanları ve DM oto-yanıt kuralları.")}
        actions={
          activeTab === "workflows" ? (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setShowTemplatesModal(true)}>
                <Sparkles style={{ color: "var(--accent)" }} /> {t("Hazır Şablonlar")}
              </button>
              <button className="btn btn-primary" onClick={() => startNewWorkflow()}>
                <Plus /> {t("Yeni İş Akışı")}
              </button>
            </div>
          ) : activeTab === "rules" ? (
            <Can role="admin">
              <button className="btn btn-primary" onClick={() => setEditingRule({ ...EMPTY_RULE })} disabled={features?.inbox === false}>
                <Plus /> {t("Yeni DM Kuralı")}
              </button>
            </Can>
          ) : null
        }
      />

      {/* Üst Sekmeler */}
      <div className="segmented seg-scroll" style={{ marginBottom: 20 }}>
        <button className={activeTab === "workflows" ? "active" : ""} onClick={() => setActiveTab("workflows")}>
          <Zap style={{ width: 15 }} /> {t("İş Akışları")}
        </button>
        <button className={activeTab === "rules" ? "active" : ""} onClick={() => setActiveTab("rules")}>
          <MessageSquare style={{ width: 15 }} /> {t("DM Oto-Yanıt Kuralları")}
        </button>
        <button className={activeTab === "comments" ? "active" : ""} onClick={() => setActiveTab("comments")}>
          <MessageCircle style={{ width: 15 }} /> {t("Yorumdan DM'e")}
        </button>
        <button className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>
          <Clock style={{ width: 15 }} /> {t("Çalışma Saatleri & Yedek Yanıt")}
        </button>
      </div>

      {/* ============================================================
          SEKME 1: İŞ AKIŞLARI (WORKFLOWS)
      ============================================================ */}
      {activeTab === "workflows" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* İstatistik Çubuğu */}
          <div className="grid grid-4">
            <Stat label={t("Toplam İş Akışı")} value={workflows.data?.length ?? 0} />
            <Stat label={t("Aktif İş Akışları")} value={workflows.data?.filter((w) => w.enabled).length ?? 0} />
            <Stat label={t("Toplam Çalıştırma")} value={workflows.data?.reduce((acc, w) => acc + (w.runCount || 0), 0) ?? 0} />
            <Stat label={t("Son Çalıştırma Kayıtları")} value={allRuns.data?.length ?? 0} />
          </div>

          {/* İş Akışları Listesi */}
          {workflows.isLoading ? (
            <div className="card muted small">{t("İş akışları yükleniyor…")}</div>
          ) : !workflows.data?.length ? (
            <Empty
              icon={<Zap style={{ width: 36, color: "var(--accent)" }} />}
              title={t("Henüz bir iş akışı oluşturulmamış")}
              text={t("Çok adımlı gelişmiş otomasyonlar kurarak RSS feedlerini, gelen webhookları veya DM'leri otomatik içeriklere dönüştürün.")}
              action={
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => startNewWorkflow()}>
                    <Plus /> {t("İlk İş Akışını Başlat")}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setShowTemplatesModal(true)}>
                    <Sparkles /> {t("Hazır Şablon İncele")}
                  </button>
                </div>
              }
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {workflows.data.map((wf) => {
                const trig = TRIGGER_LABELS[wf.triggerType] || TRIGGER_LABELS["webhook.inbound"];
                const TrigIcon = trig.icon;
                const webhookUrl = wf.webhookSlug ? `${publicOrigin}/api/webhooks/catch/${wf.webhookSlug}` : null;

                return (
                  <div key={wf.id} className="card" style={{ padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
                      {/* Sol: İkon ve Bilgi */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 260, flex: 1 }}>
                        <div
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: 10,
                            background: "var(--bg-3)",
                            border: "1px solid var(--border)",
                            display: "grid",
                            placeItems: "center",
                            color: trig.color,
                            flexShrink: 0,
                          }}
                        >
                          <TrigIcon style={{ width: 22, height: 22 }} />
                        </div>
                        <div>
                          <div className="row" style={{ gap: 8, alignItems: "center" }}>
                            <strong style={{ fontSize: 16 }}>{wf.name}</strong>
                            <span
                              className={`badge small ${
                                wf.lastStatus === "success"
                                  ? "badge-ok"
                                  : wf.lastStatus === "failed"
                                    ? "badge-err"
                                    : wf.lastStatus === "filtered"
                                      ? "badge-warn"
                                      : ""
                              }`}
                            >
                              {wf.lastStatus === "success"
                                ? t("Başarılı")
                                : wf.lastStatus === "failed"
                                  ? t("Hata")
                                  : wf.lastStatus === "filtered"
                                    ? t("Filtrelendi")
                                    : t("Boşta")}
                            </span>
                          </div>
                          {wf.description && <div className="muted small" style={{ marginTop: 2 }}>{wf.description}</div>}

                          {/* Catch Hook URL Kutusu */}
                          {webhookUrl && (
                            <div className="row" style={{ gap: 6, marginTop: 6, alignItems: "center" }}>
                              <span className="badge small" style={{ background: "var(--bg-3)", color: "var(--accent-2)" }}>
                                Catch Hook
                              </span>
                              <code style={{ fontSize: 11 }}>{webhookUrl}</code>
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                title={t("Kopyala")}
                                onClick={() => copyToClipboard(webhookUrl)}
                              >
                                <Copy style={{ width: 13 }} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Sağ: İstatistikler ve Düğmeler */}
                      <div className="row" style={{ gap: 10, alignItems: "center" }}>
                        <div style={{ textAlign: "right", marginRight: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                            {wf.runCount} {t("çalıştırma")}
                          </div>
                          <div className="muted small" style={{ fontSize: 11 }}>
                            {wf.lastRunAt ? new Date(wf.lastRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : t("Henüz çalışmadı")}
                          </div>
                        </div>

                        {/* Aç / Kapat */}
                        <button
                          className="btn btn-ghost btn-icon"
                          title={wf.enabled ? t("Durdur") : t("Aktifleştir")}
                          onClick={() => toggleWorkflow.mutate(wf.id)}
                        >
                          {wf.enabled ? (
                            <ToggleRight style={{ width: 24, height: 24, color: "var(--ok)" }} />
                          ) : (
                            <ToggleLeft style={{ width: 24, height: 24, color: "var(--text-3)" }} />
                          )}
                        </button>

                        {/* Test Et */}
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setTestingWorkflow(wf);
                            setTestResult(null);
                            setTestPayloadText(
                              JSON.stringify(
                                {
                                  title: "Reblebi Örnek Başlık",
                                  text: "Sosyal medya otomasyonu için test mesajı",
                                  from: "Örnek Müşteri",
                                  body: { topic: "AI ile İçerik Pazarlaması", total_price: 1200, financial_status: "paid" },
                                },
                                null,
                                2
                              )
                            );
                          }}
                        >
                          <Play style={{ width: 14 }} /> {t("Test Et")}
                        </button>

                        {/* Düzenle */}
                        <button className="btn btn-sm" onClick={() => { setEditingWorkflow(wf); setIsNewWorkflow(false); }}>
                          <Pencil style={{ width: 14 }} /> {t("Düzenle")}
                        </button>

                        {/* Sil */}
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          style={{ color: "var(--err)" }}
                          title={t("Sil")}
                          onClick={() => {
                            if (confirm(t("Bu iş akışını silmek istediğinden emin misin?"))) {
                              deleteWorkflow.mutate(wf.id);
                            }
                          }}
                        >
                          <Trash2 style={{ width: 15 }} />
                        </button>
                      </div>
                    </div>

                    {/* Akış Adımları Çizgisi */}
                    <div
                      style={{
                        marginTop: 14,
                        paddingTop: 12,
                        borderTop: "1px solid var(--border)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span className="badge small" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                        <span style={{ color: trig.color, display: "inline-flex" }}>
                          <TrigIcon style={{ width: 13, height: 13 }} />
                        </span>
                        <span>{trig.title.split(" (")[0]}</span>
                      </span>

                      {wf.steps.map((st, idx) => {
                        const sInfo = STEP_TYPE_INFO[st.type] || STEP_TYPE_INFO.action_notify;
                        const StepIcon = sInfo.icon;
                        return (
                          <div key={st.id || idx} className="row" style={{ gap: 8, alignItems: "center" }}>
                            <ArrowRight style={{ width: 13, color: "var(--text-3)" }} />
                            <span className="badge small" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                              <span style={{ color: sInfo.color, display: "inline-flex" }}>
                                <StepIcon style={{ width: 13, height: 13 }} />
                              </span>
                              <span>{st.name || sInfo.title}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Son Çalışma Kayıtları (Execution History Log) */}
          {allRuns.data && allRuns.data.length > 0 && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="card-title">
                <h3>
                  <History style={{ width: 16, display: "inline-block", verticalAlign: "middle", marginRight: 6 }} />
                  {t("Son Çalışma Kayıtları (Execution Logs)")}
                </h3>
                <span className="muted small">{t("Tüm tetiklemelerin ayrıntılı girdi/çıktı adımları")}</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>{t("İş Akışı")}</th>
                      <th>{t("Tetikleyici")}</th>
                      <th>{t("Durum")}</th>
                      <th>{t("Süre")}</th>
                      <th>{t("Adım Sayısı")}</th>
                      <th>{t("Tarih")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRuns.data.slice(0, 15).map((run) => (
                      <tr key={run.id}>
                        <td>
                          <strong>{workflows.data?.find((w) => w.id === run.workflowId)?.name ?? run.workflowId}</strong>
                        </td>
                        <td>
                          <span className="badge small">{run.triggerType}</span>
                        </td>
                        <td>
                          <span
                            className={`badge small ${
                              run.status === "success"
                                ? "badge-ok"
                                : run.status === "failed"
                                  ? "badge-err"
                                  : "badge-warn"
                            }`}
                          >
                            {run.status === "success" ? t("Başarılı") : run.status === "failed" ? t("Hata") : t("Filtrelendi")}
                          </span>
                        </td>
                        <td>{run.durationMs} ms</td>
                        <td>{run.stepsExecuted?.length ?? 0} {t("adım")}</td>
                        <td className="muted small">{new Date(run.createdAt).toLocaleString(locale === "en" ? "en-US" : "tr-TR")}</td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => setInspectingRun(run)}>
                            {t("İncele")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          SEKME 2: MEVCUT DM KURALLARI
      ============================================================ */}
      {activeTab === "rules" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {rules.isLoading ? (
            <div className="card muted small">{t("Kurallar yükleniyor…")}</div>
          ) : !rules.data?.length ? (
            <Empty
              icon={<MessageSquare style={{ width: 36, color: "var(--accent)" }} />}
              title={t("Henüz DM kuralı yok")}
              text={t("Gelen mesajlara otomatik yanıt vermek için anahtar kelime veya AI destekli kural oluşturun.")}
              action={
                <Can role="admin">
                  <button className="btn btn-primary" onClick={() => setEditingRule({ ...EMPTY_RULE })}>
                    <Plus /> {t("Kural Oluştur")}
                  </button>
                </Can>
              }
            />
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <table className="table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>{t("Kural")}</th>
                    <th>{t("Tetikleyici")}</th>
                    <th>{t("Yanıt")}</th>
                    <th>{t("Öncelik")}</th>
                    <th>{t("Durum")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.data.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                      </td>
                      <td>
                        <span className="badge small">{MATCH_LABELS[r.matchType] ? t(MATCH_LABELS[r.matchType]) : r.matchType}</span>
                        {r.pattern && <div className="muted small pre">{r.pattern}</div>}
                      </td>
                      <td>
                        <span className="badge small">{r.replyMode === "ai" ? "AI Yanıtı" : "Şablon"}</span>
                        {r.replyText && <div className="muted small pre truncate" style={{ maxWidth: 260 }}>{r.replyText}</div>}
                      </td>
                      <td>{r.priority}</td>
                      <td>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggleRule.mutate(r)}>
                          {r.enabled ? <ToggleRight style={{ color: "var(--ok)", width: 22 }} /> : <ToggleLeft style={{ color: "var(--text-3)", width: 22 }} />}
                        </button>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingRule(r)}>
                          <Pencil style={{ width: 14 }} />
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--err)" }} onClick={() => removeRule.mutate(r.id)}>
                          <Trash2 style={{ width: 14 }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "comments" && <CommentToDmTab channels={channels.data ?? []} inboxEnabled={features?.inbox !== false} />}

      {/* ============================================================
          SEKME 3: ÇALIŞMA SAATLERİ & YEDEK YANIT
      ============================================================ */}
      {activeTab === "settings" && sv && (
        <div className="card" style={{ maxWidth: 720 }}>
          <div className="card-title">
            <h3>{t("Mesai Saatleri & AI Yedek Yanıt")}</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label className="row" style={{ gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={sv.businessHoursEnabled}
                onChange={(e) => setSettingsForm({ ...sv, businessHoursEnabled: e.target.checked })}
              />
              <span>{t("Mesai saatleri kontrolünü etkinleştir")}</span>
            </label>

            {sv.businessHoursEnabled && (
              <div className="row" style={{ gap: 12 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>{t("Başlangıç")}</label>
                  <input
                    type="time"
                    className="input"
                    value={sv.businessHoursStart}
                    onChange={(e) => setSettingsForm({ ...sv, businessHoursStart: e.target.value })}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>{t("Bitiş")}</label>
                  <input
                    type="time"
                    className="input"
                    value={sv.businessHoursEnd}
                    onChange={(e) => setSettingsForm({ ...sv, businessHoursEnd: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="field">
              <label>{t("Mesai Dışı Otomatik Mesaj")}</label>
              <textarea
                className="input"
                rows={3}
                value={sv.outsideHoursMessage}
                onChange={(e) => setSettingsForm({ ...sv, outsideHoursMessage: e.target.value })}
                placeholder={t("Şu an çalışma saatlerimiz dışındayız. İlk iş gününde size döneceğiz.")}
              />
            </div>

            <div className="field">
              <label className="row" style={{ gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={sv.aiAutoReplyFallback}
                  onChange={(e) => setSettingsForm({ ...sv, aiAutoReplyFallback: e.target.checked })}
                />
                <span>{t("Kural eşleşmezse AI yedek yanıt versin")}</span>
              </label>
            </div>

            {sv.aiAutoReplyFallback && (
              <div className="field">
                <label>{t("AI Yanıt Talimatı (Prompt)")}</label>
                <textarea
                  className="input"
                  rows={3}
                  value={sv.aiReplyInstructions}
                  onChange={(e) => setSettingsForm({ ...sv, aiReplyInstructions: e.target.value })}
                  placeholder={t("Müşterilere samimi, net ve yardımcı bir dille yanıt ver.")}
                />
              </div>
            )}

            <div className="field">
              <label>{t("Çıkış kelimeleri")}</label>
              <input
                className="input"
                value={sv.optOutKeywords ?? ""}
                onChange={(e) => setSettingsForm({ ...sv, optOutKeywords: e.target.value })}
                placeholder="stop, durdur, abonelikten çık*"
              />
              <span className="help">{t("Bu kelimelerden birini yazan kişiye bir daha otomatik mesaj gönderilmez (kural, AI, yorumdan DM, iş akışı). İnsan cevabı gidebilir.")}</span>
            </div>

            <div className="field">
              <label>{t("Çıkış onay mesajı")}</label>
              <textarea
                className="input"
                rows={2}
                value={sv.optOutReply ?? ""}
                onChange={(e) => setSettingsForm({ ...sv, optOutReply: e.target.value })}
                placeholder={t("Tamam, sana bir daha otomatik mesaj göndermeyeceğiz.")}
              />
              <span className="help">{t("Çıkışta bir kez gönderilir; boş bırakırsan mesaj gönderilmez.")}</span>
            </div>

            <button className="btn btn-primary" onClick={() => saveSettings.mutate(sv)} disabled={saveSettings.isPending}>
              {t("Ayarları Kaydet")}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: İŞ AKIŞI TASARIMCISI (BUILDER)
      ============================================================ */}
      {editingWorkflow && (
        <Modal
          title={isNewWorkflow ? t("Yeni İş Akışı Oluştur (Zap)") : t("İş Akışını Düzenle")}
          onClose={() => setEditingWorkflow(null)}
          large
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Üst Bilgiler */}
            <div className="grid grid-2">
              <div className="field">
                <label>{t("İş Akışı Adı")}</label>
                <input
                  className="input"
                  value={editingWorkflow.name}
                  onChange={(e) => setEditingWorkflow({ ...editingWorkflow, name: e.target.value })}
                  placeholder={t("Örn: Blog RSS -> AI Özet -> Sosyal Medya Paylaşımı")}
                  required
                />
              </div>
              <div className="field">
                <label>{t("Açıklama")}</label>
                <input
                  className="input"
                  value={editingWorkflow.description ?? ""}
                  onChange={(e) => setEditingWorkflow({ ...editingWorkflow, description: e.target.value })}
                  placeholder={t("Bu iş akışı ne işe yarıyor?")}
                />
              </div>
            </div>

            <div className="flow-builder">
              {/* 1. ADIM: TETİKLEYİCİ (TRIGGER) */}
              <div className="flow-node active">
                <div className="flow-node-header">
                  <div className="row" style={{ gap: 10, alignItems: "center" }}>
                    <div className="flow-node-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      1
                    </div>
                    <div>
                      <strong>{t("Tetikleyici (Trigger)")}</strong>
                      <div className="muted small">{TRIGGER_LABELS[editingWorkflow.triggerType]?.desc}</div>
                    </div>
                  </div>
                  <span className="badge small" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                    {t("Başlangıç")}
                  </span>
                </div>

                <div className="field" style={{ marginTop: 10 }}>
                  <label>{t("Tetikleyici Türü")}</label>
                  <select
                    className="input"
                    value={editingWorkflow.triggerType}
                    onChange={(e) =>
                      setEditingWorkflow({
                        ...editingWorkflow,
                        triggerType: e.target.value as WorkflowTriggerType,
                        triggerConfig: {},
                      })
                    }
                  >
                    {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.title}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tetikleyici Özel Ayarları */}
                {editingWorkflow.triggerType === "webhook.inbound" && (
                  <div style={{ marginTop: 12, padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                    <div className="muted small" style={{ marginBottom: 6 }}>
                      {t("Bu adrese herhangi bir harici servisten (Shopify, Stripe, Form, cURL) HTTP POST veya GET isteği atıldığında akış anında tetiklenir:")}
                    </div>
                    <code style={{ display: "block", padding: 8, background: "var(--bg)", borderRadius: 6, wordBreak: "break-all" }}>
                      {editingWorkflow.webhookSlug
                        ? `${publicOrigin}/api/webhooks/catch/${editingWorkflow.webhookSlug}`
                        : `${publicOrigin}/api/webhooks/catch/(otomatik-olusturulacak)`}
                    </code>
                  </div>
                )}

                {editingWorkflow.triggerType === "rss.new_item" && (
                  <div className="field" style={{ marginTop: 12 }}>
                    <label>{t("RSS Feed URL'si")}</label>
                    <input
                      className="input"
                      value={editingWorkflow.triggerConfig?.rssUrl ?? ""}
                      onChange={(e) =>
                        setEditingWorkflow({
                          ...editingWorkflow,
                          triggerConfig: { ...editingWorkflow.triggerConfig, rssUrl: e.target.value },
                        })
                      }
                      placeholder="https://site.com/feed.xml"
                      required
                    />
                  </div>
                )}

                {editingWorkflow.triggerType === "schedule.cron" && (
                  <div className="row" style={{ gap: 12, marginTop: 12 }}>
                    <div className="field" style={{ flex: 1 }}>
                      <label>{t("Sıklık")}</label>
                      <select
                        className="input"
                        value={editingWorkflow.triggerConfig?.interval ?? "daily"}
                        onChange={(e) =>
                          setEditingWorkflow({
                            ...editingWorkflow,
                            triggerConfig: { ...editingWorkflow.triggerConfig, interval: e.target.value },
                          })
                        }
                      >
                        <option value="daily">{t("Günde bir kez")}</option>
                        <option value="hourly">{t("Her saat başı")}</option>
                      </select>
                    </div>
                    <div className="field" style={{ flex: 1 }}>
                      <label>{t("Saat (0-23)")}</label>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        className="input"
                        value={editingWorkflow.triggerConfig?.hour ?? 9}
                        onChange={(e) =>
                          setEditingWorkflow({
                            ...editingWorkflow,
                            triggerConfig: { ...editingWorkflow.triggerConfig, hour: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 2+. ADIMLAR: SIRALI İŞLEMLER */}
              {editingWorkflow.steps.map((step, idx) => {
                const sInfo = STEP_TYPE_INFO[step.type] || STEP_TYPE_INFO.action_notify;
                const StepIcon = sInfo.icon;

                return (
                  <div key={step.id || idx} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div className="flow-connector" />

                    <div className="flow-node">
                      <div className="flow-node-header">
                        <div className="row" style={{ gap: 10, alignItems: "center" }}>
                          <div className="flow-node-icon" style={{ background: "var(--bg-3)", color: sInfo.color }}>
                            {idx + 2}
                          </div>
                          <div>
                            <strong>{step.name || sInfo.title}</strong>
                            <div className="muted small">{sInfo.desc}</div>
                          </div>
                        </div>

                        <div className="row" style={{ gap: 6 }}>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            style={{ color: "var(--err)" }}
                            title={t("Adımı Sil")}
                            onClick={() => {
                              const newSteps = [...editingWorkflow.steps];
                              newSteps.splice(idx, 1);
                              setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                            }}
                          >
                            <Trash2 style={{ width: 14 }} />
                          </button>
                        </div>
                      </div>

                      {/* Adım Türü Seçici */}
                      <div className="grid grid-2" style={{ gap: 10, marginBottom: 12 }}>
                        <div className="field">
                          <label>{t("Adım Başlığı")}</label>
                          <input
                            className="input"
                            value={step.name}
                            onChange={(e) => {
                              const newSteps = [...editingWorkflow.steps];
                              newSteps[idx] = { ...step, name: e.target.value };
                              setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                            }}
                          />
                        </div>
                        <div className="field">
                          <label>{t("İşlem Türü")}</label>
                          <select
                            className="input"
                            value={step.type}
                            onChange={(e) => {
                              const newType = e.target.value as WorkflowStepType;
                              const newSteps = [...editingWorkflow.steps];
                              newSteps[idx] = { ...step, type: newType, config: {} };
                              setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                            }}
                          >
                            {Object.entries(STEP_TYPE_INFO).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v.title}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* --- FORM AYARLARI: FİLTRE --- */}
                      {step.type === "filter" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="row-between" style={{ marginBottom: 8 }}>
                            <strong className="small">{t("Filtre Koşulları")}</strong>
                            <select
                              className="input"
                              style={{ width: "auto", padding: "2px 8px", height: 28 }}
                              value={step.config.match || "all"}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.match = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                            >
                              <option value="all">{t("Tüm koşullar sağlansın (VE)")}</option>
                              <option value="any">{t("En az biri sağlansın (VEYA)")}</option>
                            </select>
                          </div>

                          {(step.config.conditions || []).map((cond: any, cIdx: number) => (
                            <div key={cIdx} className="row" style={{ gap: 6, marginBottom: 6 }}>
                              <input
                                className="input"
                                style={{ flex: 2 }}
                                placeholder="trigger.text"
                                value={cond.field}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.conditions[cIdx].field = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                              />
                              <select
                                className="input"
                                style={{ flex: 2 }}
                                value={cond.operator}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.conditions[cIdx].operator = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                              >
                                <option value="contains">{t("içerir")}</option>
                                <option value="not_contains">{t("içermez")}</option>
                                <option value="equals">{t("eşittir")}</option>
                                <option value="not_equals">{t("eşit değildir")}</option>
                                <option value="greater_than">{t("büyüktür")}</option>
                                <option value="less_than">{t("küçüktür")}</option>
                                <option value="is_empty">{t("boş ise")}</option>
                                <option value="is_not_empty">{t("dolu ise")}</option>
                              </select>
                              <input
                                className="input"
                                style={{ flex: 2 }}
                                placeholder={t("değer")}
                                value={cond.value}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.conditions[cIdx].value = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                              />
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.conditions.splice(cIdx, 1);
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                              >
                                <Trash2 style={{ width: 14 }} />
                              </button>
                            </div>
                          ))}

                          <button
                            className="btn btn-sm"
                            style={{ marginTop: 6 }}
                            onClick={() => {
                              const newSteps = [...editingWorkflow.steps];
                              if (!newSteps[idx].config.conditions) newSteps[idx].config.conditions = [];
                              newSteps[idx].config.conditions.push({ field: "trigger.text", operator: "contains", value: "" });
                              setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                            }}
                          >
                            <Plus style={{ width: 13 }} /> {t("Koşul Ekle")}
                          </button>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: FORMATTER --- */}
                      {step.type === "formatter" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div className="field">
                              <label>{t("Dönüştürücü Türü")}</label>
                              <select
                                className="input"
                                value={step.config.type || "text"}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.type = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                              >
                                <option value="text">{t("Metin (Text)")}</option>
                                <option value="math">{t("Sayı & Matematik")}</option>
                                <option value="date">{t("Tarih & Zaman")}</option>
                              </select>
                            </div>
                            <div className="field">
                              <label>{t("İşlem")}</label>
                              <select
                                className="input"
                                value={step.config.operation || "trim"}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.operation = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                              >
                                {step.config.type === "math" ? (
                                  <>
                                    <option value="add">{t("Topla (+)")}</option>
                                    <option value="subtract">{t("Çıkar (-)")}</option>
                                    <option value="multiply">{t("Çarp (*)")}</option>
                                    <option value="divide">{t("Böl (/)")}</option>
                                  </>
                                ) : step.config.type === "date" ? (
                                  <>
                                    <option value="format_date">{t("Formatlı Tarih")}</option>
                                    <option value="add_hours">{t("Saat Ekle")}</option>
                                    <option value="now_iso">{t("Şu Anki ISO Zamanı")}</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="trim">{t("Boşlukları Kırp (Trim)")}</option>
                                    <option value="uppercase">{t("Büyük Harf Yap (UPPERCASE)")}</option>
                                    <option value="lowercase">{t("Küçük Harf Yap (lowercase)")}</option>
                                    <option value="capitalize">{t("Baş Harfleri Büyüt")}</option>
                                    <option value="truncate">{t("Karakter Sınırla (Truncate)")}</option>
                                    <option value="replace">{t("Kelime Değiştir (Replace)")}</option>
                                    <option value="template_merge">{t("Şablon Metni Birleştir")}</option>
                                  </>
                                )}
                              </select>
                            </div>
                          </div>

                          <div className="field">
                            <label>{t("Girdi Metni / Değer")}</label>
                            <input
                              className="input"
                              value={step.config.input ?? ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.input = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="{{trigger.text}}"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: AI ASİSTANI --- */}
                      {step.type === "ai" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="field" style={{ marginBottom: 8 }}>
                            <label>{t("AI Modu")}</label>
                            <select
                              className="input"
                              value={step.config.mode || "custom"}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.mode = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                            >
                              <option value="rewrite">{t("Sosyal Medyaya Uyarla & Kanca Ekle")}</option>
                              <option value="summarize">{t("Kısa ve Vurucu Özetle")}</option>
                              <option value="extract_hashtags">{t("Alakalı Hashtagler Çıkar")}</option>
                              <option value="sentiment_analysis">{t("Duygu & Şikayet Analizi Yap")}</option>
                              <option value="translate">{t("Türkçeye Çevir")}</option>
                              <option value="custom">{t("Özel Prompt / Talimat")}</option>
                            </select>
                          </div>

                          <div className="field">
                            <label>{t("Girdi veya Özel İstek")}</label>
                            <textarea
                              className="input"
                              rows={3}
                              value={step.config.input || step.config.prompt || ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.input = e.target.value;
                                newSteps[idx].config.prompt = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="{{trigger.text}}"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: SİSTEMLER AJANI --- */}
                      {step.type === "sistemler" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="field" style={{ marginBottom: 10 }}>
                            <label>{t("Sistemler Ajanı Seçimi")}</label>
                            <select
                              className="input"
                              value={step.config.system || "marka-hafizasi"}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.system = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                            >
                              {SISTEMLER_OPTIONS.map((sys) => (
                                <option key={sys.id} value={sys.id}>
                                  {sys.name} ({sys.desc})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="field">
                            <label>{t("Ajanın İnceleyeceği Konu / Metin")}</label>
                            <textarea
                              className="input"
                              rows={3}
                              value={step.config.input ?? ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.input = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="{{trigger.title}} veya konu özeti"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: GÖNDERİ PAYLAŞ --- */}
                      {step.type === "action_post" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="field" style={{ marginBottom: 10 }}>
                            <label>{t("Yayınlanacak Kanallar")}</label>
                            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                              {channels.data?.map((ch) => {
                                const checked = (step.config.channelIds || []).includes(ch.id);
                                return (
                                  <label
                                    key={ch.id}
                                    className="badge"
                                    style={{
                                      padding: "6px 10px",
                                      cursor: "pointer",
                                      background: checked ? "var(--accent-soft)" : "var(--bg)",
                                      border: checked ? "1px solid var(--accent)" : "1px solid var(--border)",
                                      color: checked ? "var(--accent-2)" : "var(--text)",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      style={{ display: "none" }}
                                      checked={checked}
                                      onChange={(e) => {
                                        const newSteps = [...editingWorkflow.steps];
                                        const current = new Set(newSteps[idx].config.channelIds || []);
                                        if (e.target.checked) current.add(ch.id);
                                        else current.delete(ch.id);
                                        newSteps[idx].config.channelIds = Array.from(current);
                                        setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                      }}
                                    />
                                    <ProviderIcon provider={ch.provider} /> {ch.name}
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div className="field">
                              <label>{t("Yayın Zamanı")}</label>
                              <select
                                className="input"
                                value={step.config.publishMode || "next_slot"}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.publishMode = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                              >
                                <option value="next_slot">{t("Bir sonraki boş saate koy (Akıllı Kuyruk)")}</option>
                                <option value="now">{t("Hemen Şimdi Yayınla")}</option>
                                <option value="draft">{t("Taslak Olarak Kaydet")}</option>
                              </select>
                            </div>
                            <div className="field">
                              <label>{t("Başlık (Opsiyonel)")}</label>
                              <input
                                className="input"
                                value={step.config.title ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.title = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="{{trigger.title}}"
                              />
                            </div>
                          </div>

                          <div className="field">
                            <label>{t("Gönderi Metni Şablonu")}</label>
                            <textarea
                              className="input"
                              rows={3}
                              value={step.config.content ?? ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.content = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="{{steps.step_1.output}}"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: WEBHOOK İSTEĞİ --- */}
                      {step.type === "action_webhook" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div className="field" style={{ flex: 1 }}>
                              <label>{t("HTTP Metodu")}</label>
                              <select
                                className="input"
                                value={step.config.method || "POST"}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.method = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                              >
                                <option value="POST">POST</option>
                                <option value="GET">GET</option>
                                <option value="PUT">PUT</option>
                              </select>
                            </div>
                            <div className="field" style={{ flex: 3 }}>
                              <label>{t("Hedef Webhook URL'si")}</label>
                              <input
                                className="input"
                                value={step.config.url ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.url = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="https://hooks.slack.com/... veya https://discord.com/api/webhooks/..."
                              />
                            </div>
                          </div>

                          <div className="field">
                            <label>{t("JSON Gövdesi (Payload)")}</label>
                            <textarea
                              className="input font-mono"
                              rows={3}
                              value={step.config.body ?? ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.body = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder='{"text": "{{steps.step_1.output}}"}'
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: E-POSTA BİLDİRİMİ --- */}
                      {step.type === "action_email" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div className="field">
                              <label>{t("Alıcı E-posta")}</label>
                              <input
                                className="input"
                                value={step.config.to ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.to = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder={t("Boş bırakılırsa yöneticiye gider")}
                              />
                            </div>
                            <div className="field">
                              <label>{t("Konu")}</label>
                              <input
                                className="input"
                                value={step.config.subject ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.subject = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="⚠️ Bildirim: {{trigger.title}}"
                              />
                            </div>
                          </div>

                          <div className="field">
                            <label>{t("E-posta İçeriği")}</label>
                            <textarea
                              className="input"
                              rows={3}
                              value={step.config.body ?? ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.body = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="{{steps.step_1.output}}"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: İÇ BİLDİRİM --- */}
                      {step.type === "action_notify" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div className="field">
                              <label>{t("Bildirim Başlığı")}</label>
                              <input
                                className="input"
                                value={step.config.title ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.title = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="Yeni İçerik Hazır!"
                              />
                            </div>
                            <div className="field">
                              <label>{t("Tür")}</label>
                              <select
                                className="input"
                                value={step.config.kind || "info"}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.kind = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                              >
                                <option value="info">{t("Bilgi (Mavi)")}</option>
                                <option value="success">{t("Başarılı (Yeşil)")}</option>
                                <option value="warning">{t("Uyarı (Sarı)")}</option>
                                <option value="error">{t("Hata (Kırmızı)")}</option>
                              </select>
                            </div>
                          </div>

                          <div className="field">
                            <label>{t("Mesaj Gövdesi")}</label>
                            <input
                              className="input"
                              value={step.config.body ?? ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.body = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="{{steps.step_1.output}}"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: JAVASCRIPT KOD MOTORU --- */}
                      {step.type === "code" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="field">
                            <label style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>{t("JavaScript Kodu (Sandbox)")}</span>
                              <span className="muted small">inputData ve return desteklenir</span>
                            </label>
                            <textarea
                              className="input font-mono"
                              rows={5}
                              value={step.config.code ?? `// inputData üzerinden gelen verilere erişebilirsiniz:\nconst price = Number(inputData.total_price || 0);\nreturn {\n  priceWithTax: price * 1.20,\n  calculatedAt: new Date().toISOString()\n};`}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.code = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="return { result: inputData.foo * 2 };"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: SLACK BİLDİRİMİ --- */}
                      {step.type === "action_slack" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div className="field">
                              <label>{t("Slack Webhook URL")}</label>
                              <input
                                className="input"
                                value={step.config.webhookUrl ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.webhookUrl = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="https://hooks.slack.com/services/..."
                              />
                            </div>
                            <div className="field">
                              <label>{t("Kanal (İsteğe bağlı)")}</label>
                              <input
                                className="input"
                                value={step.config.channel ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.channel = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="#siparisler veya #duyurular"
                              />
                            </div>
                          </div>
                          <div className="field">
                            <label>{t("Mesaj Metni")}</label>
                            <textarea
                              className="input"
                              rows={3}
                              value={step.config.message ?? ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.message = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="🎉 Yeni Sipariş: #{{trigger.order_number}} - {{trigger.customer_name}} ({{trigger.total_price}} TL)"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: DISCORD BİLDİRİMİ --- */}
                      {step.type === "action_discord" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div className="field">
                              <label>{t("Discord Webhook URL")}</label>
                              <input
                                className="input"
                                value={step.config.webhookUrl ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.webhookUrl = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="https://discord.com/api/webhooks/..."
                              />
                            </div>
                            <div className="field">
                              <label>{t("Embed Başlığı")}</label>
                              <input
                                className="input"
                                value={step.config.title ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.title = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="🚀 Yeni Ödeme / Bildirim"
                              />
                            </div>
                          </div>
                          <div className="field">
                            <label>{t("Embed Açıklaması")}</label>
                            <textarea
                              className="input"
                              rows={3}
                              value={step.config.description ?? ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.description = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="Müşteri: {{trigger.customer_name}}\nTutar: {{trigger.total_price}} TL"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: TELEGRAM BİLDİRİMİ --- */}
                      {step.type === "action_telegram" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div className="field">
                              <label>{t("Bot Token")}</label>
                              <input
                                className="input"
                                value={step.config.botToken ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.botToken = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="123456:ABC-DEF..."
                              />
                            </div>
                            <div className="field">
                              <label>{t("Hedef Chat / Kanal ID")}</label>
                              <input
                                className="input"
                                value={step.config.chatId ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.chatId = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="-10012345678 veya @kanaladi"
                              />
                            </div>
                          </div>
                          <div className="field">
                            <label>{t("Mesaj Metni")}</label>
                            <textarea
                              className="input"
                              rows={3}
                              value={step.config.text ?? ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.text = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="📢 Yeni Sipariş: #{{trigger.order_number}}"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: TAKVİME EKLE --- */}
                      {step.type === "action_calendar_event" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div className="field">
                              <label>{t("Etkinlik / Görev Başlığı")}</label>
                              <input
                                className="input"
                                value={step.config.title ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.title = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="Sipariş Teslimatı / Görevi: #{{trigger.order_number}}"
                              />
                            </div>
                            <div className="field">
                              <label>{t("Planlama Tarihi (ISO veya boş)")}</label>
                              <input
                                className="input"
                                value={step.config.scheduledAt ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.scheduledAt = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="Boş bırakılırsa sıradaki boş saate oturur"
                              />
                            </div>
                          </div>
                          <div className="field">
                            <label>{t("Notlar / İçerik")}</label>
                            <textarea
                              className="input"
                              rows={2}
                              value={step.config.content ?? ""}
                              onChange={(e) => {
                                const newSteps = [...editingWorkflow.steps];
                                newSteps[idx].config.content = e.target.value;
                                setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                              }}
                              placeholder="Müşteri: {{trigger.customer_name}}, Şehir: {{trigger.shipping_city}}"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- FORM AYARLARI: SHOPIFY GÜNCELLE --- */}
                      {step.type === "action_shopify" && (
                        <div style={{ padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div className="field">
                              <label>{t("Mağaza Alan Adı (Domain)")}</label>
                              <input
                                className="input"
                                value={step.config.shopDomain ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.shopDomain = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="magazam.myshopify.com"
                              />
                            </div>
                            <div className="field">
                              <label>{t("Sipariş ID")}</label>
                              <input
                                className="input"
                                value={step.config.orderId ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.orderId = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="{{trigger.order_id}}"
                              />
                            </div>
                          </div>
                          <div className="grid grid-2" style={{ gap: 8 }}>
                            <div className="field">
                              <label>{t("Siparişe Not Ekle")}</label>
                              <input
                                className="input"
                                value={step.config.note ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.note = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="Reblebi tarafından işlendi"
                              />
                            </div>
                            <div className="field">
                              <label>{t("Siparişe Etiket (Tag) Ekle")}</label>
                              <input
                                className="input"
                                value={step.config.tags ?? ""}
                                onChange={(e) => {
                                  const newSteps = [...editingWorkflow.steps];
                                  newSteps[idx].config.tags = e.target.value;
                                  setEditingWorkflow({ ...editingWorkflow, steps: newSteps });
                                }}
                                placeholder="otomasyon, vip, takipte"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Değişken Kısayolları (Chips) */}
                      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                        <span className="muted small" style={{ fontSize: 11 }}>{t("Değişken Ekle:")}</span>
                        {["{{trigger.title}}", "{{trigger.text}}", "{{trigger.link}}", "{{steps.step_1.output}}", "{{steps.step_2.output}}"].map((pill) => (
                          <button
                            key={pill}
                            type="button"
                            className="var-pill"
                            onClick={() => copyToClipboard(pill)}
                            title={t("Kopyalamak için tıkla")}
                          >
                            {pill}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* (+) ADIM EKLE DÜĞMESİ */}
              <div className="flow-connector" />
              <button
                className="btn btn-ghost btn-sm flow-add-step"
                onClick={() => {
                  const stepNum = editingWorkflow.steps.length + 1;
                  const newStep: WorkflowStep = {
                    id: `step_${stepNum}`,
                    type: "ai",
                    name: `Adım ${stepNum}: AI ile İşle`,
                    config: { mode: "rewrite", input: `{{steps.step_${stepNum - 1}.output}}` },
                  };
                  setEditingWorkflow({
                    ...editingWorkflow,
                    steps: [...editingWorkflow.steps, newStep],
                  });
                }}
              >
                <Plus style={{ width: 14 }} /> {t("Yeni Adım Ekle")}
              </button>
            </div>

            {/* Kaydet ve Kapat */}
            <div className="row-between" style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <button className="btn btn-ghost" onClick={() => setEditingWorkflow(null)}>
                {t("Vazgeç")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => saveWorkflow.mutate(editingWorkflow)}
                disabled={!editingWorkflow.name || saveWorkflow.isPending}
              >
                {saveWorkflow.isPending ? t("Kaydediliyor…") : t("İş Akışını Kaydet")}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================
          MODAL: HAZIR ŞABLON GALERİSİ (TEMPLATES)
      ============================================================ */}
      {showTemplatesModal && (
        <Modal title={t("Hazır Otomasyon Şablonları")} onClose={() => setShowTemplatesModal(false)} large>
          <p className="muted small" style={{ marginBottom: 16 }}>
            {t("Tek tıkla hazır bir iş akışını çalışma alanınıza ekleyin ve anında kullanmaya başlayın.")}
          </p>
          <div className="grid grid-2" style={{ gap: 14 }}>
            {templates.data?.map((tpl) => (
              <div key={tpl.id} className="template-card">
                <div>
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <strong>{tpl.name}</strong>
                    <span className="badge small">{tpl.triggerType}</span>
                  </div>
                  <p className="muted small" style={{ lineHeight: 1.5 }}>
                    {tpl.description}
                  </p>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                    {tpl.steps.map((s, idx) => (
                      <span key={idx} className="badge small" style={{ background: "var(--bg-3)" }}>
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
                <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => startNewWorkflow(tpl)}>
                  <Sparkles style={{ width: 13 }} /> {t("Bu Şablonu Kullan")}
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* ============================================================
          MODAL: TEST ÇALIŞTIRMASI & CANLI SİMÜLASYON
      ============================================================ */}
      {testingWorkflow && (
        <Modal title={t("İş Akışını Canlı Test Et: {name}", { name: testingWorkflow.name })} onClose={() => setTestingWorkflow(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="muted small">
              {t("Aşağıdaki örnek tetikleyici verisi ile iş akışını baştan sona çalıştırıp her adımın sonucunu görüntüleyin:")}
            </p>

            <div className="field">
              <label>{t("Örnek Tetikleyici JSON Payload'u")}</label>
              <textarea
                className="input font-mono"
                rows={6}
                value={testPayloadText}
                onChange={(e) => setTestPayloadText(e.target.value)}
              />
            </div>

            <button
              className="btn btn-primary"
              disabled={runTestWorkflow.isPending}
              onClick={() => {
                let parsed: any = {};
                try {
                  parsed = JSON.parse(testPayloadText);
                } catch {
                  parsed = { text: testPayloadText };
                }
                runTestWorkflow.mutate({ id: testingWorkflow.id, payload: parsed });
              }}
            >
              {runTestWorkflow.isPending ? t("Çalıştırılıyor…") : t("Testi Çalıştır")}
            </button>

            {testResult && (
              <div style={{ marginTop: 14, padding: 12, background: "var(--bg-3)", borderRadius: 8 }}>
                <div className="row-between" style={{ marginBottom: 10 }}>
                  <strong>{t("Test Sonucu")}</strong>
                  <span className={`badge ${testResult.status === "success" ? "badge-ok" : "badge-err"}`}>
                    {testResult.status} ({testResult.durationMs} ms)
                  </span>
                </div>

                <div className="run-timeline">
                  {testResult.stepsExecuted.map((step, idx) => (
                    <div key={idx} className="run-step-item">
                      <div className="row-between">
                        <strong>
                          {idx + 1}. {step.name} ({step.type})
                        </strong>
                        <span className={`badge small ${step.status === "success" ? "badge-ok" : "badge-err"}`}>
                          {step.status} ({step.durationMs} ms)
                        </span>
                      </div>
                      {step.error && <div className="notice notice-err small" style={{ marginTop: 6 }}>{step.error}</div>}
                      {step.output !== undefined && (
                        <div style={{ marginTop: 6 }}>
                          <div className="muted small">{t("Çıktı:")}</div>
                          <pre style={{ margin: 0, padding: 6, background: "var(--bg)", borderRadius: 4, fontSize: 11, maxHeight: 120, overflow: "auto" }}>
                            {typeof step.output === "object" ? JSON.stringify(step.output, null, 2) : String(step.output)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ============================================================
          MODAL: ÇALIŞMA KAYDI İNCELEME (RUN INSPECTOR)
      ============================================================ */}
      {inspectingRun && (
        <Modal title={t("Çalışma Kaydı Ayrıntısı (Run Inspector)")} onClose={() => setInspectingRun(null)} large>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="grid grid-3">
              <div className="card" style={{ padding: 10 }}>
                <div className="muted small">{t("Durum")}</div>
                <div style={{ fontWeight: 700, marginTop: 2 }}>{inspectingRun.status}</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div className="muted small">{t("Toplam Süre")}</div>
                <div style={{ fontWeight: 700, marginTop: 2 }}>{inspectingRun.durationMs} ms</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div className="muted small">{t("Zaman")}</div>
                <div style={{ fontWeight: 700, marginTop: 2 }}>
                  {new Date(inspectingRun.createdAt).toLocaleString(locale === "en" ? "en-US" : "tr-TR")}
                </div>
              </div>
            </div>

            <div>
              <strong>{t("Tetikleyici Verisi (Payload)")}</strong>
              <pre style={{ background: "var(--bg-3)", padding: 10, borderRadius: 8, fontSize: 12, maxHeight: 140, overflow: "auto" }}>
                {JSON.stringify(inspectingRun.triggerPayload, null, 2)}
              </pre>
            </div>

            <div>
              <strong>{t("Çalıştırılan Adımlar")}</strong>
              <div className="run-timeline">
                {inspectingRun.stepsExecuted.map((step, idx) => (
                  <div key={idx} className="run-step-item">
                    <div className="row-between">
                      <strong>
                        {idx + 1}. {step.name} ({step.type})
                      </strong>
                      <span
                        className={`badge small ${
                          step.status === "success"
                            ? "badge-ok"
                            : step.status === "failed"
                              ? "badge-err"
                              : "badge-warn"
                        }`}
                      >
                        {step.status} ({step.durationMs} ms)
                      </span>
                    </div>
                    {step.error && <div className="notice notice-err small" style={{ marginTop: 6 }}>{step.error}</div>}
                    <div style={{ marginTop: 8 }}>
                      <div className="muted small">{t("Çıktı:")}</div>
                      <pre style={{ margin: 0, padding: 6, background: "var(--bg)", borderRadius: 4, fontSize: 11, maxHeight: 120, overflow: "auto" }}>
                        {typeof step.output === "object" ? JSON.stringify(step.output, null, 2) : String(step.output)}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================
          MODAL: DM KURALI DÜZENLEME (RULE EDITOR)
      ============================================================ */}
      {editingRule && (
        <Modal title={editingRule.id ? t("DM Kuralını Düzenle") : t("Yeni DM Kuralı")} onClose={() => setEditingRule(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field">
              <label>{t("Kural Adı")}</label>
              <input
                className="input"
                value={editingRule.name}
                onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                placeholder={t("Örn: Fiyat Sorusu")}
                required
              />
            </div>

            <div className="grid grid-2">
              <div className="field">
                <label>{t("Eşleşme Türü")}</label>
                <select
                  className="input"
                  value={editingRule.matchType}
                  onChange={(e) => setEditingRule({ ...editingRule, matchType: e.target.value as any })}
                >
                  <option value="keyword">{t("Anahtar Kelime")}</option>
                  <option value="first_contact">{t("İlk Temas (Hoş Geldin)")}</option>
                  <option value="any">{t("Her Mesaj")}</option>
                  <option value="regex">Regex</option>
                  <option value="story_mention">{t("Hikâyede Bahsetme (Instagram)")}</option>
                  <option value="story_reply">{t("Hikâyeye Cevap (Instagram)")}</option>
                  <option value="ref">{t("Bağlantı (ig.me / m.me ref)")}</option>
                </select>
              </div>
              <div className="field">
                <label>{t("Öncelik (Düşük sayı önce çalışır)")}</label>
                <input
                  type="number"
                  className="input"
                  value={editingRule.priority}
                  onChange={(e) => setEditingRule({ ...editingRule, priority: Number(e.target.value) })}
                />
              </div>
            </div>

            {editingRule.matchType === "story_mention" && (
              <span className="help">{t("Biri hikâyesinde hesabını etiketlediğinde çalışır. Kişi bir şey yazmadığı için \"Her Mesaj\" ve kelime kuralları bu olayda çalışmaz.")}</span>
            )}

            {editingRule.matchType === "story_reply" && (
              <div className="field">
                <label>{t("Anahtar Kelimeler (isteğe bağlı)")}</label>
                <input
                  className="input"
                  value={editingRule.pattern ?? ""}
                  onChange={(e) => setEditingRule({ ...editingRule, pattern: e.target.value })}
                  placeholder="fiyat*, link"
                />
                <span className="help">{t("Boş bırakırsan hikâyene gelen her cevapta çalışır.")}</span>
              </div>
            )}

            {editingRule.matchType === "ref" && (
              <div className="field">
                <label>{t("Ref değerleri (virgülle ayırın)")}</label>
                <input
                  className="input"
                  value={editingRule.pattern ?? ""}
                  onChange={(e) => setEditingRule({ ...editingRule, pattern: e.target.value })}
                  placeholder="yds_ekim, kampanya*"
                />
                <span className="help">
                  {t("Bağlantı örneği: ig.me/m/hesabin?ref=yds_ekim. Sonuna * koyarsan o harflerle başlayan her ref uyar; boşsa her ref. Ref değeri kişi kartına \"ref\" alanı olarak yazılır.")}
                </span>
              </div>
            )}

            {editingRule.matchType === "keyword" && (
              <div className="field">
                <label>{t("Anahtar Kelimeler (Virgülle ayırın)")}</label>
                <input
                  className="input"
                  value={editingRule.pattern ?? ""}
                  onChange={(e) => setEditingRule({ ...editingRule, pattern: e.target.value })}
                  placeholder={t("fiyat, ücret, kaç para, ne kadar")}
                />
                <span className="help">{t("Tam kelime aranır: \"dur\" yazarsan \"durum\" eşleşmez. Ekli halleri için sonuna * koy: \"fiyat*\" → fiyatı, fiyatlar.")}</span>
              </div>
            )}

            <div className="field">
              <label>{t("Yanıt Modu")}</label>
              <select
                className="input"
                value={editingRule.replyMode}
                onChange={(e) => setEditingRule({ ...editingRule, replyMode: e.target.value as any })}
              >
                <option value="template">{t("Sabit Metin Şablonu")}</option>
                <option value="ai">{t("AI Yanıtı")}</option>
              </select>
            </div>

            {editingRule.replyMode === "template" ? (
              <div className="field">
                <label>{t("Yanıt Metni")}</label>
                <textarea
                  className="input"
                  rows={3}
                  value={editingRule.replyText ?? ""}
                  onChange={(e) => setEditingRule({ ...editingRule, replyText: e.target.value })}
                  placeholder={t("Merhaba {{name}}, mesajınız için teşekkürler!")}
                />
              </div>
            ) : (
              <div className="field">
                <label>{t("AI Yanıt Talimatı (Prompt)")}</label>
                <textarea
                  className="input"
                  rows={3}
                  value={editingRule.aiInstructions ?? ""}
                  onChange={(e) => setEditingRule({ ...editingRule, aiInstructions: e.target.value })}
                  placeholder={t("Müşterinin sorusunu nazikçe ve detaylıca yanıtla.")}
                />
              </div>
            )}

            <button
              className="btn btn-primary"
              style={{ marginTop: 10 }}
              onClick={() => saveRule.mutate(editingRule)}
              disabled={saveRule.isPending || !editingRule.name}
            >
              {t("Kuralı Kaydet")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
