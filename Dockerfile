# syntax=docker/dockerfile:1

# --- Stage 1: Install dependencies ---
FROM node:20-slim AS deps
WORKDIR /app

# Copy package manifests
COPY package.json ./
COPY package-lock.json* yarn.lock* pnpm-lock.yaml* bun.lock* ./

# Install dependencies (uses npm ci when package-lock.json is present, otherwise npm install)
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi

# --- Stage 2: Build Next.js standalone production bundle ---
FROM node:20-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# --- Stage 3: Minimal production runtime (Cloud Run / Docker) ---
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Copy public assets, repo-committed fonts, and Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder /app/assets ./assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 8080

CMD ["node", "server.js"]
