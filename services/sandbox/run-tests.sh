#!/usr/bin/env bash
# Run the full sandbox + file-storage test suite locally.
# Starts the sandbox service if it isn't already up, then runs both suites.
#
#   ./run-tests.sh
#
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
URL="${SANDBOX_URL:-http://localhost:8002}"

started=""
if ! curl -sf --max-time 3 "$URL/health" >/dev/null 2>&1; then
  echo "Starting sandbox service on :8002 ..."
  mkdir -p /work 2>/dev/null || true
  python3 main.py >/tmp/sandbox-test.log 2>&1 &
  started=$!
  for _ in $(seq 1 20); do curl -sf "$URL/health" >/dev/null 2>&1 && break; sleep 0.5; done
fi

echo "== Sandbox service tests =="
SANDBOX_URL="$URL" python3 test_sandbox.py
rc1=$?

echo "== App-side file storage tests =="
TMPD="$(mktemp -d)"
( cd "$ROOT" && DATABASE_URL="sqlite://$TMPD/test.db" MOSAIC_FILE_DIR="$TMPD/files" \
    SANDBOX_URL="$URL" npx tsx services/sandbox/test_file_storage.ts )
rc2=$?
rm -rf "$TMPD"

[ -n "$started" ] && kill "$started" 2>/dev/null || true
exit $(( rc1 || rc2 ))
