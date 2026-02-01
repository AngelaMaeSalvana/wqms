# WQMS Node.js server (MQTT → Supabase bridge)

This server subscribes to HiveMQ (`water-quality/#`), stores readings in Supabase (or SQLite), and exposes a small REST API.

## 1. Prerequisites

- **Node.js** 18+ (or 16+)
- **npm** (comes with Node)

## 2. Install dependencies

```bash
cd server
npm install
```

## 3. Configure environment

Copy the example env file and edit with your values:

```bash
cp .env.example .env
```

Edit **`.env`** and set:

| Variable | Where to get it | Example |
|----------|-----------------|---------|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same → **service_role** key (keep secret) | `eyJhbG...` |
| `MQTT_URL` | HiveMQ Cloud cluster URL (use **mqtts** for TLS) | `mqtts://xxxxx.s1.eu.hivemq.cloud:8883` |
| `MQTT_USER` | HiveMQ username (same as your LoRa forwarder) | `WaterQuality` |
| `MQTT_PASS` | HiveMQ password | your password |
| `PORT` | Optional; default 5000 | `5000` |

- **Supabase**: If you leave `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` empty, the server uses SQLite (`wqms.db`) instead.
- **MQTT**: If you use a local broker, set `MQTT_URL=mqtt://localhost:1883` and you can omit `MQTT_USER` / `MQTT_PASS`.

## 4. Run the server

**Production:**
```bash
npm start
```

**Development (auto-restart on file changes):**
```bash
npm run dev
```

You should see:
- `✅ Using Supabase database` or `✅ Connected to SQLite database`
- `🔌 Connecting to MQTT broker: ...`
- `✅ MQTT Connected to broker`
- `📡 Subscribed to water-quality/#`

Then the server is listening on `http://localhost:5000` (or your `PORT`). Any message on `water-quality/#` from HiveMQ will be stored in the database.

## 5. Deploy (optional)

To keep the MQTT bridge running 24/7 (e.g. for LoRa → HiveMQ → Supabase):

- Deploy this **server** to **Railway**, **Render**, or **Fly.io** (not Vercel — serverless can’t hold a long-lived MQTT connection).
- Set the same env vars in the host’s dashboard (Supabase + MQTT).
- The WQMS dashboard on Vercel can keep reading from Supabase; it doesn’t need this server for reads when using Supabase.

## Quick reference

- **Health:** `GET http://localhost:5000/api/health`
- **Readings:** `GET http://localhost:5000/api/readings?limit=10`
- **MQTT topics:** `water-quality/#`, `sensor-data/+`, `alerts/+` (QoS 1)
