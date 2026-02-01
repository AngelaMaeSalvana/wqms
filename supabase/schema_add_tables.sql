-- =========================================================
-- WQMS – ADDITION OF TABLES ONLY
-- Forwarder -> HiveMQ -> Supabase -> UI
-- Run in Supabase Dashboard → SQL Editor
-- Only adds tables, columns, indexes, triggers, views.
-- Safe to run on existing DB (if not exists / add column if not exists).
-- Uses node_id TEXT to match existing nodes.id (text). Use full_schema.sql for new DBs with nodes.id uuid.
-- =========================================================

create extension if not exists pgcrypto;

-- =========================================================
-- Helper: auto update updated_at
-- =========================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- 1) NODES
-- =========================================================
create table if not exists public.nodes (
  id             uuid primary key default gen_random_uuid(),
  node_code      text not null unique,
  name           text not null,
  lat            double precision,
  lng            double precision,
  status         text not null default 'offline',
  last_seen_at   timestamptz,
  deactivated_at timestamptz default null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint nodes_status_check
    check (status in ('online','offline','maintenance','testing','deactivated'))
);

alter table public.nodes add column if not exists node_code text;
alter table public.nodes add column if not exists last_seen_at timestamptz;
alter table public.nodes add column if not exists deactivated_at timestamptz default null;

comment on column public.nodes.deactivated_at is
  'Updated via UI. When set, node is deactivated; status becomes deactivated. Null = active.';

create index if not exists idx_nodes_status on public.nodes(status);
create index if not exists idx_nodes_last_seen on public.nodes(last_seen_at desc);
create index if not exists idx_nodes_active on public.nodes(node_code) where deactivated_at is null;

drop trigger if exists trg_nodes_updated_at on public.nodes;
create trigger trg_nodes_updated_at before update on public.nodes
  for each row execute function public.set_updated_at();

create or replace function public.nodes_sync_status_from_deactivated()
returns trigger language plpgsql as $$
begin
  if new.deactivated_at is not null then new.status := 'deactivated';
  elsif old.deactivated_at is not null and new.deactivated_at is null then new.status := 'offline';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_nodes_sync_status_from_deactivated on public.nodes;
create trigger trg_nodes_sync_status_from_deactivated before update on public.nodes
  for each row execute function public.nodes_sync_status_from_deactivated();

-- =========================================================
-- 2) SENSOR READINGS
-- =========================================================
create table if not exists public.sensor_readings (
  id                bigint generated always as identity primary key,
  node_id           text not null references public.nodes(id) on delete cascade,
  recorded_at        timestamptz not null,
  temperature        real,
  turbidity          real,
  ph                 real,
  nh3                real,
  dissolved_oxygen   real,
  flow_rate          real,
  wqi                integer,
  topic              text,
  payload_json       jsonb,
  ingest_id          uuid,
  created_at         timestamptz not null default now()
);

alter table public.sensor_readings add column if not exists recorded_at timestamptz;
alter table public.sensor_readings add column if not exists topic text;
alter table public.sensor_readings add column if not exists payload_json jsonb;
alter table public.sensor_readings add column if not exists ingest_id uuid;
alter table public.sensor_readings add column if not exists flow_rate real;

create unique index if not exists uq_sensor_readings_node_time
  on public.sensor_readings (node_id, recorded_at);
create index if not exists idx_sensor_readings_node_time
  on public.sensor_readings(node_id, recorded_at desc);
create index if not exists idx_sensor_readings_time
  on public.sensor_readings(recorded_at desc);

-- =========================================================
-- 3) DAILY SUMMARIES
-- =========================================================
create table if not exists public.daily_summaries (
  id                        uuid primary key default gen_random_uuid(),
  node_id                   text not null references public.nodes(id) on delete cascade,
  date                      date not null,
  temperature_min           real,
  temperature_avg            real,
  temperature_max           real,
  turbidity_min              real,
  turbidity_avg              real,
  turbidity_max              real,
  ph_min                    real,
  ph_avg                    real,
  ph_max                    real,
  nh3_min                   real,
  nh3_avg                   real,
  nh3_max                   real,
  dissolved_oxygen_min       real,
  dissolved_oxygen_avg       real,
  dissolved_oxygen_max      real,
  flow_rate_min             real,
  flow_rate_avg             real,
  flow_rate_max             real,
  wqi_min                   integer,
  wqi_avg                   integer,
  wqi_max                   integer,
  computed_at               timestamptz not null default now(),
  constraint uq_daily_summaries_node_date unique (node_id, date)
);

