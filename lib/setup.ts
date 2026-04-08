import { getDb } from './db'
import bcrypt from 'bcryptjs'

let setupDone = false

export async function setupDatabase() {
  // Only run once per process (Vercel may reuse warm functions)
  if (setupDone) return
  const sql = getDb()

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    TIMESTAMPTZ DEFAULT now()
    )`

  await sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL DEFAULT 'New conversation',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`

  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ DEFAULT now()
    )`

  await sql`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_convs_user ON conversations(user_id, updated_at DESC)`

  // Create admin user from env vars if it doesn't exist yet
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  const name = process.env.ADMIN_NAME || 'Admin'

  if (email && password) {
    const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`
    if (existing.length === 0) {
      const hash = await bcrypt.hash(password, 12)
      await sql`
        INSERT INTO users (email, name, password_hash, role)
        VALUES (${email.toLowerCase()}, ${name}, ${hash}, 'admin')
        ON CONFLICT (email) DO NOTHING`
      console.log('Admin user created:', email)
    }
  }

  setupDone = true
}
