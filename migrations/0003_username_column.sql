-- Adds the username column for launch telemetry.
-- Safe to run even if already applied: each statement is independent and
-- errors on missing columns are expected/ignorable (see instructions below).
--
-- Run once against the remote D1 database:
--   npx wrangler d1 execute skylineenginestatsdb --remote --file ./migrations/0003_username_column.sql
-- If you see "duplicate column name: user_name" it is ALREADY applied — nothing to do.

ALTER TABLE launches ADD COLUMN user_name TEXT;

CREATE INDEX IF NOT EXISTS idx_launches_created_at ON launches(created_at);
