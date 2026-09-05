# ── Mosaic — Dockerfile ───────────────────────────────────────
# Multi-stage build: deps → builder → runtime

# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
# Install build tools needed for native modules (better-sqlite3, etc.)
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# DB CLI tools for consistent backups (scripts/backup.sh runs these in-container):
#   sqlite             → sqlite3 CLI for VACUUM INTO snapshots (SQLite deployments)
#   postgresql-client  → pg_dump for logical dumps (Postgres deployments)
RUN apk add --no-cache sqlite postgresql-client \
    # Chromium for server-side PDF rendering (report generation). Alpine's package is
    # arch-native (works on both amd64 and arm64), unlike @sparticuz/chromium which
    # ships an x86-only binary and fails under Rosetta on Apple Silicon.
    chromium nss freetype harfbuzz ca-certificates ttf-freefont
# NOTE: font-noto-cjk (CJK glyph coverage) was intentionally NOT bundled — it adds
# ~100MB+ which, on top of Chromium's ~187 packages, pushed the emulated linux/amd64
# release build past the runner's limit (canceled). CJK report content is a niche
# need; if required, add `font-noto-cjk` here and build with a longer job timeout.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mosaic

# Copy built assets
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# CHANGELOG.md is read by /api/deployment to show release notes in-app (the update
# modal). Without it the notes come back empty.
COPY --from=builder /app/CHANGELOG.md ./CHANGELOG.md
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
# DB migration files — read at runtime by lib/migrate.ts (process.cwd()/migrations).
# Without this the migration runner finds no directory and silently skips, so schema
# changes never reach production installs.
COPY --from=builder /app/migrations ./migrations

# Data directory for SQLite
RUN mkdir -p /data && chown mosaic:nodejs /data
# App data dir for generated report PDFs (report-runner writes to ./data/reports).
RUN mkdir -p /app/data/reports && chown -R mosaic:nodejs /app/data

USER mosaic
EXPOSE 3001
ENV PORT=3001

CMD ["npm", "start"]
