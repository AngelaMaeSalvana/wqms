-- WQMS: Add missing columns per plan (flow_rate, last_maintenance, alerts fields, avg_flow_rate)
-- Run in Supabase Dashboard → SQL Editor (or via Supabase CLI) on existing DB.

-- 1. water_quality_readings (if exists; app now uses only sensor_readings)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'water_quality_readings') THEN
    ALTER TABLE water_quality_readings ADD COLUMN IF NOT EXISTS flow_rate real;
  END IF;
END $$;

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

-- 4. sensor_readings (if used): flow_rate for parity (skip if table does not exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sensor_readings') THEN
    ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS flow_rate real;
  END IF;
END $$;

-- 5. daily_summaries: optional avg_flow_rate
ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS avg_flow_rate real;
