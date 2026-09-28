import { useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "./lib/api";
import { useI18n } from "./lib/i18n";
import { ME_KEY, SessionProvider, useMeQuery } from "./lib/session";
import { BROWSER_TZ } from "./lib/tz";
import Shell from "./components/Shell";
import { AuthLayout, ForgotPage, InvitePage, LoginPage, ResetPasswordPage, SignupPage, VerifyPage } from "./pages/public/AuthPages";
import { ConsentPage, DataDeletionPage, LandingPage, LegalPage, McpDocsPage, PreviewPage } from "./pages/public/PublicPages";
import DashboardPage from "./pages/Dashboard";
import ChannelsPage from "./pages/Channels";
import PostsPage from "./pages/Posts";
import ComposerPage from "./pages/Composer";
import { CampaignDetailPage, CampaignsPage } from "./pages/Campaigns";
import InboxPage from "./pages/InboxPage";
import AutomationPage from "./pages/Automation";
import AnalyticsPage from "./pages/Analytics";
import MediaPage from "./pages/Media";
import TeamPage from "./pages/Team";
import BillingPage from "./pages/Billing";
import SettingsPage from "./pages/SettingsPage";
import AdminPage from "./pages/Admin";

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="login">{children}</div>;
}

/** Hiç çalışma alanı olmayan kullanıcı (hepsinden ayrıldı ya da çıkarıldı) */
function NoWorkspace() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.post("/api/auth/orgs", { name, timezone: BROWSER_TZ, locale }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
  return (
    <AuthLayout title={t("Çalışma alanı oluştur")} sub={t("Hiçbir çalışma alanına üye değilsin. Yeni bir alan aç ya da ekibinden davet iste.")}>
      <div className="field">
        <label>{t("Ad")}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
      </div>
      {create.error && <div className="notice notice-err small">{errMsg(create.error)}</div>}
      <button className="btn btn-primary btn-block" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
        {t("Oluştur")}
      </button>
      <button
        className="btn btn-ghost btn-block"
        onClick={async () => {
          await api.post("/api/auth/logout");
          qc.clear();
          window.location.href = "/login";
        }}
      >
        {t("Çıkış")}
      </button>
    </AuthLayout>
  );
}

function AppArea() {
  const me = useMeQuery();
  const loc = useLocation();
  const { t } = useI18n();
  if (me.isLoading) return <FullScreen>{t("Yükleniyor…")}</FullScreen>;
  if (me.isError)
    return (
      <FullScreen>
        <div className="card">{t("API'ye ulaşılamıyor. Sunucu çalışıyor mu? (npm run dev)")}</div>
      </FullScreen>
    );
  const d = me.data!;
  if (d.needsSetup) return <Navigate to="/signup" replace />;
  if (!d.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!d.org) return <NoWorkspace />;
  return (
    <SessionProvider me={d}>
      <Shell>
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="channels" element={<ChannelsPage />} />
          <Route path="posts" element={<PostsPage />} />
          <Route path="posts/new" element={<ComposerPage key="new" />} />
          <Route path="posts/:id" element={<ComposerPage />} />
          <Route path="campaigns" element={<CampaignsPage />} />
          <Route path="campaigns/:id" element={<CampaignDetailPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="inbox/:id" element={<InboxPage />} />
          <Route path="automation" element={<AutomationPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="media" element={<MediaPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </Shell>
    </SessionProvider>
  );
}

function Home() {
  const me = useMeQuery();
  if (me.data?.needsSetup) return <Navigate to="/signup" replace />;
  if (me.data?.user) return <Navigate to="/app" replace />;
  return <LandingPage />;
}

/** Eski Türkçe yolları yeni /app yollarına taşı */
function Legacy({ to }: { to: string }) {
  const { id } = useParams();
  const loc = useLocation();
  return <Navigate to={`${to.replace(":id", id ?? "")}${loc.search}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/pricing" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot" element={<ForgotPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="/invite" element={<InvitePage />} />
      <Route path="/consent" element={<ConsentPage />} />
      <Route path="/data-deletion" element={<DataDeletionPage />} />
      <Route path="/privacy" element={<LegalPage kind="privacy" />} />
      <Route path="/terms" element={<LegalPage kind="terms" />} />
      <Route path="/preview/:token" element={<PreviewPage />} />
      <Route path="/docs/mcp" element={<McpDocsPage />} />
      <Route path="/app/*" element={<AppArea />} />
      <Route path="/kanallar" element={<Legacy to="/app/channels" />} />
      <Route path="/gonderiler" element={<Legacy to="/app/posts" />} />
      <Route path="/gonderiler/yeni" element={<Legacy to="/app/posts/new" />} />
      <Route path="/gonderiler/:id" element={<Legacy to="/app/posts/:id" />} />
      <Route path="/gelen-kutusu" element={<Legacy to="/app/inbox" />} />
      <Route path="/gelen-kutusu/:id" element={<Legacy to="/app/inbox/:id" />} />
      <Route path="/otomasyon" element={<Legacy to="/app/automation" />} />
      <Route path="/analitik" element={<Legacy to="/app/analytics" />} />
      <Route path="/ayarlar" element={<Legacy to="/app/settings" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
