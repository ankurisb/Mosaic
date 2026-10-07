// reset-verify.cjs — run INSIDE the mosaic container after a reset.
// Proves the Mosaic DB carries NO residue from a prior customer across every
// table that can hold customer data, credentials or activity.
const D = require('/app/node_modules/better-sqlite3');
const DB = process.env.MOSAIC_DB_PATH || '/data/mosaic.db';
const db = new D(DB, { readonly: true });

function has(t){ try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t); } catch { return false; } }
function count(sql){ try { return db.prepare(sql).get().c; } catch (e) { return 'ERR'; } }

let clean = true;
const chk = (label, val, expected) => {
  const pass = (expected === undefined) ? true : (val === expected);
  if (!pass) clean = false;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}: ${val}${expected!==undefined?` (expect ${expected})`:''}`);
};

console.log('--- IDENTITY ---');
chk('admin users', count("SELECT COUNT(*) c FROM users WHERE role='admin'"), 1);
chk('total users', count("SELECT COUNT(*) c FROM users"), 1);
if (has('sso_config')) chk('sso configs (customer IdP)', count("SELECT COUNT(*) c FROM sso_config"), 0);

console.log('--- DATA SOURCES / CREDENTIALS ---');
chk('db_connections total', count("SELECT COUNT(*) c FROM db_connections"), 1);
chk('sandbox present', count("SELECT COUNT(*) c FROM db_connections WHERE label='Sandbox DB (built-in)'"), 1);
chk('NON-sandbox DB conns', count("SELECT COUNT(*) c FROM db_connections WHERE label<>'Sandbox DB (built-in)'"), 0);
for (const [t,l] of [['api_connections','API connections'],['api_services','API services'],['mcp_connections','MCP connections'],['file_servers','file servers'],['prism_instances','PRISM instances'],['airbyte_instances','Airbyte instances']])
  if (has(t)) chk(l, count(`SELECT COUNT(*) c FROM ${t}`), 0);

console.log('--- CUSTOMER ACTIVITY & ARTEFACTS ---');
for (const [t,l] of [['conversations','conversations'],['messages','messages'],['saved_queries','saved queries'],['query_history','query history'],['dashboards','dashboards'],['report_templates','report templates'],['report_instances','report instances'],['rca_sessions','rca sessions'],['integration_channels','alert channels'],['integration_rules','alert rules'],['rule_groups','rule groups'],['metric_definitions','metric definitions'],['developer_api_keys','developer API keys'],['audit_events','audit events']])
  if (has(t)) chk(l, count(`SELECT COUNT(*) c FROM ${t}`), 0);

console.log('--- STORED SECRETS ---');
if (has('kv_settings')) chk('Anthropic key in kv_settings', count("SELECT COUNT(*) c FROM kv_settings WHERE key LIKE '%anthropic%' AND value_enc IS NOT NULL AND value_enc<>''"), 0);
if (has('smtp_config')) chk('SMTP config rows', count("SELECT COUNT(*) c FROM smtp_config"), 0);

db.close();
console.log(clean ? 'RESULT: CLEAN ✓ — no prior-customer residue in Mosaic DB' : 'RESULT: RESIDUE FOUND ✗ — see FAIL lines above');
process.exit(clean ? 0 : 1);
