# Mosaic — Code Protection Design

**Status:** Draft for review
**Scope:** Protect the Mosaic codebase from casual extraction and unauthorized use, for **both Personal and Enterprise** editions.
**Approach:** Two complementary layers — (1) **private images + token flow** (who can *pull* the code) and (2) **seat-based license validation** (who can *run* it), served by a small **licensing service on Railway**.

---

## 0. Honest security stance (read this first)

Code that runs on a machine the customer controls **cannot be made impossible to extract.** Docker images can be unpacked; minified JS can be analyzed; a running container can be entered. This design does **not** claim otherwise.

What it **does** achieve:

- **Stops casual copying** — no one can `docker pull` your compiled app anonymously anymore.
- **Controls who runs it** — an install without a valid, current license refuses to operate.
- **Gives you a kill switch** — revoke a customer's license (and their registry token) and their install stops working at the next check.
- **Raises the cost of reverse-engineering** — obfuscation makes the extracted (already non-source) build meaningfully harder to understand.

What it **does not** achieve:

- A sufficiently determined, skilled attacker who has already obtained an image can, with effort, patch out the license check and run a cracked copy offline. Obfuscation slows this; it does not prevent it.
- Anyone who pulled a **public** image **before** we make it private already has that copy. (Timing note: we have distributed to very few people, so do this **before** wider distribution.)

This is the same protection bar mature commercial on-prem software operates at (Docker Desktop, GitLab, etc.). None of them are truly un-extractable either. The goal is **"not worth stealing, and revocable,"** not "mathematically impossible."

---

## 1. What we're protecting, and today's exposure

| Asset | Today | After this design |
|---|---|---|
| Source `.ts`/`.tsx` | Not shipped (only compiled `.next`) | Unchanged |
| Source maps | Not shipped | Unchanged |
| Compiled app image | **PUBLIC on GHCR — anyone can pull** | **Private — token required** |
| DB schema (`migrations/*.sql`) | Plain SQL in image | Still in image, but image is private; optional hardening later |
| Running the app | No gate — anyone with the image can run it | **License-gated, seat-based, revocable** |

---

## 2. Architecture overview

```
                         Licensing Service (Railway)
                         - Postgres: customers, licenses, seats
                         - POST /license/validate
                         - POST /registry/token  (short-lived)
                         - Admin: issue / revoke / adjust seats
                            |                  |
              validate      |                  |  issue scoped pull token
              (heartbeat)    |                  |  (GHCR read-only, short TTL)
                            |                  |
        Mosaic app (container)            Installer (DMG / server deploy)
        - on boot + periodic heartbeat:   - takes the customer LICENSE KEY
          POST /license/validate          - gets a short-lived GHCR token
        - if invalid/expired/over-seats:  - docker login ghcr.io
          enter "unlicensed" mode         - docker compose pull (private)
                            |
                       GHCR (now PRIVATE)
                       ghcr.io/ankurisb/*
```

**One credential:** the customer gets a single **license key**. That key is used both to (a) obtain a short-lived registry token to *pull* images, and (b) validate the *running* license. No separate registry credentials to manage.

---

## 3. Seat-based model

