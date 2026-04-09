-- Remove location from sensor_readings; use nodes.location via node_id FK.
-- Location stays in public.nodes; sensor_readings references nodes by node_id.

-- 1. Ensure every node_id in sensor_readings exists in nodes (so FK won't fail).
-- Uses only node_id (no sensor_readings.location) so this works even if location was already dropped.
INSERT INTO nodes (id, name, location, status)
SELECT missing.id, missing.id, missing.id, 'offline'
FROM (
  SELECT DISTINCT r.node_id AS id
  FROM sensor_readings r
  LEFT JOIN nodes n ON n.id = r.node_id
  WHERE n.id IS NULL
) missing
ON CONFLICT (id) DO NOTHING;

-- 2. Add foreign key from sensor_readings.node_id to nodes.id (if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sensor_readings_node_id_fkey'
      AND table_schema = 'public' AND table_name = 'sensor_readings'
  ) THEN
    ALTER TABLE sensor_readings
      ADD CONSTRAINT sensor_readings_node_id_fkey
      FOREIGN KEY (node_id) REFERENCES nodes(id);
  END IF;
END $$;

-- 3. Drop location column from sensor_readings
ALTER TABLE sensor_readings DROP COLUMN IF EXISTS location;

-- 4. Update refresh_daily_summaries to get location from nodes (JOIN on node_id)
CREATE OR REPLACE FUNCTION refresh_daily_summaries(p_start_date date, p_end_date date)
RETURNS TABLE (
  date date,
  node_id text,
  location text,
  reading_count bigint,
  avg_temperature double precision,
  avg_turbidity double precision,
  avg_ph double precision,
  avg_tan double precision,
  avg_dissolved_oxygen double precision,
  avg_flow_rate double precision,
  avg_wqi double precision,
  min_wqi integer,
  max_wqi integer
) AS $$
BEGIN
  RETURN QUERY
  INSERT INTO daily_summaries (
    date, node_id, location, reading_count,
    avg_temperature, avg_turbidity, avg_ph, avg_tan, avg_dissolved_oxygen, avg_flow_rate,
    avg_wqi, min_wqi, max_wqi
  )
  SELECT
    (r.timestamp AT TIME ZONE 'UTC')::date AS date,
    r.node_id,
    COALESCE(n.location, r.node_id::text) AS location,
    count(*)::integer AS reading_count,
    avg(r.temperature)::real AS avg_temperature,
    avg(r.turbidity)::real AS avg_turbidity,
    avg(r.ph)::real AS avg_ph,
    NULL::real AS avg_tan,
    avg(r.dissolved_oxygen)::real AS avg_dissolved_oxygen,
    avg(r.flow_rate)::real AS avg_flow_rate,
    NULL::real AS avg_wqi,
    NULL::integer AS min_wqi,
    NULL::integer AS max_wqi
  FROM sensor_readings r
  LEFT JOIN nodes n ON n.id = r.node_id
  WHERE r.timestamp IS NOT NULL
    AND (r.timestamp AT TIME ZONE 'UTC')::date >= p_start_date
    AND (r.timestamp AT TIME ZONE 'UTC')::date <= p_end_date
  GROUP BY (r.timestamp AT TIME ZONE 'UTC')::date, r.node_id, n.location
  ON CONFLICT (date, node_id) DO UPDATE SET
    location = EXCLUDED.location,
    reading_count = EXCLUDED.reading_count,
    avg_temperature = EXCLUDED.avg_temperature,
    avg_turbidity = EXCLUDED.avg_turbidity,
    avg_ph = EXCLUDED.avg_ph,
    avg_tan = EXCLUDED.avg_tan,
    avg_dissolved_oxygen = EXCLUDED.avg_dissolved_oxygen,
    avg_flow_rate = EXCLUDED.avg_flow_rate,
    avg_wqi = EXCLUDED.avg_wqi,
    min_wqi = EXCLUDED.min_wqi,
    max_wqi = EXCLUDED.max_wqi
  RETURNING
    daily_summaries.date,
    daily_summaries.node_id,
    daily_summaries.location,
    daily_summaries.reading_count::bigint,
    daily_summaries.avg_temperature::double precision,
    daily_summaries.avg_turbidity::double precision,
    daily_summaries.avg_ph::double precision,
    daily_summaries.avg_tan::double precision,
    daily_summaries.avg_dissolved_oxygen::double precision,
    daily_summaries.avg_flow_rate::double precision,
    daily_summaries.avg_wqi::double precision,
    daily_summaries.min_wqi,
    daily_summaries.max_wqi;
END;
$$ LANGUAGE plpgsql;
