-- Change firmware timestamp chain columns from timestamptz to bigint.
-- t_node, t_fwd_rx, t_fwd_pub are epoch milliseconds (int8) produced by the ESP32 firmware.
-- t_be_rx and t_alert_trigger are handled in migration 009.
-- USING NULL is safe because all rows had null values before firmware was deployed.
ALTER TABLE sensor_readings
  ALTER COLUMN t_node    TYPE bigint USING NULL,
  ALTER COLUMN t_fwd_rx  TYPE bigint USING NULL,
  ALTER COLUMN t_fwd_pub TYPE bigint USING NULL;