A **seat = one active Mosaic user** (a row in the app's `users` table that has logged in within the seat window, e.g. 30 days).

- Each **license** has a `seat_limit` (e.g. 5, 25, unlimited-for-enterprise).
- The Mosaic app reports its **current active-seat count** in each heartbeat.
- The licensing service records usage and returns `seats_ok: true/false`.
- **Over-limit behavior (your policy choice — default proposed):** *soft* — the app keeps working but flags "over seat limit, contact sales" to the admin, and it's visible to you in the admin panel. (A *hard* block is possible but risks locking out a paying customer over a counting edge case — soft is the safer default for on-prem.)

Both editions use the same mechanism; Enterprise licenses simply carry a higher (or unlimited) seat limit and a longer term.

---

## 4. The license lifecycle

1. **Issue** — you (admin) create a customer + license in the Railway service. It generates a signed **license key** (e.g. `MSC-XXXX-XXXX-XXXX`) carrying: customer id, edition, seat_limit, expiry. The key is a **signed token** (Ed25519) so the app can verify authenticity offline as a fallback, but the *authoritative* check is online.
2. **Install** — the installer asks for the license key, exchanges it at `/registry/token` for a short-lived GHCR pull token, `docker login`s, and pulls the private images.
3. **Run** — on boot and every N hours, Mosaic calls `/license/validate` with the key + machine fingerprint + active-seat count. Response: `valid`, `edition`, `seats_ok`, `expires_at`, `grace`.
4. **Grace / offline** — if the service is unreachable, the app uses the last known-good validation for a **grace period** (e.g. 7–14 days) so a transient outage or an air-gapped site doesn't break a legitimate customer. After grace with no contact, it enters unlicensed mode.
5. **Revoke** — you flip the license to revoked in the admin panel. Next heartbeat → app enters unlicensed mode; next token request → refused. (Already-pulled images keep working only until their next heartbeat fails past grace.)

**"Unlicensed mode"** (proposed): the app loads but shows a full-screen "License required / expired — contact UGX" gate and disables AI/data features, rather than hard-crashing (better UX, clearer to the customer, still non-functional as a product).

---

## 5. What each side does

### 5a. Licensing service (Railway) — *I build, you host*
- **Stack:** small Node/Express (or Fastify) service + Railway Postgres.
- **Tables:** `customers`, `licenses` (key_hash, edition, seat_limit, expires_at, status), `seat_usage` (license_id, active_seats, reported_at, machine_fingerprint), `audit`.
- **Endpoints:**
  - `POST /license/validate` — { key, fingerprint, active_seats } -> { valid, edition, seat_limit, seats_ok, expires_at, grace_days }
  - `POST /registry/token` — { key } -> { token, expires_in } (a short-lived GHCR pull token; see section 6)
  - **Admin** (protected): create/list customers & licenses, revoke, adjust seats. Minimal UI or just authenticated API to start.
- **Signing keys:** Ed25519 keypair; private key on Railway (env var), public key baked into Mosaic for offline fallback verification.

### 5b. Mosaic app — *I build*
- **`lib/license.ts`:** on boot (via `instrumentation.ts`) and on a timer, call `/license/validate`; cache last-good result; compute grace; expose `getLicenseState()`.
- **Active-seat count:** query `users` for logins within the seat window.
- **Gate:** middleware / a boot check that puts the app in "unlicensed mode" when state is invalid past grace.
- **Config:** `LICENSE_KEY` and `LICENSE_SERVER_URL` in the container env (installer writes them).
- Reuses the existing `/api/deployment` + edition detection we already built.

### 5c. Installer — *I build (Electron), you test in DMG*
- Add a **license-key field** to the install wizard.
- Call `/registry/token`, `docker login ghcr.io -u <customer> -p <token>`, then the existing `docker compose pull`.
- Write `LICENSE_KEY` + `LICENSE_SERVER_URL` into the `.env`.
- Enterprise (server) install: the same, via the documented CLI/compose path (they run `docker login` with the token, then `up -d`).

### 5d. Obfuscation — *I build*
- Add stronger JS obfuscation to the production build (beyond Next's minify): a webpack/Next plugin (e.g. `javascript-obfuscator` on server chunks, chosen carefully — over-aggressive obfuscation can break Next). Measured, tested, not blind.
- Schema hardening (optional, later): ship migrations in a less-trivially-readable form.

---

## 6. Making images private — the mechanics

- **You do:** in GitHub, set the `mosaic*` packages' visibility to **Private**. (I can't change your GitHub settings.)
- **The pull-token approach (recommended):** the Railway service holds **one** GitHub token with `read:packages` on your private packages. When a licensed customer calls `/registry/token`, the service returns a **short-lived** credential the customer uses for `docker login`. Customers never see or hold your real GitHub token; their access is gated by their license and expires quickly.
  - *Honest caveat:* GHCR doesn't natively mint per-customer short-lived tokens, so the pragmatic v1 is: the service proxies/wraps access, or hands out a scoped token with a short rotation. We'll pick the cleanest mechanism GHCR supports at build time; if GHCR is too coarse, the fallback is **mirroring images to a registry that does support fine-grained short-lived tokens** (e.g. a Railway-hosted registry, or a cloud registry). This is the one area where the exact mechanism needs a spike during the build.

---

## 7. What YOU need to provide / decide

| # | Item | Why |
|---|---|---|
| 1 | Make `mosaic*` GHCR packages **private** (GitHub setting) | Core of layer 1 |
| 2 | A **Railway project** for the licensing service + a Railway Postgres | Where the service runs |
| 3 | A **GitHub token** with `read:packages` (stored only on Railway) | For the token-issuing endpoint |
| 4 | **Seat/term policy** per edition (e.g. Personal = 1–3 seats/trial 30d; Enterprise = N seats/annual) | Drives license issuance |
| 5 | **Over-limit policy:** soft-flag (proposed) vs hard-block | Product decision |
| 6 | **Grace period** length for offline/air-gapped (proposed 7–14 days) | Balances protection vs. not breaking legit customers |
| 7 | A **domain** for the licensing service (or use the Railway URL) | The app phones this |

## 8. What I build (sequenced)

1. **Licensing service** (Railway-ready): schema, `/license/validate`, `/registry/token`, admin API, Ed25519 signing. *Testable against a local Postgres; deployed to your Railway.*
2. **Mosaic client** (`lib/license.ts` + boot gate + seat counting + unlicensed mode). *Testable in the container.*
3. **Registry-token spike** — determine the cleanest GHCR mechanism; implement (or set up a mirror registry if needed).
4. **Installer** license field + `docker login` + `.env` wiring. *Electron — needs DMG test.*
5. **Obfuscation** pass on the production build. *Testable via a build.*

## 9. Honest effort + risk

- **Realistic size:** several days across service + client + installer + the registry-token spike.
- **Biggest unknown:** the GHCR short-lived-token mechanism (section 6) — may push us to a mirror registry. This is the one thing to spike early.
- **Cannot fully validate without:** your Railway project live + the GitHub packages set private. So parts are "build now, wire up when infra is ready" — same pattern as the Electron work.
- **Ongoing cost to you:** you now operate a licensing service (uptime matters — if it's down and a customer is past grace, they're blocked; the grace period mitigates this).

## 10. Recommended first step

Do the **registry-token spike (section 6) + stand up the Railway service skeleton** first, because the registry mechanism is the one genuine unknown that could change the shape of everything else. Once that's proven, the rest is well-understood work.

---

*This protects Mosaic against casual copying, unauthorized/expired use, and gives you seat-based control with a kill switch — for both editions. It is not, and cannot be, an absolute lock against a determined attacker with an extracted image. That is the honest and appropriate bar for commercial on-prem software.*
