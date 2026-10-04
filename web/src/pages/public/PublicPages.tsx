import { useEffect, useState, type ReactNode } from "react";
import { McpGuide } from "../../components/McpGuide";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, CheckCircle2, MessageSquare, Minus, ShieldCheck } from "lucide-react";
import { api, errMsg, PROVIDER_NAME, type PlanFeature, type PlanInfo, type PostKind, type ProviderId, type Role } from "../../lib/api";
import { useI18n, useLabels } from "../../lib/i18n";
import { useMeQuery } from "../../lib/session";
import { fmt, BROWSER_TZ } from "../../lib/tz";
import { ProviderIcon } from "../../components/ui";
import { AuthLayout, usePublicConfig } from "./AuthPages";
import { PublicShell } from "../../landing/PublicShell";
import { usePage, useHydrated } from "../../landing/util";
import { Seo } from "../../seo/Seo";
import { legalJsonLd, mcpJsonLd } from "../../seo/jsonld";
import { pathFor } from "../../seo/routes";
import { SITE_NAME, SITE_URL } from "../../config/site";

/* ---------------- MCP OAuth onay ekranı ---------------- */

interface ConsentInfo {
  client: { id: string; name: string; uri: string | null; logo: string | null; redirectHost: string };
  scope: string;
  orgs: Array<{ id: string; name: string; role: Role; mcpAllowed: boolean }>;
  currentOrgId: string | null;
}

export function ConsentPage() {
  const { t } = useI18n();
  const L = useLabels();
  const loc = useLocation();
  const [params] = useSearchParams();
  const id = params.get("request") ?? "";
  const me = useMeQuery();
  const q = useQuery({ queryKey: ["consent", id], queryFn: () => api.get<ConsentInfo>(`/api/oauth2/requests/${encodeURIComponent(id)}`), enabled: Boolean(id && me.data?.user), retry: false });
  const [orgId, setOrgId] = useState("");
  useEffect(() => {
    if (q.data && !orgId) setOrgId(q.data.orgs.find((o) => o.id === q.data!.currentOrgId && o.mcpAllowed)?.id ?? q.data.orgs.find((o) => o.mcpAllowed)?.id ?? "");
  }, [q.data, orgId]);
  const decide = useMutation({
    mutationFn: (allow: boolean) => api.post<{ redirect: string }>(`/api/oauth2/requests/${encodeURIComponent(id)}/decision`, { allow, orgId: orgId || undefined }),
    onSuccess: (r) => {
      window.location.href = r.redirect;
    },
  });

  if (me.isLoading) return <AuthLayout title="…"><span /></AuthLayout>;
  if (!me.data?.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!id || q.isError) {
    return (
      <AuthLayout title={t("İstek bulunamadı")}>
        <p>{t("Bu yetkilendirme isteğinin süresi dolmuş. AI uygulamasından bağlanmayı yeniden başlat.")}</p>
      </AuthLayout>
    );
  }
  if (!q.data) return <AuthLayout title="…"><span /></AuthLayout>;
  const c = q.data.client;
  const allowedOrgs = q.data.orgs.filter((o) => o.mcpAllowed);

  return (
    <AuthLayout title={t("{app} hesabına erişmek istiyor", { app: c.name })} sub={t("Yönlendirme: {host}", { host: c.redirectHost })}>
      <div className="consent-client">
        {c.logo ? <img src={c.logo} alt="" /> : <Bot />}
        <div>
          <strong>{c.name}</strong>
          {c.uri && <div className="muted small truncate">{c.uri}</div>}
        </div>
      </div>
      <div className="small">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("İzin verirsen bu uygulama seçtiğin çalışma alanında senin adına:")}</div>
        <ul className="bullets">
          <li>{t("Kanalları ve gönderileri görebilir, gönderi oluşturup planlayabilir")}</li>
          <li>{t("Gelen kutusunu okuyup yanıt verebilir")}</li>
          <li>{t("Oto-yanıt kuralları ve AI içerik üretimini kullanabilir")}</li>
        </ul>
        <div className="muted" style={{ marginTop: 6 }}>{t("Rolünün izin vermediği hiçbir işlemi yapamaz. Erişimi istediğin zaman Ayarlar > Bağlantılar sekmesinden kaldırabilirsin.")}</div>
      </div>
      {allowedOrgs.length === 0 ? (
        <div className="notice notice-warn">{t("Hiçbir çalışma alanının planında MCP erişimi yok.")}</div>
      ) : (
        <div className="field">
          <label>{t("Çalışma alanı")}</label>
          <select className="select" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            {q.data.orgs.map((o) => (
              <option key={o.id} value={o.id} disabled={!o.mcpAllowed}>
                {o.name} · {L.role(o.role)}
                {o.mcpAllowed ? "" : ` (${t("planda yok")})`}
              </option>
            ))}
          </select>
        </div>
      )}
      {decide.error && <div className="notice notice-err small">{errMsg(decide.error)}</div>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
          {t("Reddet")}
        </button>
        <button className="btn btn-primary" disabled={decide.isPending || !orgId} onClick={() => decide.mutate(true)}>
          <ShieldCheck /> {t("İzin ver")}
        </button>
      </div>
      <p className="muted small">{t("Giriş yapan: {email}", { email: me.data.user.email })}</p>
    </AuthLayout>
  );
}

