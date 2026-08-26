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
RUN apk add --no-cache sqlite postgresql-client

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mosaic

# Copy built assets
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

# Data directory for SQLite
RUN mkdir -p /data && chown mosaic:nodejs /data

USER mosaic
EXPOSE 3001
ENV PORT=3001

CMD ["npm", "start"]
