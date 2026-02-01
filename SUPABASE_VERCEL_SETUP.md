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
5. **Redeploy** so the new env vars are applied.

When these are set, the React app uses Supabase for readings, alerts, and nodes instead of (or in addition to) the backend API.

## 5. LoRa → HiveMQ → Supabase → WQMS dashboard (Vercel)

**Yes, this is possible.** End-to-end flow:

```
Sensor node → LoRa → Forwarder (Heltec LoRa32) → HiveMQ Cloud → Node server (bridge) → Supabase
                                                                                           ↓
WQMS dashboard (Vercel) ←─────────────────────────────────────────────────────────────── Supabase
```

- **Forwarder**: Your Arduino code receives LoRa packets, sends ACK, and publishes JSON to HiveMQ topic `water-quality/{nodeId}`. No change needed.
- **Bridge**: The **Node server** in this repo subscribes to HiveMQ and inserts each message into Supabase. It must run **24/7** (e.g. **Railway**, **Render**, **Fly.io**). **Vercel is serverless** — you cannot run the MQTT subscriber on Vercel.
- **Dashboard**: The React app on Vercel reads from Supabase. No backend needed for the frontend when using Supabase.

**Server env vars for HiveMQ Cloud** (match your packet forwarder):

| Variable | Example |
|----------|---------|
| `MQTT_URL` | `mqtts://YOUR_CLUSTER.s1.eu.hivemq.cloud:8883` |
| `MQTT_USER` | `WaterQuality` |
| `MQTT_PASS` | your HiveMQ password |
| `SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (server only) |

Deploy the server to Railway/Render with these env vars; the dashboard on Vercel will show data from Supabase as soon as the forwarder publishes to HiveMQ.

## 6. Backend / MQTT ingestion (optional)

If you run the **Express server** (e.g. for MQTT → DB):

- Set **server** env vars (locally or on your host, e.g. Railway/Render):
  - `SUPABASE_URL` = same Project URL
  - `SUPABASE_SERVICE_ROLE_KEY` = service_role key (never expose in the client)
  - `MQTT_URL` = `mqtts://YOUR_CLUSTER.s1.eu.hivemq.cloud:8883` for HiveMQ Cloud
  - `MQTT_USER` and `MQTT_PASS` = HiveMQ credentials

With these set, the server writes MQTT readings and alerts to Supabase instead of SQLite.  
If you don’t set them, the server keeps using SQLite (`wqms.db`).

## 7. Local development

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
