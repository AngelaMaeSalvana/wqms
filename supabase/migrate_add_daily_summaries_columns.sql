-- Run in Supabase SQL Editor if daily_summaries exists without min/avg/max columns
-- (e.g. created from an older schema)

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
