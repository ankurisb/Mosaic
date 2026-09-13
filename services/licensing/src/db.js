// services/licensing/src/db.js
// Postgres access + schema for the licensing service. Kept deliberately small.
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway Postgres needs SSL; local dev usually doesn't.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
})

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name        TEXT NOT NULL,
      email       TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS licenses (
      id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      customer_id   TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      key_hash      TEXT NOT NULL UNIQUE,
      edition       TEXT NOT NULL DEFAULT 'enterprise',
      seat_limit    INTEGER NOT NULL DEFAULT 5,
      status        TEXT NOT NULL DEFAULT 'active',   -- active | revoked | suspended
      expires_at    TIMESTAMPTZ,
      grace_days    INTEGER NOT NULL DEFAULT 14,
      notes         TEXT,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS seat_usage (
      id            BIGSERIAL PRIMARY KEY,
      license_id    TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
      active_seats  INTEGER NOT NULL,
      fingerprint   TEXT,
      app_version   TEXT,
      reported_at   TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_seat_usage_license ON seat_usage(license_id, reported_at DESC);
    CREATE TABLE IF NOT EXISTS lic_audit (
      id          BIGSERIAL PRIMARY KEY,
      license_id  TEXT,
      action      TEXT NOT NULL,
      detail      JSONB,
      actor       TEXT,
      at          TIMESTAMPTZ DEFAULT now()
    );
  `)
}

async function audit(licenseId, action, detail, actor) {
  try {
    await pool.query('INSERT INTO lic_audit (license_id, action, detail, actor) VALUES ($1,$2,$3,$4)',
      [licenseId || null, action, detail ? JSON.stringify(detail) : null, actor || 'system'])
  } catch { /* audit is best-effort */ }
}

module.exports = { pool, initSchema, audit }
