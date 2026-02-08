-- WQMS: Use TAN (not NH3), add flow_rate; remove nh3 and wqi from sensor_readings.
-- NH3 is calculated from TAN, pH, and temperature; WQI is calculated from parameters.
-- App uses only sensor_readings for all reading data.

-- sensor_readings
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS tan real;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS flow_rate real;
ALTER TABLE sensor_readings DROP COLUMN IF EXISTS nh3;
ALTER TABLE sensor_readings DROP COLUMN IF EXISTS wqi;

-- daily_summaries
ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS avg_tan real;
ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS avg_flow_rate real;
ALTER TABLE daily_summaries DROP COLUMN IF EXISTS avg_nh3;
