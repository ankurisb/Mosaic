# Changelog

All notable changes to Mosaic are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [1.3.40] - 2026-10-12

### Fixed
- **Chat source picker was missing Prism, file servers, and MCP servers.** The picker only loaded databases, API connections, and Airbyte, so a newly added Prism instance (or file server / MCP server) never appeared and couldn't be selected. It now loads all source types.

### Changed
- **Source picker is organised by category with search.** Instead of one long flat list (which got unwieldy with dozens of API connection groups), sources are grouped into collapsible categories — Databases, APIs, File servers, Prism, Airbyte, MCP — each with a count. Large categories start collapsed, small ones expanded, and a search box at the top filters across all sources (by name, service, or host). API connections show their parent service inline. Pinning no longer closes the menu, so several sources can be selected in one go.

## [1.3.39] - 2026-10-12

### Added
- **Editable API source name in the AI builder.** The builder previously showed a read-only "API source" name with no way to change it. The Name field in the Draft pane is now an editable input, so you can name the source before (or while) building; the name is saved on Save as draft / Publish. The agent also now defaults the name to the API's own title (e.g. the OpenAPI `info.title`) instead of a generic "API source".

## [1.3.38] - 2026-10-12

### Fixed
- **Chat 400 "unexpected tool_use_id found in tool_result blocks" on multi-tool turns.** When the model made several tool calls (now common, since API sources actually work), history trimming (the last-40-messages slice and the char-budget `trimHistory`) could cut between an assistant's `tool_use` and the following user's `tool_result`, leaving an orphaned tool block. The Anthropic API then rejected the whole request. Added `sanitizeHistory` (lib/chat-history.ts, unit-tested) which runs before every model call and drops any unmatched `tool_use`/`tool_result` on either side (removing emptied messages), so the request is always well-formed regardless of trimming.

## [1.3.37] - 2026-10-12

### Added
- **Agentic builder can now discover auth-gated API specs.** Some APIs serve their own OpenAPI spec behind login (e.g. `GET /api/openapi.json` → 403 "Superuser session required"). The builder fetched specs unauthenticated, so it couldn't discover these at all. Discovery is now auth-aware as a general primitive: when a spec URL returns 401/403 and credentials are available, the agent logs in against common login endpoints with the server-held credentials, pulls a token from common response paths (e.g. `tokens.access`), and retries the spec with `Authorization: Bearer`. A model-driven `login_probe` also seeds the session. This closes the whole auth-gated-spec class (not a per-API special case). Validated live against a 552-path FactoryOS dev instance: gated spec → login → 739 operations across 43 groups discovered.
- Spec/doc discovery now uses the `lan` SSRF mode, so specs served from on-prem factory boxes (LAN hosts) are reachable, not just public ones. `fetchUrlText` gained `headers` and `ssrf` options and now returns the HTTP `status` so callers can react to 401/403.

## [1.3.36] - 2026-10-12

### Fixed
- **Published API sources were invisible to chat (every Type-2 API source, not just FactoryOS).** The chat's connection-listing query selected a `c.method` column from `api_connections`, which doesn't exist — so the query threw, was swallowed by its `.catch(() => [])`, and returned an empty list. The copilot therefore reported "no API connections" even with a published source and 25 connections. Removed the non-existent column (a connection is a base path; method is chosen per call via `call_api`), so published API sources now appear. Also reworded the per-connection prompt line to show the base path and note that any method/sub-path can be called under it, instead of implying GET-only.

## [1.3.35] - 2026-10-12

### Changed
- **The AI builder is now a full-page view, not stacked above the list.** Opening Add with AI / Resume previously rendered the builder inline *above* the whole API-connections list and the import header, so it never felt like a separate page. The builder now replaces the list view entirely (its own title + Close return you to the list), so the landing page is the list and editing a draft is a dedicated page.
- **Removed the irrelevant "Back to describe" on a resumed draft.** It only makes sense for a brand-new Add-with-AI flow; on a resumed draft there's no describe step, so it's hidden (Close returns to the list).
- **No more stacked status banners.** Saving a draft now clears the stale "Resumed draft" hint, so you don't see "Saved as draft" and "Resumed draft" at the same time.

## [1.3.34] - 2026-10-12

### Fixed
- **Resumed draft falsely claimed "credentials filled in".** The resume banner always said credentials were filled, even when the draft had none saved — so the assistant correctly reporting "no login credentials attached" (and Publish staying locked) looked like a contradiction. The banner now reflects reality: if no secrets were loaded, it says the draft has no saved credentials and to enter them.
- **Credentials buried below the endpoint list.** On resume, the "Credentials & details needed" fields rendered after all 25 endpoint groups, so they were easy to miss. They now sit directly under Connection, and are highlighted with a prompt when unfilled.
- **Try-It panel stayed open behind the builder.** Opening Add with AI, Resume, or Diagnose now closes the Try-It panel so it doesn't linger.

## [1.3.33] - 2026-10-12

