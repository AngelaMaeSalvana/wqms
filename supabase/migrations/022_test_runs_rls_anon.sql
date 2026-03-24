-- Allow dashboard (Supabase anon) to read test_runs for Reports > Testing on static hosts (e.g. Vercel).
-- Service role (bridge/server) bypasses RLS.
ALTER TABLE test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on test_runs" ON test_runs;
CREATE POLICY "Allow all on test_runs" ON test_runs FOR ALL USING (true) WITH CHECK (true);
