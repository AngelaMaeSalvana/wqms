# WQMS Supabase Database

## Setup (new project)

1. In [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**.
2. Run the full schema once:
   - Open **schema.sql** and run it. This creates:
     - `profiles` (linked to `auth.users`, with unique `username`)
     - `sensor_readings` – single table for all sensor/forwarder data (bridge + API)
     - `alerts`
     - `daily_summaries`
     - `nodes` (with seed data)
     - RLS policies, indexes, `set_updated_at` trigger, and `refresh_daily_summaries` function.

## Auth migration notes (important)

`schema.sql` now assumes authenticated client access and no longer keeps open `Allow all` policies.

Rollout order:

1. Ensure Auth is configured in Supabase (email + OAuth providers, redirect URLs).
2. Ensure backend writes use `SUPABASE_SERVICE_ROLE_KEY` (server-only).
3. Update frontend to require user sign-in before data screens.
4. Run updated `schema.sql` to add `profiles` and switch RLS policies to authenticated defaults.
5. Verify:
   - Authenticated user can read app data.
   - Unauthenticated user is denied by RLS.
   - Authenticated user can only read/update their own `profiles` row.

For signup flows, create one `profiles` row per user (`profiles.id = auth.users.id`) and store the unique `username`.

## Access levels

The app now uses two roles in `profiles.role`:

- `admin` - full access (settings changes, exports, write endpoints)
- `guest` - view-only access

New users default to `guest`. Promote a user to System Admin in SQL:

```sql
update profiles
set role = 'admin'
where id = '<auth_user_uuid>';
```

Role is also mirrored to `auth.users.raw_app_meta_data.role` so it appears in Supabase Auth user details.

## Existing database (migrations)

If you already have tables and only need new columns or fixes:

1. Run **migrations/001_add_missing_columns.sql** (adds `flow_rate`, alert fields, `last_maintenance`, `avg_flow_rate`; safe if `sensor_readings` is missing).
2. Run **migrations/002_tan_flowrate_remove_nh3_wqi.sql** to switch to TAN (drop `nh3`/`wqi` from readings), add `tan` and `flow_rate`, and use `avg_tan` in daily_summaries. NH3 and WQI are calculated in the app.

## Refreshing daily summaries

From SQL Editor or any Postgres client:

```sql
-- Refresh a date range (e.g. last 30 days)
SELECT * FROM refresh_daily_summaries(
  (current_date - interval '30 days')::date,
  current_date
);

-- Refresh a single day
SELECT * FROM refresh_daily_summaries(current_date, current_date);
```

You can call this from your backend or a cron job after new readings are inserted.

## Data model (TAN, no stored NH3/WQI)

- **Readings** store raw sensor data: `temperature`, `turbidity`, `ph`, **`tan`** (Total Ammonia Nitrogen), `dissolved_oxygen`, **`flow_rate`**. NH3 is calculated from TAN, pH, and temperature; WQI is calculated from parameters (DO, NH3, pH, turbidity, temperature) in the app.
- **Daily summaries** store `avg_tan`, `avg_flow_rate`, and optionally computed `avg_wqi` (app or `refresh_daily_summaries` can leave it null for app-side calculation).

## Tables overview

| Table             | Purpose |
|-------------------|--------|
| `sensor_readings` | All sensor/forwarder data (MQTT bridge + API + dashboard); columns: `tan`, `flow_rate`, etc. |
| `alerts`          | Alerts (severity, status, thresholds) |
| `daily_summaries` | Per-day, per-node aggregates for reports |
| `nodes`           | Node metadata (name, location, status, lat/lng) |

## Environment

- **Client**: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`
- **Server / Bridge**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; bridge writes to `sensor_readings` by default