### Fixed
- **Publish re-locking after a successful verification.** The AI builder gated Publish on the *current* probe result, so after a connection was verified, probing a non-existent path (e.g. a group root like `/accounts/`, which 404s because it isn't a real endpoint) would re-disable Publish. Publish now latches unlocked once *any* probe succeeds this session — the agent's build probe, a manual probe, or an Ask & refine probe all count — and only re-locks when the config materially changes (new build or an applied refine). The helper text now explains that a 404 on a group root doesn't count and to probe a real endpoint.

## [1.3.32] - 2026-10-12

### Fixed
- **"No diagnosis was produced" even though the agent answered.** The diagnose/assist loop only captured an answer if the model called its `finish` tool; when the model replied in prose instead (common for a simple question like "are all endpoints accessible?"), that answer was discarded and the UI showed the fallback message despite a successful probe. The shared engine now keeps the model's final prose as the answer, so Ask & refine and the Diagnose panel show the real response. Applies to both the builder chat and the chat copilot's `diagnose_api_connection`.
- **Black bubble in the Ask & refine / Diagnose chat.** The user message bubble used `var(--accent-bg, …)`, which resolves to the near-black accent in this theme, rendering a black blob with invisible text. Switched to an explicit light-blue tint that reads correctly in both light and dark.

## [1.3.31] - 2026-10-12

### Changed
- **The builder's Refine pane is now an interactive chat ("Ask & refine").** Instead of a one-shot "tell Mosaic what to fix" box that regenerated the whole connection as JSON (and could fail to parse on large specs), you can now hold a conversation about the draft: ask questions ("do all the endpoints work?", "what does the materials endpoint return?") and Mosaic answers by actually probing/reading the spec live, or request a change ("records are under data.results") and apply it to the draft with one click, then Publish. Powered by the same agent as the Diagnose panel, in a new `assist` mode, with the draft (incl. live credentials) sent inline. Fixes the "Expected ',' or ']' … JSON" error from typing a question into the old Refine box.

## [1.3.30] - 2026-10-12

### Added
- **"Connection verified" summary in the AI API builder.** After an agentic build succeeds, the cockpit now shows a clear green banner — "Found N endpoint groups behind <auth> auth and confirmed a live call returned 200 OK" — and states explicitly that auth is shared across every group, so the user does not need to probe each one; publishing registers them all. Removes the ambiguity of having to click through every group to know the build worked.

## [1.3.29] - 2026-10-12

### Added
- **Interactive "Diagnose" troubleshooting for live API connections — in Settings and in chat.** Instead of a one-shot "Build it with AI", you can now troubleshoot a misbehaving connection conversationally. A shared agent (`diagnoseApiConnection`) seeds the same investigation loop (discover spec, login, probe) with an *existing* connection's config + a symptom, reproduces the failure against the live API, root-causes it, and — when it's a config problem — proposes a corrected candidate. Credentials never leave the server: the stored `auth_config` is split into structural fields (shown to the model) and secrets (injected only at probe time), and re-attached on apply.
  - **Settings → APIs:** a **Diagnose** button on each source opens a chat-style panel (symptom → diagnosis + the steps it took + a proposed-fix diff). Applying is admin-only and confirm-gated, re-publishing through the shared upsert and audit-logged.
  - **Chat:** a `diagnose_api_connection` tool (read-only) lets the copilot troubleshoot a source mid-conversation and surface the root cause + proposed fix; `apply_api_fix` applies it, admin-only and behind an explicit two-step confirm (preview → `confirm:true`), audit-logged. Proposed fixes are held server-side by `fix_id` so the large candidate never round-trips through the model.

### Changed
- API source persistence (service + connections upsert, and full-config load with decrypted auth) is now a single shared path (`lib/api-source-store.ts`) used by the services route, the AI builder, and the chat apply tool — one place to audit and evolve.

## [1.3.28] - 2026-10-12

### Fixed
- **Agentic builder no longer 404s on every probe when a spec has a shared mount prefix.** FactoryOS's spec has an empty `servers` list and every path already carries a `/api` prefix. The builder was told the base URL was `…/api`, then probed `…/api` + `/api/...` → a doubled prefix → 404 on all 188 endpoints; grouping also collapsed to a single bogus `api` group. The OpenAPI summariser now detects a shared mount prefix (`/api`, `/v1`, …), resolves the base URL from the spec's own origin (per the OpenAPI default when `servers` is empty), folds the prefix into a `suggestedBaseUrl`, groups on the real segments beneath it, and returns every path relative to that base. The agent uses `suggestedBaseUrl` verbatim and never re-adds the prefix. FactoryOS now resolves to base `https://myfactory.ugx.ai/api` with 25 real groups (accounts, assets, core, manufacturing, orders, …). The peel is guarded so a genuine single-group API (e.g. all paths under `/assets`, where `/assets` is itself an endpoint) is not over-stripped.

## [1.3.27] - 2026-10-12

### Fixed
- **Agentic builder now reads the full spec and covers the whole API.** The doc fetcher capped text at 200k chars, so a large OpenAPI spec (e.g. FactoryOS at ~267 KB) was truncated before it parsed — the agent fell back to the docs page and only registered the two or three endpoints it happened to probe. Spec fetches now use a much larger cap so the JSON parses, the summariser reports the endpoint **groups**, and the agent registers a connection per group (base path) after confirming auth with a probe or two — so the whole API is reachable, not just what it touched.


## [1.3.26] - 2026-10-12

### Fixed
- **AI builders now reliably get the Anthropic key.** The API/connector builders and scheduled report narratives constructed their Anthropic client with a bare `new Anthropic()`, which only reads the `ANTHROPIC_API_KEY` env var — but on this deployment the key lives in the database (`kv_settings`). On a freshly started container (before any chat request happened to warm the env), those LLM calls had no key and failed, which is a major reason the AI builder appeared not to work. All of them now resolve the key via `getKey('ANTHROPIC_API_KEY')` and pass it explicitly, like chat and model resolution already do.

