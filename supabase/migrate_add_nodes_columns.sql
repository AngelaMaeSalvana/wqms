-- Run in Supabase SQL Editor if nodes table exists but is missing columns
-- (e.g. created from an older schema)

alter table public.nodes add column if not exists node_code text;
alter table public.nodes add column if not exists last_seen_at timestamptz;
alter table public.nodes add column if not exists deactivated_at timestamptz default null;

-- Optional: backfill node_code for existing rows (then you can add unique/not null)
-- update public.nodes set node_code = 'N-' || replace(id::text, '-', '') where node_code is null;

-- If sensor_readings exists with timestamp instead of recorded_at:
alter table public.sensor_readings add column if not exists recorded_at timestamptz;
alter table public.sensor_readings add column if not exists topic text;
alter table public.sensor_readings add column if not exists payload_json jsonb;
alter table public.sensor_readings add column if not exists ingest_id uuid;
alter table public.sensor_readings add column if not exists flow_rate real;
-- Optional: copy from timestamp: update public.sensor_readings set recorded_at = timestamp where recorded_at is null;

-- If alerts exists with timestamp instead of triggered_at:
alter table public.alerts add column if not exists triggered_at timestamptz default now();
-- Optional: copy from timestamp: update public.alerts set triggered_at = timestamp where triggered_at is null;
