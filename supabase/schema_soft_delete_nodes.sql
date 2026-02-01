-- =========================================================
-- Soft delete for NODES: deactivate instead of delete
-- Keeps all FKs intact so reports/exports never lose node data.
-- =========================================================

-- Add deactivation column to nodes (run after main schema)
alter table public.nodes
  add column if not exists deactivated_at timestamptz default null;

comment on column public.nodes.deactivated_at is
  'When set, node is deactivated (soft-deleted). Null = active.';

-- Index for "active nodes only" lists (dashboard, dropdowns)
create index if not exists idx_nodes_active
  on public.nodes(node_code)
  where deactivated_at is null;

-- Optional: view for "active nodes only" (use in UI for node pickers)
create or replace view public.v_nodes_active as
select id, node_code, name, lat, lng, status, last_seen_at, created_at, updated_at
from public.nodes
where deactivated_at is null;

-- Usage:
--   "Delete" a node:   update nodes set deactivated_at = now(), updated_at = now() where id = $1;
--   Reactivate:        update nodes set deactivated_at = null, updated_at = now() where id = $1;
--   List active:       select * from v_nodes_active;  or  where deactivated_at is null
--   Reports:           include all nodes (active + deactivated) so history is complete.
--   Bridge:            optionally skip inserting readings for nodes where deactivated_at is not null.