## [1.3.25] - 2026-10-12

### Added
- **Agentic API builder.** "Build it with AI" now investigates the API end-to-end instead of guessing from one prompt: it discovers the OpenAPI/Swagger spec at common locations, reads the auth scheme and login endpoint, **logs in for real and inspects the raw response to find where the token actually lives** (e.g. `tokens.access`, not an assumed `access_token`), then probes a cheap endpoint to confirm the whole chain — iterating until it works. It lands a verified, already-probed connection in the cockpit with a transcript of what it did. Optional credentials in the describe step let it self-drive; "Quick draft" keeps the one-shot path. Credentials are injected server-side and never appear in a model prompt or the candidate.
- Shared, SSRF-guarded probe lib (`runCandidateProbe` + `inspectLogin`) and an OpenAPI/Swagger summariser so large specs fit the agent's context.

## [1.3.24] - 2026-10-11

### Added
- **API sources — draft vs published.** A custom API source can now be saved mid-build as a **draft** and resumed later (handy when testing a tricky API takes a while). In the AI builder cockpit: **Save as draft** (always available) and **Publish** (unlocks once a probe succeeds). Drafts appear in the API connections list with a **Draft** badge and a **Resume** action that reopens the cockpit with credentials pre-filled, ready to probe where you left off.

### Changed
- **Chat uses only published API connections.** The chat tool list now filters to published sources, and `call_api` refuses a draft as defence-in-depth. (Previously chat could use any configured connection, tested or not — this closes that gap.) Existing connections default to published, so nothing changes on upgrade.

## [1.3.23] - 2026-10-11

### Changed
- **AI API builder — cockpit layout.** The review step is now a one-screen, three-column layout: Draft (connection, endpoints, credentials) · Test & result (probe bar pinned on top, the live response persists in the middle) · Refine ("tell Mosaic what to fix" + Refine/Register, pinned on the right). You probe, read the result, and refine side by side without scrolling. Panes scroll internally and stack on narrow screens.
- **AI API builder — reads doc links automatically.** "Draft connection" now auto-fetches any URLs in the description (SSRF-guarded, public web only; redirects followed; HTML reduced to text), and expands an `llms.txt` index once to a few of its listed same-host pages — so pasting a docs link (or its llms.txt) just works, with no manual copy/paste step. The builder shows which pages it read.
- Genericised the builder's illustrative examples (placeholder, generator prompt) — no vendor-specific names.

## [1.3.22] - 2026-10-10

### Added
- **AI-assisted API source builder (“✨ Add with AI”).** A new conversational way to connect any live API under Settings → API connections, alongside the existing Import Postman / Import OpenAPI / SAP / manual paths (which remain as seeds). Describe the API in plain English, attach text docs (docs, OpenAPI, Postman, a sample response) or pull a docs URL, and Mosaic drafts a connection, **probes it live against the real source**, refines against what actually came back, collects credentials in masked fields, and registers it — immediately callable from chats and RCAs. Registration reuses the existing `api_services`/`api_connections` registry, so AI-built sources behave identically to hand-built ones (Try / Edit / Delete). Admin-only; the live probe is SSRF-guarded (LAN mode: on-prem APIs allowed, loopback/cloud-metadata blocked).
- **`session_token` auth type.** Generic username/password-login→token auth for APIs that authenticate via a login endpoint returning a token in its JSON body (e.g. a POST of credentials → `{access_token}` used as a Bearer). Fully configurable (login URL, body shape, token JSON-path, header/prefix, expiry) so one type covers the long tail of bespoke login flows; tokens are cached and re-minted on expiry. Covered by unit and real-HTTP integration tests.

### Fixed
- **Postman import error handling.** `parsePostmanCollection` referenced an unimported `log` in a client component, so a malformed collection threw `log is not defined` in the browser (masking the real parse error); now uses `console.error`.

## [1.3.21] - 2026-10-10

### Changed
- **Model picker grouped by tier.** The chat model dropdown now groups the live model list into Opus / Sonnet / Haiku / Fable sections (newest version first within each) with section headers, instead of one long flat list — mirroring how Claude's own picker is organised. "Auto" stays pinned at the top. Grouping is derived entirely from `GET /api/models`, so new models and tiers slot into the correct group automatically with no hardcoding.

## [1.3.20] - 2026-10-10

### Changed
- **Anthropic SDK upgraded 0.39 → 0.133.** Runtime streaming verified against the live API (the chat path uses the stable raw-iterator event protocol). Enables the features below.
- **Model list is now dynamic — nothing hardcoded.** Available models are fetched live from the Anthropic API (`client.models.list`, active only, newest-first) via `lib/models.ts`, exposed through `GET /api/models`, and shown in the chat picker. New models (e.g. Fable 5.1, Opus/Sonnet/Haiku 5.5) appear automatically with no code change. The default model and all internal model choices (RCA classify, query generation, report narratives, connector generation) now resolve dynamically rather than from hardcoded ids. Per-token pricing resolves as per-model override (`MODEL_PRICING_OVERRIDES`, $/MTok) → tier default by family → fallback, so cost accounting covers every model.
- **Auto model routing (new picker default).** "Auto" selects the model by query shape: an RCA or any substantive query always gets the default-or-stronger model (identical to today — RCA is never downgraded), while only clearly-trivial small-talk drops to the fast model. Optional `AUTO_MODEL_ESCALATE=1` sends the heaviest RCAs to the top (Opus) tier. Users can still pin a specific model.

