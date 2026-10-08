import { useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "./lib/api";
import { useI18n } from "./lib/i18n";
import { ME_KEY, SessionProvider, useMeQuery } from "./lib/session";
import { BROWSER_TZ } from "./lib/tz";
import Shell from "./components/Shell";
import { Empty } from "./components/ui";
import { AuthLayout } from "./pages/public/AuthPages";
import DashboardPage from "./pages/Dashboard";
import ChannelsPage from "./pages/Channels";
import PostsPage from "./pages/Posts";
import ComposerPage from "./pages/Composer";
import TrashPage from "./pages/Trash";
import BioPageScreen from "./pages/Bio";
import LibraryPage from "./pages/Library";
import { CampaignDetailPage, CampaignsPage } from "./pages/Campaigns";
import InboxPage from "./pages/InboxPage";
import AutomationPage from "./pages/Automation";
import AnalyticsPage from "./pages/Analytics";
import ReportPage from "./pages/Report";
import CompetitorsPage from "./pages/Competitors";
import AdsPage from "./pages/Ads";
import HashtagsPage from "./pages/Hashtags";
import StudioPage from "./pages/Studio";
import AutolistsPage from "./pages/Autolists";
import BulkImportPage from "./pages/BulkImport";
import WebsitePage from "./pages/Website";
import MentionsPage from "./pages/Mentions";
import FeedGridPage from "./pages/FeedGrid";
import MediaPage from "./pages/Media";
import TeamPage from "./pages/Team";
import BillingPage from "./pages/Billing";
import SettingsPage from "./pages/SettingsPage";
import AdminPage from "./pages/Admin";

/**
 * Giriş sonrası panel (/app/*). App.tsx bunu lazy yükler: landing ziyaretçisi panel kodunu indirmez.
 * İçerik App.tsx'ten olduğu gibi taşındı; davranış değişmedi.
 */

export function FullScreen({ children }: { children: ReactNode }) {
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

export default function AppArea() {
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
          <Route path="posts/trash" element={<TrashPage />} />
          <Route path="posts/autolists" element={<AutolistsPage />} />
          <Route path="posts/import" element={<BulkImportPage />} />
          <Route path="posts/grid" element={<FeedGridPage />} />
          <Route path="posts/:id" element={<ComposerPage />} />
          <Route path="campaigns" element={<CampaignsPage />} />
          <Route path="campaigns/:id" element={<CampaignDetailPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="inbox/:id" element={<InboxPage />} />
          <Route path="automation" element={<AutomationPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="analytics/report" element={<ReportPage />} />
          <Route path="analytics/competitors" element={<CompetitorsPage />} />
          <Route path="analytics/studio" element={<StudioPage />} />
          <Route path="analytics/website" element={<WebsitePage />} />
          <Route path="analytics/ads" element={<AdsPage />} />
          <Route path="analytics/hashtags" element={<HashtagsPage />} />
          <Route path="analytics/mentions" element={<MentionsPage />} />
          <Route path="media" element={<MediaPage />} />
          <Route path="bio" element={<BioPageScreen />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="*" element={<PanelNotFound />} />
        </Routes>
      </Shell>
    </SessionProvider>
  );
}

/** Panelde olmayan adres: sessizce ana sayfaya atmak yerine ne olduğunu söyle (eski/yanlış bağlantılar fark edilsin) */
function PanelNotFound() {
  const { t } = useI18n();
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <Empty
        title={t("Sayfa bulunamadı")}
        text={t("Bu adres panelde yok; bağlantı eski ya da hatalı olabilir.")}
        action={
          <Link to="/app" className="btn btn-primary">
            {t("Panele dön")}
          </Link>
        }
      />
    </div>
  );
}
