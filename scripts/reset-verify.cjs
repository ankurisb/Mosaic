// reset-verify.cjs — run INSIDE the mosaic container after a reset.
// Backend-aware: works on Personal/Enterprise-bundled (SQLite) AND Enterprise
// with external Postgres. Proves the Mosaic DB carries NO residue from a prior
// customer across every table that can hold customer data, creds or activity.
const URL = process.env.DATABASE_URL || '';
const isPg = /^postgres(ql)?:\/\//.test(URL);

async function main() {
  let q; // q(sql) -> Promise<number|'ERR'>   ,  exists(table) -> Promise<bool>
  if (isPg) {
    const { Pool } = require('/app/node_modules/pg');
    const pool = new Pool({ connectionString: URL, max: 2 });
    q = async (sql) => { try { const r = await pool.query(sql); return Number(r.rows[0].c); } catch { return 'ERR'; } };
    var exists = async (t) => { try { const r = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name=$1", [t]); return r.rowCount > 0; } catch { return false; } };
    var close = () => pool.end();
  } else {
    const D = require('/app/node_modules/better-sqlite3');
    const db = new D(process.env.MOSAIC_DB_PATH || '/data/mosaic.db', { readonly: true });
    q = async (sql) => { try { return db.prepare(sql).get().c; } catch { return 'ERR'; } };
    var exists = async (t) => { try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t); } catch { return false; } };
    var close = () => db.close();
  }

  let clean = true;
  const chk = (label, val, expected) => {
    const pass = (expected === undefined) ? true : (val === expected);
    if (!pass) clean = false;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}: ${val}${expected !== undefined ? ` (expect ${expected})` : ''}`);
  };
  const C = (t) => `SELECT COUNT(*) AS c FROM ${t}`;

  console.log(`--- backend: ${isPg ? 'postgres' : 'sqlite'} ---`);
  console.log('--- IDENTITY ---');
  chk('admin users', await q("SELECT COUNT(*) AS c FROM users WHERE role='admin'"), 1);
  chk('total users', await q(C('users')), 1);
  if (await exists('sso_config')) chk('sso configs', await q(C('sso_config')), 0);

  console.log('--- DATA SOURCES / CREDENTIALS ---');
  chk('db_connections total', await q(C('db_connections')), 1);
  chk('sandbox present', await q("SELECT COUNT(*) AS c FROM db_connections WHERE label='Sandbox DB (built-in)'"), 1);
  chk('NON-sandbox DB conns', await q("SELECT COUNT(*) AS c FROM db_connections WHERE label<>'Sandbox DB (built-in)'"), 0);
  for (const [t, l] of [['api_connections', 'API connections'], ['api_services', 'API services'], ['mcp_connections', 'MCP connections'], ['file_servers', 'file servers'], ['prism_instances', 'PRISM instances'], ['airbyte_instances', 'Airbyte instances']])
    if (await exists(t)) chk(l, await q(C(t)), 0);

  console.log('--- CUSTOMER ACTIVITY & ARTEFACTS ---');
  for (const [t, l] of [['conversations', 'conversations'], ['messages', 'messages'], ['saved_queries', 'saved queries'], ['query_history', 'query history'], ['dashboards', 'dashboards'], ['report_templates', 'report templates'], ['report_instances', 'report instances'], ['rca_sessions', 'rca sessions'], ['integration_channels', 'alert channels'], ['integration_rules', 'alert rules'], ['rule_groups', 'rule groups'], ['metric_definitions', 'metric definitions'], ['developer_api_keys', 'developer API keys'], ['audit_events', 'audit events']])
    if (await exists(t)) chk(l, await q(C(t)), 0);

  console.log('--- STORED SECRETS ---');
  if (await exists('kv_settings')) chk('Anthropic key in kv_settings', await q("SELECT COUNT(*) AS c FROM kv_settings WHERE key LIKE '%anthropic%' AND value_enc IS NOT NULL AND value_enc<>''"), 0);
  if (await exists('smtp_config')) chk('SMTP config rows', await q(C('smtp_config')), 0);

  await close();
  console.log(clean ? 'RESULT: CLEAN ✓ — no prior-customer residue' : 'RESULT: RESIDUE FOUND ✗ — see FAIL lines');
  process.exit(clean ? 0 : 1);
}
main().catch(e => { console.log('verify error:', e.message); process.exit(2); });
