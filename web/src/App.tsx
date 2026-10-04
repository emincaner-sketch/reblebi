import { lazy, Suspense, useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useI18n } from "./lib/i18n";
import { useMeQuery } from "./lib/session";
import { ForgotPage, InvitePage, LoginPage, ResetPasswordPage, SignupPage, VerifyPage } from "./pages/public/AuthPages";
import { ConsentPage, DataDeletionPage, LegalPage, McpDocsPage, PreviewPage } from "./pages/public/PublicPages";
import LandingPage from "./landing/LandingPage";
import PricingPage from "./landing/PricingPage";
import NotFoundPage from "./landing/NotFoundPage";
import { applyHead, privateMeta } from "./seo/meta";
import { PAGE_PATHS } from "./seo/routes";

// Panel ayrı pakette: landing ve diğer herkese açık sayfalar panel kodunu indirmez
const AppArea = lazy(() => import("./AppArea"));

function Loading() {
  const { t } = useI18n();
  return <div className="login">{t("Yükleniyor…")}</div>;
}

function Home() {
  const me = useMeQuery();
  if (me.data?.needsSetup) return <Navigate to="/signup" replace />;
  if (me.data?.user) return <Navigate to="/app" replace />;
  return <LandingPage />;
}

/** Giriş, kayıt, panel, önizleme: arama motoru dizinine girmez (sunucu da bu yollara noindex'li kabuk verir) */
function Private() {
  const { locale } = useI18n();
  const { pathname } = useLocation();
  useEffect(() => {
    applyHead(privateMeta(locale));
  }, [pathname, locale]);
  return <Outlet />;
}

/** Eski Türkçe yolları yeni /app yollarına taşı */
function Legacy({ to }: { to: string }) {
  const { id } = useParams();
  const loc = useLocation();
  return <Navigate to={`${to.replace(":id", id ?? "")}${loc.search}`} replace />;
}

/**
 * Herkese açık sayfalar seo/routes.ts'deki PAGE_PATHS ile aynı yolları kullanır (TR kökte, EN /en altında).
 * Sunucudaki SPA yolları listesi (server/src/api/server.ts) buradaki özel yollarla aynı tutulmalı.
 */
export default function App() {
  const both = (key: keyof typeof PAGE_PATHS) => [PAGE_PATHS[key].tr, PAGE_PATHS[key].en];
  return (
    <Routes>
      {both("home").map((p) => (
        <Route key={p} path={p} element={<Home />} />
      ))}
      {both("pricing").map((p) => (
        <Route key={p} path={p} element={<PricingPage />} />
      ))}
      {both("mcp").map((p) => (
        <Route key={p} path={p} element={<McpDocsPage />} />
      ))}
      {both("privacy").map((p) => (
        <Route key={p} path={p} element={<LegalPage kind="privacy" />} />
      ))}
      {both("terms").map((p) => (
        <Route key={p} path={p} element={<LegalPage kind="terms" />} />
      ))}
      {both("deletion").map((p) => (
        <Route key={p} path={p} element={<DataDeletionPage />} />
      ))}
      <Route path="/pricing" element={<Navigate to={PAGE_PATHS.pricing.tr} replace />} />

      <Route element={<Private />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot" element={<ForgotPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/consent" element={<ConsentPage />} />
        <Route path="/preview/:token" element={<PreviewPage />} />
        <Route
          path="/app/*"
          element={
            <Suspense fallback={<Loading />}>
              <AppArea />
            </Suspense>
          }
        />
        <Route path="/kanallar" element={<Legacy to="/app/channels" />} />
        <Route path="/gonderiler" element={<Legacy to="/app/posts" />} />
        <Route path="/gonderiler/yeni" element={<Legacy to="/app/posts/new" />} />
        <Route path="/gonderiler/:id" element={<Legacy to="/app/posts/:id" />} />
        <Route path="/gelen-kutusu" element={<Legacy to="/app/inbox" />} />
        <Route path="/gelen-kutusu/:id" element={<Legacy to="/app/inbox/:id" />} />
        <Route path="/otomasyon" element={<Legacy to="/app/automation" />} />
        <Route path="/analitik" element={<Legacy to="/app/analytics" />} />
        <Route path="/ayarlar" element={<Legacy to="/app/settings" />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