### Added (gated OFF by default — enable per-deployment after a live check)
- **Strict tool use** (`ANTHROPIC_STRICT_TOOLS=1`), **extended thinking on RCA turns** (`ANTHROPIC_RCA_THINKING=1`, adaptive + effort), **citations for document attachments** (`ANTHROPIC_CITATIONS=1`), and **Message Batches for scheduled report narratives** (`REPORTS_USE_BATCHES=1`). All five SDK-0.133 features were verified end-to-end against the live API; they stay off by default so the upgrade ships with zero behaviour change until each is turned on.
- **Parallel tool use**: the agentic loop already runs tool calls concurrently; a prompt nudge now encourages the model to batch independent fetches into one turn.

## [1.3.19] - 2026-10-10

### Fixed
- **API Keys: bundled services no longer offer pointless credential configuration.** For a service that runs in *bundled* mode (its URL is the compose default, not a bring-your-own override), the admin user/password are baked by docker-compose and shared with the running container — "configuring" them in the UI could only desync Mosaic's auth from the bundled container and break the integration. Those fields (Superset service user/password, CISO admin email/password) now show as **managed by Mosaic** with no Set/Override. The moment an admin points a service at their own instance (sets its URL), the credentials become editable again for that BYO instance. A stray override left on a managed credential offers a one-click **Reset to bundled**. (n8n's API key is generated inside n8n and is never bundle-baked, so it stays user-configurable as before.)
- **About tab: corrected inaccurate/irrelevant deployment details.** Mosaic ships as an on-premises Docker stack, but the About panel described a Vercel/serverless vs "Self-hosted (Node.js)" split that never applies (the Vercel path is dead code on-prem) and labelled a non-SQLite database "Cloud · auto-scaling". Platform now reads **On-premises (Docker)**, a server database reads **Server database**, the scheduler sub-text is always the built-in Node timer, and the deployment banner reflects on-premises — no more Vercel-mode branching.

## [1.3.18] - 2026-10-10

### Fixed
- **System Watchdog opens in the browser on hosted boxes.** The watchdog on `:3099` served plain HTTP only. Because the main site is HTTPS, browsers with HTTPS-First upgrade `http://host:3099` to `https://host:3099`, which had no TLS listener — so the page "wouldn't open" even though the service was healthy (curl saw HTTP 200). The watchdog now serves **HTTPS on :3099** using Caddy's existing certificate (read-only from the `caddy-data` volume; it needs only the cert files on disk, so it still works while Caddy is down) and hot-reloads the cert on renewal. Plain HTTP moves to an internal `:3098` for localhost scripts and health checks. Localhost / non-TLS installs (no `MOSAIC_HOSTNAME`) fall back to plain HTTP on `:3099` exactly as before. The in-app "System Watchdog" link is now protocol-relative so it inherits HTTPS on a real deployment.
- **Watchdog no longer cries wolf over edition-gated services.** Components not included on an edition (CISO, the OpenMeter metering stack) were counted as failures when their containers were simply absent, showing a false "6 issues detected" on a healthy trial box. Edition-/add-on-gated services that aren't deployed now render neutrally as "Not deployed" and are never counted as issues; if such a service *is* deployed but crashes, it still flags normally. Required core services (Mosaic, Superset, Elasticsearch, Superset DB, Redis) are unchanged.
- **Watchdog memory reading corrected.** The "Available memory" card parsed `/proc/meminfo` by awk output order, which lists `MemTotal` before `MemAvailable`, so the two were swapped (showing e.g. "31557 MB free of 21950 MB total"). Values are now read by field name.

## [1.3.17] - 2026-10-09

### Changed
- **Prompt caching enabled on the chat path.** The system prompt and tool definitions — identical across every turn of an agentic query's tool-use loop — are now marked cacheable. After the first call, that large prefix is read from cache at ~10% of the input price instead of being re-sent and re-processed each turn. On multi-step queries (which re-send a compounding context) this cuts input cost and latency substantially; usage now populates the Cache Tokens column. Cost accounting already priced cache reads/writes correctly (0.1× / 1.25×), so reported costs reflect the savings automatically.

## [1.3.16] - 2026-10-09

### Fixed
- **Welcome emails and Google SSO now use the real URL.** `NEXT_PUBLIC_APP_URL` was hardcoded to `http://localhost:3001`, so invite/welcome emails linked to localhost and the SSO OAuth redirect URI was wrong (Google sign-in would fail on a real domain with a redirect-URI mismatch). It's now derived from the hostname (`https://<host>` for a real deployment).
- **Data Pipelines (Airbyte) is hidden for non-admin users.** It showed an "Open" that dead-ended for regular users: Airbyte Community has no per-user SSO, and both its entry points (the raw portal and the Data Sources settings tab) are admin-only. The Connected Tools row is now admin-only, matching how Airbyte is actually administered. n8n and Superset are unaffected — they open via SSO for any granted user.

## [1.3.15] - 2026-10-09

### Added
- **Airbyte is gated behind Mosaic login.** Airbyte's port now requires a valid Mosaic session (and the `airbyte` surface grant) before it can be reached: a visitor with no session is redirected to Mosaic login instead of seeing Airbyte's own login page, and every request is authorised against Mosaic (forward_auth / RBAC). This closes the previously public Airbyte login page while keeping the port reachable from any device. Airbyte Community can't do SSO federation, so you still sign in to Airbyte itself after the gate — the gate controls *who can reach it*, not the sign-in.

