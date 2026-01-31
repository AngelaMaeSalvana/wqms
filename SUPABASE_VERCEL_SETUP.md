# Supabase + Vercel Setup (WQMS)

This guide walks you through using **Supabase** as the database for WQMS, with the React app deployed on **Vercel**.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. **New project** → choose org, name, database password, region.
3. Wait for the project to be ready.

## 2. Run the database schema

1. In Supabase Dashboard, open **SQL Editor**.
2. Copy the contents of **`supabase/schema.sql`** from this repo.
3. Paste into the SQL Editor and **Run**.
4. This creates:
   - `water_quality_readings` – sensor readings
   - `alerts` – alerts
   - `daily_summaries` – daily aggregates for reports
   - `nodes` – monitoring nodes (with default seed rows)
   - RLS policies so the app can read/write with the anon key

## 3. Get your Supabase keys

1. In Supabase Dashboard go to **Settings → API**.
2. Note:
   - **Project URL** → `REACT_APP_SUPABASE_URL` (client) and `SUPABASE_URL` (server)
   - **anon public** key → `REACT_APP_SUPABASE_ANON_KEY` (client)
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (server only; keep secret)

## 4. Configure Vercel (client)

1. In [Vercel](https://vercel.com), open your project (the **client** app).
2. **Settings → Environment Variables**.
3. Add:

   | Name                         | Value                    | Environment   |
   |------------------------------|--------------------------|---------------|
   | `REACT_APP_SUPABASE_URL`     | `https://xxx.supabase.co`| All           |
   | `REACT_APP_SUPABASE_ANON_KEY` | your anon key          | All           |

4. Add your existing MQTT vars if you use them:  
   `REACT_APP_MQTT_WS_URL`, `REACT_APP_MQTT_USER`, `REACT_APP_MQTT_PASS`.
5. **Apply to**: check **Production** (and **Preview** if you use branch deploys).
6. **Redeploy**: Deployments → open the latest → ⋮ → **Redeploy** (or **Redeploy with existing Build Cache** off if you changed env vars and it still shows "Not connected").

When these are set, the React app uses Supabase for readings, alerts, and nodes instead of (or in addition to) the backend API.

### If Vercel still shows "DB: Not connected"

- **Use exact names**: `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` (Create React App only exposes `REACT_APP_*`). Do **not** use `NEXT_PUBLIC_SUPABASE_*` for this app.
- **Apply to the right env**: If you only added vars to "Preview", Production builds won’t see them. Add to **Production** (and Preview if needed).
- **Redeploy after adding vars**: Env vars are baked in at **build** time. After adding or changing them, trigger a new deployment.
- **No typos**: URL should be like `https://htrqixgpmbncbkifizty.supabase.co` (no trailing slash). Anon key is the long JWT from Supabase → Settings → API → anon **public**.

## 5. Backend / MQTT ingestion (optional)

If you run the **Express server** (e.g. for MQTT → DB):

- Set **server** env vars (locally or on your host, e.g. Railway/Render):
  - `SUPABASE_URL` = same Project URL
  - `SUPABASE_SERVICE_ROLE_KEY` = service_role key (never expose in the client)
  - `MQTT_URL` (and `MQTT_USER` / `MQTT_PASS` if needed)

With these set, the server writes MQTT readings and alerts to Supabase instead of SQLite.  
If you don’t set them, the server keeps using SQLite (`wqms.db`).

## 6. Local development

**Client (React):**

- Copy `client/.env.example` to `client/.env`.
- Set `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY`.
- Run `npm start` in `client/`.

**Server (optional):**

- Copy `server/.env.example` to `server/.env`.
- Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to use Supabase, or leave them unset to use SQLite.
- Run `npm start` in `server/`.

## Summary

| Where        | Env vars |
|--------------|----------|
| **Vercel (client)** | `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` |
| **Server**   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and MQTT vars if used) |

- **Database**: Run `supabase/schema.sql` once in the Supabase SQL Editor.
- **Client**: With Supabase env vars set on Vercel, the app uses Supabase for data.
- **Server**: With Supabase env vars set, MQTT data is stored in Supabase; otherwise the server uses SQLite.
