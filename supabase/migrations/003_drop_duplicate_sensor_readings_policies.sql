-- Fix "policy already exists" when re-running seed or schema_sensor_readings.
-- Run once in Supabase SQL Editor if you see: policy "Allow service role full access on sensor_readings" already exists.
-- This drops the older policy names; "Allow all on sensor_readings" (from main schema) is enough for full access.

DROP POLICY IF EXISTS "Allow service role full access on sensor_readings" ON sensor_readings;
DROP POLICY IF EXISTS "Allow anon read on sensor_readings" ON sensor_readings;

-- Ensure the single policy used by the app exists (idempotent).
DROP POLICY IF EXISTS "Allow all on sensor_readings" ON sensor_readings;
CREATE POLICY "Allow all on sensor_readings" ON sensor_readings FOR ALL USING (true) WITH CHECK (true);
