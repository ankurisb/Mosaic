#!/bin/zsh
# ============================================================
# Mosaic Dev Launcher
# Starts Next.js dev server + Tailscale Funnel (permanent URL)
# Usage: ./dev-start.sh
# ============================================================

PROJECT_DIR="/Users/ankursingh/projects/Mosaic"
PORT=3000
LOG_DIR="$PROJECT_DIR/.dev-logs"
NEXT_LOG="$LOG_DIR/next.log"
TUNNEL_URL="https://ankurs-macbook-pro.taile41f0a.ts.net"

mkdir -p "$LOG_DIR"

# ── Write permanent URL immediately (it never changes) ──────
echo "$TUNNEL_URL" > "$LOG_DIR/tunnel-url.txt"
echo "$(date): $TUNNEL_URL" >> "$LOG_DIR/tunnel-url-history.txt"

# ── Cleanup on exit ─────────────────────────────────────────
cleanup() {
  echo "\n🛑 Shutting down Next.js..."
  [[ -n $NEXT_PID ]] && kill $NEXT_PID 2>/dev/null
  echo "ℹ️  Tailscale Funnel keeps running in background."
  echo "   To stop it: tailscale serve reset"
  exit 0
}
trap cleanup INT TERM

# ── Kill anything already on port 3000 ──────────────────────
existing=$(lsof -ti :$PORT 2>/dev/null)
if [[ -n $existing ]]; then
  echo "⚠️  Port $PORT in use (PID $existing) — killing it..."
  kill -9 $existing 2>/dev/null
  sleep 1
fi

# ── Ensure Tailscale Funnel is running ──────────────────────
echo "🔗 Ensuring Tailscale Funnel is active..."
FUNNEL_STATUS=$(tailscale funnel status 2>&1)
if ! echo "$FUNNEL_STATUS" | grep -q "proxy"; then
  tailscale serve --bg http://localhost:$PORT > /dev/null 2>&1
  tailscale funnel --bg 443 > /dev/null 2>&1
  echo "✅ Tailscale Funnel started"
else
  echo "✅ Tailscale Funnel already running"
fi

# ── Start Next.js ───────────────────────────────────────────
echo "🚀 Starting Mosaic (Next.js) on port $PORT..."
cd "$PROJECT_DIR"
npm run dev > "$NEXT_LOG" 2>&1 &
NEXT_PID=$!

# Wait for Next.js to be ready
echo "⏳ Waiting for Next.js..."
for i in {1..30}; do
  if curl -s http://localhost:$PORT > /dev/null 2>&1; then
    echo "✅ Next.js ready"
    break
  fi
  sleep 1
done

# ── Print summary ────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              MOSAIC DEV ENVIRONMENT READY                    ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Local:   http://localhost:$PORT                                ║"
echo "║  Public:  $TUNNEL_URL  ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Logs:    $LOG_DIR            ║"
echo "║  Press Ctrl+C to stop Next.js (Funnel keeps running)         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Keep alive ───────────────────────────────────────────────
wait $NEXT_PID
