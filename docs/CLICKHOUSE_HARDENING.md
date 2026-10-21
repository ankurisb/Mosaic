# ClickHouse connector — security hardening (customer onboarding)

Mosaic queries a customer's ClickHouse read-only, generating SQL. A statement-type
allowlist (SELECT/WITH/EXPLAIN) is **not sufficient on its own**: ClickHouse table
functions run inside a plain `SELECT` and can reach the network or filesystem —
`url()`, `remote()`/`remoteSecure()`, `s3()`, `file()`, `hdfs()`, `mysql()`,
`postgresql()`, `jdbc()`, `odbc()`, and others — and a `SETTINGS` clause can raise
limits. An injected or confused query could read from or exfiltrate to arbitrary hosts.

Mosaic blocks these constructs in the app (`lib/sql-guard.ts`, defence in depth), but the
**authoritative control is the ClickHouse user Mosaic connects as**. Configure it as
follows when onboarding a ClickHouse source.

## 1. A dedicated read-only user
```xml
<!-- users.xml / a profile -->
<profiles>
  <mosaic_readonly>
    <readonly>1</readonly>                     <!-- blocks SET / DDL / DML; 2 if you need session settings -->
    <max_execution_time>30</max_execution_time>
    <max_memory_usage>4000000000</max_memory_usage>
    <max_result_rows>200000</max_result_rows>
    <max_rows_to_read>5000000000</max_rows_to_read>
    <result_overflow_mode>break</result_overflow_mode>
  </mosaic_readonly>
</profiles>
```

## 2. Grant SELECT only, and no source privileges
```sql
CREATE USER mosaic IDENTIFIED BY '…' SETTINGS PROFILE 'mosaic_readonly';
GRANT SELECT ON <customer_db>.* TO mosaic;
-- Do NOT grant: REMOTE, URL, S3, FILE, HDFS, MYSQL, POSTGRES, ODBC, JDBC, MONGO, SQLITE
-- (ClickHouse gates table functions behind these grants; without them the functions fail)
REVOKE REMOTE, URL, S3, FILE ON *.* FROM mosaic;   -- explicit, if the role inherited any
```

## 3. Network
Keep ClickHouse reachable only from the Mosaic host/network. The settings-profile caps
(`max_execution_time`, `max_memory_usage`, `max_result_rows`, `max_rows_to_read`) stop an
accidental full scan of a multi-billion-row table from starving the instance.

## Why both layers
- **App layer** (`assertNoDangerousSql`): rejects the dangerous table-function calls and
  `SETTINGS` clause before the query is sent — fast feedback, covers every query path
  (chat, dashboards, reports).
- **DB layer** (grants + `readonly=1` + profile): the real boundary — even if a query
  reached ClickHouse, the user has no privilege to run `url()`/`s3()`/etc. and can't raise
  limits. This is the control to show in a security review.
