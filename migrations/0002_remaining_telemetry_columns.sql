-- Adds the telemetry columns missing from `launches`.
-- (created_at already exists on the remote table, so it is NOT touched here.)
--
-- Run once against the remote D1 database:
--   npx wrangler d1 execute skylineenginestatsdb --remote --file ./migrations/0002_remaining_telemetry_columns.sql

ALTER TABLE launches ADD COLUMN os TEXT;
ALTER TABLE launches ADD COLUMN user_name TEXT;
ALTER TABLE launches ADD COLUMN os_version TEXT;
ALTER TABLE launches ADD COLUMN arch TEXT;
ALTER TABLE launches ADD COLUMN locale TEXT;
ALTER TABLE launches ADD COLUMN tz_offset_min INTEGER;
ALTER TABLE launches ADD COLUMN screen_w INTEGER;
ALTER TABLE launches ADD COLUMN screen_h INTEGER;
ALTER TABLE launches ADD COLUMN cpu_cores INTEGER;
ALTER TABLE launches ADD COLUMN ram_gb INTEGER;
ALTER TABLE launches ADD COLUMN event TEXT DEFAULT 'launch';

CREATE INDEX IF NOT EXISTS idx_launches_created_at ON launches(created_at);
