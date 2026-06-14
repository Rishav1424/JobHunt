FROM node:20-alpine

# Install system deps for Playwright + tectonic (LaTeX compiler)
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

# Playwright uses system chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npm run db:generate

COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev"]
