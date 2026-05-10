# API bulk import — implementation plan

Status: Phase 1 shipped. Phases 2–6 pending.

## Goal

Reduce per-customer API setup time from "30 minutes of form-filling per service" to "drop a spec, pick the resources you want, click Import." Critical for SaaS APIs (Zoho Books, Salesforce, HubSpot, Xero) where a meaningful integration covers 30–50 endpoints.

## Architecture

- api_services table: a service (auth + base_url shared across endpoints)
- api_connections table: individual endpoints under a service
- Existing importer in components/settings/TabAPIs.tsx parses Postman v2.1; drop zone wired
- Goal end state: drag a Postman or OpenAPI file → folder/tag tree with checkboxes → pick what you want → connections appear with paths, pagination, data path, base URL, auth all pre-configured

## Phase status

Phase 1: Postman recursive folder traversal + selective import UI — SHIPPED (1d)
Phase 2: Postman variable substitution + smarter auth detection — TODO (0.5–1d)
Phase 3: OpenAPI 3.0 spec parser + tag-level selector — TODO (2d)
Phase 4: Pagination + data-path inference (both formats) — TODO (1.5d)
Phase 5: Endpoint catalog injection into chat system prompt — TODO (1d)
Phase 6: Polish — dedup, edge cases, error handling — TODO (0.5d)

Total remaining: ~6 days of focused work.

---

## Phase 2 — Postman variable substitution + auth detection

PROBLEM
Real Postman collections use template variables like {{baseUrl}}/invoices and {{customerId}}. Our parser doesn't substitute, so we end up with literal {{baseUrl}} in connection paths.
Auth detection is also weak — only handles bearer with token. Misses basic, API key headers, OAuth2.

SOLUTION
1. Parse collection.variable into a map.
2. Substitute {{key}} → value in URLs, headers, auth tokens.
3. Substitute recursively in folder-level variables (folders can override).
4. Expand auth detection to handle bearer / basic / apikey / oauth2 from collection.auth.

FILES TO TOUCH
- components/settings/TabAPIs.tsx — add substitutePostmanVars, expand parsePostmanCollection.

TEST
Create a test collection with {{baseUrl}} and basic auth. Verify substitution + auth fields populate in import preview.

---

## Phase 3 — OpenAPI 3.0 spec import

PROBLEM
Most modern APIs publish OpenAPI specs (richer metadata than Postman). No support today.

SOLUTION
- Add second import path next to Postman drop zone: text input "OpenAPI URL or paste JSON/YAML"
- Fetch URL via new /api/openapi-fetch route to avoid browser CORS
- Parse spec; surface tags as folder groups with checkboxes
- info.title → service name; servers[0].url → base URL; components.securitySchemes → auth detection; paths → connection list grouped by tags
- YAML support via 'yaml' or 'js-yaml' npm package

FILES TO TOUCH
- components/settings/TabAPIs.tsx — new import flow alongside Postman
- app/api/openapi-fetch/route.ts — new proxy endpoint
- package.json — YAML parser

TEST
Use https://petstore3.swagger.io/api/v3/openapi.json. Verify tags become folder groups; all operations import.

---

## Phase 4 — Pagination + data-path inference

PROBLEM
Every imported connection ships with pagination_style 'none' and pagination_data_path ''. User must manually fix per endpoint. For 40+ endpoints that's painful.

SOLUTION — TWO HEURISTICS
Pagination:
  - OpenAPI: read 'parameters' for patterns. page+per_page → page_number. cursor+limit → cursor. offset+limit → offset.
  - Postman: parse query params from URL string. Same patterns.
  - Sample-based: if collection has response examples, look for top-level next_page, has_more, data/results/items.

Data path:
  - OpenAPI: walk responses.200.content.application/json.schema. Look for first array property at top level (invoices, data, results).
  - Sample-based: same logic against example response body.

Be conservative. If uncertain, leave fields blank — never guess wrong. Show inferred values in preview UI so user can override before import.

FILES TO TOUCH
- components/settings/TabAPIs.tsx — inference helpers, surface in preview
- Possibly lib/import-inference.ts — extracted helper module

---

## Phase 5 — Endpoint catalog in system prompt

PROBLEM
Once a service has 40+ connections, Claude struggles to pick the right one. Current system prompt lists only service names and base URLs.

SOLUTION
Inject a condensed endpoint catalog per service into the chat system prompt:
  - Each line: "<connection name>: <method> <path> -- <description>"
  - Built from api_connections.label + api_connections.description
  - Cap at ~50 connections per service to protect token budget; if exceeded, list first 50 and note "more available, ask to list them"

FILES TO TOUCH
- app/api/chat/route.ts — extend apiList builder around line 110 (where fullSystem is composed)

TEST
Add 10+ connections to a service. Ask vague queries like "show overdue invoices". Verify Claude picks the right connection without explicit guidance.

---

## Phase 6 — Polish

- Dedup on re-import: if service with same info.name exists, offer "Replace existing" / "Add as new"
- Better error messages when spec parsing fails
- "(N hidden)" indicator when folder has many endpoints, with show/hide toggle
- Variable substitution: show what was substituted in preview ("{{baseUrl}} → https://api.example.com")
- Friendly "no token detected" handling for OpenAPI security schemes that need flows beyond what Mosaic supports

---

## Out of scope

- Postman environment file imports (separate file, separate UI flow)
- OpenAPI 2.0 / Swagger
- AsyncAPI / GraphQL specs
- Per-operation auth overrides
- Auto-refresh of imported specs

---

## Notes for next session

- All phases land as separate commits. Don't bundle.
- Each phase should be testable end-to-end before merging.
- Phase order matters: 2 before 3 (substitution logic shared); 4 needs 3; 5 needs nothing but is highest user-visible value.
- If short on time, prioritise 3 → 5 → 4. 2 and 6 are nice-to-have.

