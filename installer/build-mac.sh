#!/usr/bin/env bash
# Build the Mosaic installer for macOS (universal — Apple Silicon + Intel).
# Produces a .dmg under dist/. Run on a Mac.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Refreshing bundled deploy files from the repo…"
# The installer ships the current compose so a fresh install matches this repo.
cp ../docker-compose.yml deploy/docker-compose.yml
echo "    deploy/docker-compose.yml updated"

echo "==> Installing installer dependencies…"
npm install

echo "==> Generating icon assets from SVG (if tooling present)…"
# electron-builder needs icon.png (>=512px) and icon.icns for mac. If you have
# librsvg/imagemagick installed this regenerates them; otherwise ensure the PNG
# already exists in assets/.
if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 1024 -h 1024 assets/icon.svg -o assets/icon.png
  echo "    assets/icon.png regenerated"
fi

echo "==> Building macOS DMG (universal)…"
npm run build:mac

echo "==> Done. DMG is in dist/"
ls -lh dist/*.dmg 2>/dev/null || true
