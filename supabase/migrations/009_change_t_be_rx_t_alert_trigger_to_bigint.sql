-- Change t_be_rx (sensor_readings) and t_alert_trigger (alerts) from timestamptz to bigint.
-- All timestamp chain columns are now epoch milliseconds (int8) for consistency.
ALTER TABLE sensor_readings
  ALTER COLUMN t_be_rx TYPE bigint USING NULL;

ALTER TABLE alerts
  ALTER COLUMN t_alert_trigger TYPE bigint USING NULL;