alter table public.daily_summaries add column if not exists temperature_min real;
alter table public.daily_summaries add column if not exists temperature_avg real;
alter table public.daily_summaries add column if not exists temperature_max real;
alter table public.daily_summaries add column if not exists turbidity_min real;
alter table public.daily_summaries add column if not exists turbidity_avg real;
alter table public.daily_summaries add column if not exists turbidity_max real;
alter table public.daily_summaries add column if not exists ph_min real;
alter table public.daily_summaries add column if not exists ph_avg real;
alter table public.daily_summaries add column if not exists ph_max real;
alter table public.daily_summaries add column if not exists nh3_min real;
alter table public.daily_summaries add column if not exists nh3_avg real;
alter table public.daily_summaries add column if not exists nh3_max real;
alter table public.daily_summaries add column if not exists dissolved_oxygen_min real;
alter table public.daily_summaries add column if not exists dissolved_oxygen_avg real;
alter table public.daily_summaries add column if not exists dissolved_oxygen_max real;
alter table public.daily_summaries add column if not exists flow_rate_min real;
alter table public.daily_summaries add column if not exists flow_rate_avg real;
alter table public.daily_summaries add column if not exists flow_rate_max real;
alter table public.daily_summaries add column if not exists wqi_min integer;
alter table public.daily_summaries add column if not exists wqi_avg integer;
alter table public.daily_summaries add column if not exists wqi_max integer;
alter table public.daily_summaries add column if not exists computed_at timestamptz default now();

create index if not exists idx_daily_summaries_node_date
  on public.daily_summaries(node_id, date desc);

-- =========================================================
-- 4) THRESHOLDS
-- =========================================================
create table if not exists public.thresholds (
  id                    uuid primary key default gen_random_uuid(),
  scope                 text not null default 'global',
  node_id               text references public.nodes(id) on delete cascade,
  temperature_min       real,
  temperature_max        real,
  ph_min                real,
  ph_max                real,
  turbidity_max         real,
  dissolved_oxygen_min   real,
  nh3_max               real,
  flow_rate_min          real,
  flow_rate_max          real,
  updated_at            timestamptz not null default now(),
  constraint thresholds_scope_check check (scope in ('global','node')),
  constraint thresholds_scope_node_rule check (
    (scope = 'global' and node_id is null) or (scope = 'node' and node_id is not null)
  ),
  constraint uq_thresholds_scope_node unique (scope, node_id)
);

drop trigger if exists trg_thresholds_updated_at on public.thresholds;
create trigger trg_thresholds_updated_at before update on public.thresholds
  for each row execute function public.set_updated_at();

insert into public.thresholds (scope)
select 'global'
where not exists (select 1 from public.thresholds where scope = 'global' and node_id is null);

-- =========================================================
-- 5) CALIBRATION SETTINGS
-- =========================================================
create table if not exists public.calibration_settings (
  id                        uuid primary key default gen_random_uuid(),
  scope                     text not null default 'global',
  node_id                   text references public.nodes(id) on delete cascade,
  temperature_offset        real not null default 0,
  ph_offset                 real not null default 0,
  turbidity_offset          real not null default 0,
  nh3_offset                real not null default 0,
  dissolved_oxygen_offset   real not null default 0,
  flow_rate_offset          real not null default 0,
  updated_at                timestamptz not null default now(),
  constraint calibration_scope_check check (scope in ('global','node')),
  constraint calibration_scope_node_rule check (
    (scope = 'global' and node_id is null) or (scope = 'node' and node_id is not null)
  ),
  constraint uq_calibration_scope_node unique (scope, node_id)
);

