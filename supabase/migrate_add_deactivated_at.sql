-- Run in Supabase SQL Editor if nodes table exists WITHOUT deactivated_at
-- or to add status=deactivated + trigger (UI updates deactivated_at → status follows)

alter table public.nodes
  add column if not exists deactivated_at timestamptz default null;

comment on column public.nodes.deactivated_at is
  'Updated via UI. When set, node is deactivated; status becomes deactivated. Null = active.';

-- Allow status 'deactivated' (UI shows this when deactivated_at is set)
alter table public.nodes drop constraint if exists nodes_status_check;
alter table public.nodes add constraint nodes_status_check
  check (status in ('online','offline','maintenance','testing','deactivated'));

create index if not exists idx_nodes_active
  on public.nodes(node_code)
  where deactivated_at is null;

-- When UI updates deactivated_at: set status = 'deactivated' or back to 'offline'
create or replace function public.nodes_sync_status_from_deactivated()
returns trigger language plpgsql as $$
begin
  if new.deactivated_at is not null then
    new.status := 'deactivated';
  elsif old.deactivated_at is not null and new.deactivated_at is null then
    new.status := 'offline';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_nodes_sync_status_from_deactivated on public.nodes;
create trigger trg_nodes_sync_status_from_deactivated
before update on public.nodes
for each row execute function public.nodes_sync_status_from_deactivated();

create or replace view public.v_nodes_active as
select id, node_code, name, lat, lng, status, last_seen_at, created_at, updated_at
from public.nodes
where deactivated_at is null;
