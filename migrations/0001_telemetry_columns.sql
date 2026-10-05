-- Adds telemetry columns to `launches` so the dashboard can show daily
-- activity, platform/version breakdowns and recent records.
--
-- Run once against the remote D1 database:
--   npx wrangler d1 execute skylineenginestatsdb --remote --file ./migrations/0001_telemetry_columns.sql
--
-- NOTE: existing rows intentionally keep created_at = NULL. They still count
-- toward total launches / total users, but they are excluded from time based
-- metrics (today, daily chart, recent table), so no historical data is faked.

ALTER TABLE launches ADD COLUMN created_at TEXT;
ALTER TABLE launches ADD COLUMN os TEXT;
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