## [1.3.14] - 2026-10-09

### Fixed
- **Superset opens via single sign-on on real-domain deployments.** The SSO handshake only recognised the bundled Superset at `localhost:8445`, so on a real hostname (e.g. `https://<host>:8445/`) it skipped the auto-login and bounced users to Superset's own login form (which fails over the proxy even with the right password). Now any `:8445` host is recognised — open Superset from Mosaic and you land in it already authenticated.
- **Tool links resolve to the deployment's real hostname.** `MOSAIC_HOSTNAME` (and `CADDY_TLS`) are now passed into the app container, not just used to build the `*_PUBLIC_URL` strings. Without them, the v1.3.13 server-side URL logic fell back to `localhost` — so "Open Airbyte" opened `http://localhost:8000` and edition detection could misfire on a server box.

## [1.3.13] - 2026-10-08

### Fixed
- **Airbyte login over HTTPS.** Bundled Airbyte is now served through Caddy over TLS (port 8446) instead of plain `http://<host>:8000`. On a real domain the browser was dropping Airbyte's `Secure` session cookie, so login failed with "credentials correct, but the server failed to set a cookie." Opening Airbyte from Mosaic now lands you straight in the workspace. (Local/`localhost` installs are unchanged.)
- **Embedded Superset opens without a second login.** The Superset single-sign-on hand-off now sets its session cookie with the correct path, so the dashboard loads instead of bouncing to Superset's own login.
- **System Health reports bundled Superset correctly.** In Enterprise it now probes the bundled Superset directly instead of showing "unknown".
- **Tool links use the deployment's real hostname.** Superset, n8n, Airbyte and the watchdog link now derive from `MOSAIC_HOSTNAME` rather than `localhost`, so they open correctly from any machine, not just the server.

### Added
- **API Keys page tells bundled from unset.** n8n, Superset and CISO running on their built-in (bundled) defaults now show a **"bundled"** badge with the value in use — instead of a misleading "not set" — so you can see at a glance what's already wired up versus what genuinely needs a value (e.g. the n8n API key).
- **Post-install verification.** The installer now runs a reachability check after install and the System Health page probes each tool from the browser's side, naming the exact port to open if one isn't reachable — catching the "healthy server-side but won't open" gap.

### Changed
- **Documented Enterprise inbound ports** (canonical `docs/NETWORK.md`), including Airbyte's new HTTPS port 8446; port 8000 is now internal-only.
- **Trial-box reset tooling** for single-tenant trial reuse: edition-aware reset that stops all profiles, honours `MOSAIC_HOSTNAME`, and re-registers the bundled Airbyte so a box is demo-ready between prospects.

## [1.3.12] - 2026-09-14

### Changed
- **Structured analysis views no longer need magic keywords.** Mosaic now decides for itself when a question is a genuine operational/quality investigation and produces the right structured view (fishbone, Pareto, SPC, Cpk, OEE waterfall, etc.) — you no longer have to say "root cause" or "fishbone" to get one. It stays conservative: casual, conceptual, or non-data questions get a plain answer, not a forced diagram.

### Added
- **"Next best view" suggestions.** When an answer is data-grounded but shown as prose, Mosaic can offer one or two one-tap chips ("View as fishbone", "View Cpk analysis") to open the matching structured view. It only suggests a view it already has the data to fully populate, so tapping always produces a complete diagram — never an empty one.

## [1.3.11] - 2026-09-14

### Added
- **Process capability chart.** Root-cause analyses can now show a Cp/Cpk capability histogram of measured values against the spec limits (LSL/USL/target/mean), with a capability rating — core for CNC/moulding dimensional conformance. (Mosaic already computed Cpk; now it can show it.)
- **OEE loss waterfall.** A cascade from ideal 100% down through availability, performance and quality losses to the achieved OEE, colour-coded by loss type — the standard "where is my OEE going" visual.

### Fixed
- **Fault tree** now renders as a proper indented hierarchy (cause → sub-cause → root) instead of a flat grid that misrepresented the structure.
- **Batch comparison** change indicators are now aligned to the correct column.
- All 14 existing root-cause diagrams re-verified end-to-end with real data.

## [1.3.10] - 2026-09-14

### Fixed
- **RCA diagrams look clean, not messy.** Root-cause analyses now render complete, legible diagrams: the fishbone keeps cause labels short so branches no longer overlap or run off the edge, empty/unpopulated diagrams are omitted entirely (no more blank fishbone/5-whys/CAP shells), and category labels are sized to fit. The AI is also instructed to keep diagram labels terse and only include a diagram when it can fully populate it.

## [1.3.9] - 2026-09-13

### Fixed
- **Changepoint detection now finds real shifts.** It previously reported no changepoints even for an obvious step change (e.g. a metric jumping from 10 to 50); the detection is now seeded correctly and reliably flags genuine shifts while ignoring stable noise.
- **RCA diagrams are robust to incomplete data.** All 14 root-cause visualisations now coerce incomplete AI-produced data to a safe shape and render an empty-but-valid diagram (backed by a per-diagram error boundary), so a single incomplete diagram never disrupts the rest of an analysis.

## [1.3.8] - 2026-09-13

