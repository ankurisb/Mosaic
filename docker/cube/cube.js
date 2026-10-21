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

const MAP_FILE = path.join(__dirname, 'model', '.datasources.json');

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
    return {
      type: ds.type,
      host: ds.host,
      port: ds.port,
      database: ds.database,
      user: ds.user,
      password: ds.password,
      ssl: ds.ssl || false,
    };
  },

  // Advertise the data sources Cube knows about (lets Cube validate at load time).
  scheduledRefreshContexts: () => [{ securityContext: {} }],
};
