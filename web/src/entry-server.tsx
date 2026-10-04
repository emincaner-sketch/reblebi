import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ToastProvider } from "./components/ui";
import { I18nProvider } from "./lib/i18n";

/**
 * Derleme anında herkese açık sayfaları HTML'e çevirir (scripts/prerender.ts kullanır).
 * Ağaç main.tsx ile aynıdır; tarayıcı bu HTML'i hydrateRoot ile canlandırır.
 */
export function render(url: string): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <QueryClientProvider client={qc}>
          <I18nProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </I18nProvider>
        </QueryClientProvider>
      </StaticRouter>
    </StrictMode>,
  );
}