### Fixed
- **RCA analysis no longer crashes the page.** A root-cause-analysis response whose diagram data was incomplete (e.g. a fishbone with a missing branch list) threw an uncaught error that blanked the whole chat with an "Application error" screen. Each RCA visualisation is now wrapped in an error boundary, so a single malformed diagram degrades to a small "couldn't be displayed" notice while the rest of the analysis — charts, insights, tables — renders normally. The fishbone renderer also handles incomplete data gracefully.

## [1.3.7] - 2026-09-13

### Fixed
- **CSV data corruption.** The CSV reader used naive comma-splitting, so any quoted field containing a comma — very common in industrial data (descriptions, downtime reasons, part names like "High-speed, precision lathe") — was split at the internal comma, truncating the field and shifting every column after it, silently producing wrong data. Replaced with a proper RFC-4180 parser that also handles escaped quotes, quoted newlines, and auto-detects comma / semicolon / tab delimiters (for European exports and historians).

## [1.3.6] - 2026-09-13

### Fixed
This release fixes real functional bugs found by end-to-end feature testing (correctness,
not just security):

- **Alerts now fire on Personal installs.** Threshold alerts silently never fired on
  SQLite (Personal edition) — the alert condition is stored as JSON, which SQLite returns
  as a string, so every condition field read as undefined and the alert logged "skipped"
  with no error. Setting "alert me when scrap > 5%" would produce nothing, ever. Both the
  simple alerts and the Rules-module rule groups are fixed; verified end-to-end (alert
  fires and the notification is delivered with the correct computed value).
- **Statistical analyses no longer crash on degenerate data.** Analysing values with zero
  variance (all identical), empty data, or a single point returned NaN/Inf which crashed
  the analysis with an opaque 500. They now return a clear message (e.g. "zero variance —
  no test statistic defined") instead. Normal analyses are unchanged and numerically
  correct.
- **On-prem internal webhooks work.** The webhook security guard now allows a plant's own
  LAN alerting endpoints (while still blocking loopback and cloud metadata), so
  notifications to internal receivers are delivered.

## [1.3.5] - 2026-09-13

### Security
This release is a focused security-hardening pass. Several server-side request-forgery
(SSRF) and authorization issues were found by adversarial testing and fixed:

- **Critical — SSO configuration could be changed without authentication.** The
  save/delete SSO-config actions had no auth check, so an unauthenticated caller could
  inject a malicious identity provider or delete the real SSO config. Both now require
  an administrator.
- **Unauthenticated SSRF in the OpenAPI-spec fetcher** (used by the API-connector
  wizard) — it fetched any URL server-side with no auth or validation. Now admin-only,
  with private/loopback/metadata targets blocked, redirects not followed, and a response
  size cap.
- **SSRF hardening** across the Prism connection test (blocks loopback/cloud-metadata
  while still allowing on-prem plant LAN devices) and the n8n webhook path.
- **Query Runner read-only enforcement** is now bypass-resistant: stacked statements
  (`SELECT …; DROP …`), comment/whitespace-prefixed writes, and `ATTACH` are all blocked
  on read-only connections.
- **Data-access allowed-tables guardrail** now parses the actual `FROM`/`JOIN` tables
  instead of a substring match, so a `JOIN`/`UNION`/CTE to a non-allowed table can no
  longer slip through.
- Report download is path-contained; the Prism connection test is admin-only; internal
  error details are no longer leaked in a few error responses. Removed stray
  experimental files that shouldn't have shipped.

### Fixed
- The last hard-coded `v1.0.0` version strings (user menu and setup page) now show the
  real version.

## [1.3.4] - 2026-09-13

### Added
- **Business definitions.** Define how *your* plant computes its metrics and what your terms mean — OEE, first-pass yield, what counts as a defect, which machines make up "Line A." Mosaic uses these exact definitions in every analysis, so answers reflect your standards, not generic assumptions.
- **Licensing & entitlements (foundation).** Mosaic can now validate a license against a licensing service, with seat-based limits, expiry, offline grace, and a remote kill switch. Disabled by default (no license configured → runs as before), so existing installs are unaffected until you issue keys.

### Changed
- **Current Claude models.** The model picker now offers Claude Sonnet 5 (default), Opus 5, and Haiku 4.5 — the current generation, at lower cost than before. (The picker already existed; the versions were a generation behind.)
- **Private image distribution.** The installer authenticates to a private image registry before pulling, so the compiled app is no longer anonymously downloadable.
- **Personal edition** keeps Dashboards and Rules (both work), with the notification-channel settings they need made available.

### Fixed
- **Security:** closed server-side request-forgery (SSRF) vectors in the MCP connector and in Slack/Teams/webhook/n8n notifications — a crafted URL can no longer reach internal services or cloud metadata. Bounded MCP response sizes and treat MCP output as untrusted data.
- **Reliability:** notifications now retry transient delivery failures (a brief Slack/email blip no longer drops an alert).
- **First-run experience (installer):** fixed a false "Port 443 in use" preflight error, made "Open Mosaic" load in the app window (not a browser), and calmed the download progress display.
- **Fresh install:** the "Mosaic Files" data source now appears immediately on a clean Personal install; System Health shows unconfigured BYO services as "not configured" rather than a misleading "down"; the login page no longer shows a stale hard-coded version.
- Query Builder retries schema loading once to avoid a race right after creating a data source.

## [1.3.3] - 2026-09-07

### Added
- **Local folder analysis (Personal edition).** A `~/Mosaic/files` folder is created at install and mounted into Mosaic; drop documents (or whole subfolders) in and ask about them in chat — no data-source setup. Files are scanned recursively, and each top-level subfolder becomes its own data source, so organised folders (e.g. `production/` vs `compliance/`) are treated as separate scopes and not cross-correlated unless you ask.
- **Rich document reading.** PDF, Word, PowerPoint and Excel are converted to clean, token-efficient Markdown via MarkItDown — crucially preserving tables as real tables (not scrambled text). Applies to local folders and Enterprise file servers alike.
- **Visual chart reading (on request).** When a report's charts are embedded as images that text can't parse, Mosaic offers to read them visually; on your approval it renders the pages and interprets the charts (OEE breakdowns, Pareto, plan-vs-actual, etc.). Each visual read is recorded in the audit log with the consent captured.
- **Cross-source analysis (`combine_sources`).** Mosaic can now join and correlate data across different sources by a shared key — e.g. match API production orders to database quality records by order id — using a real, deterministic SQL join (DuckDB) instead of matching rows by hand. The join engine is sandboxed: it can only see the data explicitly passed to it (no file or database access).
- Query Builder: a **New query** button; Rules and alerts now select the query before the column, matching the natural order.

### Changed
- **Personal edition is now a coherent single-user product.** Features that assume multiple users or a shared server are hidden in Personal: user management, authentication/SSO, teams, notifications, audit trail, data retention, backup, remote support, and the enterprise-only services on System Health (usage metering, Keycloak, the search index). Enterprise is unchanged.
- **Updates.** The in-app update prompt no longer opens an external GitHub page — release notes render inline in Mosaic's own styling. Both editions show clear, reliable guided update steps (the previous one-click auto-update, which could interrupt the app mid-restart, was removed).
- The About screen now lists the **actual installed** dependency versions instead of a hard-coded list, and no longer implies a currency check it wasn't performing.

### Fixed
- Local file reading now reaches the user's real files (the container previously couldn't see host folders), reads PDFs/Office docs that were silently skipped before, and surfaces the complete file list for "summarise everything" requests.
- Migrations and the folder/data-source setup run reliably at boot; edition is detected consistently across the app.
- Various UI polish: the wordmark no longer touches the window edge, and the "create new" buttons are consistent across Query Builder, Alerts and Workflow rules.

