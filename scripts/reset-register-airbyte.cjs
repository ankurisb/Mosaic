// reset-register-airbyte.cjs — run INSIDE the mosaic container after a reset.
// Re-registers the bundled abctl Airbyte in Mosaic's airbyte_instances table so a
// freshly-reset trial box is immediately demo-ready (the reset wipes the old
// registration as customer data). abctl auth is OAuth2 (client_id/secret),
// supplied via env by the reset wrapper which reads `abctl local credentials`.
const D = require('/app/node_modules/better-sqlite3');
const crypto = require('crypto');
const DB = process.env.MOSAIC_DB_PATH || '/data/mosaic.db';

const URL = process.env.AB_URL || 'http://host.docker.internal:8000';
const CLIENT_ID = process.env.AB_CLIENT_ID || '';
const CLIENT_SECRET = process.env.AB_CLIENT_SECRET || '';

if (!CLIENT_ID || !CLIENT_SECRET) { console.log('no abctl creds supplied — skipping Airbyte registration'); process.exit(0); }

function getSecret() { return process.env.AUTH_SECRET || ''; }
function encrypt(text) {
  const key = Buffer.from(getSecret().slice(0, 32).padEnd(32, '0'));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return 'enc2:' + iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + enc.toString('hex');
}

const db = new D(DB);
const cols = db.prepare("PRAGMA table_info(airbyte_instances)").all().map(c => c.name);
db.prepare("DELETE FROM airbyte_instances").run();
const id = crypto.randomUUID();
if (cols.includes('client_id') && cols.includes('client_secret_enc')) {
  db.prepare(`INSERT INTO airbyte_instances (id,label,url,username,password_enc,client_id,client_secret_enc,active,created_at)
    VALUES (?,?,?,?,?,?,?,1,datetime('now'))`)
    .run(id, 'Bundled Airbyte (abctl)', URL, CLIENT_ID, encrypt(CLIENT_SECRET), CLIENT_ID, encrypt(CLIENT_SECRET));
} else {
  db.prepare(`INSERT INTO airbyte_instances (id,label,url,username,password_enc,active,created_at)
    VALUES (?,?,?,?,?,1,datetime('now'))`)
    .run(id, 'Bundled Airbyte (abctl)', URL, CLIENT_ID, encrypt(CLIENT_SECRET));
}
console.log('re-registered Airbyte:', URL, 'client', CLIENT_ID.slice(0, 8) + '...');
db.close();
