# MQTT → Supabase Bridge

Standalone **always-on** Node.js service: subscribes to HiveMQ Cloud (WSS), parses `water-quality/#` messages, and inserts into Supabase. This is the **only** component that writes MQTT sensor data to the database.

## Requirements

- **Node.js** 18+ (or 16+)
- **npm** packages: `mqtt`, `@supabase/supabase-js` (already in `package.json`)

## Setup

1. **Environment**

   Copy and edit env:

   ```bash
   cp .env.bridge.example .env
   ```

   Set:

   | Variable | Description |
   |----------|-------------|
   | `MQTT_URL` | **WSS** URL, e.g. `wss://YOUR_CLUSTER.s1.eu.hivemq.cloud:8884/mqtt` |
   | `MQTT_USER` | HiveMQ username (e.g. `WaterQuality`) |
   | `MQTT_PASS` | HiveMQ password |
   | `SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |
   | `SUPABASE_TABLE` | Optional; default `sensor_readings` (or `water_quality_readings`) |

2. **Supabase table**

   - Either run **`supabase/schema_sensor_readings.sql`** in Supabase SQL Editor to create `sensor_readings`, or
   - Use your existing `water_quality_readings` table and set `SUPABASE_TABLE=water_quality_readings`.

3. **Run**

   ```bash
   npm run bridge
   # or
   node bridge.js
   ```

   Load env from file (e.g. `.env`) with `dotenv` or your host’s env (Railway, Render, etc.).

## Behavior

- Connects to HiveMQ over **WSS** (WebSockets).
- Subscribes to **`water-quality/#`** (all nodes).
- **Ignores** topics ending in **`/command`**.
- For each message: parses JSON, gets **nodeId** from payload `nodeId`/`node` or from topic `water-quality/{nodeId}`, builds a row, inserts into Supabase.
- **Logs**: connection status, topic + payload, insert success/failure.

## Example payload (from forwarder)

```json
{
  "nodeId": "node1",
  "seq": 42,
  "temperature": 25.2,
  "turbidity": 12.0,
  "ph": 7.1,
  "nh3": 0.3,
  "dissolved_oxygen": 7.5,
  "wqi": 85,
  "location": "River A",
  "timestamp": "2025-02-01T10:00:00.000Z"
}
```

## Deploy (24/7)

Run this process on **Railway**, **Render**, **Fly.io**, or a VPS. Do **not** use Vercel (serverless); the bridge must keep a long-lived MQTT connection.
