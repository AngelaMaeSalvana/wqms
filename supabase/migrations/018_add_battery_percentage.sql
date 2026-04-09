-- Add battery percentage column (device-computed from voltage; 0-100 or null)
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS battery_percentage integer;
