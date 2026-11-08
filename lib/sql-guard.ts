// lib/sql-guard.ts
// Defence-in-depth guard against read-only-looking SQL that can still reach the network
// or filesystem or exfiltrate data. A statement-type allowlist (SELECT/WITH/EXPLAIN) is
// NOT sufficient for ClickHouse: table functions like url(), remote(), s3(), file(),
// mysql(), postgresql() run inside a plain SELECT and read from / write to arbitrary
// hosts. This is the app-side layer; the authoritative control is a locked-down DB user
// (ClickHouse readonly=1, no REMOTE/URL/S3/FILE grants) — see the onboarding doc.
//
// Snowflake note: an EXTERNAL FUNCTION or a network/Python UDF can reach the internet from
// inside a SELECT, but a *call* to a pre-existing one is syntactically identical to any other
// function call — there is no reliable token to block without breaking ordinary queries. The
// authoritative control for that egress path is RBAC: do not grant the read-only role USAGE on
// external functions, API / external-access integrations, network rules, or secrets (see the
// least-privilege onboarding doc). The guard still blocks what IS detectable: creating such
// objects (CREATE/ALTER/DROP ... FUNCTION/INTEGRATION/…), COPY INTO, and direct @stage reads.
//
// Pure + unit-tested. Throws on a violation; returns void when clean.

// ClickHouse table/source functions that reach network, filesystem, or another database.
// Matched as a function call: name followed by "(" (so a column named "file" is unaffected).
const CLICKHOUSE_DANGEROUS_FNS = [
  'url', 'remote', 'remotesecure', 's3', 's3cluster', 'gcs', 'file', 'hdfs',
  'mysql', 'postgresql', 'jdbc', 'odbc', 'mongodb', 'redis', 'sqlite',
  'azureblobstorage', 'deltalake', 'hudi', 'iceberg', 'executable', 'input',
]

