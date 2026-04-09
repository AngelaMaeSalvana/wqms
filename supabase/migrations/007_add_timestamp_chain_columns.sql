-- Add full timestamp chain columns to sensor_readings for end-to-end latency tracking.
-- Each column stores an ISO-8601 timestamp from the corresponding pipeline stage.
-- t_node    : time the sensor node transmitted the packet (from node firmware clock)
-- t_fwd_rx  : time the LoRa packet forwarder received the packet over the air
-- t_fwd_pub : time the packet forwarder published the message to the MQTT broker
-- t_be_rx   : time the backend server received the message from the MQTT broker
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS t_node     timestamptz;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS t_fwd_rx   timestamptz;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS t_fwd_pub  timestamptz;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS t_be_rx    timestamptz;

-- Add seq and t_alert_trigger to alerts for per-packet alert correlation.
-- seq             : sequence identifier linking this alert to a specific telemetry packet
-- t_alert_trigger : ISO-8601 timestamp of when the backend detected and triggered the alert
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS seq             integer;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS t_alert_trigger timestamptz;

-- Indexes to support the timestamp-logs query (filter by node + time range)
CREATE INDEX IF NOT EXISTS idx_sensor_readings_seq     ON sensor_readings (seq);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_t_be_rx ON sensor_readings (t_be_rx DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_seq              ON alerts (seq);
