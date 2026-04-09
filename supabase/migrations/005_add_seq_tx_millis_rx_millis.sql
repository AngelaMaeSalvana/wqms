-- Add forwarder metadata columns to sensor_readings.
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS seq integer;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS tx_millis bigint;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS rx_millis bigint;
