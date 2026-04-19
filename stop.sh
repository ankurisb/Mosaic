#!/bin/bash
INSTALL_DIR="$HOME/claude-app"
for p in 3000 3001 3002; do
  pids=$(lsof -ti:$p 2>/dev/null)
  [ -n "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null || true
done
[ -f "$INSTALL_DIR/server.pid" ] && kill -9 $(cat "$INSTALL_DIR/server.pid") 2>/dev/null || true
rm -f "$INSTALL_DIR/server.pid"
echo "✓ Stopped"
