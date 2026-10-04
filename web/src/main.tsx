// Genel stiller önce: landing.css (App içinden gelir) aynı özgüllükteki kurallarda panel stilini ezebilsin
import "./fonts.css";
import "./styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ToastProvider } from "./components/ui";
import { I18nProvider } from "./lib/i18n";
import { PRERENDERED } from "./lib/boot";
import { registerServiceWorker } from "./lib/pwa";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } } });

// Panel açık temayla açılır; koyu tema yalnızca panelde ve seçildiyse (ilk çizimde yanıp sönmesin diye burada da uygulanır)
try {
  if (location.pathname.startsWith("/app") && localStorage.getItem("sp_theme") === '"dark"') document.documentElement.dataset.theme = "dark";
} catch {
  /* yoksay */
}

const tree = (
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={qc}>
        <I18nProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);

const root = document.getElementById("root")!;
// Herkese açık sayfalar derleme sırasında HTML'e çevrilir (scripts/prerender.ts); o HTML'i yeniden çizmeden canlandır
if (PRERENDERED) ReactDOM.hydrateRoot(root, tree);
else ReactDOM.createRoot(root).render(tree);
registerServiceWorker();
