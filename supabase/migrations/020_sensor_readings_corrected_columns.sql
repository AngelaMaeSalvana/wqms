-- User calibration (Settings offsets) applied in bridge → stored alongside lab-adjusted values.

ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS temperature_corrected real;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS ph_corrected real;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS turbidity_corrected real;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS dissolved_oxygen_corrected real;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS flow_rate_corrected real;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS nh3_corrected real;

COMMENT ON COLUMN sensor_readings.temperature_corrected IS 'Lab-adjusted temperature + user offset from wqms_calibration';
COMMENT ON COLUMN sensor_readings.ph_corrected IS 'Lab-adjusted pH + user offset';
COMMENT ON COLUMN sensor_readings.turbidity_corrected IS 'Lab-adjusted turbidity + user offset';
COMMENT ON COLUMN sensor_readings.dissolved_oxygen_corrected IS 'Lab-adjusted DO + user offset';
COMMENT ON COLUMN sensor_readings.flow_rate_corrected IS 'Lab-adjusted flow + user offset';
COMMENT ON COLUMN sensor_readings.nh3_corrected IS 'NH3 (stored or TAN-derived) + user nh3 offset';
