-- =========================================================
-- WQMS – TEST DATA FOR ALL TABLES
-- Run in Supabase Dashboard → SQL Editor AFTER schema_add_tables.sql
--
-- Use this when nodes.id is TEXT (e.g. N1, N2). If you get
-- "invalid input syntax for type uuid" on NODES insert, your
-- nodes.id is UUID – run seed_test_data_uuid.sql instead.
-- =========================================================

-- 1) NODES (id as TEXT: N1, N2, N3)
insert into public.nodes (id, node_code, name, lat, lng, status, last_seen_at)
values
  ('N1', 'N1', 'Node 1 - Main', 8.52, 124.70, 'online', now() - interval '5 minutes'),
  ('N2', 'N2', 'Node 2 - Secondary', 8.53, 124.71, 'online', now() - interval '1 hour'),
  ('N3', 'N3', 'Node 3 - Testing', 8.54, 124.72, 'testing', now() - interval '2 hours')
on conflict (id) do update set
  node_code = excluded.node_code,
  name = excluded.name,
  lat = excluded.lat,
  lng = excluded.lng,
  status = excluded.status,
  last_seen_at = excluded.last_seen_at,
  updated_at = now();

-- 2) SENSOR READINGS – Dashboard "today" chart + Reports table & chart
-- 2a) Today: multiple points per node for the live chart (every ~2 hours)
insert into public.sensor_readings (node_id, recorded_at, temperature, turbidity, ph, nh3, dissolved_oxygen, flow_rate, wqi)
values
  ('N1', date_trunc('hour', now()) - interval '8 hours', 25.2, 11.5, 7.0, 0.13, 6.9, 43.0, 79),
  ('N1', date_trunc('hour', now()) - interval '6 hours', 25.5, 11.8, 7.1, 0.14, 6.85, 44.0, 78),
  ('N1', date_trunc('hour', now()) - interval '4 hours', 26.0, 12.2, 7.2, 0.15, 6.8, 45.0, 77),
  ('N1', date_trunc('hour', now()) - interval '2 hours', 26.2, 12.5, 7.25, 0.155, 6.75, 45.5, 76),
  ('N1', date_trunc('hour', now()), 26.2, 12.1, 7.2, 0.15, 6.8, 45.0, 78),
  ('N2', date_trunc('hour', now()) - interval '6 hours', 25.0, 10.0, 6.95, 0.11, 7.0, 41.0, 81),
  ('N2', date_trunc('hour', now()) - interval '3 hours', 25.3, 10.4, 7.0, 0.12, 6.95, 42.0, 80),
  ('N2', date_trunc('hour', now()), 25.5, 10.2, 7.0, 0.12, 7.0, 42.0, 82),
  ('N3', date_trunc('hour', now()) - interval '4 hours', 24.5, 9.2, 6.85, 0.09, 7.1, 39.0, 84),
  ('N3', date_trunc('hour', now()), 24.8, 9.5, 6.9, 0.10, 7.2, 40.0, 85)
on conflict (node_id, recorded_at) do nothing;

-- 2b) Last 14 days: 3 readings per node per day for Reports table & report chart (by week / by month)
insert into public.sensor_readings (node_id, recorded_at, temperature, turbidity, ph, nh3, dissolved_oxygen, flow_rate, wqi)
select nid, ((current_date - d)::date + (hr || ' hours')::interval),
  (25.0 + (case nid when 'N1' then 1.2 when 'N2' then 0.5 else -0.8 end) + (d * 0.05) + (hr * 0.02))::real,
  (10.0 + (case nid when 'N1' then 3 when 'N2' then 1 else 0 end) + (d * 0.1) + (hr * 0.03))::real,
  (7.0 + (case nid when 'N1' then 0.2 when 'N2' then 0.05 else -0.1 end) + (sin(d * 0.5) * 0.1))::real,
  (0.12 + (d * 0.002) + (hr * 0.001))::real,
  (6.5 + (case nid when 'N1' then 0.3 when 'N2' then 0.5 else 0.7 end) + (sin(d * 0.3) * 0.2))::real,
  (42 + (d * 0.3) + (hr * 0.2))::real,
  (72 + (case nid when 'N1' then 5 when 'N2' then 8 else 12 end) + (d * 0.5))::integer
from (values ('N1'), ('N2'), ('N3')) t(nid),
     generate_series(0, 14) d(d),
     (values (6), (12), (18)) hrs(hr)
on conflict (node_id, recorded_at) do nothing;

-- 3) DAILY SUMMARIES – Report chart (by week / by month) + Calendar WQI per day
-- Last 14 days + current month so calendar and "by month" chart have data
insert into public.daily_summaries (node_id, date, temperature_min, temperature_avg, temperature_max, turbidity_min, turbidity_avg, turbidity_max, ph_min, ph_avg, ph_max, nh3_min, nh3_avg, nh3_max, dissolved_oxygen_min, dissolved_oxygen_avg, dissolved_oxygen_max, flow_rate_min, flow_rate_avg, flow_rate_max, wqi_min, wqi_avg, wqi_max)
select nid, (current_date - d)::date,
  (25.0 + off - 0.8)::real, (25.0 + off + (d * 0.04))::real, (25.0 + off + 1.2)::real,
  (10.0 + turb_off - 0.5)::real, (10.0 + turb_off + (d * 0.08))::real, (10.0 + turb_off + 1.5)::real,
  (7.0 + ph_off - 0.15)::real, (7.0 + ph_off + (sin(d) * 0.08))::real, (7.0 + ph_off + 0.2)::real,
  (0.11 + (d * 0.002))::real, (0.12 + (d * 0.002))::real, (0.14 + (d * 0.002))::real,
  (6.4 + do_off - 0.2)::real, (6.5 + do_off + (d * 0.02))::real, (6.8 + do_off)::real,
  (41 + (d * 0.2))::real, (42 + (d * 0.25))::real, (45 + (d * 0.2))::real,
  (70 + wqi_off + (d * 0.3))::integer, (74 + wqi_off + (d * 0.4))::integer, (80 + wqi_off + (d * 0.3))::integer
