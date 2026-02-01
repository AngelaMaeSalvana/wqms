-- Run in Supabase SQL Editor if alerts table exists without type/message/etc.
-- (e.g. created from an older schema with title/detail/timestamp)

alter table public.alerts add column if not exists type text;
alter table public.alerts add column if not exists severity text;
alter table public.alerts add column if not exists parameter text;
alter table public.alerts add column if not exists value real;
alter table public.alerts add column if not exists message text;
alter table public.alerts add column if not exists triggered_at timestamptz default now();
alter table public.alerts add column if not exists status text default 'open';
alter table public.alerts add column if not exists acknowledged_at timestamptz;
alter table public.alerts add column if not exists resolved_at timestamptz;
