import { getDb } from './db'
import bcrypt from 'bcryptjs'

let done = false

export async function setupDatabase() {
  if (done) return
  const sql = getDb()

  // Core auth tables
  await sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    banned BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
  )`

  await sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New conversation',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`

  await sql`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
  )`

  // Database connections
  await sql`CREATE TABLE IF NOT EXISTS db_connections (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    label TEXT NOT NULL,
    dialect TEXT NOT NULL DEFAULT 'postgres',
    environment TEXT NOT NULL DEFAULT 'development',
    host TEXT,
    port INT DEFAULT 5432,
    database_name TEXT,
    username TEXT,
    password_enc TEXT,
    connection_string TEXT,
    schema_name TEXT DEFAULT 'public',
    ssl_mode TEXT DEFAULT 'prefer',
    ssl_ca TEXT,
    pool_min INT DEFAULT 1,
    pool_max INT DEFAULT 5,
    connect_timeout_ms INT DEFAULT 5000,
    query_timeout_ms INT DEFAULT 30000,
    read_only BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
  )`

  // API services (workspace)
  await sql`CREATE TABLE IF NOT EXISTS api_services (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    label TEXT NOT NULL,
    base_url TEXT NOT NULL,
    environment TEXT NOT NULL DEFAULT 'production',
    auth_type TEXT NOT NULL DEFAULT 'bearer',
    auth_config TEXT NOT NULL DEFAULT '{}',
    default_headers TEXT DEFAULT '{}',
    api_version TEXT,
    version_header TEXT,
    rate_limit_rpm INT,
    connect_timeout_ms INT DEFAULT 5000,
    request_timeout_ms INT DEFAULT 30000,
    retry_count INT DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT now()
  )`

  // API connections (within a service)
  await sql`CREATE TABLE IF NOT EXISTS api_connections (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    service_id TEXT NOT NULL REFERENCES api_services(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    description TEXT,
    base_path TEXT,
    pagination_style TEXT DEFAULT 'none',
    pagination_limit_param TEXT DEFAULT 'limit',
    pagination_cursor_param TEXT DEFAULT 'cursor',
    pagination_data_path TEXT,
    auth_override BOOLEAN DEFAULT false,
    auth_config TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`

  // Usage events
  await sql`CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL,
    user_email TEXT,
    type TEXT NOT NULL,
    model TEXT,
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    cost_usd NUMERIC(10,6) DEFAULT 0,
    latency_ms INT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`

  await sql`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id,created_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_convs_user ON conversations(user_id,updated_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id,created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at DESC)`

  // Bootstrap admin
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  const name = process.env.ADMIN_NAME || 'Admin'
  if (email && password) {
    const existing = await sql`SELECT id FROM users WHERE email=${email.toLowerCase()}`
    if (!existing.length) {
      const hash = await bcrypt.hash(password, 12)
      await sql`INSERT INTO users(email,name,password_hash,role) VALUES(${email.toLowerCase()},${name},${hash},'admin') ON CONFLICT DO NOTHING`
      console.log('Admin created:', email)
    }
  }

  done = true
}