from (values ('N1', 1.0, 2.5, 0.18, 0.25, 4), ('N2', 0.4, 1.0, 0.05, 0.4, 7), ('N3', -0.6, 0, -0.08, 0.6, 10)) t(nid, off, turb_off, ph_off, do_off, wqi_off),
     generate_series(0, 14) d(d)
on conflict (node_id, date) do update set
  temperature_avg = excluded.temperature_avg,
  turbidity_avg = excluded.turbidity_avg,
  ph_avg = excluded.ph_avg,
  nh3_avg = excluded.nh3_avg,
  dissolved_oxygen_avg = excluded.dissolved_oxygen_avg,
  flow_rate_avg = excluded.flow_rate_avg,
  wqi_avg = excluded.wqi_avg,
  computed_at = now();

-- Current month: daily summaries for each day so far (for calendar view when viewing this month)
insert into public.daily_summaries (node_id, date, temperature_min, temperature_avg, temperature_max, turbidity_min, turbidity_avg, turbidity_max, ph_min, ph_avg, ph_max, nh3_min, nh3_avg, nh3_max, dissolved_oxygen_min, dissolved_oxygen_avg, dissolved_oxygen_max, flow_rate_min, flow_rate_avg, flow_rate_max, wqi_min, wqi_avg, wqi_max)
select nid, (date_trunc('month', current_date)::date + (d || ' days')::interval)::date,
  (25.2 + off - 0.5)::real, (25.5 + off + (d * 0.1))::real, (26.2 + off)::real,
  (10.5 + turb_off - 0.3)::real, (11.0 + turb_off + (d * 0.05))::real, (12.5 + turb_off)::real,
  (7.0 + ph_off - 0.1)::real, (7.1 + ph_off + (d * 0.005))::real, (7.3 + ph_off)::real,
  (0.12 + (d * 0.001))::real, (0.13 + (d * 0.001))::real, (0.15 + (d * 0.001))::real,
  (6.5 + do_off - 0.15)::real, (6.7 + do_off + (d * 0.01))::real, (6.95 + do_off)::real,
  (42 + (d * 0.15))::real, (43 + (d * 0.2))::real, (46 + (d * 0.15))::real,
  (72 + wqi_off + (d * 0.2))::integer, (76 + wqi_off + (d * 0.25))::integer, (82 + wqi_off + (d * 0.2))::integer
from (values ('N1', 1.0, 2.0, 0.15, 0.2, 3), ('N2', 0.5, 1.0, 0.05, 0.35, 6), ('N3', -0.5, 0, -0.05, 0.5, 9)) t(nid, off, turb_off, ph_off, do_off, wqi_off),
     generate_series(0, least(extract(day from current_date)::int - 1, 30)) d(d)
on conflict (node_id, date) do update set
  temperature_avg = excluded.temperature_avg,
  wqi_avg = excluded.wqi_avg,
  computed_at = now();

-- 4) THRESHOLDS – global row already exists; add node-specific for N1
insert into public.thresholds (scope, node_id, temperature_min, temperature_max, ph_min, ph_max, turbidity_max, dissolved_oxygen_min, nh3_max, flow_rate_min, flow_rate_max)
values ('node', 'N1', 18, 32, 6.5, 8.5, 25, 4, 0.5, 30, 60)
on conflict (scope, node_id) do update set
  temperature_min = excluded.temperature_min,
  temperature_max = excluded.temperature_max,
  ph_min = excluded.ph_min,
  ph_max = excluded.ph_max,
  updated_at = now();

-- 5) CALIBRATION_SETTINGS – global exists; add node-specific for N2
insert into public.calibration_settings (scope, node_id, temperature_offset, ph_offset, turbidity_offset, nh3_offset, dissolved_oxygen_offset, flow_rate_offset)
values ('node', 'N2', 0.1, 0.05, 0, 0, 0.1, 0)
on conflict (scope, node_id) do update set
  temperature_offset = excluded.temperature_offset,
  updated_at = now();

-- 6) ALERTS
insert into public.alerts (node_id, type, severity, parameter, value, message, triggered_at, status)
values
  ('N1', 'threshold_breach', 'warning', 'temperature', 27.1, 'Temperature at Node 1 - Main is 27.1°C (above maximum: 32°C).', now() - interval '2 hours', 'open'),
  ('N2', 'node_offline', 'info', null, null, 'Node 2 - Secondary was offline. Check connectivity.', now() - interval '5 hours', 'acknowledged'),
  ('N3', 'system', 'info', null, null, 'Node 3 - Testing completed calibration.', now() - interval '1 day', 'resolved');

-- 7) NOTIFICATIONS (link to latest 3 alerts; alerts.id can be bigint or uuid)
insert into public.notifications (alert_id, title, body, created_at)
select a.id, left(a.message, 50), a.message, a.triggered_at
from public.alerts a
order by a.triggered_at desc
limit 3;

-- 8) REPORT EXPORTS (sample queued and done)
insert into public.report_exports (node_id, from_at, to_at, format, status, file_key, created_at, completed_at)
values
  ('N1', now() - interval '7 days', now(), 'csv', 'done', 'reports/N1-last7days.csv', now() - interval '1 hour', now() - interval '55 minutes'),
  ('N2', now() - interval '1 day', now(), 'json', 'queued', null, now(), null);
