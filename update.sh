#!/bin/bash
# claude-app update script
INSTALL_DIR="$HOME/claude-app"
PORT=3001
cd "$INSTALL_DIR"

echo "→ Stopping any running server..."
# Kill everything on both common ports
for p in 3000 3001 3002; do
  pids=$(lsof -ti:$p 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "  Killing processes on port $p: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done
# Also kill by pid file
if [ -f "$INSTALL_DIR/server.pid" ]; then
  kill -9 $(cat "$INSTALL_DIR/server.pid") 2>/dev/null || true
  rm -f "$INSTALL_DIR/server.pid"
fi
sleep 2

echo "→ Applying latest files..."
if [ -d "$HOME/Downloads/claude-app-v2" ]; then
  rsync -a --exclude='node_modules' --exclude='.next' --exclude='.env.local' \
    "$HOME/Downloads/claude-app-v2/" "$INSTALL_DIR/"
  echo "  ✓ Files synced"
fi

echo "→ Building..."
rm -rf .next
npm run build 2>&1 | tail -5

echo "→ Starting on port $PORT..."
mkdir -p "$INSTALL_DIR/logs"
PORT=$PORT nohup npm start > "$INSTALL_DIR/logs/server.log" 2>&1 &
echo $! > "$INSTALL_DIR/server.pid"

sleep 4
if kill -0 $(cat server.pid) 2>/dev/null; then
  echo ""
  echo "✅ claude-app running at http://localhost:$PORT"
  echo "   Stop: bash $INSTALL_DIR/stop.sh"
else
  echo "❌ Failed. Log:"
  cat "$INSTALL_DIR/logs/server.log"
fi
