-- Add LoRa link quality columns to sensor_readings.
-- rssi : received signal strength indicator (dBm) captured by the forwarder
-- snr  : signal-to-noise ratio (dB) captured by the forwarder
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS rssi smallint;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS snr  smallint;
