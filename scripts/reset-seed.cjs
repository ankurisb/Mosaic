// reset-seed.cjs — run INSIDE the mosaic container after a reset.
// Backend-aware (SQLite for Personal/Enterprise-bundled; Postgres for Enterprise
// with external DATABASE_URL). On Postgres the volumes can't be wiped (data is
// external), so we TRUNCATE customer tables here first; on SQLite the wipe
// already happened, so we only insert the fresh admin + sandbox.
const crypto = require('crypto'), fs = require('fs'), path = require('path'), os = require('os');
const URL = process.env.DATABASE_URL || '';
const isPg = /^postgres(ql)?:\/\//.test(URL);
const email = process.env.SEED_EMAIL || 'trial-admin@ugx.ai';
const pass  = process.env.SEED_PASS  || 'Mosaic@Trial1';
const bcrypt = require('/app/node_modules/bcryptjs');

function getSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const f = path.join(os.homedir(), '.mosaic', 'secret.key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  throw new Error('no AUTH_SECRET / secret.key');
}
function encrypt(text) {
  const key = Buffer.from(getSecret().slice(0, 32).padEnd(32, '0'));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return 'enc2:' + iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + enc.toString('hex');
}
const hash = bcrypt.hashSync(pass, 10);
const uid = crypto.randomUUID();

// Customer tables to TRUNCATE on the Postgres path (external DB can't be volume-wiped).
const WIPE = ['messages','conversations','saved_queries','query_history','dashboards','dashboard_panels','dashboard_charts','report_templates','report_instances','report_deliveries','rca_sessions','rca_workflows','integration_channels','integration_rules','integration_runs','rule_groups','metric_definitions','developer_api_keys','developer_api_usage','audit_events','db_connections','api_connections','api_services','mcp_connections','file_servers','prism_instances','airbyte_instances','sso_config','smtp_config','kv_settings','users'];

async function main() {
  if (isPg) {
    const { Pool } = require('/app/node_modules/pg');
    const pool = new Pool({ connectionString: URL, max: 2 });
    for (const t of WIPE) { try { await pool.query(`TRUNCATE TABLE ${t} CASCADE`); } catch {} }
    await pool.query("INSERT INTO users (id,email,password_hash,role,created_at) VALUES ($1,$2,$3,'admin',NOW())", [uid, email, hash]);
    await pool.query("INSERT INTO db_connections (id,label,dialect,environment,host,port,database_name,username,password_enc,connection_string,schema_name,ssl_mode,pool_min,pool_max,connect_timeout_ms,query_timeout_ms,read_only) VALUES ($1,'Sandbox DB (built-in)','sqlite','development','localhost',0,'sandbox','','',$2,'main','disable',1,1,5000,30000,true)", [crypto.randomUUID(), encrypt('__sandbox__')]);
    await pool.end();
    console.log('admin + sandbox seeded (postgres):', email);
  } else {
    const D = require('/app/node_modules/better-sqlite3');
    const db = new D(process.env.MOSAIC_DB_PATH || '/data/mosaic.db');
    const admin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
    if (admin) { db.prepare("UPDATE users SET email=?,password_hash=? WHERE id=?").run(email, hash, admin.id); console.log('admin updated:', email); }
    else { db.prepare("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,datetime('now'))").run(uid, email, hash, 'admin'); console.log('admin created:', email); }
    const ex = db.prepare("SELECT id FROM db_connections WHERE label='Sandbox DB (built-in)'").get();
    if (ex) console.log('sandbox already present');
    else {
      db.prepare("INSERT INTO db_connections (id,label,dialect,environment,host,port,database_name,username,password_enc,connection_string,schema_name,ssl_mode,pool_min,pool_max,connect_timeout_ms,query_timeout_ms,read_only) VALUES (?,'Sandbox DB (built-in)','sqlite','development','localhost',0,'sandbox','','',?,'main','disable',1,1,5000,30000,1)")
        .run(crypto.randomUUID(), encrypt('__sandbox__'));
      console.log('sandbox created');
    }
    db.close();
  }
  console.log('seed done');
}
main().catch(e => { console.log('seed error:', e.message); process.exit(1); });
