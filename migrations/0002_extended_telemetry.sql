-- Extended client telemetry fields.
-- Run after migrations/0001_telemetry_columns.sql:
-- npx wrangler d1 execute skylineenginestatsdb --remote --file ./migrations/0002_extended_telemetry.sql

ALTER TABLE launches ADD COLUMN cpu_model TEXT;
ALTER TABLE launches ADD COLUMN gpu_model TEXT;
ALTER TABLE launches ADD COLUMN ram_free_gb INTEGER;
ALTER TABLE launches ADD COLUMN ram_used_pct INTEGER;
ALTER TABLE launches ADD COLUMN monitor_count INTEGER;
ALTER TABLE launches ADD COLUMN session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_launches_cpu_model ON launches(cpu_model);
CREATE INDEX IF NOT EXISTS idx_launches_gpu_model ON launches(gpu_model);
CREATE INDEX IF NOT EXISTS idx_launches_session_id ON launches(session_id);
