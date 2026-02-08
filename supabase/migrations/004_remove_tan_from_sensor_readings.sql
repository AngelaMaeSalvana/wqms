-- Remove TAN from sensor_readings. NH3 is computed in app using default TAN 0.5 mg/L (as N) when not measured.
ALTER TABLE sensor_readings DROP COLUMN IF EXISTS tan;
