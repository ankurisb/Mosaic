// test-plant-customer.cjs — TEST ONLY. Simulates a departing customer ("Acme
// Motors") by planting realistic residue across every table a real trial would
// touch, so the reset can be proven to remove ALL of it.
const D = require('/app/node_modules/better-sqlite3');
const crypto = require('crypto');
const DB = '/data/mosaic.db';
const db = new D(DB);
const u = () => crypto.randomUUID();
let planted = [];
function tryExec(label, fn){ try { fn(); planted.push(label); } catch(e){ console.log('  skip',label,'-',e.message); } }

// 1. a second admin + a customer analyst user
tryExec('users', () => {
  db.prepare("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,datetime('now'))")
    .run(u(),'cto@acme-motors.com','Acme CTO','x','admin');
  db.prepare("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,datetime('now'))")
    .run(u(),'analyst@acme-motors.com','Acme Analyst','x','user');
});

// 2. customer DB connection WITH a (fake) credential — the leak that matters most
tryExec('db_connections', () => {
  db.prepare("INSERT INTO db_connections (id,label,dialect,environment,host,port,database_name,username,password_enc,connection_string,schema_name,ssl_mode,pool_min,pool_max,connect_timeout_ms,query_timeout_ms,read_only,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))")
    .run(u(),'Acme Plant Historian','postgres','production','historian.acme-motors.internal',5432,'plant_ops','acme_svc','enc2:DEADBEEFFAKECREDENTIAL','enc2:DEADBEEFFAKECONNSTR','public','require',1,5,5000,30000,1);
});

// 3. API + MCP + file-server + prism + airbyte connections (all hold endpoints/creds)
tryExec('api_connections', () => db.prepare("INSERT INTO api_connections (id,label,base_url,created_at) VALUES (?,?,?,datetime('now'))").run(u(),'Acme MES API','https://mes.acme-motors.internal'));
tryExec('mcp_connections', () => db.prepare("INSERT INTO mcp_connections (id,label,created_at) VALUES (?,?,datetime('now'))").run(u(),'Acme MCP'));
tryExec('file_servers', () => db.prepare("INSERT INTO file_servers (id,label,created_at) VALUES (?,?,datetime('now'))").run(u(),'Acme SMB share'));
tryExec('prism_instances', () => db.prepare("INSERT INTO prism_instances (id,label,created_at) VALUES (?,?,datetime('now'))").run(u(),'Acme PRISM'));
tryExec('airbyte_instances', () => db.prepare("INSERT INTO airbyte_instances (id,label,created_at) VALUES (?,?,datetime('now'))").run(u(),'Acme Airbyte'));

// 4. conversations + messages (customer's actual questions)
tryExec('conversations+messages', () => {
  const cid = u();
  db.prepare("INSERT INTO conversations (id,title,created_at) VALUES (?,?,datetime('now'))").run(cid,'Why is Acme Line 3 scrap up?');
  db.prepare("INSERT INTO messages (id,conversation_id,role,content,created_at) VALUES (?,?,?,?,datetime('now'))").run(u(),cid,'user','Our confidential scrap data for Line 3...');
});

// 5. saved queries / query history / dashboards / reports / rca / alerts
tryExec('saved_queries', () => db.prepare("INSERT INTO saved_queries (id,name,sql,created_at) VALUES (?,?,?,datetime('now'))").run(u(),'Acme OEE by line','SELECT * FROM acme_secret_table'));
tryExec('query_history', () => db.prepare("INSERT INTO query_history (id,sql,created_at) VALUES (?,?,datetime('now'))").run(u(),'SELECT * FROM acme_secret_table'));
tryExec('dashboards', () => db.prepare("INSERT INTO dashboards (id,title,created_at) VALUES (?,?,datetime('now'))").run(u(),'Acme Exec Dashboard'));
tryExec('report_templates', () => db.prepare("INSERT INTO report_templates (id,name,created_at) VALUES (?,?,datetime('now'))").run(u(),'Acme Monthly OEE'));
tryExec('rca_sessions', () => db.prepare("INSERT INTO rca_sessions (id,created_at) VALUES (?,datetime('now'))").run(u()));
tryExec('integration_channels', () => db.prepare("INSERT INTO integration_channels (id,name,created_at) VALUES (?,?,datetime('now'))").run(u(),'Acme Slack #alerts'));
tryExec('integration_rules', () => db.prepare("INSERT INTO integration_rules (id,name,created_at) VALUES (?,?,datetime('now'))").run(u(),'Acme scrap > 5%'));
tryExec('developer_api_keys', () => db.prepare("INSERT INTO developer_api_keys (id,name,created_at) VALUES (?,?,datetime('now'))").run(u(),'Acme CI key'));

// 6. stored Anthropic key + SMTP (customer secrets)
tryExec('kv_settings anthropic key', () => db.prepare("INSERT OR REPLACE INTO kv_settings (key,value) VALUES ('anthropic_api_key','sk-ant-ACMECONFIDENTIAL')").run());

db.close();
console.log('PLANTED customer residue in:', planted.join(', '));
