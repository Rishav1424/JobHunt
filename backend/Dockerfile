# ─── Stage 1: Base ────────────────────────────────────────────────────────────
# Install system packages required for Playwright (headless chromium) and LaTeX (TeX Live)
FROM node:20-alpine AS base

RUN apk add --no-cache \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ca-certificates \
  ttf-freefont \
  curl \
  bash \
  openssl

# Force Playwright to skip browser downloads and use system chromium instead
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

WORKDIR /app

# ─── Stage 2: Development ─────────────────────────────────────────────────────
# Ideal for Compose Watch, runs typescript compiler watch
FROM base AS development

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 4000
CMD ["npm", "run", "dev"]

# ─── Stage 3: Builder (Production build) ──────────────────────────────────────
# Installs all deps and compiles TS source code to JS
FROM base AS builder

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# ─── Stage 4: Production Runner ───────────────────────────────────────────────
# Smaller production-ready image containing only built JavaScript and prod dependencies
FROM base AS production

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["npm", "start"]
