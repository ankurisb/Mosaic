# Private Images + Licensing — Deployment Guide

This is the **operator's checklist** for turning on code protection. The code is built;
these are the infra actions **you** perform (I can't touch your GitHub/Railway).

The two layers:
- **Layer 1 — Private images**: stop anonymous `docker pull` of the compiled app.
- **Layer 2 — Licensing**: control who can RUN Mosaic + a kill switch (Railway service).

---

## Layer 1 — Make GHCR images private + wire the installer

### 1a. Flip the packages to Private (GitHub)
For each package (`mosaic`, `mosaic-stats`, `mosaic-tunnel`, `mosaic-watchdog`,
`mosaic-backup`): GitHub → your profile → Packages → the package → **Package settings**
→ **Change visibility → Private**.

> After this, anonymous `docker pull ghcr.io/ankurisb/mosaic` fails — which is the point.
> (Anyone who *already* pulled the public image keeps that copy; this protects future
> pulls, so do it before wide distribution.)

### 1b. Create a read-only pull token (GitHub)
GHCR fine-grained tokens are unreliable for pulls, so use a **classic PAT** scoped to
`read:packages` only:
GitHub → Settings → Developer settings → **Personal access tokens (classic)** →
Generate → check **`read:packages`** ONLY → copy the token (`ghp_…`).

> This one token is shared across installers. It's read-only (can only pull), so the
> blast radius if it leaks is "someone can pull the private image" — the **license check
> still stops them running it**. Rotate it periodically.

### 1c. Inject the token at DMG build time
The installer (`installer/scripts/install.js`) does `docker login` before pulling when
`REGISTRY_TOKEN` is set. Provide it to the build via env:
```
REGISTRY_HOST=ghcr.io \
REGISTRY_USER=ankurisb \
REGISTRY_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx \
./installer/build-mac.sh
```
The build bakes these into the packaged installer's environment. (For CI, set them as
build secrets — never commit the token.)

> If `REGISTRY_TOKEN` is unset (e.g. a dev build), the installer skips login and assumes
> anonymous pull — so dev builds keep working while public images last.

---

## Layer 2 — Stand up the licensing service (Railway)

See `services/licensing/README.md` for the full steps. Summary:

1. **Railway project** + **Postgres** plugin → gives `DATABASE_URL`.
2. **Generate a signing keypair** (once, keep the private key secret):
   ```
   node -e 'const {generateKeyPairSync}=require("crypto");const {publicKey,privateKey}=generateKeyPairSync("ed25519");console.log("PUBLIC:\n"+publicKey.export({type:"spki",format:"pem"}));console.log("\nPRIVATE:\n"+privateKey.export({type:"pkcs8",format:"pem"}))'
   ```
3. Deploy `services/licensing` to Railway with env:
   - `DATABASE_URL` (from the plugin)
   - `LICENSE_PRIVATE_KEY` (PEM), `LICENSE_PUBLIC_KEY` (PEM)
   - `ADMIN_TOKEN` (long random string, ≥24 chars)
4. Note the service **public URL** → this is `LICENSE_SERVER_URL` for Mosaic.

### Wire Mosaic to the service
The Mosaic client reads three env vars (already plumbed through docker-compose; the
installer writes them to `.env`):
- `LICENSE_KEY` — the customer's key (issued from the admin API)
- `LICENSE_SERVER_URL` — the Railway service URL
- `MOSAIC_LICENSE_PUBLIC_KEY` — the PEM public key (for offline signature verification)

Optionally `LICENSE_CHECK_MINUTES` (default 30) — how quickly a revoke takes effect.

> **Safe rollout:** if these are unset, the gate stays `unconfigured` and OPEN — existing
> installs keep working. Enforcement begins only once you issue keys and set the env.

### Issue / manage licenses
```
# create a customer
curl -sX POST $URL/admin/customers -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Acme Corp"}'
# issue a 25-seat enterprise license
curl -sX POST $URL/admin/licenses -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"customer_id":"<id>","edition":"enterprise","seat_limit":25,"expires_at":"2027-01-01T00:00:00Z"}'
# -> returns the license KEY (shown once). Give it to the customer.

# add seats later (NO reissue) / revoke (kill switch)
curl -sX POST $URL/admin/licenses/<lic_id> -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"seat_limit":50}'
curl -sX POST $URL/admin/licenses/<lic_id> -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"revoked"}'
```

---

## Honest security posture (what this does / doesn't do)

- ✅ No anonymous image pulls; unauthorized/expired installs won't run; remote kill switch;
  seat control; air-gap grace.
- ❌ NOT absolute: a determined attacker with an extracted image + the (read-only) pull
  token can still pull, and can *attempt* to patch out the license check. Obfuscation
  raises that cost; it doesn't eliminate it. This is the standard commercial on-prem bar.
- **Air-gapped customers**: the phone-home requires outbound network. The Ed25519 signature
  allows offline authenticity verification, but you lose the live kill switch for a truly
  air-gapped install. Decide per-customer.
