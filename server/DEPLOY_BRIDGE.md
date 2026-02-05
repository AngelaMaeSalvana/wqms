# Deploy the MQTT Bridge (run 24/7 without your PC)

**You only get MQTT data in Supabase when the bridge is running.** If you don’t run it locally, you need to run it in the cloud so it stays connected to HiveMQ and writes to Supabase automatically.

---

## Why deploy the bridge?

- **Locally**: While `npm run bridge` is running on your machine, data flows. When you close the terminal or turn off the PC, it stops.
- **In the cloud**: The bridge runs 24/7 on a host. Your LoRa forwarder → HiveMQ → bridge → Supabase keeps working without your PC.

**Vercel cannot run the bridge** (serverless = no long-lived MQTT connection). Use **Railway**, **Render**, or **Fly.io** instead.

---

## Option A: Railway

1. Go to [railway.app](https://railway.app) and sign in (GitHub is fine).
2. **New Project** → **Deploy from GitHub repo** → select your WQMS repo.
3. Set **Root Directory** to `server` (so Railway uses the `server` folder).
4. **Variables** (Settings → Variables): add the same env vars you use locally (from `server/.env`):
   - `MQTT_URL` = `mqtts://YOUR_CLUSTER.s1.eu.hivemq.cloud:8883`  
     (or `wss://YOUR_CLUSTER.s1.eu.hivemq.cloud:8884/mqtt` for WSS)
   - `MQTT_USER` = your HiveMQ username  
   - `MQTT_PASS` = your HiveMQ password  
   - `SUPABASE_URL` = `https://YOUR_PROJECT.supabase.co`  
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service_role key  
   - `SUPABASE_TABLE` = `sensor_readings` (or `water_quality_readings`)
5. **Settings → Deploy**:
   - **Start Command**: `npm run bridge`  
     (so it runs the bridge instead of `npm start` / Express).
6. Deploy. Once it’s running, the bridge will connect to HiveMQ and write to Supabase; your dashboard (e.g. on Vercel) will show new data as it arrives.

---

## Option B: Render

1. Go to [render.com](https://render.com) and sign in.
2. **New +** → **Background Worker** (not Web Service).
3. Connect your GitHub repo.
4. **Root Directory**: `server`.
5. **Build Command**: `npm install`.
6. **Start Command**: `npm run bridge`.
7. **Environment**: add the same variables as in Option A:
   - `MQTT_URL`, `MQTT_USER`, `MQTT_PASS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_TABLE` (optional).
8. Create the worker. Render will run the bridge 24/7; data from HiveMQ will be written to Supabase.

---

## Option C: Fly.io

1. Install [flyctl](https://fly.io/docs/hands-on/install-flyctl/) and sign in: `fly auth login`.
2. From your repo root:
   ```bash
   cd server
   fly launch --no-deploy
   ```
   When asked for an app name, choose one. Say no to PostgreSQL if offered (you use Supabase).
3. Set secrets (env vars):
   ```bash
   fly secrets set MQTT_URL="mqtts://YOUR_CLUSTER.s1.eu.hivemq.cloud:8883"
   fly secrets set MQTT_USER="your_username"
   fly secrets set MQTT_PASS="your_password"
   fly secrets set SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
   fly secrets set SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
   fly secrets set SUPABASE_TABLE="sensor_readings"
   ```
4. Edit `fly.toml` (in `server/`) so the app runs the bridge:
   - Set `cmd = ["node", "bridge.js"]` or `cmd = ["npm", "run", "bridge"]` in `[app]` or in the `[[services]]` section (see Fly docs for your setup).
5. Deploy:
   ```bash
   fly deploy
   ```
   The bridge will run on Fly and receive MQTT data from HiveMQ.

---

## Checklist

| Step | Action |
|------|--------|
| 1 | Deploy the **bridge** to Railway / Render / Fly.io (start command: `npm run bridge`). |
| 2 | Set **env vars** on the host: MQTT (URL, user, pass) + Supabase (URL, service_role key, optional table). |
| 3 | Ensure **Supabase** has `sensor_readings` (or `water_quality_readings`) and RLS so the service role can insert. |
| 4 | Deploy the **dashboard** to Vercel as usual; it reads from Supabase, so no MQTT on Vercel. |

Once the bridge is running in the cloud, you don’t need to run it locally; HiveMQ data will be written to Supabase automatically and your dashboard will show it.
