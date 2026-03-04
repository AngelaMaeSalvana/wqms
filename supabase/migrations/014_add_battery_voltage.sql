-- Add battery voltage column for per-node battery monitoring.
-- Single Li-ion: 4.2V = 100%, 3.3V = 0%.
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS battery_voltage real;
