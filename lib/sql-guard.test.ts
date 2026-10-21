import { describe, it, expect } from 'vitest'
import { assertNoDangerousSql, SqlGuardError } from './sql-guard'

const ok = (q: string, d: string) => expect(() => assertNoDangerousSql(q, d)).not.toThrow()
const blocked = (q: string, d: string) => expect(() => assertNoDangerousSql(q, d)).toThrow(SqlGuardError)

describe('sql-guard: ClickHouse table functions', () => {
  it('blocks url/remote/s3/file/mysql/postgresql table functions', () => {
    blocked("SELECT * FROM url('http://evil/x','CSV')", 'clickhouse')
    blocked('SELECT * FROM remote(\'host:9000\', db.t)', 'clickhouse')
    blocked("SELECT * FROM s3('https://b/k','CSV')", 'clickhouse')
    blocked("SELECT * FROM file('/etc/passwd','LineAsString')", 'clickhouse')
    blocked('SELECT * FROM mysql(\'h:3306\',\'db\',\'t\',\'u\',\'p\')', 'clickhouse')
    blocked("SELECT * FROM postgresql('h:5432','db','t','u','p')", 'clickhouse')
  })
  it('blocks a SETTINGS clause', () => {
    blocked('SELECT * FROM prod SETTINGS max_result_rows=0', 'clickhouse')
  })
  it('allows an ordinary SELECT over real tables', () => {
    ok('SELECT ts, sum(units) FROM production GROUP BY ts', 'clickhouse')
    ok('WITH x AS (SELECT 1) SELECT * FROM x', 'clickhouse')
  })
  it('does not trip on a column/value that merely contains a function name', () => {
    ok("SELECT file_name FROM docs WHERE note = 'uploaded via s3(x)'", 'clickhouse')
    ok('SELECT url FROM pages', 'clickhouse')   // url as a column, not url(
  })
})

describe('sql-guard: MySQL filesystem constructs', () => {
  it('blocks INTO OUTFILE / DUMPFILE / LOAD_FILE', () => {
    blocked("SELECT * FROM t INTO OUTFILE '/tmp/x'", 'mysql')
    blocked("SELECT LOAD_FILE('/etc/passwd')", 'mysql')
  })
  it('allows a normal SELECT', () => {
    ok('SELECT a, b FROM t WHERE a > 1', 'mysql')
  })
})

describe('sql-guard: other dialects unaffected', () => {
  it('does not block ClickHouse functions on postgres (handled by its own grants)', () => {
    ok("SELECT * FROM url('x')", 'postgres')   // not clickhouse → this guard is a no-op; pg has no url() anyway
  })
})
