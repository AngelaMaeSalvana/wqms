-- Run in Supabase SQL Editor if nodes table exists WITHOUT last_seen_at

alter table public.nodes
  add column if not exists last_seen_at timestamptz;
