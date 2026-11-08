# Databricks connector — security hardening (customer onboarding)

Mosaic queries a customer's Databricks SQL warehouse **read-only** (Thrift/Arrow via
`@databricks/sql`), generating SQL and authenticating with a **personal access token (PAT)** or a
service principal's token. Mosaic's app guard (`lib/sql-guard.ts`) blocks DML/DDL, `COPY INTO`,
`INSERT OVERWRITE DIRECTORY`, and direct path-based file reads (``delta.`s3://…` ``,
``parquet.`/Volumes/…` ``). But the **authoritative control is Unity Catalog RBAC** on the
principal the PAT belongs to. Two egress paths depend on grants, not on SQL the app can see:
reading **external locations / volumes** (via path or an external table), and any
remote/UDF call. Configure the principal as follows.

## 1. A dedicated read-only principal + its grants
Prefer a **service principal** (not a human user) with its own PAT, used only by Mosaic.

```sql
-- Unity Catalog: USE lets the principal see into the catalog/schema; SELECT reads the data.
GRANT USE CATALOG ON CATALOG main              TO `mosaic-sp`;
GRANT USE SCHEMA  ON SCHEMA  main.sales         TO `mosaic-sp`;
GRANT SELECT      ON SCHEMA  main.sales         TO `mosaic-sp`;   -- all current + future tables in the schema
-- repeat per schema; Mosaic's Schema field takes a comma list (sales, marketing) or catalog.schema
```
Also grant **CAN USE** on the specific **SQL warehouse** (the one whose HTTP path Mosaic uses),
and nothing else. Use a small, **auto-stopping serverless** warehouse to cap cost.

## 2. What NOT to grant — the controls behind the guard
A read-only service principal with only USE + SELECT has none of these; a review should confirm it
lacks:
- **No write/DDL** — no `MODIFY`, `CREATE`, `INSERT`/`UPDATE`/`DELETE`/`MERGE`, no table ownership,
  no `COPY INTO`, no `INSERT OVERWRITE`.
- **No external locations / volumes / storage credentials** — do **not** grant
  `READ FILES`/`WRITE FILES` on an external location, `READ VOLUME` on a volume, or `USE`/`CREATE`
  on a storage credential. This is the control for the path-based read egress (``delta.`s3://…` ``)
  and external tables, which the app guard blocks syntactically but RBAC must block authoritatively.
- **No `CREATE FUNCTION` / use of a remote/UDF** that reaches out, no `CREATE CONNECTION`
  (Lakehouse Federation) the principal can use to query external systems.
- **No metastore/account admin, no workspace admin.**

Verify with `SHOW GRANTS \`mosaic-sp\` ON SCHEMA main.sales;` — expect only `USE SCHEMA` + `SELECT`.

## 3. Query / compute limits
- **Query timeout** — Mosaic bounds each query with the connection's `query_timeout_ms`
  (default 120s) and **cancels the running statement** server-side on overrun.
- **Serverless SQL warehouse** with **auto-stop** (e.g. 10 min) and the smallest size that meets
  latency, to cap DBU cost. Consider a **statement timeout** on the warehouse too.
- **PAT hygiene** — store the token in Mosaic only (encrypted at rest); set a short expiry and
  rotate. A service principal's OAuth token is preferable to a human PAT where available.

## 4. Network (optional, recommended)
Restrict the workspace with **IP access lists** to Mosaic's egress IP(s), and/or front it with
Private Link / a private endpoint so traffic stays off the public internet.

## Cube serving (semantic layer)
Databricks is now a Cube serving target (parity pass): Mosaic can build governed dashboards with
pre-aggregations, not just answer chat queries. The generated cubes reference
`catalog.schema.table`, so the read-only grants above are sufficient; pre-aggregation builds run as
the same principal and need only `SELECT`. *(This wiring is shipped but not yet live-verified
against a workspace — it also requires the Cube image to bundle the `databricks-jdbc` driver.)*

## Why both layers
- **App layer** (`assertNoDangerousSql`): rejects writes, `COPY INTO`, `INSERT OVERWRITE`, and
  path-based file reads before the statement runs.
- **Unity Catalog layer** (USE + SELECT only, no external-location/volume/credential grants): the
  real boundary — even if a query reached the warehouse, the principal can only read the granted
  schemas and cannot write or read storage directly. This is the control to show in a security
  review, and the only control for the remote-function/federation egress path the app can't detect.
