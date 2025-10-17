FROM node:20-alpine AS deps
WORKDIR /app
# kopiujemy manifesty wcześniej, żeby warstwa z deps się keszowała
COPY package.json package-lock.json* ./
# jeśli masz package-lock.json w repo, użyj npm ci
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# skopiuj zainstalowane moduły
COPY --from=deps /app/node_modules ./node_modules
# skopiuj kod źródłowy + spec
COPY server.js ./
COPY lib ./lib
COPY routes ./routes
COPY openapi.yaml ./openapi.yaml

EXPOSE 3000
CMD ["node", "server.js"]
