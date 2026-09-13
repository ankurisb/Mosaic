# Mosaic Licensing Service

A tiny, self-contained service that **issues, validates, and revokes** seat-based
Mosaic licenses. Deploy to Railway (or any Node host + Postgres). This is Layer 2 of
the code-protection design (`docs/CODE_PROTECTION_DESIGN.md`): it controls **who can
run** Mosaic and gives you a **kill switch**.

## What it does

- **Issue** a signed license key for a customer (edition, seat_limit, expiry).
- **Validate** (the Mosaic client phone-home): checks signature + live status/expiry/seats.
- **Revoke / suspend / adjust seats / change expiry** — all server-side, no key reissue.

The license key is **Ed25519-signed**, so the Mosaic client can verify authenticity
offline (air-gap fallback) while this service stays authoritative for live state.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/license/validate` | none (rate-limited) | Mosaic phone-home |
| POST | `/admin/customers` | admin | create a customer |
| POST | `/admin/licenses` | admin | issue a license (returns the key ONCE) |
| GET  | `/admin/licenses` | admin | list licenses + last-seen seats |
| POST | `/admin/licenses/:id` | admin | update seats / status / expiry / grace |
| GET  | `/healthz` | none | liveness |

## Deploy to Railway

1. **Create a Railway project** + add a **Postgres** plugin (gives `DATABASE_URL`).
2. Point the service at this folder (`services/licensing`). Railway builds the Dockerfile.
3. **Generate a signing keypair** (once, keep the private key secret):
   ```
   node -e 'const {generateKeyPairSync}=require("crypto");const {publicKey,privateKey}=generateKeyPairSync("ed25519");console.log("PUBLIC:\n"+publicKey.export({type:"spki",format:"pem"}));console.log("PRIVATE:\n"+privateKey.export({type:"pkcs8",format:"pem"}))'
   ```
4. **Set env vars** in Railway:
   - `DATABASE_URL` — provided by the Postgres plugin
   - `LICENSE_PRIVATE_KEY` — the PEM private key (newlines as `\n` or multiline)
   - `LICENSE_PUBLIC_KEY` — the PEM public key
   - `ADMIN_TOKEN` — a long random string (>= 24 chars); this authenticates your admin calls
5. Deploy. Note the **public URL** — that becomes `LICENSE_SERVER_URL` in Mosaic, and the
   **public key** gets baked into the Mosaic client for offline verification.

## Issue a license (example)

```
# create a customer
curl -sX POST $URL/admin/customers -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Acme Corp","email":"ops@acme.com"}'
# -> {"id":"<customer_id>"}

# issue a 25-seat enterprise license, 1-year expiry
curl -sX POST $URL/admin/licenses -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"customer_id":"<customer_id>","edition":"enterprise","seat_limit":25,"expires_at":"2027-01-01T00:00:00Z"}'
# -> {"id":"<lic_id>","key":"MSC.xxxx.yyyy", ...}   <-- give this KEY to the customer (shown once)
```

## Add seats later (no reissue)

```
curl -sX POST $URL/admin/licenses/<lic_id> -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"seat_limit":50}'
```
Takes effect on the customer's next phone-home (within hours). No new key, no reinstall.

## Kill switch

```
curl -sX POST $URL/admin/licenses/<lic_id> -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"revoked"}'
```
The install enters "unlicensed mode" at its next phone-home (or when grace expires).

## Security notes

- Only the **hash** of each key is stored — a DB leak can't recover working keys.
- Admin auth is a constant-time bearer-token compare.
- The validate endpoint is per-IP rate-limited; request bodies are capped (413).
- Forged/tampered keys are rejected by signature before any DB lookup.
