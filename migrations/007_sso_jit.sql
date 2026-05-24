-- 007_sso_jit.sql
-- Adds just-in-time (JIT) provisioning flag to sso_config.
-- When jit_enabled = 1, a first SSO login auto-creates the user
-- with role = 'user'. SSO role federation applies immediately after.
-- Default is 0 (off) — preserving existing pre-provision-only behaviour.

ALTER TABLE sso_config ADD COLUMN jit_enabled INTEGER NOT NULL DEFAULT 0;
