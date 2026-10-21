// lib/sql-guard.ts
// Defence-in-depth guard against read-only-looking SQL that can still reach the network
// or filesystem or exfiltrate data. A statement-type allowlist (SELECT/WITH/EXPLAIN) is
// NOT sufficient for ClickHouse: table functions like url(), remote(), s3(), file(),
// mysql(), postgresql() run inside a plain SELECT and read from / write to arbitrary
// hosts. This is the app-side layer; the authoritative control is a locked-down DB user
// (ClickHouse readonly=1, no REMOTE/URL/S3/FILE grants) — see the onboarding doc.
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
}
