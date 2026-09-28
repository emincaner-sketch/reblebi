import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.VITE_API_URL || "http://localhost:4100";
const toApi = { target: API, changeOrigin: false };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": toApi,
      "/media": toApi,
      "/webhooks": toApi,
      "/mcp": toApi,
      "/.well-known": toApi,
      // Sadece OAuth sunucu uç noktaları; /consent panelin kendi sayfasıdır
      "/oauth/authorize": toApi,
      "/oauth/token": toApi,
      "/oauth/register": toApi,
      "/oauth/revoke": toApi,
    },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
