#!/usr/bin/env bash
# Build the Mosaic installer for macOS (universal — Apple Silicon + Intel).
# Produces a .dmg under dist/. Run on a Mac.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Refreshing bundled deploy files from the repo…"
# The installer ships the compose PLUS every host-path file the compose bind-mounts
# (Caddyfile, openmeter/ciso/superset configs, NETWORK.md), so a fresh install has
# everything the containers expect. Without these, bind mounts fail at container
# start (Docker creates an empty dir where a file is expected).
rm -rf deploy/docker deploy/NETWORK.md
cp ../docker-compose.yml deploy/docker-compose.yml
cp -R ../docker deploy/docker
cp ../NETWORK.md deploy/NETWORK.md
echo "    deploy/ refreshed: docker-compose.yml, docker/, NETWORK.md"

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
