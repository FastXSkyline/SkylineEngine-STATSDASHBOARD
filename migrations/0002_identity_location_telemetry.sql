-- Adds identity and regional analytics for the v3 Skyline telemetry client.
--
-- Run once against the remote D1 database:
--   npx wrangler d1 execute skylineenginestatsdb --remote --file ./migrations/0002_identity_location_telemetry.sql
--
-- If the Worker has already auto-created these columns, this migration is
-- informational and does not need to be run again.

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
