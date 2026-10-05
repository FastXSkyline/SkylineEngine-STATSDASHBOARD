-- Legacy telemetry migration.
-- Existing installations may already have the first set of columns.
-- The Worker also keeps an idempotent compatibility path for these fields.
--
-- New identity/location fields:
--   discord_username
--   discord_user_id
--   pc_username
--   computer_name
--   country_code
--   timezone
--   os_name
--   client_timestamp
--
-- Run once against the remote D1 database if these columns are not already
-- present:
--   npx wrangler d1 execute skylineenginestatsdb --remote --file ./migrations/0001_telemetry_columns.sql
--
-- Existing rows remain unchanged.

ALTER TABLE launches ADD COLUMN os_name TEXT;
ALTER TABLE launches ADD COLUMN country_code TEXT;
ALTER TABLE launches ADD COLUMN timezone TEXT;
ALTER TABLE launches ADD COLUMN discord_username TEXT;
ALTER TABLE launches ADD COLUMN discord_user_id TEXT;
ALTER TABLE launches ADD COLUMN pc_username TEXT;
ALTER TABLE launches ADD COLUMN computer_name TEXT;
ALTER TABLE launches ADD COLUMN client_timestamp INTEGER;

CREATE INDEX IF NOT EXISTS idx_launches_country ON launches(country_code);
CREATE INDEX IF NOT EXISTS idx_launches_discord_id ON launches(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_launches_pc_username ON launches(pc_username);