/* ---------------- Meta veri silme durumu ---------------- */

export function DataDeletionPage() {
  const { t, intl, locale } = useI18n();
  const [params] = useSearchParams();
  const cfg = usePublicConfig();
  // Sayfa ön-render edilir; ?code= parametresi hidrasyondan sonra okunur (sunucu HTML'i ile ilk çizim aynı kalsın)
  const hydrated = useHydrated();
  const code = hydrated ? (params.get("code") ?? "") : "";
  const q = useQuery({ queryKey: ["deletion", code], queryFn: () => api.get<{ code: string; status: string; at: string; channels: number }>(`/api/public/data-deletion/${code}`), enabled: /^[a-f0-9]{16}$/.test(code), retry: false });
  const title = t("Veri silme talebi");
  const email = cfg.data?.supportEmail;
  return (
    <PublicShell>
      <Seo page="deletion" jsonLd={legalJsonLd(locale, title, pathFor("deletion", locale))} />
      <div className="lp-container lp-narrow">
        <header className="lp-page-head left">
          <h1>{title}</h1>
        </header>
        <div className="lp-doc">
          <div className="card lp-legal">
            {!code ? (
              <>
                <section>
                  <h2>{t("Facebook ve Instagram verileri")}</h2>
                  <p>{t("Facebook/Instagram bağlantına ait verilerin silinmesini istiyorsan Facebook > Ayarlar > Uygulamalar ve Web Siteleri'nden uygulamamızı kaldırıp 'Veri silme iste' seçeneğini kullan. Talep otomatik işlenir ve buraya bir onay kodu ile yönlendirilirsin.")}</p>
                </section>
                <section>
                  <h2>{t("Kanal ve hesap verileri")}</h2>
                  <p>
                    {t("Bir kanalı panelden kaldırdığında ona ait token ve konuşmalar silinir. Çalışma alanını sildiğinde bütün verileri kalıcı olarak silinir.")}
                    {email ? " " + t("Hesabının tamamen silinmesi için {email} adresine yazabilirsin.", { email }) : ""}
                  </p>
                </section>
              </>
            ) : q.data ? (
              <div className="center-col">
                <CheckCircle2 style={{ width: 40, height: 40, color: "var(--lp-success)" }} />
                <p>{t("Talebin tamamlandı. Silinen bağlı hesap sayısı: {n}", { n: q.data.channels })}</p>
                <p className="lp-small">
                  {t("Onay kodu")}: <code>{q.data.code}</code> · {fmt(q.data.at, BROWSER_TZ, intl)}
                </p>
              </div>
            ) : q.isError ? (
              <p>{t("Bu onay kodu bulunamadı.")}</p>
            ) : (
              <p className="lp-small">…</p>
            )}
          </div>
        </div>
      </div>
    </PublicShell>
  );
}