drop trigger if exists trg_calibration_settings_updated_at on public.calibration_settings;
create trigger trg_calibration_settings_updated_at before update on public.calibration_settings
  for each row execute function public.set_updated_at();

insert into public.calibration_settings (scope)
select 'global'
where not exists (select 1 from public.calibration_settings where scope = 'global' and node_id is null);

-- =========================================================
-- 6) ALERTS
-- =========================================================
create table if not exists public.alerts (
  id               uuid primary key default gen_random_uuid(),
  node_id          text not null references public.nodes(id) on delete cascade,
  type             text not null,
  severity         text not null,
  parameter        text,
  value            real,
  message          text not null,
  triggered_at     timestamptz not null default now(),
  status           text not null default 'open',
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  constraint alerts_type_check check (type in ('threshold_breach','node_offline','sensor_test_failed','system')),
  constraint alerts_severity_check check (severity in ('info','warning','critical')),
  constraint alerts_status_check check (status in ('open','acknowledged','resolved'))
);

alter table public.alerts add column if not exists type text;
alter table public.alerts add column if not exists severity text;
alter table public.alerts add column if not exists parameter text;
alter table public.alerts add column if not exists value real;
alter table public.alerts add column if not exists message text;
alter table public.alerts add column if not exists triggered_at timestamptz default now();
alter table public.alerts add column if not exists status text default 'open';
alter table public.alerts add column if not exists acknowledged_at timestamptz;
alter table public.alerts add column if not exists resolved_at timestamptz;

create index if not exists idx_alerts_node_time on public.alerts(node_id, triggered_at desc);

-- =========================================================
-- 7) NOTIFICATIONS
-- =========================================================
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  alert_id    bigint references public.alerts(id) on delete cascade,
  title       text not null,
  body        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists idx_notifications_read_at on public.notifications(read_at) where read_at is null;

-- =========================================================
-- 8) REPORT EXPORTS
-- =========================================================
create table if not exists public.report_exports (
  id             uuid primary key default gen_random_uuid(),
  node_id        text references public.nodes(id),
  from_at        timestamptz not null,
  to_at          timestamptz not null,
  format         text not null,
  status         text not null default 'queued',
  file_key       text,
  error_message  text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  constraint report_exports_format_check check (format in ('csv','json')),
  constraint report_exports_status_check check (status in ('queued','processing','done','failed'))
);

create index if not exists idx_report_exports_status
  on public.report_exports(status) where status in ('queued', 'processing');

-- =========================================================
-- Trigger: update node status when sensor data arrives
-- =========================================================
create or replace function public.on_sensor_reading_insert()
returns trigger language plpgsql as $$
begin
  update public.nodes
  set last_seen_at = greatest(coalesce(last_seen_at, 'epoch'), new.recorded_at),
      status = case when deactivated_at is null then 'online' else status end,
      updated_at = now()
  where id = new.node_id;
  return new;
end;
$$;
drop trigger if exists trg_sensor_readings_node_update on public.sensor_readings;
create trigger trg_sensor_readings_node_update after insert on public.sensor_readings
  for each row execute function public.on_sensor_reading_insert();

-- =========================================================
-- Views
-- =========================================================
create or replace view public.v_nodes_active as
select id, node_code, name, lat, lng, status, last_seen_at, created_at, updated_at
from public.nodes
where deactivated_at is null;

create or replace view public.v_sensor_readings_calibrated as
select
  r.id, r.node_id, r.recorded_at, r.created_at, r.topic, r.payload_json, r.ingest_id,
  (r.temperature + c.temperature_offset)::real as temperature,
  (r.turbidity + c.turbidity_offset)::real as turbidity,
  (r.ph + c.ph_offset)::real as ph,
  (r.nh3 + c.nh3_offset)::real as nh3,
  (r.dissolved_oxygen + c.dissolved_oxygen_offset)::real as dissolved_oxygen,
  (r.flow_rate + c.flow_rate_offset)::real as flow_rate,
  r.wqi
from public.sensor_readings r
cross join lateral (
  select * from public.calibration_settings
  where (scope = 'node' and node_id = r.node_id) or (scope = 'global' and node_id is null)
  order by (scope = 'node') desc
  limit 1
) c;
