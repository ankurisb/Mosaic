# Changelog

All notable changes to Mosaic are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [1.3.101] - 2026-10-20

### Changed
- **Robustness #1 — uniform, visible row policy for dashboard panels.** Previously a panel's result size depended on the source: SQLite and API panels were uncapped (a large query could ship tens of thousands of rows to the browser and choke the chart), while Postgres/MySQL/MSSQL/Mongo were silently clipped to 200 rows (so a time-series wanting more than 200 points was quietly truncated with no indication). Now:
  - **Database panels fetch up to 5,000 rows** on dashboards (chat stays at 200), so legitimate multi-point charts aren't clipped; SQLite is now wrapped with the same bounded `LIMIT` as the server dialects.
  - **The route applies one policy to every source** (`lib/dashboard-rows`): large **time-series** (line/area/bar) are **downsampled with LTTB** to ≤1,000 points — preserving the visual shape and both endpoints — and large **tables/other** are capped to ≤1,000 rows.
  - **It's visible, not silent.** Each panel's footer shows a note when its data was trimmed (`↓ 1,000 of 8,640 pts` for a downsample, `first 5,000+ rows` when the source itself had more), with a tooltip explaining and suggesting aggregation in SQL. `queryDatabase` now reports `truncated`, and the panel data carries `meta` (`total_rows`, `returned_rows`, `downsampled`, `truncated`, `source_capped`).
  - Non-row results (e.g. a file-server document) pass through untouched. (`lib/dashboard-rows` + 10 unit tests, `lib/tools.ts` `queryDatabase`, `app/api/dashboards/[id]/data`, `PanelChart`.)

## [1.3.100] - 2026-10-20

### Changed
- **"Edit with AI" dock now adds proposed panels straight to the dashboard** instead of a propose-then-confirm step. When you ask the dock to add/split panels, they're created immediately (and appear live in the grid) — you delete any that aren't right via the panel's × control. The proposal card still lists what was added ("Added to dashboard ✓"); the manual "Add N to dashboard" button only appears as a fallback if the auto-add fails. The assistant's narration no longer says "confirm on the proposal card" in this context. (`DashboardChatDock`, `app/api/chat/route.ts` — the main-chat new-dashboard builder still uses the review-and-save card, since there's no dashboard to delete from yet.)

## [1.3.99] - 2026-10-20

### Added
- **The "Review dashboard" drawer now renders the saved dashboard inline.** After a chat-built dashboard is saved, the drawer previously showed only a "saved — N panels" line and an "Open dashboard →" button. It now also renders the actual panels live (read-only) beneath that line, using the same data endpoint and `PanelChart` renderer as the full dashboard, stacked in a single column sized to the drawer and loaded at the dashboard's auto-detected default window. "Open dashboard →" is unchanged. (`ChatPage` — new `ProposalSavedPreview`.)

## [1.3.98] - 2026-10-20

Re-release of 1.3.97 under a clean tag — the `v1.3.97` tag was accidentally
placed on the previous (1.3.96) commit, so the build built stale code. No code
change from 1.3.97; the fixes below shipped here.

## [1.3.97] - 2026-10-20

### Fixed
- **Changing the time window no longer blanks the whole page.** The structure-load effect depended on `fetchData`, which was re-created on every `timeWindow`/`customFrom`/`customTo` change — so each date keystroke and each Apply re-ran the full load effect and flipped the full-page loader on, reloading header and all. `fetchData` is now stable (it reads the current window from a ref); structure loads **once** per dashboard (the only place the full-page loader is toggled), and a separate effect refetches panel data when the **preset** window changes — so only the panels refresh, the header stays put.
- **The calendar picker no longer refetches on every date change.** Custom `from`/`to` dates are no longer in any fetch-trigger dependency; a custom range is fetched **only** when you click **Apply** (which now shows the refresh spinner).
- **Resizing a panel no longer wipes its content.** The resize path sent `update_panel` with just `{id, w, h}`, and `update_panel` overwrote *every* column — blanking the panel's title, query and source to defaults. `update_panel` now does a **geometry-only** update (touch only `col/row/w/h`) when no content fields are present. (`app/api/dashboards/route.ts`.)

### Changed
- **Dashboard panels moved to a 12-column grid** (from 4 columns) for far finer width control: widths now snap in 1/12ths (quarter = 3, third = 4, half = 6, two-thirds = 8, three-quarter = 9, full = 12) instead of coarse quarters, and heights go up to 3 rows. **Resizing now previews live** during the drag instead of only snapping on release. Existing panels are migrated (`020_dashboard_grid_12col.sql`, `w × 3`) so their proportions are preserved. The panel builder gained a **Height** selector; the AI planner, chat dock and proposal flow default to half-width (6) on the new grid. (`DashboardView`, `PanelChart`, `PanelBuilder`, `DashboardChatDock`, `ChatPage`, `app/api/dashboards/route.ts`, `lib/tools.ts`.)

## [1.3.96] - 2026-10-20

### Added
- **Resize and reorder dashboard panels.** The resize affordance was plumbed but never rendered (no handle element existed, even in the earliest version), so resizing never actually worked. Added a **resize handle** (bottom-right corner) that drives the existing resize logic, and **drag-to-reorder** — grab a panel by its header (a grip appears) and drop it on another to reorder; the new order persists (`reorder_panels` now writes `sort_order`, which is what the auto-flow grid follows). (`PanelChart`, `DashboardView`, `app/api/dashboards/route.ts`.)

### Changed
- **Sandbox demo data now spans the last 14 days** (deterministic) instead of a single historical day. Each day uses the same fixed profile, so time windows genuinely apply and trends have one point per day — and totals stay trivially checkable (N days in the window → N × the per-day value, e.g. 7d → 7 × 629 = 4,403 units). This makes time-window + aggregation behaviour validatable end to end on the built-in source, and preset windows (Today / 7d / 30d) now return data without a custom range. (`lib/tools.ts` sandbox seed.)

## [1.3.95] - 2026-10-20

### Changed
- **Dashboard right pane is now full-height and unified.** The "Edit with AI" pane spans the whole right side of the dashboard (the view is a fixed-height app shell; the panel grid scrolls within its column). The manual panel editor no longer opens as a full-width drawer that pushes the grid down — it now lives in the **same right pane**, with a header toggle to switch between **Edit with AI** (chat) and **Edit panel / Add panel** (the form). Clicking a panel's edit pencil, or "Add panel", opens the form in that pane; `PanelBuilder` gained an `embedded` mode (fills the pane, fields stacked single-column). (`DashboardView`, `PanelBuilder`, `DashboardChatDock`.)

## [1.3.94] - 2026-10-20

### Added
- **Dashboard chat dock — evolve a dashboard in natural language, in place.** An "Edit with AI" button on a native dashboard opens a right-side chat scoped to *that* dashboard. You can:
  - **Add panels** — "add a panel showing downtime by reason". The model proposes new panels (dry-run previewed, with per-panel data/empty/error verdicts); an "Add N to dashboard" button **appends** them to the current dashboard (not a new one) and the grid reloads live.
  - **Edit a panel's presentation** — "change the OEE panel to a bar chart" → `update_dashboard_panel` (chart type / title / subtitle / chart_config only; query and source are left to the add-a-corrected-panel flow for safety).
  - **Remove panels** — "remove the status-mix panel" → `remove_dashboard_panels`.
  - **Ask questions** — "what does the defect-rate panel show?" — plain answers, no change.
  - Server: `/api/chat` accepts a `dashboard_id`; when the owner supplies it, the current panels are injected as context and two dashboard-scoped tools (`update_dashboard_panel`, `remove_dashboard_panels`) are offered **only** in this mode (never in the normal chat). Changes emit a `dashboard_changed` event so the view refreshes immediately. (`components/dashboards/DashboardChatDock.tsx`, `DashboardView`, `app/api/chat/route.ts`.)

## [1.3.93] - 2026-10-20

### Fixed
- **API dashboard panels showed "No data" despite returning records.** The panel executor returned the raw `call_api` result for API panels, but the chart renderer's `normalise()` only understands `{rows}` or a bare array — so a wrapped response (OData, or FactoryOS's `{status,message,data:"<json>"}`) was never parsed and every API panel rendered empty. The dry-run had the same blind spot: it classified any truthy response object as "data" (rows 0), so the proposal looked green while the saved panel was blank. Both now run the API result through `extractApiRecords` (the envelope unwrapper built for the dictionary) → the executor returns real `{rows}` and the dry-run verdict/sample reflect the actual records. API errors are now surfaced instead of silently empty.

