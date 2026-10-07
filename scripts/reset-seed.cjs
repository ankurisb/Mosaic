// reset-seed.cjs — run INSIDE the mosaic container after a volume wipe.
// Creates a fresh admin user + the built-in sandbox connection so the instance
// is immediately demo-ready. Self-contained: replicates the app's AES-256-GCM
// credential encryption so the sandbox connection is valid without the HTTP API.
const D = require('/app/node_modules/better-sqlite3');
const bcrypt = require('/app/node_modules/bcryptjs');
const crypto = require('crypto');
const fs = require('fs'); const path = require('path'); const os = require('os');

const DB = process.env.MOSAIC_DB_PATH || '/data/mosaic.db';
const email = process.env.SEED_EMAIL || 'trial-admin@ugx.ai';
const pass  = process.env.SEED_PASS  || 'Mosaic@Trial1';

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

const db = new D(DB);
try {
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  const hash = bcrypt.hashSync(pass, 10);
  if (admin) { db.prepare("UPDATE users SET email=?,password_hash=? WHERE id=?").run(email, hash, admin.id); console.log('admin updated:', email); }
  else { const id = crypto.randomUUID(); db.prepare("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,datetime('now'))").run(id, email, hash, 'admin'); console.log('admin created:', email); }
} catch (e) { console.log('admin seed error:', e.message); }

try {
  const ex = db.prepare("SELECT id FROM db_connections WHERE label='Sandbox DB (built-in)'").get();
  if (ex) console.log('sandbox already present');
  else {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO db_connections (id,label,dialect,environment,host,port,database_name,username,password_enc,connection_string,schema_name,ssl_mode,pool_min,pool_max,connect_timeout_ms,query_timeout_ms,read_only) VALUES (?,'Sandbox DB (built-in)','sqlite','development','localhost',0,'sandbox','','',?,'main','disable',1,1,5000,30000,1)")
      .run(id, encrypt('__sandbox__'));
    console.log('sandbox created');
  }
} catch (e) { console.log('sandbox seed error:', e.message); }

db.close(); console.log('seed done');
