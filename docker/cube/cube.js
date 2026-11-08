// docker/cube/cube.js — Cube engine config for the Mosaic package (Phase 6).
//
// Multi-datasource: Mosaic writes a map of its configured db_connections to
// /cube/conf/model/.datasources.json (connId -> { type, host, port, database, user,
// password }). Each generated cube carries `data_source: <connId>`, so Cube calls
// driverFactory({ dataSource }) and we return the matching driver config. SQLite and
// other non-Cube dialects are never written to the map (those panels use Mosaic's SQL
// pipeline), so an unknown dataSource here is a hard error surfaced to the app, which
// then falls back to SQL.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODEL_DIR = path.join(__dirname, 'model');
const MAP_FILE = path.join(MODEL_DIR, '.datasources.json');

function loadMap() {
  try {
    return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  } catch (_e) {
    return {};
  }
}

module.exports = {
  // Where the generated cube schema files live (mounted read-only from the shared
  // cube-schema volume that Mosaic writes to).
  schemaPath: 'model',

  // Recompile the schema when Mosaic rewrites the model files. In production mode Cube
  // caches the compiled schema; without this a cube written AFTER Cube started (a newly
  // verified source) is never picked up and queries fall back to SQL. Hashing the model
  // dir's filenames+mtimes makes the version change exactly when the files change, so a
  // model/verify/connection change is reflected on the next query — no restart needed.
  schemaVersion: () => {
    try {
      const h = crypto.createHash('sha1')
      for (const f of fs.readdirSync(MODEL_DIR).sort()) {
        try { h.update(f + ':' + fs.statSync(path.join(MODEL_DIR, f)).mtimeMs + ';') } catch (_e) { /* skip */ }
      }
      return h.digest('hex')
    } catch (_e) { return '0' }
  },

  // Return the driver config for a given dataSource. Cube passes { dataSource:'default' }
  // for cubes with no data_source; we don't register a default source, so such cubes
  // never resolve here (by design — every Mosaic cube is tagged).
  driverFactory: ({ dataSource }) => {
    const map = loadMap();
    let ds = map[dataSource];
    // Cube's readiness/liveness probe always tests a 'default' dataSource. Mosaic models
    // no default source (every cube is tagged), so resolve 'default' to the first
    // configured source when one exists; when none exist yet there is simply nothing for
    // Cube to be ready for (the probe stays red until the first SQL source is synced).
    if (!ds && dataSource === 'default') {
      const first = Object.keys(map)[0];
      ds = first ? map[first] : undefined;
    }
    if (!ds) {
      throw new Error(`cube: no datasource config for '${dataSource}'`);
    }
    const type = String(ds.type || '').toLowerCase();

    // -- Warehouse dialects carry their own driver shape ----------------------
    // BigQuery: projectId + a parsed service-account credentials object (or an
    // apiEndpoint override for an emulator).
    if (type === 'bigquery') {
      const bq = { type: 'bigquery', projectId: ds.projectId };
      if (ds.credentials) {
        try { bq.credentials = JSON.parse(ds.credentials); } catch (_e) { /* leave unset → clear auth error */ }
      }
      if (ds.apiEndpoint) bq.apiEndpoint = ds.apiEndpoint;
      return bq;
    }
    // Snowflake: account + warehouse + role (+ database/schema). Auth is either a password
    // or a key pair. The driver spreads this config over its env defaults, so whatever we
    // return wins. For key-pair we must set authenticator=SNOWFLAKE_JWT and the inline
    // privateKey (PEM); passing the PEM as `password` makes the driver try password auth,
    // which fails and — after a few retries — temporarily LOCKS the Snowflake user.
    if (type === 'snowflake') {
      const sf = {
        type: 'snowflake',
        account: ds.account,
        username: ds.user,
        database: ds.database,
        schema: ds.schema,
        warehouse: ds.warehouse,
        role: ds.role,
      };
      if (ds.authenticator === 'SNOWFLAKE_JWT' && ds.privateKey) {
        // The PEM in the datasource map is already unencrypted (Mosaic decrypts a
        // password-protected key before writing the map), so no passphrase is needed here.
        sf.authenticator = 'SNOWFLAKE_JWT';
        sf.privateKey = ds.privateKey.endsWith('\n') ? ds.privateKey : ds.privateKey + '\n';
      } else if (ds.authenticator === 'OAUTH' && ds.token) {
        sf.authenticator = 'OAUTH';
        sf.token = ds.token;
      } else {
        sf.password = ds.password;
      }
      return sf;
    }

    // Base config shared by the SQL dialects (postgres/mysql/mssql/clickhouse/redshift).
    // Cube's Postgres and MySQL drivers read `host`; its SQL Server driver (tedious)
    // reads `server` and ignores `host`, so without the mapping below every MSSQL
    // pre-aggregation build dies with `config.server is required` and the panel
    // silently falls back to SQL. Redshift reuses this Postgres-shaped config.
    const cfg = {
      type: ds.type,
      host: ds.host,
      port: ds.port,
      database: ds.database,
      user: ds.user,
      password: ds.password,
      ssl: ds.ssl || false,
    };
    if (type === 'mssql' || type === 'sqlserver') {
      cfg.server = ds.host;            // tedious requires `server`
      cfg.options = {
        encrypt: !!ds.ssl,             // no TLS unless the connection asked for it
        trustServerCertificate: true,  // on-prem SQL Server commonly uses self-signed certs
      };
    }
    return cfg;
  },

  // Advertise the data sources Cube knows about (lets Cube validate at load time).
  scheduledRefreshContexts: () => [{ securityContext: {} }],
};