## [1.3.2] - 2026-09-04

### Added
- **Query unification** — the Query Builder is now the single place queries are authored and stored (DB-backed `saved_queries`), referenced everywhere else. No free-text SQL outside the Query Builder.
- Dashboards: build a Superset dashboard from a saved query, with live validation of the chart spec against the real result columns before building.
- Multi-chart Superset dashboards — add charts from multiple queries to one dashboard (layout via position_json); refuses to modify dashboards Mosaic didn't create (protects hand-designed layouts).
- Alerts & workflow rule conditions reference saved queries (DB) and pre-configured API connections (API) — no free-text SQL or API paths. Robust API value extraction across common response shapes (flat, arrays, data/results/value/items/records wrappers, OData v2/v4) plus a configurable data path; optional "any row matches" evaluation.
- Report sections use saved queries (DB) and API connections (API); per-section width (full / half / third) with auto-wrapping row layout, rendered identically in-app and in PDF.
- Field pickers show a saved query's actual result columns (dropdown) so a mistyped field can't silently prevent a condition from firing.
- CJK (Noto) fonts in the image so reports with Chinese/Japanese/Korean content render real glyphs.
- Airbyte: workspace selector; Mosaic → n8n workflow triggering (outbound).
- Persisted, paginated "Queries & dashboards" view of everything Mosaic built in Superset.

### Fixed
- **Migrations now run in production.** The Dockerfile never copied `migrations/`, so the migration runner silently skipped in every built image; migrations also only ran on a home-page render. Now migrations (schema + data) run at server boot via `instrumentation.ts`, before any request, with per-statement additive-migration support.
- **PDF report generation works on ARM (Apple Silicon).** Switched from the x86-only `@sparticuz/chromium` to the arch-native Alpine `chromium` package, fixing the `rosetta error` on arm64; added a writable reports directory.
- Superset BYO consistency: status, dashboards list, embed, sync, user-sync and the launch button all resolve configuration settings-first (BYO wins over bundled defaults); honest `unconfigured` / `error` / `healthy` status states across Airbyte, n8n, Superset and CISO.
- Bar/line charts no longer duplicate the dimension (the "Duplicate column/metric labels" error); empty-result queries no longer falsely flagged as non-numeric.
- Report template editor: connection dropdown selection sticks; edit page no longer crashes; saving keeps you on the page; multi-section templates stay compact.
- Numerous BYO auth fixes where a service read credentials env-first instead of settings-first.

### Notes
- Both editions share one image; the browser certificate warning on `https://localhost` (Personal) is expected for a self-signed cert and does not appear on a real domain (Enterprise, with `CADDY_TLS` set for a public certificate).

## [1.2.1] - 2026-05-24

### Added
- CISO Assistant GRC platform integrated into Mosaic stack (docker-compose.yml — 3 services: ciso-backend, ciso-frontend, ciso-caddy)
- Caddy reverse proxy routing for CISO Assistant on port 8443 (plain HTTP, on-prem safe)
- Custom backend Dockerfile patches Django cookie security flags so login works over plain HTTP without TLS
- ISO 27001:2022 library (264 frameworks available; 123 requirements, 93 Annex A SoA controls)
- "Open CISO Assistant" button in Settings → Audit tab with two-layer compliance explanation
- .env.example — CISO_SUPERUSER_EMAIL / CISO_SUPERUSER_PASSWORD entries

