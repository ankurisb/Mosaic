-- migrations/032_snowflake_key_passphrase.sql
-- Encrypted passphrase for a password-protected Snowflake private key (key-pair auth).
--   key_passphrase_enc : encrypt()'d passphrase that decrypts the PEM in password_enc.
-- Only used when auth_mode = 'keypair' AND the private key is itself encrypted.
-- Nullable → back-compatible; an unencrypted key leaves this NULL.
ALTER TABLE db_connections ADD COLUMN key_passphrase_enc TEXT;
