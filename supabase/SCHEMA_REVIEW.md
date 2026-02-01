# WQMS Node-Only Schema — Review & Suggestions

## Verdict: **Correct and well-structured**

The schema is valid, consistent, and fits the Forwarder → HiveMQ → Supabase → UI flow. Below are minor fixes, optional improvements, and **app/bridge alignment notes** so the client and bridge work with this schema.

---

## 1. What’s already good

- **Nodes**: UUID PK, unique `node_code`, status check, indexes on `status` and `last_seen_at`, `set_updated_at` trigger.
- **sensor_readings**: Identity PK, FK to `nodes` with CASCADE, `(node_id, recorded_at)` unique for dedup, indexes for time-series queries, `topic`/`payload_json`/`ingest_id` for debugging.
- **daily_summaries**: Min/avg/max per parameter, `(node_id, date)` unique.
- **thresholds / calibration_settings**: Scope (global/node) with check and `(scope, node_id)` unique; initial global row inserted.
- **alerts**: Type, severity, status, acknowledged/resolved timestamps; index on `(node_id, triggered_at desc)`.
- **notifications / report_exports**: Sensible structure.
- **Trigger** `on_sensor_reading_insert`: Updates node `last_seen_at` and `status = 'online'` correctly.
- **View** `v_sensor_readings_calibrated`: Lateral join picks node calibration then global; works as long as the global calibration row exists (you ensure that).

---

## 2. Suggested fixes (small)

### 2.1 **Prefer soft delete (deactivate) for nodes**

**Recommendation: do not delete nodes; deactivate them.** That way:

- All FKs (sensor_readings, daily_summaries, alerts, report_exports, etc.) stay valid.
- Reports and exports never lose node context (“which node was this?”).
- You can reactivate a node later if needed.

Add to `nodes`:

```sql
deactivated_at timestamptz default null   -- null = active, set = deactivated
```

- “Delete” a node: `update nodes set deactivated_at = now(), updated_at = now() where id = $1;`
- List active nodes: `where deactivated_at is null` (or use a view `v_nodes_active`).
- Reports: query all nodes (active + deactivated) so history is complete.

See **`schema_soft_delete_nodes.sql`** for the full patch (column, index, optional view).

### 2.2 `updated_at` on thresholds and calibration_settings

You have `updated_at` columns but no triggers. For consistency with `nodes`:

```sql
-- After creating thresholds table:
drop trigger if exists trg_thresholds_updated_at on public.thresholds;
create trigger trg_thresholds_updated_at
  before update on public.thresholds
  for each row execute function public.set_updated_at();

-- After creating calibration_settings table:
drop trigger if exists trg_calibration_settings_updated_at on public.calibration_settings;
create trigger trg_calibration_settings_updated_at
  before update on public.calibration_settings
  for each row execute function public.set_updated_at();
```

---

## 3. Optional improvements

### 3.1 Row Level Security (RLS) for Supabase

If the dashboard uses the anon key, enable RLS and define policies instead of relying only on the service role:

```sql
-- Example: sensor_readings
alter table public.sensor_readings enable row level security;

create policy "Service role full access"
  on public.sensor_readings for all
  using (true) with check (true);

-- If anon should only read (e.g. Reports):
create policy "Anon read sensor_readings"
  on public.sensor_readings for select
  using (true);
```

Repeat the pattern for `nodes`, `daily_summaries`, `alerts`, etc., as needed.

### 3.2 Optional CHECKs on sensor_readings (data quality)

Reject obviously invalid values at the DB layer:

```sql
-- Add after sensor_readings creation (optional):
alter table public.sensor_readings
  add constraint chk_ph_range check (ph is null or (ph >= 0 and ph <= 14)),
  add constraint chk_temperature_celsius check (temperature is null or (temperature >= -50 and temperature <= 100));
```

Adjust ranges to your real-world limits.

### 3.3 Index for report export queue workers

If a worker polls by status:

```sql
create index if not exists idx_report_exports_status
  on public.report_exports(status)
  where status in ('queued', 'processing');
```

### 3.4 Unread notifications

If you often query “unread” notifications:

```sql
create index if not exists idx_notifications_read_at
  on public.notifications(read_at)
  where read_at is null;
```

### 3.5 Nodes: optional lat/lng sanity check

```sql
-- Optional, add to nodes:
alter table public.nodes
  add constraint chk_lat check (lat is null or (lat >= -90 and lat <= 90)),
  add constraint chk_lng check (lng is null or (lng >= -180 and lng <= 180));
```

---

## 4. Critical: align app and bridge with this schema

Your current **bridge** and **client** were written for a different shape. For this schema to work end-to-end:

### 4.1 `sensor_readings`

| Current (bridge/client) | This schema |
|-------------------------|------------|
| `node_id` text (e.g. N1) | `node_id` **uuid** (FK to `nodes.id`) |
| `timestamp` | **`recorded_at`** |
| No `topic` / `payload_json` / `ingest_id` | Optional `topic`, `payload_json`, `ingest_id` |
| No `flow_rate` | `flow_rate` present |

- **Bridge**: Before insert, resolve node identifier (e.g. `N1`, `N-001`) to `nodes.id` (uuid) via `nodes.node_code`. Use column **`recorded_at`** (not `timestamp`). Optionally set `topic`, `payload_json`, `ingest_id`.
- **Client** (`getSensorReadings`, etc.): Query and order by **`recorded_at`**, and use `node_id` as uuid.

### 4.2 `nodes`

| Current (client) | This schema |
|------------------|------------|
| `id` (likely text) | `id` **uuid**, **`node_code`** text (e.g. N-001) |
| `location` | No `location` (use `name`, or add a column if needed) |

- **Client**: Use `node_code` for display/keys if you want (e.g. N-001). For Supabase as source of truth, select `id`, `node_code`, `name`, `lat`, `lng`, `status`, `last_seen_at`. Add `location` to the schema only if the UI still needs it.

### 4.3 `alerts`

| Current (client) | This schema |
|------------------|------------|
| `timestamp` | **`triggered_at`** |
| `title`, `detail` | **`message`** (and optional `parameter`, `value`) |

- **Client**: Use **`triggered_at`** for ordering/filtering and **`message`** (and optionally `parameter`/`value`) for display. Add a `title` column to the schema only if you want to keep that in the UI.

---

## 5. Deduplication and `(node_id, recorded_at)`

The unique constraint `(node_id, recorded_at)` allows at most one row per node per timestamp. If the device or forwarder can send multiple readings in the same second, either:

- **Round/truncate** `recorded_at` (e.g. to the second) in the bridge before insert, or
- Use **INSERT ... ON CONFLICT (node_id, recorded_at) DO UPDATE** to upsert (e.g. update payload_json or other fields).

---

## 6. Summary

- **Schema**: Correct; only small improvements suggested (e.g. `ON DELETE SET NULL` on `report_exports.node_id`, `updated_at` triggers on thresholds/calibration).
- **Optional**: RLS policies, CHECKs on key columns, extra indexes for reports/notifications/queue workers.
- **Required for this schema**: Update bridge to use **uuid `node_id`** (from `nodes` by `node_code`) and **`recorded_at`**; update client to use **`recorded_at`**, **`triggered_at`**, and **`message`** (and node columns) as above.

---

## 7. Soft delete (deactivate) for nodes — recommended

**Prefer “no delete, deactivate”** so reports and exports never lose node context:

- Add `deactivated_at timestamptz` to `nodes` (null = active).
- “Delete” = `update nodes set deactivated_at = now()`; never `delete from nodes`.
- Active lists: `where deactivated_at is null` or use `v_nodes_active`.
- Reports: include all nodes (active + deactivated) so history is complete.

See **`schema_soft_delete_nodes.sql`** for the full patch.