/* ---------------- Müşteri önizleme ---------------- */

interface PreviewData {
  org: { name: string };
  post: { title: string | null; kind: PostKind; status: string; publishAt: string | null; content: string; media: Array<{ url: string; kind: string }>; targets: Array<{ channel: string; provider: ProviderId | null; avatarUrl: string | null; content: string }> };
  allowComments: boolean;
  comments: Array<{ author: string; text: string; at: string }>;
}

export function PreviewPage() {
  const { token = "" } = useParams();
  const { t, intl } = useI18n();
  const L = useLabels();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["preview", token], queryFn: () => api.get<PreviewData>(`/api/public/preview/${encodeURIComponent(token)}`), retry: false });
  const [name, setName] = useState(() => localStorage.getItem("sp_preview_name") ?? "");
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: () => api.post(`/api/public/preview/${encodeURIComponent(token)}/comments`, { name, text }),
    onSuccess: () => {
      localStorage.setItem("sp_preview_name", name);
      setText("");
      qc.invalidateQueries({ queryKey: ["preview", token] });
    },
  });
  if (q.isError) return <AuthLayout title={t("Önizleme bulunamadı")}><p>{t("Bu önizleme bağlantısı geçersiz ya da süresi dolmuş.")}</p></AuthLayout>;
  if (!q.data) return <AuthLayout title="…"><span /></AuthLayout>;
  const d = q.data;
  return (
    <div className="public-page">
      <div className="public-narrow">
        <div className="muted small">{d.org.name} · {t("Gönderi önizlemesi")}</div>
        <h1 style={{ margin: "6px 0 4px" }}>{d.post.title || L.kind(d.post.kind)}</h1>
        <div className="muted small" style={{ marginBottom: 18 }}>
          {L.kind(d.post.kind)}
          {d.post.publishAt ? ` · ${fmt(d.post.publishAt, BROWSER_TZ, intl)}` : ""}
        </div>
        <div className="form">
          {d.post.targets.map((tg, i) => (
            <div key={i} className="preview">
              <div className="preview-head">
                {tg.provider && <ProviderIcon provider={tg.provider} size={22} />}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{tg.channel}</div>
                  {tg.provider && <div className="muted small">{PROVIDER_NAME[tg.provider]}</div>}
                </div>
              </div>
              {d.post.media.length > 0 && (
                <div className="media-grid" style={{ marginBottom: 8 }}>
                  {d.post.media.slice(0, 4).map((m, j) => (
                    <div key={j} className="media-thumb">
                      {m.kind === "video" ? <video src={m.url} controls muted /> : <img src={m.url} alt="" />}
                    </div>
                  ))}
                </div>
              )}
              <p className="pre" style={{ fontSize: 13 }}>{tg.content}</p>
            </div>
          ))}
        </div>
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-title">
            <h2>
              <MessageSquare style={{ width: 16, verticalAlign: "middle" }} /> {t("Yorumlar")}
            </h2>
          </div>
          {d.comments.length === 0 && <p className="muted small">{t("Henüz yorum yok.")}</p>}
          <div className="form">
            {d.comments.map((c, i) => (
              <div key={i} className="note">
                <div className="small">
                  <strong>{c.author}</strong> <span className="muted">· {fmt(c.at, BROWSER_TZ, intl)}</span>
                </div>
                <div className="pre">{c.text}</div>
              </div>
            ))}
          </div>
          {d.allowComments && (
            <form
              className="form"
              style={{ marginTop: 14 }}
              onSubmit={(e) => {
                e.preventDefault();
                send.mutate();
              }}
            >
              <input className="input" placeholder={t("Adın")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
              <textarea className="textarea" placeholder={t("Onay, düzeltme ya da soru yaz…")} value={text} onChange={(e) => setText(e.target.value)} required maxLength={2000} style={{ minHeight: 80 }} />
              {send.error && <div className="notice notice-err small">{errMsg(send.error)}</div>}
              <button className="btn btn-primary" disabled={send.isPending} style={{ alignSelf: "flex-end" }}>
                {t("Yorum gönder")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Plan kartı (panel: Plan & kullanım) ---------------- */

const FEATURE_LABEL: Record<PlanFeature, string> = {
  mcp: "Claude / ChatGPT (MCP) bağlantısı",
  inbox: "Birleşik gelen kutusu + oto-yanıt",
  aiReplies: "AI DM yanıtları",
  approvals: "Onay akışı",
  webhooks: "Giden webhook'lar",
  customers: "Müşteri (ajans) modu",
  previewLinks: "Müşteri önizleme linkleri",
  analytics: "Analitik",
  byokAi: "Kendi AI anahtarın",
};

export function planLimit(n: number, t: (s: string) => string): string {
  return n >= 1_000_000_000 ? t("Sınırsız") : n.toLocaleString();
}

export function PlanCard({ p, highlight, cta }: { p: PlanInfo; highlight?: boolean; cta: ReactNode }) {
  const { t, locale } = useI18n();
  return (
    <div className={`card plan-card ${highlight ? "plan-hl" : ""}`}>
      <div className="row-between">
        <h2>{p.name[locale]}</h2>
        {highlight && <span className="badge badge-accent">{t("Popüler")}</span>}
      </div>
      <div className="plan-price">
        ${p.priceMonthly}
        <span className="muted small"> / {t("ay")}</span>
      </div>
      {p.priceYearly > 0 && <div className="muted small">{t("Yıllık ${n}", { n: p.priceYearly })}</div>}
      <ul className="plan-list">
        <li><Check /> {t("{n} kanal", { n: planLimit(p.channels, t) })}</li>
        <li><Check /> {t("{n} ekip üyesi", { n: planLimit(p.members, t) })}</li>
        <li><Check /> {t("Ayda {n} gönderi", { n: planLimit(p.postsPerMonth, t) })}</li>
        <li><Check /> {t("Ayda {n} AI üretimi", { n: planLimit(p.aiPerMonth, t) })}</li>
        <li><Check /> {t("{n} MB depolama", { n: planLimit(p.storageMb, t) })}</li>
        {(Object.keys(FEATURE_LABEL) as PlanFeature[]).map((f) => (
          <li key={f} className={p.features[f] ? "" : "off"}>
            {p.features[f] ? <Check /> : <Minus />} {t(FEATURE_LABEL[f])}
          </li>
        ))}
      </ul>
      {cta}
    </div>
  );
}

/* ---------------- MCP bağlantı rehberi (herkese açık) ---------------- */

export function McpDocsPage() {
  const { t, locale } = useI18n();
  const page = usePage();
  const cfg = usePublicConfig();
  const c = cfg.data;
  const app = SITE_NAME;
  const title = t("AI asistanını {app}'ye bağla", { app });
  const intro = t("{app}, Model Context Protocol (MCP) ile Claude, ChatGPT, Gemini, Grok ve Cursor gibi AI asistanlarına bağlanır. Asistanın içerik takvimini kurar, gönderileri boş saatlere yerleştirir ve zamanı gelince {app} paylaşır; arada üçüncü parti bir araca gerek yoktur.", { app });
  return (
    <PublicShell>
      <Seo page="mcp" jsonLd={mcpJsonLd(locale, title, intro)} />
      <div className="lp-container lp-narrow">
        <header className="lp-page-head left">
          <nav aria-label={t("Sayfa yolu")}>
            <ol className="lp-crumbs">
              <li>
                <Link to={page("home")}>{t("Ana sayfa")}</Link>
              </li>
              <li aria-current="page">{t("AI bağlantı rehberi (MCP)")}</li>
            </ol>
          </nav>
          <span className="lp-eyebrow">Claude · ChatGPT · Gemini · Grok</span>
          <h1>{title}</h1>
          <p className="lp-lead">{intro}</p>
        </header>
        <div className="lp-doc">
          <div className="card">
            <h2>{t("Kurulum adımları")}</h2>
            <McpGuide mcpUrl={c?.mcpUrl ?? `${SITE_URL}/mcp`} appName={app} />
          </div>
          <div className="card">
            <h2>{t("Nasıl çalışır?")}</h2>
            <ol className="steps">
              <li>{t("Asistan önce çalışma alanı bilgisini okur: kanalların, saat dilimin, paylaşım saatlerin ve kotaların.")}</li>
              <li>{t("Kanalların boş paylaşım saatlerini bulur ve planı önce deneme modunda doğrular (karakter sınırı, zorunlu görsel, tarih).")}</li>
              <li>{t("Onayınla gönderileri tek seferde kampanya olarak kaydeder. Onay modu açıksa gönderiler senin onayını bekler.")}</li>
              <li>{t("{app} her gönderiyi zamanı gelince platformun resmî API'siyle paylaşır, hataları tekrar dener ve sonucu bildirir.", { app })}</li>
            </ol>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}

/* ---------------- Yasal sayfalar ---------------- */

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const { t, locale } = useI18n();
  const cfg = usePublicConfig();
  const c = cfg.data;
  const company = c?.companyName || SITE_NAME;
  const email = c?.supportEmail || "—";
  const app = SITE_NAME;
  const tr = locale === "tr";

  const privacy = tr
    ? [
        ["Topladığımız veriler", `Hesap bilgileri (ad, e-posta, şifrenin tek yönlü özeti), bağladığın sosyal medya hesaplarına ait erişim token'ları (şifreli), bu hesaplar üzerinden paylaştığın içerikler, yüklediğin medya ve gelen kutusundaki mesajlar.`],
        ["Kullanım amacı", `Veriler yalnızca ${app} hizmetini sunmak için kullanılır: gönderileri planlamak ve yayınlamak, mesajları göstermek ve senin tanımladığın kurallarla yanıtlamak, analitik göstermek. Verilerini satmayız ve reklam için kullanmayız.`],
        ["Meta (Facebook/Instagram) verileri", `Meta platformundan aldığımız veriler Meta Platform Koşulları'na uygun işlenir. Uygulamayı Facebook ayarlarından kaldırıp veri silme istediğinde o Facebook kullanıcısıyla bağlanmış tüm kanallar ve konuşmaları otomatik silinir; durumu /data-deletion sayfasından onay koduyla görebilirsin.`],
        ["Yapay zekâ", `AI özelliklerini kullandığında ilgili metin (brief, marka bilgisi, konuşma geçmişi) seçili AI sağlayıcısına yalnızca yanıt üretmek için gönderilir.`],
        ["Saklama ve silme", `Kanal kaldırıldığında ona ait token ve konuşmalar silinir. Çalışma alanını sildiğinde tüm verileri kalıcı olarak silinir. Hesabının tamamen silinmesi için ${email} adresine yazabilirsin.`],
        ["Güvenlik", `Token'lar AES-256-GCM ile şifrelenir, bağlantılar HTTPS üzerinden yapılır, oturum çerezleri imzalıdır.`],
        ["İletişim", `${company}${c?.companyAddress ? `, ${c.companyAddress}` : ""} · ${email}`],
      ]
    : [
        ["Data we collect", `Account details (name, email, a one-way hash of your password), access tokens of the social accounts you connect (encrypted), content you publish through them, media you upload and messages in your inbox.`],
        ["How we use it", `Data is used only to provide ${app}: scheduling and publishing posts, showing messages and replying with the rules you define, and showing analytics. We do not sell your data or use it for advertising.`],
        ["Meta (Facebook/Instagram) data", `Data received from the Meta platform is processed in line with the Meta Platform Terms. When you remove the app in your Facebook settings and request data deletion, all channels and conversations connected by that Facebook user are deleted automatically; you can check the status on the /data-deletion page with your confirmation code.`],
        ["Artificial intelligence", `When you use AI features, the relevant text (brief, brand details, conversation history) is sent to the selected AI provider only to generate a response.`],
        ["Retention and deletion", `Removing a channel deletes its tokens and conversations. Deleting a workspace permanently deletes all of its data. To delete your account entirely, write to ${email}.`],
        ["Security", `Tokens are encrypted with AES-256-GCM, connections use HTTPS and session cookies are signed.`],
        ["Contact", `${company}${c?.companyAddress ? `, ${c.companyAddress}` : ""} · ${email}`],
      ];

  const terms = tr
    ? [
        ["Hizmet", `${app}, sosyal medya hesaplarını planlama, yayınlama, mesajlaşma ve analitik için tek panelde yönetmeni sağlayan bir yazılım hizmetidir.`],
        ["Hesabın", `Hesabının ve bağladığın kanalların güvenliğinden sen sorumlusun. Ekip üyelerine verdiğin rollerle yapılan işlemler çalışma alanının sorumluluğundadır.`],
        ["Kabul edilebilir kullanım", `Spam, yanıltıcı içerik, başkalarının haklarını ihlal eden paylaşımlar ve platformların (Meta, X, TikTok, LinkedIn, Google, Telegram) kurallarına aykırı kullanım yasaktır. Bu durumda hesabı askıya alabiliriz.`],
        ["Planlar ve ücretler", `Ücretli planlar aylık ya da yıllık faturalanır. Plan süresi dolduğunda çalışma alanı Ücretsiz plan limitlerine düşer; veriler silinmez.`],
        ["Üçüncü taraf platformlar", `Yayınlar ilgili platformların API'leri üzerinden yapılır. Platformların kesintilerinden, kural değişikliklerinden ya da içeriği reddetmesinden sorumlu değiliz.`],
        ["Sorumluluğun sınırı", `Hizmet "olduğu gibi" sunulur. Dolaylı zararlardan sorumlu değiliz; toplam sorumluluğumuz son 12 ayda ödediğin ücretle sınırlıdır.`],
        ["İletişim", `${company} · ${email}`],
      ]
    : [
        ["The service", `${app} is a software service that lets you manage scheduling, publishing, messaging and analytics for your social media accounts from one panel.`],
        ["Your account", `You are responsible for the security of your account and connected channels. Actions taken by team members under the roles you grant are the responsibility of the workspace.`],
        ["Acceptable use", `Spam, misleading content, posts that infringe others' rights and any use that violates the rules of the platforms (Meta, X, TikTok, LinkedIn, Google, Telegram) are prohibited. We may suspend accounts in such cases.`],
        ["Plans and fees", `Paid plans are billed monthly or yearly. When a plan expires the workspace falls back to Free plan limits; data is not deleted.`],
        ["Third-party platforms", `Posts are published through each platform's API. We are not responsible for platform outages, rule changes or content rejections.`],
        ["Limitation of liability", `The service is provided "as is". We are not liable for indirect damages; our total liability is limited to the fees you paid in the last 12 months.`],
        ["Contact", `${company} · ${email}`],
      ];

  const sections = kind === "privacy" ? privacy : terms;
  const title = kind === "privacy" ? t("Gizlilik Politikası") : t("Kullanım Koşulları");
  return (
    <PublicShell>
      <Seo page={kind} jsonLd={legalJsonLd(locale, title, pathFor(kind, locale))} />
      <div className="lp-container lp-narrow">
        <header className="lp-page-head left">
          <h1>{title}</h1>
        </header>
        <div className="lp-legal">
          {sections.map(([h, p]) => (
            <section key={h}>
              <h2>{h}</h2>
              <p>{p}</p>
            </section>
          ))}
        </div>
      </div>
    </PublicShell>
  );
}
