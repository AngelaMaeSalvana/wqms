-- Insert sample sensor readings every hour: 60 rows (1 per minute for the previous hour).
-- Uses pg_cron; enable it in Supabase Dashboard → Database → Extensions → pg_cron.

-- 1. Function: insert 60 sample readings for the previous full hour (one per minute).
--    p_node_id: node to attach readings to (default N-001; must exist in nodes or will be created by FK handling).
CREATE OR REPLACE FUNCTION insert_sample_sensor_readings_hourly(p_node_id text DEFAULT 'N-001')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hour_start timestamptz;
  i integer;
  ts timestamptz;
  t real; turb real; p real; do2 real; fr real;
  wq integer; bv real; bp integer; rss integer; sn integer;
  inserted_count integer := 0;
  base_seq integer;
BEGIN
  -- Previous full hour: e.g. if now() is 14:23, hour_start = 13:00 UTC
  hour_start := date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '1 hour';
  SELECT COALESCE(max(seq), 0) INTO base_seq FROM sensor_readings WHERE node_id = p_node_id;

  FOR i IN 0..59 LOOP
    ts := hour_start + (i || ' minutes')::interval;

    -- Realistic water-quality-ish values with small random variation per minute
    t   := 22.0 + (random() * 6.0);                    -- temperature °C ~22–28
    turb:= 5.0 + (random() * 25.0);                     -- turbidity NTU
    p   := 6.8 + (random() * 1.2);                      -- pH ~6.8–8.0
    do2 := 6.0 + (random() * 4.0);                      -- dissolved oxygen mg/L
    fr  := 10.0 + (random() * 30.0);                   -- flow rate
    wq  := 65 + (random() * 25)::integer;               -- WQI ~65–90
    bv  := 3.7 + (random() * 0.4);                      -- battery voltage 3.7–4.1
    bp  := 70 + (random() * 25)::integer;              -- battery % 70–95
    rss := -90 - (random() * 20)::integer;             -- RSSI dBm
    sn  := 5 + (random() * 5)::integer;                 -- SNR dB

    INSERT INTO sensor_readings (
      node_id,
      temperature, turbidity, ph, dissolved_oxygen, flow_rate,
      seq, timestamp, wqi, battery_voltage, battery_percentage, rssi, snr
    ) VALUES (
      p_node_id,
      t, turb, p, do2, fr,
      base_seq + i + 1,
      ts,
      wq, bv, bp, rss, sn
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$;

-- 2. Ensure the sample-data node exists (avoids FK errors)
INSERT INTO nodes (id, name, location, status)
VALUES ('N-001', 'River A - Bridge', 'Villanueva', 'online')
ON CONFLICT (id) DO NOTHING;

-- 3. Schedule: run at minute 0 of every hour (00:00, 01:00, 02:00, ...)
--    Requires pg_cron extension enabled in Supabase Dashboard → Database → Extensions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('insert-sample-readings-hourly');
    PERFORM cron.schedule(
      'insert-sample-readings-hourly',
      '0 * * * *',
      $$SELECT insert_sample_sensor_readings_hourly('N-001')$$
    );
  END IF;
END
$$;

-- To run manually (e.g. from SQL Editor): SELECT insert_sample_sensor_readings_hourly('N-001');
-- To use a different node: SELECT insert_sample_sensor_readings_hourly('N-002');
