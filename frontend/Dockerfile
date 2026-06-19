# ─── Stage 1: Base ────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app

# ─── Stage 2: Development ─────────────────────────────────────────────────────
# Used for local docker development with hot-reloading
FROM base AS development

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]

# ─── Stage 3: Builder (Production Compilation) ────────────────────────────────
FROM base AS builder

COPY package*.json ./
RUN npm install

COPY . .
# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 4: Production Runner ───────────────────────────────────────────────
# Extremely small Next.js production server using output: 'standalone'
FROM base AS production

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

# Create system user for safety
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public assets and static files
COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Server.js is automatically created by Next.js standalone build
CMD ["node", "server.js"]