## [1.3.92] - 2026-10-20

### Added
- **Dashboards built from chat now open on a time window that covers their data.** The builder's dry-run already samples each panel's rows; it now detects the data's actual time span and stores a per-dashboard default window (`detectSampleTimeRange` + `suggestDefaultWindow` pick the smallest of 24h/7d/30d/90d/1y/all that includes the oldest point). The proposal carries `suggested_window`, the confirm step saves it (new `dashboards.default_time_window` column, migration 019), and `DashboardView` applies it on first load before fetching — so a dashboard over historical data (e.g. the Sandbox demo's April data → "1y") is populated on open instead of blank on "Today". Live data still resolves to a tight recent window.
- **The chat dashboard builder now builds API / OData panels** (multi-source builder complete: database + PRISM + API). `build_dashboard` accepts `source_type: "api"` with the connection id and a request path as the query (e.g. `/A_InspectionResult?$filter=InspectionDate ge {{time_from}}&$top=100&$format=json`).
  - **Source-aware time substitution** — API panels use a new `substituteTimeWindowApi` that injects the window timestamp **unquoted** (an OData `$filter` needs a bare ISO datetime; the SQL variant's quoting would make the filter invalid). Applied in both the dry-run preview and the live executor (which previously did no time substitution for API panels at all).
  - Planner guidance documents the API panel format and the unquoted `{{time_from}}`/`{{time_to}}` convention, and tells the model to use the connection's known fields (from the API dictionary) for filter/select columns.

### Notes
- 9 new unit tests (52 in the plan module; 257 total) covering the OData substitution, time-range detection, and window suggestion.

## [1.3.91] - 2026-10-20

### Fixed
- **Dashboard chart rendering: oversized axis fonts, broken time axis, missing area/stat charts.** On a wide panel the hand-rolled SVG charts rendered at a fixed 400-wide viewBox stretched to the panel width (~1900px), magnifying every 8px label ~5× (the "323440 / 2026-10-" giant text). Fixes:
  - **Native-pixel rendering** — line/area/bar charts now measure their container (`ResizeObserver`) and render the SVG at true pixels (viewBox == width×height), so axis fonts stay ~10px at any panel width.
  - **Axis formatting** — y-axis ticks are compacted (`323440` → `323k`, `1.3M`); x-axis ISO timestamps are formatted (`2026-10-13T00:27…` → `13 Oct 00:27`) and thinned to the available width so they no longer overlap or truncate to "2026-10-".
  - **`area` chart implemented** — it previously fell through to a bar chart, so an area panel over a long series rendered as a solid block of thin bars. `area` now renders a filled line; `line` supports multiple series with a legend.
  - **`stat` chart implemented** — `stat` also fell through to a bar chart; it now renders the KPI number card (same as `number`).
  - Bar chart made responsive too, with compact y-axis and thinned x-labels.

### Notes
- A cumulative counter like PRISM `kWh` (a running meter total) plotted with `agg: SUM` shows a near-flat high line — that's the cumulative value, not per-interval generation. For "energy generated per hour/day", query the per-bucket delta (or plot the raw counter). A planner refinement to prefer deltas for cumulative keys is a candidate follow-up.

## [1.3.90] - 2026-10-20

### Added
- **Dashboard time control: "All time", "Last 90d" and "Last 1y" windows.** A freshly built dashboard over historical data (e.g. the Sandbox demo data, all stamped one day in April) opened blank on the default "Today" window, and no preset reached back far enough — so it *looked* broken when the build and data were fine (confirmed: the same panels return full data over a window that covers the data). "All time" (a ~20-year window) is a one-click way to see everything regardless of data age; 90d/1y fill the gap below it. (`DashboardView` presets + `getTimeWindow` in the panel executor.) A smarter per-dashboard default window (auto-detected from the data during the build) is the planned follow-up.

## [1.3.89] - 2026-10-19

### Fixed
- **PRISM time-series panels no longer error on wide windows** ("Incorrect TsKvQuery. Number of intervals is too high"). An aggregated `telemetry_history` query over a wide dashboard window ÷ a fine interval can exceed ThingsBoard's interval-count limit (e.g. 30 days ÷ 1h = 721 buckets). Since the dashboard window is chosen at runtime, the model can't size the interval safely — so `applyPrismWindow` now clamps the interval up so any window yields at most `MAX_PRISM_INTERVALS` (500) buckets, in both the dry-run preview and the live executor. Planner guidance also nudges the model toward a sensible interval and notes Mosaic auto-coarsens it. Caught by the live end-to-end builder test (the model aggregated at 1h over the preview window). +2 unit tests (43 in the plan module; 248 total).

## [1.3.88] - 2026-10-19

### Fixed
- **API dictionary now unwraps nested / JSON-stringified response envelopes** (the FactoryOS shape). The live extreme test showed the describer drafting an endpoint's *wrapper* fields (`status`, `message`, `data`) instead of the real record fields, because FactoryOS returns `{status, message, data: "<JSON string of {records:[…], page, …}>"}` — the records are JSON-stringified one level down. `extractApiRecords` now (1) parses a JSON-stringified payload field (`data`/`result`/`payload`/`response`/`body`) in place, (2) recurses one level into an envelope wrapper to find the records array when the object looks like a wrapper (has a `status`/`message`/pagination sibling), and (3) returns `[]` for a bare envelope with no discoverable records rather than describing the wrapper. A genuine record that merely has a `data` field is left untouched. +5 unit tests (18 in the module; 246 total).

## [1.3.87] - 2026-10-19

### Fixed
- **PRISM dashboard panels failed to execute** ("PRISM panel query must be valid JSON…") even with a perfectly valid stored query. Root cause: the SQLite layer (`lib/db.ts`) auto-parses any TEXT column whose value starts with `{`/`[` into JSON to mimic Postgres's row shape — so a PRISM panel's JSON `query` came back from the DB as an **object**, and `String(obj)` → `"[object Object]"` → parse failure. (Database/API panels never hit this; their queries aren't JSON.) But Postgres/Neon return a TEXT column as a string, so this was a SQLite-only inconsistency. Fix: exclude the `query` column from JSON auto-parse (it is always a query string, never a JSON value to rehydrate), matching Postgres. Belt-and-suspenders: `parsePrismQuery` now also accepts an already-parsed object, so the builder dry-run and the executor behave identically on any DB driver. Caught by the live extreme test before sign-off; 2 new unit tests (41 in the plan module).

## [1.3.86] - 2026-10-19

### Added
- **Chat dashboard builder now builds PRISM (IoT telemetry) panels**, not just SQL. "Build me a dashboard of solar generation" over a PRISM instance now works end-to-end: propose → dry-run preview → confirm → live panels.
  - **`build_dashboard` accepts `source_type: "prism"`** — the panel `query` is a JSON string of `query_prism` params (e.g. `{"operation":"telemetry_history","entity_type":"DEVICE","entity_id":"<uuid>","keys":["kWh"],"agg":"SUM","interval":3600000}` for a trend, or `telemetry_latest` for a current value). The tool spec and planner guidance document the format and instruct the model to resolve a device `entity_id` (via `query_prism` `devices`) and use the instance's known telemetry keys.
  - **Source-aware time handling** — PRISM panels don't use the `{{time_from}}` string placeholder (that's SQL/quoted). Instead the executor and dry-run inject the dashboard window as **epoch-ms** `startTs`/`endTs` into the parsed params for time-series ops (`applyPrismWindow`); `telemetry_latest` takes no window.
  - **Telemetry → rows adapter** (`prismSeriesToRows`) — `telemetry_history` `{series:{key:[{ts,value}]}}` is merged into ts-sorted rows `[{ts, <key>}]` (numeric strings coerced to numbers); `telemetry_latest` becomes a single row; `devices`/`assets` pass through. The panel renderer consumes the same `{rows}` shape as SQL panels.
  - **Executor + dry-run `prism` branches** (`app/api/dashboards/[id]/data`, `lib/dashboard-build`). The dry-run previews over a recent 30-day window (telemetry is recent; a 10-year window would bucket mostly-empty) and caps preview points; the saved panel runs under the dashboard's own global time window.
  - **Plan-time validation** — a PRISM panel's JSON query is parsed and checked for an `operation` in `validatePanelShape`, so a malformed panel is caught before anything is shown. Persist path already safe: `denyNonReadonly` skips non-database sources, so the SQL write-guard never false-rejects a PRISM panel.
- 13 new unit tests (39 in the plan module; 252 total) covering `parsePrismQuery`, `applyPrismWindow` (epoch-ms injection, latest = no window, no mutation), `prismSeriesToRows` (history merge + numeric coercion, latest, passthrough, empty), and prism panel-shape validation.

## [1.3.85] - 2026-10-19

### Added
- **Semantic dictionary now covers API sources** (multi-source extension, step 2). The dictionary documented SQL tables/columns and PRISM telemetry keys; it now also describes an API connection's record fields so every AI call over that API understands opaque field names.
  - **`/api/semantic` `generate` gained an `api` branch** — fetches a sample of records from the connection via `call_api`, normalises whatever envelope the API returns (bare array, OData V4 `{value:[]}`, OData V2 `{d:{results:[]}}`, a `{data|results|items:[]}` wrapper, any array-of-objects property, or a single object), unions the top-level fields, and asks the model to describe the non-obvious ones (`object_key` = field name). Every exit carries an actionable reason (connection unreachable, API error, no records to sample, no describable fields, AI step failed) and a success summary.
  - **"Describe" button on each API connection** (Settings → APIs) opens the dictionary editor (`SemanticDescriptionsModal` with `source_type="api"`); admin-gated, same propose→confirm loop. The manual "+ Add entry" prompt is now source-aware (bare field name for API/PRISM, `table.column` for databases).
  - **API field descriptions are injected into the chat prompt** — folded into each connection's line in the `## APIs` catalog as "known fields: …" (via `getSchemaHints('api', <connection id>)`).
- New pure, unit-tested module `lib/api-dictionary.ts` (`extractApiRecords`, `collectApiFields`, `isApiMetaField`) — 13 tests covering every envelope shape, metadata filtering, null-preference, and the field cap.

## [1.3.84] - 2026-10-19

### Added
- **PRISM dictionary auto-describe now validates coverage and fails with an actionable reason.** Every exit of the generate path now tells the user exactly what to fix instead of a silent empty/partial draft, and a successful draft reports its own confidence:
  - **Instance unreachable** → "Couldn't reach PRISM to list devices: … Open Settings → PRISM and use Test connection."
  - **Empty fleet** → "No devices found … Add or activate devices, then retry."
  - **Devices error while listing keys** (≥ half the sample) → diagnosed as auth/connectivity, with a sample error and a pointer to Test connection — distinct from the "no data" case.
  - **Devices present but no timeseries keys** → "…none report timeseries telemetry keys yet. Likely the devices haven't sent data, or values are stored as attributes…" (explicitly *not* blamed on auth).
  - **Sparse** (many devices, ≤2 keys) → drafts anyway but warns the fleet may be warming up.
  - **AI draft step fails** → says the keys were read fine and to retry / check the API key.
  - On success the response carries **diagnostics** (fleet size, devices sampled / with keys / errored, distinct keys, keys with live values, keys described, coverage status) and a **one-line summary** shown in the dictionary editor so the user can judge confidence before saving.
- Key/value fetches now run with **bounded concurrency** (6 in-flight) so a 50-device sample stays responsive against a laggy on-prem gateway, and **per-device errors are captured** rather than silently dropped (so an all-errors run is diagnosable).
- New pure, unit-tested module `lib/prism-dictionary.ts` (`planPrismSample`, `assessPrismCoverage`, `summarizePrismDraft`) with 12 tests covering the union/ranking, the key cap, and every fallback branch (empty fleet, all-errors, no-keys, sparse, huge vocabulary, malformed keys).

### Changed
- `generatePrismDraft` (`app/api/semantic/route.ts`) refactored to use the new module; the dictionary editor (`SemanticDescriptionsModal`) shows the coverage summary and any warning.

## [1.3.83] - 2026-10-19

### Fixed
- **PRISM dictionary auto-describe now captures the whole telemetry vocabulary** instead of a single key. The v1.3.82 generator sampled *one representative device per device type* — but real PRISM/ThingsBoard solar fleets type every device `default` and spread the key vocabulary across devices (one unit reports `kWh`/`kW`, another `v1n`, a weather station `slr_rdtn`). On the live Ornate NTPC instance (101 devices, all type `default`) that collapsed to a single device exposing only `v1n`, so "Describe" drafted one useless entry. The generator now **unions telemetry keys across a broad device sample** (up to 50 devices), ranks them by how many devices report each key, and pulls latest values from the richest devices for units inference. Verified live: 17 distinct keys recovered (`mb_error`, `machine_status`, `total_energy`, `kWh`, `kWh_today`, `kWh_sf`, `kW`, `total_power`, `kW_sf`, `v1n`, `kWh_in`, `kWh_out`, `slr_rdtn`, …) vs 1 before. (`app/api/semantic/route.ts` `generatePrismDraft`.)

## [1.3.82] - 2026-10-19

### Added
- **Semantic dictionary now covers PRISM sources** (multi-source extension, step 1 — the solar/energy win). The dictionary previously only described SQL database tables/columns; it now documents a PRISM instance's cryptic telemetry keys (`kWh_sf`, `v1n`, `mb_error`, `machine_status`, …) so every AI query over PRISM understands them.
  - **New `keys` operation on `query_prism`** — lists the available telemetry key names for a device/asset (ThingsBoard `keys/timeseries`).
  - **`/api/semantic` `generate` gained a PRISM branch** — lists devices, samples one representative device per type for its key list + latest values, and asks the model to draft a units-aware description per key (`lib/ai/describe-schema` generalised from SQL-only to "tables/columns, telemetry keys, or API fields").
  - **"Describe" button on each PRISM instance** (Settings → PRISM) opens the same dictionary editor (`SemanticDescriptionsModal` with `source_type="prism"`); admin-gated, same propose→confirm loop.
  - **PRISM key descriptions are injected into the chat prompt** — folded into the `query_prism` instance catalog so the agent sees "known telemetry keys: kWh_sf = …; v1n = …" alongside each instance.
  - (API-source dictionary and the builder generation for PRISM/API follow in v1.3.83; design in `claude/mosaic-dashboard-multisource-design.md`.)

## [1.3.81] - 2026-10-19

### Changed
- **Dashboard builder dry-run now previews time-filtered panels over a wide (~10-year) window** instead of a fixed last-30-days. A panel that filters on `{{time_from}}`/`{{time_to}}` was correctly reported "empty" whenever the source's data fell outside the last 30 days (e.g. the sandbox's April data checked in October), making a valid panel look broken in the proposal. The preview now answers "does this panel return data?" regardless of how old the data is; the saved dashboard still runs under its own top-right time window. (`lib/dashboard-build.ts` `previewWindow`.)

