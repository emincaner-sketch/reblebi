# SosyalPilot üretim imajı: panel + API + MCP tek süreçte, tek porttan (4100)
# Derleme:  docker build -t sosyalpilot .
# Çalıştırma için docker-compose.yml kullan (Caddy ile otomatik HTTPS).

# 1) Tüm bağımlılıklar + derleme (server/dist ve web/dist)
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# 2) Yalnızca sunucunun çalışma zamanı bağımlılıkları
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace=server --include-workspace-root=false --no-audit --no-fund

# 3) Çalışma imajı
FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_PORT=4100 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app ./
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/api/main.js"]
