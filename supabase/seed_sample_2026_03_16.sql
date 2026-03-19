-- Insert sample sensor_readings: 1 row per minute for YESTERDAY (00:00–23:59, 1440 rows).
-- Run in Supabase SQL Editor. Change 'N-001' if you use a different node_id.

-- Ensure node exists (avoids foreign key error)
INSERT INTO nodes (id, name, location, status)
VALUES ('N-001', 'River A - Bridge', 'Villanueva', 'online')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sensor_readings (
  node_id,
  temperature, turbidity, ph, dissolved_oxygen, flow_rate,
  seq, timestamp, wqi, battery_voltage, battery_percentage, rssi, snr
)
SELECT
  'N-001',
  22.0 + (random() * 6.0),
  5.0 + (random() * 25.0),
  6.8 + (random() * 1.2),
  6.0 + (random() * 4.0),
  10.0 + (random() * 30.0),
  row_number() OVER ()::integer,
  ts,
  65 + (random() * 25)::integer,
  3.7 + (random() * 0.4),
  (70 + (random() * 25))::integer,
  (-90 - (random() * 20))::smallint,
  (5 + (random() * 5))::smallint
FROM generate_series(
  (current_date - 1)::timestamptz,
  (current_date)::timestamptz - interval '1 minute',
  interval '1 minute'
) AS t(ts);

-- Also seed TODAY so the dashboard Live Chart (which only shows today) displays data:
INSERT INTO sensor_readings (
  node_id,
  temperature, turbidity, ph, dissolved_oxygen, flow_rate,
  seq, timestamp, wqi, battery_voltage, battery_percentage, rssi, snr
)
SELECT
  'N-001',
  22.0 + (random() * 6.0),
  5.0 + (random() * 25.0),
  6.8 + (random() * 1.2),
  6.0 + (random() * 4.0),
  10.0 + (random() * 30.0),
  (1440 + row_number() OVER ())::integer,
  ts,
  65 + (random() * 25)::integer,
  3.7 + (random() * 0.4),
  (70 + (random() * 25))::integer,
  (-90 - (random() * 20))::smallint,
  (5 + (random() * 5))::smallint
FROM generate_series(
  (current_date)::timestamptz,
  (current_date)::timestamptz + interval '23 hours 59 minutes',
  interval '1 minute'
) AS t(ts);
