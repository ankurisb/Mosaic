# Google BigQuery connector — security hardening (customer onboarding)

Mosaic queries a customer's BigQuery **read-only**, generating GoogleSQL, authenticating with a
**service-account** JSON key. BigQuery has no transaction-wrapped `READ ONLY` like Postgres, so
the app guard (`lib/sql-guard.ts`) is the first control: it blocks DML/DDL, `EXPORT DATA`
(results → Cloud Storage) and `LOAD DATA` (Cloud Storage → table). But the **authoritative control
is IAM** — the service account's roles. Two egress paths depend on IAM, not on SQL the app can
see: `EXPORT DATA`/`LOAD DATA` to GCS, and **remote/external functions** (a call looks like any
function call). Configure the service account as follows.

## 1. A dedicated read-only service account
Create an SA used only by Mosaic, and grant it the least role that still lets it run queries.

- **On the billing/compute project** (where jobs run, = Mosaic's *Project ID*):
  - `roles/bigquery.jobUser` — create query jobs (no data access by itself).
- **On the data** (dataset or project that holds the tables, = Mosaic's *Default dataset*):
  - `roles/bigquery.dataViewer` — read table data + metadata. Grant it at the **dataset** level
    (or per-table) rather than project-wide when you can, so Mosaic sees only what it should.

```bash
# Billing project: run jobs only
gcloud projects add-iam-policy-binding BILLING_PROJECT \
  --member="serviceAccount:mosaic-ro@BILLING_PROJECT.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

# Data: read-only on just the datasets Mosaic needs (repeat per dataset)
bq add-iam-policy-binding \
  --member="serviceAccount:mosaic-ro@BILLING_PROJECT.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer" \
  DATA_PROJECT:analytics
```
Mosaic's *Default dataset* accepts a **comma-separated list** (`analytics, events`) and
cross-project `data-project.dataset`, so grant dataViewer on every dataset you list. Jobs bill to
the Project ID; the SA just needs read on the data.

## 2. What NOT to grant — the controls behind the guard
A read-only SA with only jobUser + dataViewer has none of these; a security review should confirm
the SA lacks:
- **No `roles/bigquery.dataEditor` / `dataOwner` / `admin`** — those allow writes, DDL, and
  `LOAD DATA`/`EXPORT DATA`.
- **No GCS write (or broad read)** — do not grant the SA `roles/storage.objectAdmin`/`Creator` on
  the buckets `EXPORT DATA` would target, nor broad `storage.objectViewer`. Without GCS write,
  `EXPORT DATA` fails; without the external bucket, `LOAD DATA`/external tables can't read it.
- **No `bigquery.connections.use`** — this is the control for **remote functions** and
  BigQuery-Omni/external connections (the egress path a `SELECT calling a remote function` uses,
  which the app guard cannot distinguish from a normal function call).
- **No `roles/bigquery.readSessionUser` beyond need, no project-wide `dataViewer`** when a dataset
  grant suffices.

Verify:
```bash
gcloud projects get-iam-policy BILLING_PROJECT --flatten="bindings[].members" \
  --filter="bindings.members:mosaic-ro@" --format="table(bindings.role)"
# expect: roles/bigquery.jobUser  (+ dataViewer shown on the dataset/data project)
```

## 3. Query / cost limits
- **Job timeout** — Mosaic bounds every query with the connection's `query_timeout_ms` (passed as
  BigQuery `jobTimeoutMs`, default 120s); BigQuery stops the job server-side on overrun.
- **Maximum bytes billed** — cap scan cost at the project or by a custom quota, so a runaway scan
  can't rack up cost. Consider a BigQuery **reservation** or on-demand with a bytes-billed limit.
- **Key hygiene** — store the SA JSON key in Mosaic only (encrypted at rest). Rotate it on a
  schedule; prefer short-lived keys / workload identity where the deployment allows.

## 4. Network (optional)
Use **VPC Service Controls** to keep the data project inside a perimeter, and a private
`apiEndpoint` (Private Google Access) if the deployment requires BigQuery traffic to stay private.

## Why both layers
- **App layer** (`assertNoDangerousSql`): rejects DML/DDL, `EXPORT DATA`, `LOAD DATA` before the
  job is created — BigQuery has no read-only transaction, so this is the first line.
- **IAM layer** (jobUser + dataset-scoped dataViewer, nothing else): the real boundary — even if a
  query reached BigQuery, the SA can only read the granted datasets and cannot write, export/ingest
  to GCS, or use an external connection / remote function. This is the control to show in a
  security review, and the only control for the remote-function egress path the app can't detect.
