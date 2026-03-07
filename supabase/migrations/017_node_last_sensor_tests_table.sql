-- Standalone table for last sensor test per node_id.
-- Works for both nodes from the nodes table and derived nodes (from sensor_readings).
CREATE TABLE IF NOT EXISTS node_last_sensor_tests (
  node_id text PRIMARY KEY,
  last_sensor_test_at timestamptz NOT NULL,
  last_sensor_test_status text
);

-- Allow anon access for dashboard
ALTER TABLE node_last_sensor_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on node_last_sensor_tests" ON node_last_sensor_tests;
CREATE POLICY "Allow all on node_last_sensor_tests" ON node_last_sensor_tests FOR ALL USING (true) WITH CHECK (true);