### Fixed
- Caddy auto-adds X-Forwarded-Proto: https which caused Django to set Secure cookies over HTTP, silently breaking login — fixed by stripping header in Caddyfile and patching SESSION_COOKIE_SECURE / CSRF_COOKIE_SECURE in Dockerfile.backend
- Removed orphaned docker/ciso/mosaic_settings.py and docker/ciso/local_settings.py

## [1.2.0] - 2026-05-18

### Added
- Report template builder — section types (KPI, table, chart, AI narrative, static text), data bindings, schedule, recipients
- Report scheduler — cron-based generation, PDF via Puppeteer, email delivery with attachment
- Report history — downloadable PDF instances, run log
- Friendly schedule builder — Daily/Weekly/Monthly picker with day/time selectors, human summary (no cron strings exposed)
- Structured recipients — notification group pills + individual email input, matching Rules page pattern
- Elasticsearch database connector — Query DSL + GET discovery, API key and Basic auth
- Elasticsearch test harness — 4 indices (maintenance_logs, alarm_events, quality_events, operator_logbook), 372 documents aligned with PRESS-01/CNC-03 RCA scenarios
- SharePoint file server transport — Microsoft Graph API, OAuth2 client credentials (tenant_id, client_id, client secret)
- SharePoint test handler — validates credentials against Azure AD, surfaces AADSTS errors in UI
- n8n webhook action type in Workflow rules — configurable URL + payload template with {{variables}}, _mosaic context block appended
- rca_sessions table — records every RCA completion with workflow_id, problem, renderers_used, rca_block
- Backfill migration for historical rca_sessions from messages table

### Fixed
- rca_sessions write gated on matchedWorkflow (generic RCA path never wrote sessions)
- integration_runs FK constraint — rule_id referenced integration_rules only, blocking rule_groups (workflow rules) from logging
- integration_runs schema migration — drops FK on boot for existing SQLite DBs
- TabAPIs.tsx — 13 pre-existing TypeScript errors (ImportConnection missing 4 fields, ApiService missing auth_status/last_auth_error, Alert style prop)
- app/api/export/word/route.ts — Buffer not assignable to BodyInit (→ Uint8Array), Parameters<typeof Document> DOM type conflict
- cron-parser API change — parseExpression → CronExpressionParser.parse
- Collapsed sidebar — Dashboards/Reports/Rules labels truncated; now shows icon-only rail with tooltips when collapsed
- User row collapsed state — avatar only, name/role/version hidden; ThemeToggle hidden when collapsed
- About page — version badge, build date and footer all hardcoded; now read from package.json and git log
- appUrl default was localhost:3001 — corrected to localhost:3000
- react-markdown version in deps list showed 9.x — corrected to 10.1.0

## [1.1.0] - 2026-05-11

### Added
- SSO authentication — Microsoft Entra ID and Google Workspace (OIDC)
- SMTP configuration UI with test button and encrypted password storage
- Welcome emails sent on user invite with branded HTML template
- User management — stats dashboard, search, filter, pagination, last login tracking
- OpenAPI 3.0 importer with toggle button UI (Import Postman + Import OpenAPI)
- Postman variable substitution and smarter auth detection
- Pagination and data-path inference at import time
- Endpoint catalog injected into chat system prompt
- Import polish — dedup detection, fold toggle, better error messages
- API response hard cap at 200 records to prevent context window overflow
- Chat + menu replacing toolbar clutter (data sources, RCA workflows, model, system prompt)
- File attachment support in chat (image, PDF, CSV)
- Stop/cancel button while streaming
- Sidebar collapse with smooth animation on all pages
- Conversation search in sidebar
- Markdown rendering in chat responses
- Self-hosted scheduler — built-in 60s Node timer (no Vercel dependency)
- Deployment info page in Settings → About
- Search and pagination on all three settings connection tabs

### Fixed
- API system prompt token bloat — descriptions truncated, default limits added
- Conversation delete button changed from red to subtle grey
- Chat response formatting — no markdown tables, no emoji, no duplicate headings

## [1.0.0] - 2026-04-08

### Added
- AI chat with streaming responses and tool use
- Web search via Tavily API
- Database connections — PostgreSQL, MySQL, SQL Server, InfluxDB, MongoDB, SQLite
- REST API service workspaces with OAuth2, bearer, basic, API key auth
- SAP OData V2/V4 connector with automatic format injection
- File server connections — SFTP, S3, SMB/CIFS, local filesystem
- Postman v2.1 collection importer with folder tree and checkboxes
- RCA Workflows — Pareto, Fishbone, 5 Whys, corrective action plan renderers
- 4 seeded RCA templates — Quality Defect, Machine Downtime, OEE Drop, Safety Incident
- Notifications — Slack, Teams, Email (SMTP), SMS and WhatsApp via Twilio
- Alert rules with threshold, schedule, and RCA complete triggers
- Dashboard builder with panel types — bar, line, KPI, table, donut, gauge
- User management with admin/user roles and ban/unban
- JWT authentication with bcrypt password hashing
- Usage analytics with per-user token cost tracking
- Light and dark mode with system preference detection