// MySQL constructs that write to or read from the filesystem inside a SELECT.
const MYSQL_DANGEROUS = [
  { re: /\bINTO\s+OUTFILE\b/i, name: 'INTO OUTFILE' },
  { re: /\bINTO\s+DUMPFILE\b/i, name: 'INTO DUMPFILE' },
  { re: /\bLOAD_FILE\s*\(/i, name: 'LOAD_FILE()' },
]

export class SqlGuardError extends Error {}

// Strip string/quoted literals so a dangerous token inside data (e.g. a WHERE value
// 'see s3(x)') doesn't trip the guard — we only care about actual SQL syntax.
function stripLiterals(sql: string): string {
  return sql
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")   // single-quoted strings
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""')    // double-quoted identifiers/strings
    .replace(/`(?:[^`]|``)*`/g, '``')          // backtick identifiers
}

// Throw if the query uses a construct the statement allowlist can't catch. dialect-aware.
export function assertNoDangerousSql(query: string, dialect: string): void {
  const stripped = stripLiterals(query)
  const lower = stripped.toLowerCase()

  if (dialect === 'clickhouse') {
    for (const fn of CLICKHOUSE_DANGEROUS_FNS) {
      // word-boundary + optional whitespace + "(" → a table-function call
      const re = new RegExp(`(^|[^a-z0-9_])${fn}\\s*\\(`, 'i')
      if (re.test(lower)) {
        throw new SqlGuardError(`Query uses the ClickHouse table function ${fn}() which can reach the network or filesystem; it is blocked. Query only your configured tables.`)
      }
    }
    // A SETTINGS clause can raise readonly/limits within the statement.
    if (/(^|[^a-z0-9_])settings\s+/i.test(lower)) {
      throw new SqlGuardError('A SETTINGS clause is not allowed; connect with a settings profile instead.')
    }
  }

  if (dialect === 'mysql' || dialect === 'mariadb') {
    for (const d of MYSQL_DANGEROUS) {
      if (d.re.test(stripped)) throw new SqlGuardError(`Query uses ${d.name} which reads/writes the filesystem; it is blocked.`)
    }
  }

  // BigQuery: EXPORT DATA writes query results to Cloud Storage (exfiltration);
  // DDL/DML and scripting mutate. The statement allowlist already requires a
  // SELECT/WITH prefix, so this is defence-in-depth against a smuggled trailer.
  if (dialect === 'bigquery') {
    if (/(^|[^a-z0-9_])export\s+data\b/i.test(lower)) {
      throw new SqlGuardError('EXPORT DATA is blocked (it writes results to Cloud Storage). Return rows instead.')
    }
    // LOAD DATA INTO/OVERWRITE ingests from Cloud Storage / local files into a table — a write +
    // external ingest path, statement-leading in GoogleSQL.
    if (/^\s*load\s+data\b/i.test(stripped)) {
      throw new SqlGuardError('LOAD DATA is blocked (it ingests from Cloud Storage into a table). Return rows instead.')
    }
    const bqWrite = /(^|[^a-z0-9_])(insert|update|delete|merge|truncate|create|drop|alter)\s/i
    if (bqWrite.test(lower)) {
      throw new SqlGuardError('Only read-only SELECT/WITH queries are allowed on BigQuery.')
    }
  }

  // Databricks (Spark SQL): INSERT OVERWRITE DIRECTORY and COPY INTO write to cloud
  // storage; DML/DDL mutate.
  if (dialect === 'databricks') {
    if (/(^|[^a-z0-9_])insert\s+overwrite\b/i.test(lower) || /(^|[^a-z0-9_])copy\s+into\b/i.test(lower)) {
      throw new SqlGuardError('INSERT OVERWRITE / COPY INTO is blocked (it writes to storage). Return rows instead.')
    }
    if (/(^|[^a-z0-9_])(insert|update|delete|merge|truncate|create|drop|alter|replace)\s/i.test(lower)) {
      throw new SqlGuardError('Only read-only SELECT/WITH queries are allowed on Databricks.')
    }
  }

  // Snowflake: COPY INTO <location> exports to a stage/S3/GCS/Azure; DML/DDL mutate. The
  // stage file commands are statement-leading: GET downloads a stage file to the client
  // (data exfiltration), PUT uploads one, LIST/LS enumerate a stage, REMOVE/RM delete from
  // it. GET in particular is not caught by the DML/DDL keyword list, so block the whole
  // family by their leading verb.
  if (dialect === 'snowflake') {
    // Single statement only: a `;` that isn't a trailing terminator means a smuggled second
    // statement (e.g. `SELECT 1; DROP TABLE t`). Strip comments + a trailing `;` first so a
    // legitimate terminator or trailing comment doesn't trip it. (The driver also rejects
    // multi-statement by default; this is defence-in-depth.)
    const noComments = stripped.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    if (/;\s*\S/.test(noComments.replace(/;\s*$/, ''))) {
      throw new SqlGuardError('Multiple statements are not allowed; run a single SELECT.')
    }
    // Stage file-transfer commands are statement-leading: GET downloads a stage file to the
    // client (exfiltration), PUT uploads, LIST/LS enumerate, REMOVE/RM delete.
    if (/^\s*(get|put|list|ls|remove|rm)\b/i.test(stripped)) {
      throw new SqlGuardError('Stage file commands (GET/PUT/LIST/REMOVE) are blocked; return rows with a SELECT instead.')
    }
    // Procedural / dynamic / session commands: CALL runs a stored procedure (can mutate or
    // reach the network), EXECUTE [IMMEDIATE|TASK] runs dynamic or scheduled SQL, BEGIN/DECLARE
    // open an anonymous scripting block, USE changes the session's role/warehouse/database.
    if (/^\s*(call|execute|begin|declare|use)\b/i.test(stripped)) {
      throw new SqlGuardError('Procedural / session commands (CALL/EXECUTE/BEGIN/DECLARE/USE) are blocked; run a single SELECT.')
    }
    if (/(^|[^a-z0-9_])copy\s+into\b/i.test(lower)) {
      throw new SqlGuardError('COPY INTO is blocked (it reads/writes a stage or cloud storage). Return rows instead.')
    }
    // Direct stage references — @stage, @~ (user stage), @%table (table stage),
    // @db.schema.stage, @"quoted stage" — read files straight from a (possibly external) stage,
    // a data path that sidesteps table grants and can pull from S3/GCS/Azure, e.g.
    // `SELECT $1 FROM @ext_stage` or `FROM DIRECTORY(@stage)`. The GET/PUT/LIST block above only
    // catches the leading-verb commands, not a stage read inside a SELECT. `@` denotes a stage in
    // Snowflake and appears nowhere else in analytic SQL once string/quoted literals are stripped,
    // so treat any residual `@` as a stage reference.
    if (/@/.test(noComments)) {
      throw new SqlGuardError('Direct stage references (@stage) are blocked; query your configured tables, not stage files.')
    }
    if (/(^|[^a-z0-9_])(insert|update|delete|merge|truncate|create|drop|alter|put|remove|grant|revoke|call|execute)\s/i.test(lower)) {
      throw new SqlGuardError('Only read-only SELECT/WITH queries are allowed on Snowflake.')
    }
  }

  // Redshift: UNLOAD exports to S3; SELECT … INTO materialises a new table. Both
  // are writes/exfiltration that a SELECT-prefixed statement can still smuggle in.
  if (dialect === 'redshift') {
    if (/(^|[^a-z0-9_])unload\s*\(/i.test(lower)) {
      throw new SqlGuardError('UNLOAD is blocked (it exports data to S3). Query only your configured tables.')
    }
    // COPY loads from S3 / DynamoDB / EMR / an SSH host into a table — a write + an ingest path
    // that can reach external storage and read credentials. It's statement-leading in Redshift.
    if (/^\s*copy\s/i.test(stripped)) {
      throw new SqlGuardError('COPY is blocked (it loads from S3 / DynamoDB and writes a table). Return rows with a SELECT instead.')
    }
    if (/(^|[^a-z0-9_])into\s+[a-z_#"]/i.test(lower) && !/\binto\s+outfile\b/i.test(lower)) {
      throw new SqlGuardError('SELECT … INTO is blocked (it writes a new table); return rows instead.')
    }
  }
}
