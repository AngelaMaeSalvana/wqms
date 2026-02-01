-- Run in Supabase SQL Editor if tables were created with node_id uuid
-- but nodes.id is text (FK failed). This drops FKs, alters node_id to text, re-adds FKs.

-- thresholds
alter table public.thresholds drop constraint if exists thresholds_node_id_fkey;
alter table public.thresholds alter column node_id type text using node_id::text;
alter table public.thresholds add constraint thresholds_node_id_fkey
  foreign key (node_id) references public.nodes(id) on delete cascade;

-- calibration_settings
alter table public.calibration_settings drop constraint if exists calibration_settings_node_id_fkey;
alter table public.calibration_settings alter column node_id type text using node_id::text;
alter table public.calibration_settings add constraint calibration_settings_node_id_fkey
  foreign key (node_id) references public.nodes(id) on delete cascade;

-- alerts
alter table public.alerts drop constraint if exists alerts_node_id_fkey;
alter table public.alerts alter column node_id type text using node_id::text;
alter table public.alerts add constraint alerts_node_id_fkey
  foreign key (node_id) references public.nodes(id) on delete cascade;

-- report_exports
alter table public.report_exports drop constraint if exists report_exports_node_id_fkey;
alter table public.report_exports alter column node_id type text using node_id::text;
alter table public.report_exports add constraint report_exports_node_id_fkey
  foreign key (node_id) references public.nodes(id);

-- daily_summaries
alter table public.daily_summaries drop constraint if exists daily_summaries_node_id_fkey;
alter table public.daily_summaries alter column node_id type text using node_id::text;
alter table public.daily_summaries add constraint daily_summaries_node_id_fkey
  foreign key (node_id) references public.nodes(id) on delete cascade;

-- sensor_readings
alter table public.sensor_readings drop constraint if exists sensor_readings_node_id_fkey;
alter table public.sensor_readings alter column node_id type text using node_id::text;
alter table public.sensor_readings add constraint sensor_readings_node_id_fkey
  foreign key (node_id) references public.nodes(id) on delete cascade;
