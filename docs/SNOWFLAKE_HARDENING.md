# Snowflake connector — security hardening (customer onboarding)

Mosaic queries a customer's Snowflake read-only, generating SQL. A statement-type
allowlist (`SELECT`/`WITH`) is **not sufficient on its own**: inside a plain `SELECT` a
query can still reach a stage, call an external function or network UDF, or (via
procedural/dynamic SQL) mutate. Mosaic blocks what is detectable in the app
(`lib/sql-guard.ts`, defence in depth) — DML/DDL, `COPY INTO`, the `GET`/`PUT`/`LIST`/`REMOVE`
stage commands, procedural/session commands (`CALL`/`EXECUTE`/`BEGIN`/`DECLARE`/`USE`),
smuggled multi-statements, and direct `@stage` reads — but the **authoritative control is the
Snowflake role Mosaic connects as**. One egress path is *not* detectable in the app: a call to
a pre-existing external function or network UDF is syntactically identical to any other function
call. RBAC is the only reliable control for it. Configure the role as follows.

## 1. A dedicated read-only role and user
```sql
USE ROLE ACCOUNTADMIN;                 -- or SECURITYADMIN + SYSADMIN as appropriate

CREATE ROLE IF NOT EXISTS MOSAIC_RO;

-- Compute: let the role use a (small, auto-suspending) warehouse, not create/modify one.
GRANT USAGE ON WAREHOUSE MOSAIC_WH TO ROLE MOSAIC_RO;

-- Read scope: USAGE lets the role "see into" the db/schema; SELECT reads the data.
GRANT USAGE ON DATABASE   ANALYTICS            TO ROLE MOSAIC_RO;
GRANT USAGE ON SCHEMA     ANALYTICS.PUBLIC     TO ROLE MOSAIC_RO;
GRANT SELECT ON ALL     TABLES IN SCHEMA ANALYTICS.PUBLIC TO ROLE MOSAIC_RO;
GRANT SELECT ON ALL     VIEWS  IN SCHEMA ANALYTICS.PUBLIC TO ROLE MOSAIC_RO;
-- Keep new objects readable automatically:
GRANT SELECT ON FUTURE  TABLES IN SCHEMA ANALYTICS.PUBLIC TO ROLE MOSAIC_RO;
GRANT SELECT ON FUTURE  VIEWS  IN SCHEMA ANALYTICS.PUBLIC TO ROLE MOSAIC_RO;

-- Bind the role to a dedicated service user and make it the default.
CREATE USER IF NOT EXISTS MOSAIC_SVC
  DEFAULT_ROLE = MOSAIC_RO
  DEFAULT_WAREHOUSE = MOSAIC_WH;
GRANT ROLE MOSAIC_RO TO USER MOSAIC_SVC;
```
Repeat the `USAGE`/`SELECT` grants for each schema Mosaic should read. For a multi-schema
connection (Mosaic accepts a comma-separated Schema list), grant every schema in the list.

## 2. What NOT to grant — the controls behind the guard
The read-only role must have **no** path to write, to reach the network, or to read files
directly. Simply do not grant these (a fresh custom role has none by default); the list is what
a security review should confirm the role lacks:

- **No write/DDL:** no `INSERT`/`UPDATE`/`DELETE`/`MERGE`, no `CREATE`/`ALTER`/`DROP` on any
  object, no `OWNERSHIP`.
- **No external functions / network access:** no `USAGE` on external functions, **API
  integrations**, **external access integrations**, **network rules**, or **secrets**. This is
  the control for the one egress path the app guard cannot see — a call to an existing external
  function or a Python/Java UDF with outbound access. Without these grants such a call fails in
  Snowflake.
- **No stages:** no `USAGE`/`READ` on internal or external stages, and no `CREATE STAGE`. Mosaic
  also blocks `@stage` reads in SQL, but the grant is the real boundary. (This also means no
  `COPY INTO`, `GET`/`PUT`, directory tables.)
- **No account/session administration:** no `ACCOUNTADMIN`/`SECURITYADMIN`/`SYSADMIN`, no
  `CREATE WAREHOUSE`, no `EXECUTE TASK`, no `IMPORTED PRIVILEGES` beyond what reading needs.

Verify with:
```sql
SHOW GRANTS TO ROLE MOSAIC_RO;        -- should be only USAGE (wh/db/schema) + SELECT (tables/views)
```

## 3. How Mosaic authenticates (pick one)
All three store the secret encrypted at rest in Mosaic; choose per your security posture.

- **Key-pair (recommended for a service user).** Register the public key on the user and give
  Mosaic the PEM private key. The key may be **encrypted (passphrase-protected)** — enter the
  passphrase in the connection's *Key passphrase* field; Mosaic decrypts the key in memory and
  never stores it unencrypted.
  ```sql
  ALTER USER MOSAIC_SVC SET RSA_PUBLIC_KEY = 'MIIBIjANBgkq...';   -- the public half
  ```
- **OAuth token.** With a Snowflake OAuth security integration and your IdP, supply an OAuth
  access token (Mosaic auth mode *OAuth token*). Snowflake maps the token to the user/role.
- **Password.** Supported; prefer key-pair or OAuth for an unattended service user, and enforce
  MFA/network policy at the account level.

## 4. Query and compute limits
- **Statement timeout** — cap runaway queries server-side as well as in Mosaic (Mosaic bounds
  execution via the connection's `query_timeout_ms` and cancels on expiry):
  ```sql
  ALTER USER MOSAIC_SVC SET STATEMENT_TIMEOUT_IN_SECONDS = 120;
  -- or on the warehouse: ALTER WAREHOUSE MOSAIC_WH SET STATEMENT_TIMEOUT_IN_SECONDS = 120;
  ```
- **Small, auto-suspending warehouse** with a **resource monitor** to cap credits:
  ```sql
  ALTER WAREHOUSE MOSAIC_WH SET WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60 AUTO_RESUME = TRUE;
  CREATE RESOURCE MONITOR MOSAIC_RM WITH CREDIT_QUOTA = 50
    TRIGGERS ON 100 PERCENT DO SUSPEND;
  ALTER WAREHOUSE MOSAIC_WH SET RESOURCE_MONITOR = MOSAIC_RM;
  ```

## 5. Network (optional, recommended)
Restrict the service user (or the account) to Mosaic's egress IPs with a network policy:
```sql
CREATE NETWORK POLICY MOSAIC_NP ALLOWED_IP_LIST = ('<mosaic-egress-ip>/32');
ALTER USER MOSAIC_SVC SET NETWORK_POLICY = MOSAIC_NP;
```

## Why both layers
- **App layer** (`assertNoDangerousSql` in `lib/sql-guard.ts`): rejects DML/DDL, `COPY INTO`,
  stage commands and `@stage` reads, procedural/session commands and smuggled multi-statements
  before the query is sent — fast feedback across every path (chat, dashboards, reports).
- **DB layer** (the `MOSAIC_RO` role): the real boundary — even if a query reached Snowflake, the
  role can only `SELECT` the granted tables/views and has no privilege to write, to use an
  external function / integration / network rule / secret, or to touch a stage. This is the
  control to show in a security review, and the only control for the external-function egress
  path the app layer cannot detect.