## [1.3.80] - 2026-10-19

### Added / Changed
- **Dashboard builder — the complete loop.** Request in chat → validate in the right-side review panel → publish → appears in the Dashboards menu and leaves a link in the chat.
  - **Proposal now opens in the resizable right-side review panel** (same chrome as file/map/research review), instead of an inline card. The chat message keeps a "Dashboard proposal — review" chip to reopen it. (`DashboardProposalPanel` in `components/ChatPage.tsx`.)
  - **After publishing, the chat message shows a persistent "Open dashboard: <title> →" link**, so the created dashboard is reachable from the conversation for future reference (and it's listed in the Dashboards menu as before).
- **Fixed: builder dashboards now obey the global time control.** The top-right time-window selector drives panels via `{{time_from}}`/`{{time_to}}`/`{{interval}}` placeholders, but the substitution injected a raw, unquoted timestamp — so time-filtered SQL broke and the planner dropped the filters. New shared `substituteTimeWindow` (`lib/dashboard-plan.ts`, unit-tested) injects a **quoted** timestamp and absorbs any quotes the author already wrote, used by both the dashboard data route and the builder dry-run. The planner is now instructed to add `{{time_from}}`/`{{time_to}}` filters on time-series panels, so saved dashboards respond to the global window. (No separate aggregation selector yet — the bucket interval is tied to the window via `{{interval}}`.)
- 4 new unit tests (26 for the plan module; 201 total).

## [1.3.79] - 2026-10-19

### Hardened / Fixed
- **Dashboard write boundary (`/api/dashboards`) hardened** — found by an adversarial pass against the live v1.3.78 deployment (the Save path the chat builder's proposal card uses). The chat builder itself passed its end-to-end security test: a plan containing `DELETE FROM machines` was classified `error` and never executed (blocked by the read-only guard before run). But the persist API underneath had gaps, now closed:
  - **IDOR on panels** — `update_panel`, `delete_panel` and `reorder_panels` modified/deleted a panel by id with **no ownership check**, so any signed-in user could alter another user's panels by guessing ids. All three are now scoped to panels on the caller's own dashboards (`update_panel` returns 404 for a panel the caller doesn't own; delete/reorder are owner-scoped in the WHERE clause).
  - **No panel cap** — `add_panel` accepted unlimited panels per dashboard (60 added freely in the test), and the dashboard data route runs every panel query on load. Capped at `MAX_PANELS_PER_DASHBOARD = 50`.
  - **Non-read-only panel queries could be stored** — `add_panel`/`update_panel` now reject a non-SELECT query for database panels at write time (`readonlyGuard`, dialect-aware), defence-in-depth on top of the executor's run-time guard.
  - Confirmed already-correct: `add_panel` required-field validation (400), cross-user `add_panel` blocked (404 via dashboard ownership), non-owner `delete_dashboard` deletes nothing.

## [1.3.78] - 2026-10-19

### Added
- **Chat-native dashboard builder (Phase 1B)** — ask in chat ("build a dashboard for plant performance: daily generation, availability by inverter, top 5 underperformers") and Mosaic proposes a whole multi-panel dashboard with **live sample data**, which you confirm/edit/drop before anything is saved. Design: `claude/mosaic-dashboard-chat-builder-design.md`.
  - **`build_dashboard` tool** (lib/tools.ts spec; handled inline in the chat route like deep_research). The model emits a typed plan — title + up to 12 panels, each `{source_type, source_id, SQL SELECT, chart_type, …}`.
  - **Server dry-run + validate** (`lib/dashboard-build.ts` + pure, unit-tested `lib/dashboard-plan.ts`): every panel is shape-checked, its query passed through the same read-only whitelist as `query_database` (rejects non-SELECT, stacked statements), bounded with a preview `LIMIT`/`TOP`, executed read-only via the existing panel executor path, and classified `data | empty | error | invalid` with a real row sample. `{{time_from}}/{{time_to}}` panels run against a default 30-day preview window.
  - **Proposal card in chat** (`DashboardProposalCard`): a grid of live-preview tiles, each with a green/amber/red verdict, the reason when empty/error, and a sample of real rows. Per tile: include/exclude, edit title/chart/SQL. **Save** persists the included panels via the existing `create_dashboard` / `add_panel` actions and opens the new dashboard. Nothing is written until you save.
  - 22 unit tests for the plan logic (read-only guard, preview-limit for every dialect, result classifier, plan/panel validation); `build_dashboard` added to the build-phase tool set so it's never starved by the tool budget. Database (SQL) sources this phase; API/PRISM planning is a later phase.

## [1.3.77] - 2026-10-19

### Hardened
- **Semantic dictionary made bulletproof against hostile/oversized input** — found by an adversarial test pass against the live v1.3.76 deployment before building the programmatic (chat) writer on top of it. Three real robustness gaps closed in `/api/semantic` upsert + `lib/semantic.ts`:
  - **Description length cap** — descriptions are now sanitized and bounded to 500 chars at rest (a 20,000-char value was previously stored verbatim). `sanitizeDescription()` also strips control characters and collapses all whitespace (newlines included) to single spaces, so stored values are single-line, bounded, and free of the newline/control shape a prompt-injection attempt in sample data could otherwise carry through the AI drafter into a system prompt. `clip()` applies the same stripping again at prompt-build time (defence in depth).
  - **Item-count cap** — an upsert of more than 500 items is rejected 400 (2,000 items were previously all accepted → table/prompt bloat).
  - **Object-key cap** — an `object_key` over 300 chars is rejected 400 (a 5,008-char key was previously stored).
  - **source_type allow-list** — must be one of database/api/file/prism, else 400.
  - **Prompt-budget guard** — `columnGloss` now glosses at most 40 columns per table, so a very large dictionary cannot starve the schema block.
  - Confirmed already-correct (unchanged): empty/whitespace description clears the entry; generate on a bad/non-SQL source returns a clean 400 / empty draft without crashing; duplicate keys in one payload are last-wins; unknown action → 400. 6 new unit tests (15 total in `lib/semantic.test.ts`).

## [1.3.76] - 2026-10-19

### Added
- **Semantic schema dictionary — plain-language table/column descriptions that make NL→SQL reliable on cryptic industrial schemas.** This is Phase 1A of the conversational dashboard builder (design: `claude/mosaic-dashboard-chat-builder-design.md`), but it improves every AI query path immediately (chat, PanelBuilder, future dashboard builder). It complements the existing `metric_definitions` business-metric layer: that one holds metrics/entities/terms, this one holds the data-dictionary — what an opaque column like `kWh_sf`, `v1n`, `mb_error` or `machine_status` actually means.
  - **New `semantic_descriptions` table** (migration 018): per-source table/column descriptions, unique on `(source_type, source_id, object_key)`.
  - **Woven into the schema block the model already sees** (`formatSchemaForPrompt` now takes a hints map): each described table is annotated and described columns get a compact gloss, so the model stops guessing at opaque names. Degrades silently to the plain schema when no descriptions exist. Loaded in the chat route's schema injection (`lib/semantic.ts`, unit-tested).
  - **AI auto-describe (propose → confirm loop):** `/api/semantic` `generate` pulls the real schema + sample rows and makes one bounded model call to draft a description per table/column; the user reviews, edits, and saves (`upsert`). Same propose→confirm pattern as the data-source "Test with AI" flow. CRUD + generate are admin-gated; reads are available to any signed-in user so the dictionary feeds everyone's queries.
  - **UI:** a "Describe" action on each database connection in Settings → Databases opens a dictionary editor (`SemanticDescriptionsModal`) — "Describe with AI", edit inline, save.

### Fixed
- **Chat media uploads: hardened ingestion to end "network error" / silent drop-offs.** Uploaded images and documents *were* reaching the model (images → native vision, docs → server-side text extraction), but ingestion failed in ways that looked like a network error or a file that simply did nothing. Root causes and fixes:
  - **HEIC/HEIF photos (the iPhone default) silently failed.** They matched neither the image whitelist nor a document type, so they fell into the text extractor, returned "no extractable text," and the turn appeared to do nothing — and Claude's vision API can't read HEIC anyway. The client now **transcodes HEIC→JPEG** in-browser (works on iOS/Safari via canvas); if the browser can't decode it, the file is **rejected with a clear message** ("re-send as JPEG/PNG") instead of vanishing.
  - **Full-res images 400-ed the whole request.** No size/dimension guard meant a large photo could exceed Anthropic's per-image limit and fail the entire turn with a generic error. The client now **downscales images to ≤1568px long edge and re-encodes** (PNG stays PNG for crisp screenshots; others → JPEG) before upload; the server re-checks decoded size as a backstop.
  - **Many multi-MB images in one JSON body stalled/reset the POST.** Downscaling plus a per-file size cap, a 20-file count cap, and a combined-payload ceiling keep the request well-bounded.
  - **No read-error handling and no send-gating.** `FileReader` had no `onerror`, and nothing blocked *send* until async reads finished, so a file could be dropped or a message sent without its attachment. Reads now surface errors, each attachment shows a **pending spinner / red "failed" chip with the reason**, send is disabled while any file is preparing, and **image-only messages (no text) can now be sent**.
  - **Server is now a loud safety net:** every unusable file (HEIC, unsupported image type, oversized, unreadable, or truncated document) becomes a **visible notice in the turn** instead of a silent drop or a misrouted document (`lib/attachments.ts`).
  - New shared, isomorphic limits/classifier module (`lib/attachment-limits.ts`) is the single source of truth for both client and server, with unit tests (`lib/attachment-limits.test.ts`).

## [1.3.74] - 2026-10-17

### Fixed
- **Critical: Google (and any role-less) SSO login no longer demotes admins to `user`.** The SSO role-federation code was written for Keycloak — it reads roles from `realm_access.roles` / `resource_access[...].roles`. Google OIDC tokens carry no such claims, so `ssoRoles` was always empty, which the code treated as "no admin role → set `user`," overwriting the stored role on every Google login. Audit trail confirmed a real demotion (`SSO_ROLE_ASSIGNED … previous_role: admin, new_role: user, sso_roles: []`). Fix: role federation now only takes effect when the IdP **actually asserts roles**; an IdP that asserts none leaves the Mosaic-managed role untouched (`app/api/auth/callback/[provider]/route.ts`, decision extracted to tested `lib/sso-role.ts`). Keycloak federation — including legitimate demotions — is unchanged.



### Added
- **Mobile: Phase 1b — comprehensive responsive pass across every page.** Building on the chat shell (1.3.72), the rest of the app is now phone-usable:
  - **AppShell** (the shared nav behind Dashboards, Reports, Query Builder, Rules, Connectors) gets the same mobile treatment: sidebar → slide-over drawer with a hamburger top bar (section title shown), backdrop, auto-close on navigate. One change, five pages fixed.
  - **Settings** gets its own drawer + hamburger top bar (shows the active tab), and its content padding tightens on mobile.
  - **Fixed multi-column layouts collapse on phones:** the dashboard panel grid (4-col → 1), the Rules grids (3/4-col → 1–2 col), via a global `@media` rule that overrides the components' inline grid columns (`data-panel-grid` / `data-rgrid` / `data-rgrid-2`).
  - **Two-pane editors stack:** the report Template Builder's fixed 320px side panel drops below the editor on mobile (`data-rsplit`), and the page scrolls instead of clipping.
  - Data tables (Reports, dashboard query tables) already scroll horizontally; modals already cap at viewport width — left as-is.
- Shared `useIsMobile` hook (`lib/useIsMobile.ts`) now drives all three shells (chat, AppShell, settings).

### Note
- This makes every page navigable and readable on a phone. Per-tab polish inside the heaviest Settings sub-tabs (Databases/APIs builders) and true mobile-optimised data entry are follow-ups, as is Phase 2 (SSE reconnect/resume + Web Push).

## [1.3.72] - 2026-10-16

### Added
- **Mobile: Phase 1 — installable PWA + mobile chat shell.** Mosaic now installs to a phone's home screen (web manifest, maskable icons, Apple touch icon, `black-translucent` status bar) and runs full-screen standalone, with a conservative service worker that caches only static assets + an offline fallback page (never API or authenticated HTML). The chat surface is now phone-native below a 760px breakpoint: the sidebar becomes a slide-over **drawer** (hamburger in a mobile top bar, backdrop, auto-closes on select/new chat), the file/map/research panels open as **full-screen sheets**, the composer docks to the bottom with home-indicator safe-area padding, message gutters tighten, and the desktop resize handles don't render. Desktop above the breakpoint is byte-for-byte unchanged.
- The root layout now sets the mobile **viewport** (`width=device-width`, `viewport-fit=cover`, per-mode `theme-color`) — previously absent, which made the app render desktop-zoomed on phones — plus safe-area CSS vars and `100dvh` sizing.

### Note
- This is Phase 1. Phase 2 (SSE reconnect/resume so long reports survive a screen-lock, and Web Push) and an optional Phase 3 (Capacitor store wrapper) are planned separately.

## [1.3.71] - 2026-10-15

### Added
- **Chat folders.** Organise conversations in the sidebar into per-user folders. A "New folder" button sits above the chat list; folders are collapsible (with a count), rename in place, and delete (chats inside move to Ungrouped, not deleted — collapse state persists per browser). Each chat has a hover menu to move it into a folder, create a folder and move it there, or remove it from its folder. Backed by a new `chat_folders` table + `conversations.folder_id` (migration `017_chat_folders.sql`, plus setup for fresh installs), a `/api/folders` CRUD route, and `PATCH /api/conversations/[id]` extended to move a chat between folders.
- **Resizable panels.** The sidebar and the right-hand panel (file preview / map / research workspace) now have draggable dividers, and their widths persist per browser (`localStorage`). Sidebar clamps 200–460px, the right panel 320–1100px; the sidebar collapse toggle still works.

## [1.3.70] - 2026-10-15

### Note
- Re-release of **1.3.69** under a fresh tag. The `v1.3.69` tag was accidentally created on the previous commit (the v1.3.68 HEAD) before the chat-budget commit was pulled, so it would have shipped the wrong code. No code changes beyond 1.3.69 — the chat anti-silent-failure + phased tool-call budget fix below is the payload.

## [1.3.69] - 2026-10-15

### Fixed
- **Chat turns can no longer fail silently, and data-heavy reports no longer get cut off by the tool-call budget.** A "last 1 month" report hit the agent's hard `TOOL_CALL_BUDGET` (was 20) during data-gathering; the loop then forced a no-tools synthesis turn *before* the report was built, that turn produced no text, and — because the message is only streamed/persisted when it is non-empty — the user got a blank reply with no error. Two fixes in `app/api/chat/route.ts`:
  1. **Anti-silent-failure guard.** If a turn ends with empty output, the user now gets a clear message (tool-call limit reached; narrow the request or reply "continue") that is also persisted — never a blank reply.
  2. **Phased, less brittle budget** (`lib/chat-budget.ts`). The budget is raised 20 → 40 and made env-configurable (`CHAT_TOOL_CALL_BUDGET`). Approaching the cap, the model is nudged to stop opening new sources and build the deliverable. At the cap it enters a **build phase** where only deliverable tools (`run_code`, `render_chart`, `render_map`) are allowed for a small grace (6 calls), so a report is actually built from gathered data instead of being cut off between gathering and building. Only past that grace does it hard-stop to prose.

## [1.3.68] - 2026-10-15

### Added
- **"Discover" in the AI builder's Endpoints pane — multi-source endpoint discovery.** Fixes the *under-coverage* side of the problem (a connection that saved only 1 endpoint). Discovery now tries, in order: (1) an authenticated OpenAPI/Swagger spec, then (2) the server's own **route map** — a Django DEBUG 404 page lists every registered URL pattern. Whatever it finds is run through the deterministic validator, so only real, data-returning collections are proposed. The result shows the source ("via OpenAPI spec" / "via server route map"), a monochrome list of the data endpoints found (with record counts and the detected records key), and a one-click **"Add N endpoints"** that merges them into the draft (de-duped, carrying the records key as `pagination_data_path`). New `discover_endpoints` action (`app/api/api-builder/route.ts`) + `lib/api-discover.ts` (`discoverEndpoints`, `parseDjangoDebugRoutes`, `selectCollectionPaths`). One shared login across the whole sweep (single-flight).

### Why
- The same root cause as 1.3.67, from the opposite side: endpoint *discovery* is unreliable when an API has no reachable machine-readable spec (FactoryOS gates `openapi.json` behind a superuser session), so the agent improvises and under- or over-captures. The FactoryOS route map exposes ~748 real routes, and crucially shows the real data collections are **deep paths** (`mes/assets/oee/`, `core/tenants`) — not the module roots (`/mes`, `/core`) that were being saved and 404ing. Discovery + validation together now yield the real collections, generalising to any API that hides its spec.
- **Scope note:** the route-map source reads Django's DEBUG URL dump, which only exists when `DEBUG=True` (dev/on-prem); a locked-down production app hides it, and there the spec path carries discovery. The UI always names which source found the endpoints.

## [1.3.67] - 2026-10-15

### Added
- **"Validate all" in the AI builder's Endpoints pane.** One click probes every registered endpoint group with a cheap authenticated GET and classifies what actually came back — separating *connected* (auth works) from *serves data* (a real, reachable collection). Each endpoint gets a monochrome status glyph (✓ data · ○ reachable-but-empty · ✕ no data · ⦸ auth · ! error) with the detail in a tooltip, plus a roll-up summary ("3 return data · 40 no data") and a one-click **"Remove N with no data"** to prune dead module-prefix endpoints. A data endpoint also unlocks Publish. Backed by a new deterministic `validate_endpoints` action (`app/api/api-builder/route.ts`) and `classifyProbe` (`lib/api-probe.ts`); the whole sweep shares one login (single-flight) so validating 40+ endpoints doesn't stampede the auth endpoint.
- **AI-led "Test with AI" in the Test & result pane.** Replaces the manual path-typing probe as the primary action: Mosaic picks a real, data-returning path under the selected endpoint group, fills any required query params / path variables itself, probes it, and shows the response here with its reasoning in Ask & refine. The old manual probe (method + path) is still available under an "Advanced" fold.

### Why
- Two attempts at the same FactoryOS API showed the same underlying bug from opposite sides: one connection saved **43** endpoints (40 of them module prefixes that 404), another saved just **1** (discovery truncated). Root cause: endpoint *discovery* is unreliable when an API has no machine-readable spec (FactoryOS gates its OpenAPI schema behind a superuser session), so the agent improvises the endpoint list. The fix separates best-effort *discovery* ("which endpoints exist") from deterministic *validation* ("which endpoints actually return data"), making a connection's real coverage visible and prunable regardless of how it was discovered — and removes the need to type non-obvious probe params by hand.

## [1.3.66] - 2026-10-14

### Removed
- **"Check all sources" button in Settings → Data sources** (and its `/api/datasources/health` endpoint) — it duplicated the in-chat `check_data_sources` health check. The chat health card and the tool remain the single way to run it.

## [1.3.65] - 2026-10-14

### Fixed
- **The AI builder now exposes a "Login URL" (and "Token path") field for `session_token` APIs.** Previously the only editable fields for session-token auth were Username and Password — there was no way to enter the **login URL**, which that auth type requires, so an edited connection could never be made to work from the form (the Base URL shown on the left is read-only). `CRED_FIELDS.session_token` now includes `login_url` and `token_path` (both non-secret, so they don't block Probe), and the new-build path prefills these from the AI's candidate so they aren't blanked. Editing a session-token service now shows its Login URL / Token path, ready to fill or fix.

## [1.3.64] - 2026-10-14

### Changed
- **Removed the "Try" buttons from API connections** (service and per-connection) — live testing is already in the AI builder's Probe step, so Try was redundant.
- **A re-published API service no longer shows a stale "Auth broken" badge.** `upsertApiSource` now resets `auth_status`/`last_auth_error`/`last_auth_check` when a service is updated, so after you edit and republish a connection its health shows neutral until the next real call sets it accurately — instead of keeping the pre-fix "broken" status.

### Fixed (operational note)
- A connection using `session_token` auth needs a **login URL**, not just username/password. The old manual edit form had no field for it, so "fixing credentials" there left `login_url` missing and auth still broken. Editing via the AI builder (now the default) surfaces the login URL as a required field.

## [1.3.63] - 2026-10-14

### Removed
- **Dead `apply_fix` action** in `app/api/api-builder/route.ts` — it was only called by the removed Diagnose panel (and was the source of the "candidate.service required" error). Dropped it and its now-unused imports (`upsertApiSource`, `ApiServiceConfig`, `mergeStoredSecrets`, `audit`/`AUDIT`). The `diagnose` action stays — the builder's "Ask & refine" chat still uses it.

## [1.3.62] - 2026-10-14

### Changed
- **Editing an API connection now opens the AI builder — "Diagnose" removed.** The Diagnose panel (and its `apply_fix` flow, which was erroring with "candidate.service required") is gone. The **Edit** button on a published API service now opens the same **"Add with AI"** builder used to create it, pre-loaded with the service's saved configuration and credentials. You describe what's wrong (or edit the fields), the AI probes the live API and refines the config, and publishing updates the service **in place** (same id). This turns "fix a broken connection" into the same AI-assisted flow as creating one — e.g. add Dev FactoryOS's missing login URL + credentials, probe, republish. `DiagnosePanel` was removed. (Note: republishing re-writes the service's connections, so any per-connection `auth_override` is not preserved across an AI edit; service-level auth is.)

## [1.3.61] - 2026-10-14

### Added
- **Structured health card for `check_data_sources` — in chat and in Settings.** The health check used to come back as a wall of prose. Now its result renders as a compact, scannable **Source health** card: a `{ok}/{total} reachable` summary, sources grouped into **Needs attention** (first) and **Working**, each with a color-coded status dot (green/amber/red), type chip, latency and a one-line detail. In chat the card renders automatically from the tool result and the assistant replies with just a one-line headline + the single next action (it no longer re-lists every source). The same card is available in **Settings → Data sources** behind a **"Check all sources"** button (new `GET /api/datasources/health`, which runs the same bounded, one-probe-per-service check). New reusable `components/SourceHealthCard.tsx`.

## [1.3.60] - 2026-10-14

### Added
- **Bounded tool executor.** The chat loop could emit many tool calls in one turn and ran them through an unbounded `Promise.all`, which stampeded shared resources (connection pools, per-host rate limits, auth logins). Tool fan-out now runs through `mapLimit` with a capped concurrency (`TOOL_FANOUT_CONCURRENCY`, default 6, env-overridable) — a wide turn degrades to "slower", not "mass timeouts". The model can still batch parallel fetches; only how many execute at once is bounded. New `lib/concurrency.ts` (+ tests: order preserved, concurrency cap never exceeded, still parallel).
- **`check_data_sources` health tool — a real "are my sources accessible?" path.** Replaces the pattern where the model fired a separate query per connection (the stampede trigger). One tool call now health-checks **every** configured source — databases, API services, Prism, MCP servers, file servers — with bounded concurrency, a short per-probe timeout and a hard backstop, reusing the existing probes (`runCandidateProbe`, `getPrismToken`, `testMcpEndpoint`, a DB `SELECT 1`, a file-server reachability list). It probes **once per service** (single-flight login), not once per connection, and returns each source's status (`ok` / `auth_failed` / `degraded` / `down`), latency and a short detail, plus a summary. The system prompt routes "list/check all data sources" and "which are up/down" to it. Honours pinned-source scoping.

## [1.3.59] - 2026-10-14

### Fixed
- **Datasource auth login now honours the configured request timeout (was hardcoded 10s).** After the stampede fix (v1.3.58), a single login could still time out: the *data* request already used each service's `request_timeout_ms` (30s by default), but the login handshake was hardcoded to 10s. A real credentialed login (DB lookup + password hash + token mint) on a small or loaded upstream can exceed 10s even though the endpoint is reachable (verified: the failing login endpoint validates in ~120ms but the full credentialed login runs longer). `getSessionToken` / `getOAuth2AccessToken` / `getPrismToken` now take the service's timeout (threaded via `applyAuth` from `call_api`), the default is raised from 10s to 20s, and it's clamped to a 5s–60s range. Tests assert the timeout is threaded through (`AbortSignal.timeout` called with the configured value / the 20s default).

### Note (not a code issue)
- The "Dev FactoryOS" connection is recorded as `broken: session_token auth requires login_url` — it simply has **no login URL configured** in its connection settings; set that for it to authenticate. "API source" (myfactory) and Prism were login *timeouts*, addressed above.

## [1.3.58] - 2026-10-14

### Fixed
- **Datasource auth login stampede — mass "The operation was aborted due to timeout" when checking many sources at once.** API connections (session_token / OAuth2) and Prism authenticate with a login handshake before the first call, and the token is cached only *after* a successful login. When many connections that share one auth service were queried in the same turn (e.g. "list all data sources and check they're accessible"), the token was cold so **every** concurrent caller missed the cache and fired its own login simultaneously — stampeding the external auth endpoint until all of them hit the 10s timeout. The datasources were not actually down (connectivity to each was verified healthy); it was a thundering herd of logins.
  - Fix: **single-flight** on all three token paths (`getOAuth2AccessToken`, `getSessionToken`, `getPrismToken`) in `lib/api-auth.ts` — concurrent cold-cache logins for the same service now collapse into one in-flight request; the first logs in and the rest await that result. Regression test (`lib/api-auth.test.ts`): 25 concurrent cold logins for one service → exactly 1 login call.
  - Note: this collapses the common case where connections share an auth service. A "check all data sources" that spans many *distinct* slow external services could still be slow; a dedicated bounded-concurrency health check is a possible follow-up.

## [1.3.57] - 2026-10-14

### Fixed
- **Memory settings tab no longer looks cramped / edge-to-edge.** The shared `Card` primitive has no internal padding, and the Memory composer and list placed their inputs directly inside it, so fields sat flush against the card border with no margin. Added proper internal padding, and redesigned the tab: the category picker is now a **segmented control** (Preference / Fact / Project shown at once instead of a dropdown), a **saved count** sits next to the "Saved memories" header, the "Add memory" button is a primary action aligned right, and the empty state is a real placeholder card instead of a bare line. No API/behaviour change.

## [1.3.56] - 2026-10-14

### Changed
- **Deep Diagnose survives a synthesis failure.** If the final RCA synthesis call fails (model/network error), the run no longer loses everything — it now falls back to surfacing the **supported hypotheses (highest-confidence first) as the ranked causes**, so the engineer still gets the per-hypothesis verdicts and evidence that already ran, with a clear note that synthesis didn't complete.

### Tests
- **Deep Diagnose extreme-test pass** (`tests/research/diagnose-extreme.test.ts`, 19/19): malformed/absent `===VERDICT===` and `===CAUSES===` JSON, invalid verdict values, out-of-range/non-numeric confidence clamping, non-array evidence, empty plan → fallback hypothesis, overflowing plan capped at MAX_H, **sub-agent failure isolation** (one hypothesis' model call throws, siblings still resolve), the **synthesis-failure fallback** above, tool-budget exhaustion → forced verdict, `strictSources` blocking an unscoped source-tool call, and read-only governance (sub-agents never get `run_code`/write/recursion tools).
- **CI is now trustworthy:** fixed a stale `lib/rca.test.ts` assertion (`'oee'` is intentionally an RCA keyword) — full vitest suite green (109 tests) — and wired the standalone tsx suites (`tests/research/*`, `tests/map/*`) into the CI Test gate via a pinned `tsx`, so a regression in deep_research / deep_diagnose / render_map / the heartbeat & workspace snapshots now fails the build.

## [1.3.55] - 2026-10-14

### Fixed
- **The Research/Diagnosis workspace panel can now be reopened — it is no longer lost once closed or after a reload.** Previously the panel was driven only by transient live state (`research`), which held just the latest run and was never persisted, so closing the panel (or reopening the conversation from history) left only the main-chat text with no way back to the sub-agent workspace. Now `runResearch` / `runDiagnose` return a serialisable **workspace snapshot** (mode, each sub-agent's headline/bullets/source-links or verdict/confidence, ranked causes + checks for diagnose, counts), the chat route streams it in the tool result **and persists it on the assistant message** (`tool_calls`), and the "Research workspace / Diagnosis workspace" chip under each message reopens the panel from that per-message snapshot. Works for multiple research messages in one conversation and survives a page reload; during an in-flight run the chip falls back to the live state.
  - Verified: `tests/research/workspace.test.ts` (16/16) — snapshot shape for both research and diagnose, structured finding + source links preserved, ranked causes/checks preserved, and JSON-serialisability. Research (24/24), finding (10/10), diagnose (9/9) and heartbeat (18/18) suites still green.

## [1.3.54] - 2026-10-14

### Added
- **Collapsible sub-agent cards + overall progress bar in the Research/Diagnosis workspace.** Each sub-agent (and each diagnose hypothesis) card now collapses to a single header row — chevron, title, status badge — and **starts collapsed by default**, so a run with several sub-agents is scannable at a glance instead of a long scroll of findings. Click any card to expand its working + output; an **Expand all / Collapse all** control sits by the section header. A **progress bar across the top of the panel** fills as sub-agents complete (8–90% during the run, ~95% while synthesising, 100% done), with the live percentage shown in the header subtitle. Collapsed running cards keep a pulsing status dot so liveness is still visible. Same component powers both the research and diagnose panels.

## [1.3.53] - 2026-10-14

### Changed
- **Research sub-agent findings are now structured, not a wall of text.** Each research sub-agent ends its final message with a `===FINDING===` JSON trailer — a one-line **headline** (the key takeaway) plus up to five **key-fact bullets** (figures, named players, specific facts) — mirroring the `===VERDICT===` pattern the diagnose sub-agents already use. The Research workspace panel renders the headline, the bullet list, and the sub-agent's **top sources as clickable chips**, instead of dumping the raw model prose into one unstyled block. The prose summary is still kept (trailer stripped) and fed to the synthesis step, so the final briefing is unchanged. Parsing is best-effort: a sub-agent that omits the trailer degrades gracefully to its raw summary — no headline/bullets, same as before.
  - Verified by a fake-model test pass: `tests/research/finding.test.ts` (10/10) — headline/bullets parsed, marker stripped from both headline and summary, bullets kept short, source chips emitted, and the no-trailer fallback. Research orchestrator (24/24) and SSE heartbeat (18/18) suites still green.

## [1.3.52] - 2026-10-14

### Fixed
- **Long research/diagnose runs no longer drop with "Error: network error".** A `deep_research` / `deep_diagnose` turn has silent windows where the server is awaiting a single long model call and emits no SSE events — the lead planning call, a sub-agent mid model-round, and above all the **synthesis gap** between `research_synthesizing` and `research_done`. Safari (and some proxies) tear down a streaming fetch that goes idle during those windows; the client's reader threw, and because no assistant text had streamed yet the catch wrote `Error: <message>` into the empty bubble (on Safari, literally "network error"). The server kept working — the v1.3.43 `cancel()` guard turned the disconnect into a clean no-op, so nothing was logged — but the user saw a failed run even though sub-agents had produced real findings.
  - Fix: a lightweight **SSE heartbeat** (`{type:'ping'}` every 10s) runs for the life of every chat stream and is cleared in `finally`, so the connection is never idle long enough to be dropped. The client ignores unknown event types, so pings are harmless. Also set `X-Accel-Buffering: no` on the response as belt-and-suspenders against any buffering proxy (Caddy already auto-flushes `text/event-stream`). No version-gating — this is a pure reliability fix that applies to all long turns (including `run_code`).

## [1.3.51] - 2026-10-14

### Added
- **Deep Diagnose — multi-agent root-cause analysis (Phase 3.1).** For an equipment fault/breakdown, a new `deep_diagnose` tool runs a diagnostic variant of the research orchestrator: the lead forms 3–6 **testable failure-mode hypotheses** (telemetry, alarms, maintenance, neighbouring assets, setpoints, sensor quality), each **hypothesis sub-agent** tests one against your telemetry/alarms/history data in parallel and returns a **verdict (supported / refuted / inconclusive) + confidence + evidence**, and synthesis produces **ranked probable causes with confidence, evidence, and recommended next checks**. The right panel is a live **Diagnosis workspace** — hypothesis cards with verdict badges and confidence bars, resolving into the ranked-cause board. Streams the same workspace events in `diagnose` mode.
  - **Scope hardening (folded in from the sub-agent review):** diagnostic sub-agents are given the **data-source catalog** in their prompt (so they can target internal data), and run with **`strictSources`** — when a source scope is active, a data tool must name an explicit in-scope source (no implicit "resolve your own target" fall-through). The `strictSources` guard was added to `runTool` and is used only by diagnostic sub-agents; the main chat is unchanged.
  - Verified by a fake-model test pass (9/9): hypothesis planning, verdict/confidence parsing, ranked-cause + checks parsing, event ordering in diagnose mode, and both strict/non-strict scope-guard behaviours.

## [1.3.50] - 2026-10-14

### Fixed
- **`fetch_url` now decodes HTML entities in the page title** (e.g. `Hi &amp; Bye` → `Hi & Bye`), matching the body text. Found by the Phase 3 extreme test pass.

### Changed
- Deep-research orchestrator (`lib/research.ts`) is now dependency-injectable (Anthropic client + tool executor) so the full orchestration can be tested deterministically. Added `tests/research/` — 24 orchestrator cases (planning, sub-agent loop, budget cap, concurrency, source de-dupe, synthesis, event ordering, failure isolation, read-only isolation) + a 9-case `fetch_url` suite (content extraction, truncation, redirects, and a 13-URL SSRF matrix). 33/33.

## [1.3.49] - 2026-10-14

### Added
- **Deep research with sub-agents (Phase 3).** For broad / comparative / multi-part questions, Mosaic now runs a `deep_research` investigation: a lead pass decomposes the question into 3–6 focused sub-tasks, each sub-task runs its own bounded, read-only agentic loop (a "sub-agent") in parallel, and a final pass synthesises a **cited briefing**. The right-side panel becomes a live **Research workspace** — the lead agent and each sub-agent with its status (queued → researching → done), the tool it's using right now, and its finding — streamed as it happens (new SSE events `research_plan` / `subagent_status` / `subagent_result` / …). Results come back as a report + numbered sources in chat, and can be turned into a PDF/map.
  - Governance: sub-agents get **read-only research tools only** (web_search, fetch_url, query_database/query_prism/call_api/read_file_server/query_airbyte/query_mcp/combine_sources/stats) — never write actions, `run_code`, memory, or `deep_research` itself (no recursion). Budgets: 2–6 sub-agents, ≤6 tool calls each, 3 running concurrently; the whole run is audited.
- **`fetch_url` tool.** Reads a named public web page's text (HTML stripped, truncated) — complements keyword `web_search` for reading a concrete URL. **SSRF-guarded**: http(s) only; blocks loopback, private/link-local IPs, cloud metadata (169.254.169.254), single-label internal docker hostnames, `.local`/`.internal`, and disallowed redirects. 13/13 guard tests pass.

## [1.3.48] - 2026-10-14

### Fixed
- **Hardened `render_map` coordinate handling (found by the Phase 2 test pass).** The tool now accepts only a real number or a non-empty numeric string for lat/lng — `null`, `undefined`, `''`, `NaN`, booleans and objects are dropped instead of being coerced to `0` (which would have plotted a stray marker at the equator). The map component also guards each marker individually, so one malformed point can never collapse the whole map to the fallback list. Verified by an extreme test pass — 16/16 tool-logic cases + 7/7 headless-browser rendering/fallback cases (markers, escaped popups/XSS, offline-tiles note, Leaflet-unavailable list fallback, 500-point load). Test harness under `tests/map/`.

## [1.3.47] - 2026-10-14

### Added
- **Interactive map in the preview panel (Phase 2 — interactive artifacts).** The right-side panel now renders interactive artifacts, not just files. First one: an interactive **Leaflet map**. A new `render_map` tool plots locations (plants / sites / devices) the model fetched from your data — pan, zoom, click a marker for its label/detail. It opens automatically in the panel, and a map chip in the message reopens it.
  - **Graceful degradation** (for on-prem/air-gapped installs): OpenStreetMap tiles when online; if tiles can't load, markers still render on a plain background with an "offline basemap" note; if Leaflet itself can't initialise, it falls back to a scrollable location list. Never a blank panel.
  - Vector circle markers (no image assets, so no broken-icon issues). `render_map` validates coordinates (lat −90..90, lng −180..180), drops invalid points, caps at 2000, and clamps zoom; it never geocodes server-side (the model must supply real coordinates).
  - The panel is now a generic artifact surface (file | map), so Phase 3's live research/sub-agent view drops into the same slot.

## [1.3.46] - 2026-10-14

### Added
- **Cross-conversation memory (Phase 1 of the chat roadmap).** Mosaic can now remember durable facts about a user across chats — preferences (how they like answers), facts (their terminology, which sites/APIs/devices matter), and project context. Saved explicitly via `remember…` / `forget…` in chat (new `save_memory` / `forget_memory` tools) or on a new **Settings → Memory** page (view / add / edit / delete). Memory is injected as a compact block into the chat system prompt at the start of each turn.
  - Per-user isolation (never shared across users); each user only sees and edits their own memory. New `user_memory` table (migration 016 + setup baselines) and owner-scoped `/api/memory` CRUD.
  - A privacy filter keeps obviously-sensitive content out of the store (passwords, API keys, card/account/ID numbers, health details), on both the tool and the settings page. Per-user caps (200 items, 500 chars each) and exact-duplicate de-dupe.
  - Auto-learning (extracting facts automatically at end of chat) is intentionally deferred to a later, flag-gated phase; v1 is explicit-save only.

## [1.3.45] - 2026-10-14

### Fixed
- **Stray `fontlist-vNNN.json` returned alongside real `run_code` output.** When code used matplotlib, its font cache was written into the sandbox work dir (where `HOME` pointed) and then captured as a "produced file", so a plot or PDF-with-chart came back with an extra JSON file. Matplotlib's cache now lives at `MPLCONFIGDIR=/opt/mplconfig` (outside the work dir, pre-warmed at image build so the first plot is fast), and the file-capture step now prunes hidden dirs/files and `__pycache__`/`.pyc` as a safety net. Verified that every format (png, xlsx, docx, pdf, pptx, csv, json, html, txt, Node) returns exactly the intended file(s) and nothing else.

## [1.3.44] - 2026-10-14

### Added
- **In-chat file previewer (Claude-style right-side panel).** Clicking any file produced by `run_code` (or an inline image) now opens a docked preview panel instead of a raw download. A generic renderer registry keyed by extension/MIME handles images, PDF, Markdown, code/text, JSON (pretty-printed), CSV/TSV, XLSX (with sheet tabs), and HTML (rendered in a script-disabled sandboxed iframe). Every type falls through to a download card when it can't be previewed, is over a 2 MB inline cap, or fails to parse — so it degrades gracefully rather than breaking. Download stays one click away from the panel header. Front-end only; reuses the existing `/api/files/<id>` endpoint.

## [1.3.43] - 2026-10-14

### Fixed
- **Chat stream crashed with "Controller is already closed" → browser showed "Load failed".** The SSE `send()` enqueued with no guard and the stream had no `cancel()` handler, so if the client connection dropped mid-turn (navigation, a network blip, or a proxy/browser timeout — more likely on a longer `run_code` turn) the next `send()` threw and errored the whole response, which the browser surfaced as "Load failed" even though the file had been produced. `send()` now no-ops once the controller is closed, a `cancel()` handler marks the stream closed on client disconnect, and the agentic loop stops early when the client is gone. Surfaced by a `run_code` spreadsheet request on the live box.
- **Sandbox `/work` not writable by the non-root user.** The `tmpfs` mount at `/work` overrode the image's directory ownership, so the sandbox user (uid 10001) got `PermissionError` creating its per-run work dir and every `run_code` call returned 500. The mount is now `mode=1777` (world-writable + sticky, like `/tmp`). Compose-only change; caught verifying the v1.3.42 deploy on the live box.

## [1.3.42] - 2026-10-14

### Added
- **Code execution + file generation in chat (`run_code`).** Mosaic can now run real Python (or Node.js) in a secure, network-isolated sandbox to *produce files*: spreadsheets (xlsx/csv), Word/PDF reports, chart images, format conversions, and genuine data analysis on data it already fetched. Files written by the code are captured and shown in the chat as download chips (images render inline), served owner-checked from `/api/files/<id>` and auto-expiring after 7 days.
  - New isolated sandbox sidecar (`mosaic-sandbox`, services/sandbox): FastAPI runner on a network-cut Docker network (`internal: true`), non-root user, `no-new-privileges`, tmpfs workdir, and per-exec CPU/memory/file-size/process rlimits with a hard timeout. Bundles pandas, numpy, scipy, matplotlib, openpyxl, XlsxWriter, python-docx, python-pptx, reportlab, fpdf2, Pillow.
  - The sandbox has **no internet and no access to any data source** — the model must fetch data first (query_database/call_api/query_prism) and embed it in the code, so execution stays sealed.
  - New `generated_files` table + storage (migration 015; bytes on the `/data` volume, metadata/ownership in DB) and a download endpoint with inline/attachment handling.

> Deploy note: this release adds the `mosaic-sandbox` container. The box's `docker-compose.yml` must be updated (new service + `sandbox-net` network + `SANDBOX_URL`) before `docker compose up -d`.

## [1.3.41] - 2026-10-13

### Fixed
- **Chat silently truncated list/telemetry results, hiding records.** Every tool result was capped at 8,000 chars (~2K tokens), so a 101-device Prism list (~12K chars) was cut to ~75 devices — and the model then reported data as "missing" when it simply couldn't see it. The cap is now tool-aware: query_prism 40k, query_database / query_airbyte / call_api 32k, default 12k. The truncation note is clearer that the result is partial, and the history char budget was raised to match.
- **Prism telemetry "fetch failed" on concurrent calls.** `tbGet` made a single fetch with no retry, so when several telemetry calls ran at once against an on-prem gateway it would intermittently return a bare "fetch failed". It now retries transient network failures (3 attempts, backoff) and, if it still can't, returns a clear message explaining the gateway is dropping concurrent requests.

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
