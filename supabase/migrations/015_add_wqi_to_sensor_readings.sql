-- Add WQI column to sensor_readings.
-- WQI is calculated in the backend (bridge) per reading and stored for reports/calendar.
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS wqi integer;
