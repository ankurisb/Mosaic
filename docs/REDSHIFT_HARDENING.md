# Amazon Redshift connector — security hardening (customer onboarding)

Mosaic queries a customer's Redshift **read-only** over the PostgreSQL wire protocol, generating
SQL. Mosaic enforces read-only three independent ways in the app (defence in depth):
1. a statement-type parser allowlist (SELECT/WITH only),
2. a driver-level `BEGIN READ ONLY` transaction on the Query Builder path,
3. the SQL guard (`lib/sql-guard.ts`) — blocks `UNLOAD` (S3 export), `SELECT … INTO` (table
   write), `COPY` (S3/DynamoDB ingest), and smuggled multi-statements.

But the **authoritative control is the Redshift user Mosaic connects as**. Two Redshift egress
paths depend on cluster-level privilege and an attached IAM role, not on SQL the app can see —
`UNLOAD`/`COPY` to S3, and Spectrum **external schemas** that read S3 directly. RBAC is the real
boundary for those. Configure the user as follows.

## 1. A dedicated read-only user + group
```sql
CREATE GROUP mosaic_ro;
CREATE USER mosaic PASSWORD '…' IN GROUP mosaic_ro CONNECTION LIMIT 5;

GRANT USAGE  ON SCHEMA analytics TO GROUP mosaic_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO GROUP mosaic_ro;
-- Keep new tables readable automatically:
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO GROUP mosaic_ro;
```
Repeat per schema. Mosaic's Schema field accepts a **comma-separated list** (`sales, marketing`)
or `*` for all user schemas, so grant every schema you list.

## 2. What NOT to grant — the controls behind the guard
A plain read-only user has none of these; a security review should confirm the user lacks:
- **No write/DDL** — no `INSERT/UPDATE/DELETE`, no `CREATE`/`DROP`/`ALTER`, no `TEMP` (so no
  `CREATE TEMP TABLE`, no `SELECT … INTO`), no table `OWNERSHIP`.
- **No S3 load/unload** — the user must not be able to run `COPY`/`UNLOAD`. Beyond the privilege,
  the real control is **not attaching an IAM role** (or `IAM_ROLE`/credentials the user can
  reference) to the cluster for this user's use. Without an assumable role, `COPY`/`UNLOAD` fail.
- **No Spectrum external schemas** — no `CREATE EXTERNAL SCHEMA` and no `USAGE` on an external
  schema that maps to a Glue/Hive catalog + S3. A Spectrum external table reads S3 directly and is
  queried like any table, so the only control is not granting access to the external schema.
- **No superuser**, no `ALTER USER`, no access to `pg_catalog` admin functions beyond read.

Verify with:
```sql
SELECT * FROM information_schema.table_privileges WHERE grantee = 'mosaic_ro';   -- SELECT only
```

## 3. Query / resource limits
- **Statement timeout** — Mosaic bounds every query with the connection's `query_timeout_ms`
  (sent as pg `statement_timeout`, default 30s) and the server cancels on expiry. Back it with a
  cluster-side cap too:
  ```sql
  ALTER USER mosaic SET statement_timeout TO 120000;   -- ms
  ```
- **WLM / query monitoring rules** — put the `mosaic_ro` group in a WLM queue with a row/row-scan
  or execution-time rule that aborts a runaway query, so an accidental cross-join can't starve the
  cluster.
- **Connection limit** — `CONNECTION LIMIT` on the user (above) caps pool fan-out.

## 4. Network
Keep the cluster in a private subnet; restrict its security group to Mosaic's egress IP(s).
Prefer SSL (`ssl_mode = require`, set on the connection).

## Why both layers
- **App layer** (`assertNoDangerousSql` + parser + `BEGIN READ ONLY`): rejects writes, `UNLOAD`,
  `SELECT … INTO`, `COPY`, and smuggled multi-statements before the query runs.
- **DB layer** (the `mosaic_ro` group + no IAM role + no external-schema access): the real
  boundary — even if a query reached Redshift, the user can only `SELECT` the granted tables and
  cannot reach S3 via `COPY`/`UNLOAD`/Spectrum. This is the control to show in a security review.
