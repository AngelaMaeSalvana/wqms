-- Delete sensor_readings from Mar 15 00:00 through Mar 16 23:59 (both days).
-- Run in Supabase SQL Editor.

DELETE FROM sensor_readings
WHERE timestamp >= '2026-03-15 00:00:00+00'::timestamptz
  AND timestamp <  '2026-03-17 00:00:00+00'::timestamptz;
