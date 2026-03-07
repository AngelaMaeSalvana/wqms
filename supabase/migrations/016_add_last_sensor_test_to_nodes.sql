-- Add last sensor test columns to nodes for persisted status across sessions
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS last_sensor_test_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sensor_test_status text;
