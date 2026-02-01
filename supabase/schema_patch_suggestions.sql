-- =========================================================
-- Optional patch: apply AFTER main WQMS schema
-- Fixes and improvements from SCHEMA_REVIEW.md
-- =========================================================
-- For nodes: run schema_soft_delete_nodes.sql first (deactivate, don't delete).
-- That keeps all FKs intact so reports never lose node data.

-- 1) updated_at triggers for thresholds and calibration_settings
drop trigger if exists trg_thresholds_updated_at on public.thresholds;
create trigger trg_thresholds_updated_at
  before update on public.thresholds
  for each row execute function public.set_updated_at();

drop trigger if exists trg_calibration_settings_updated_at on public.calibration_settings;
create trigger trg_calibration_settings_updated_at
  before update on public.calibration_settings
  for each row execute function public.set_updated_at();

-- 2) Optional: RLS on sensor_readings (uncomment and adjust as needed)
-- alter table public.sensor_readings enable row level security;
-- create policy "Service role full access" on public.sensor_readings for all using (true) with check (true);
-- create policy "Anon read sensor_readings" on public.sensor_readings for select using (true);

-- 3) Optional: data quality checks on sensor_readings
-- alter table public.sensor_readings
--   add constraint chk_ph_range check (ph is null or (ph >= 0 and ph <= 14)),
--   add constraint chk_temperature_celsius check (temperature is null or (temperature >= -50 and temperature <= 100));

-- 4) Optional: index for report export queue workers
create index if not exists idx_report_exports_status
  on public.report_exports(status)
  where status in ('queued', 'processing');

-- 5) Optional: index for unread notifications
create index if not exists idx_notifications_read_at
  on public.notifications(read_at)
  where read_at is null;

-- 6) Optional: lat/lng sanity on nodes
-- alter table public.nodes
--   add constraint chk_lat check (lat is null or (lat >= -90 and lat <= 90)),
--   add constraint chk_lng check (lng is null or (lng >= -180 and lng <= 180));
