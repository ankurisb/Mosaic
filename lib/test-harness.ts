/**
 * Test-data harness descriptors.
 *
 * These describe the 8 external data sources that ship in the optional
 * `demo` docker-compose profile (see docker-compose.demo.yml). When an admin
 * clicks "Add test harness" in Settings → Data sources, Mosaic registers these
 * as real connections pointing at the harness containers.
 *
 * Hosts are the compose SERVICE NAMES (postgres, mysql, …). They only resolve
 * when the `demo` profile is running on the shared `mosaic-net` network, i.e.
 *   docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d
 * Ports are the containers' INTERNAL ports (not the host-published ones).
 *
 * Credentials match test-data/docker-compose.yml. They are demo/throwaway
 * values and are stored encrypted like any other connection.
 */

export interface HarnessDb {
  kind: 'db'
  label: string
  dialect: string
  host: string
  port: number
  database_name: string | null
  username: string | null
  password: string | null
  schema_name: string
  ssl_mode: string
}

export interface HarnessFile {
  kind: 'file'
  label: string
  transport: 'sftp' | 's3'
  host?: string
  port?: number
  username?: string
  password?: string
  sub_path?: string
  endpoint_url?: string
  bucket?: string
  access_key_id?: string
  secret_key?: string
}

export type HarnessSource = HarnessDb | HarnessFile

export const TEST_HARNESS: HarnessSource[] = [
  { kind: 'db', label: 'Plant Operations (demo)', dialect: 'postgres', host: 'postgres', port: 5432, database_name: 'plant_ops', username: 'mosaic', password: 'mosaic_pw', schema_name: 'public', ssl_mode: 'disable' },
  { kind: 'db', label: 'ERP Lite (demo)', dialect: 'mysql', host: 'mysql', port: 3306, database_name: 'erp_lite', username: 'mosaic', password: 'mosaic_pw', schema_name: 'erp_lite', ssl_mode: 'disable' },
  { kind: 'db', label: 'Maintenance CMMS (demo)', dialect: 'mssql', host: 'mssql', port: 1433, database_name: 'cmms', username: 'sa', password: 'Mosaic_Strong_Pw_1', schema_name: 'dbo', ssl_mode: 'disable' },
  { kind: 'db', label: 'Sensor Telemetry (demo)', dialect: 'influxdb', host: 'influxdb', port: 8086, database_name: 'telemetry', username: 'mosaic', password: 'mosaic_pw', schema_name: 'telemetry', ssl_mode: 'disable' },
  { kind: 'db', label: 'Event Logs (demo)', dialect: 'mongodb', host: 'mongodb', port: 27017, database_name: 'event_logs', username: 'mosaic', password: 'mosaic_pw', schema_name: 'event_logs', ssl_mode: 'disable' },
  { kind: 'db', label: 'Ops Search (demo)', dialect: 'elasticsearch', host: 'elasticsearch', port: 9200, database_name: null, username: null, password: null, schema_name: '', ssl_mode: 'disable' },
  { kind: 'file', label: 'File Drop — SFTP (demo)', transport: 'sftp', host: 'sftp', port: 22, username: 'mosaic', password: 'mosaic_pw', sub_path: 'upload/initial' },
  // S3 source backed by adobe/s3mock (MinIO is no longer freely distributable).
  // s3mock ignores auth, so the access/secret are placeholders; path-style + the
  // in-network endpoint are what matter.
  { kind: 'file', label: 'File Drop — S3 (demo)', transport: 's3', endpoint_url: 'http://s3mock:9090', bucket: 'mosaic-test', access_key_id: 'demo', secret_key: 'demo-secret' },
]
