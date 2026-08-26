# Mosaic Installer

A cross-platform (macOS + Windows) Electron installer that deploys Mosaic via
Docker Compose against prebuilt GHCR images.

## What it does

1. **Edition picker** — Personal (core only) or Enterprise (full self-hosted stack).
   The choice maps to Docker Compose profiles:
   - Personal → no profiles (core services)
   - Enterprise → `--profile bundled --profile metering`
2. **Minimal config** — edition, admin account, port. **No Anthropic key** (Mosaic
   runs without AI; the key is added later in Settings).
3. **Preflight** — checks Docker is installed and running, RAM, disk, port, internet.
4. **Deploy** — `docker compose pull` (falls back to a local build if images aren't
   published yet) then `up -d` with the edition's profiles.
5. **Ready** — waits for the app, then offers to open it.

## Requirements (end user)

- **Docker Desktop** (both editions). The installer checks for it but does not
  install it.
- ~5 GB free disk for Personal, ~15 GB for Enterprise.

## Building

The app bundles `deploy/docker-compose.yml` (a copy of the repo's compose). The
build scripts refresh it automatically before packaging.

- **macOS** (universal DMG): `./build-mac.sh` — run on a Mac.
- **Windows** (NSIS .exe): `build-win.bat` — run on Windows. electron-builder
  cannot produce a Windows NSIS installer from macOS, so both platforms need their
  own build host (or a CI matrix with a mac and a windows runner).

Output lands in `dist/`.

## Dependencies

The installer deploys prebuilt images from GHCR, published by the repo's release
workflow (`.github/workflows/release.yml`) on a version tag. Until images are
published, the installer falls back to building locally from the bundled compose's
`build:` contexts (slower, but works).

## Icons

`assets/icon.svg` is the source. electron-builder needs raster forms
(`icon.png` ≥512px for mac, `icon.ico` for Windows); generate them from the SVG
(the mac build script does this if `rsvg-convert` is available).

## Version

Installer version is independent of Mosaic's version. It deploys
`MOSAIC_VERSION` (defaults to `latest`); pin a specific release by setting it in
the generated `.env`.
