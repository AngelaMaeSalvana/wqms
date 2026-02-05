-- WQMS: Add missing columns per plan (flow_rate, last_maintenance, alerts fields, avg_flow_rate)
-- Run in Supabase Dashboard → SQL Editor (or via Supabase CLI) on existing DB.

-- 1. water_quality_readings: flow_rate (L/min)
ALTER TABLE water_quality_readings ADD COLUMN IF NOT EXISTS flow_rate real;

-- 2. alerts: type, node_name, parameter, value, threshold_min, threshold_max, status
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS node_name text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS parameter text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS value real;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS threshold_min real;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS threshold_max real;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_alerts_status_timestamp ON alerts (status, timestamp DESC);

-- 3. nodes: last_maintenance
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS last_maintenance timestamptz;

-- 4. sensor_readings (if used): flow_rate for parity
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS flow_rate real;

-- 5. daily_summaries: optional avg_flow_rate
ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS avg_flow_rate real;
