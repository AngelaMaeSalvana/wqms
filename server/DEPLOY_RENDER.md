# Deploy the MQTT Bridge to Render

Step-by-step to run the bridge 24/7 on Render so HiveMQ data flows to Supabase without your PC.

---

## 1. Push your repo to GitHub

If you haven’t already, push your WQMS repo (including the `server` folder and `render.yaml` at the repo root) to GitHub.

---

## 2. Create the Background Worker on Render

1. Go to **[render.com](https://render.com)** and sign in (GitHub is fine).
2. Click **New +** → **Background Worker**.
3. **Connect repository**: choose your GitHub account and the **wqms** (or your repo name) repository.
4. Render may detect `render.yaml`. If it shows **Apply Blueprint** or **Create from Blueprint**, use that and skip to step 5.  
   If you’re filling the form manually, use:

   | Field | Value |
   |-------|--------|
   | **Name** | `wqms-mqtt-bridge` (or any name) |
   | **Root Directory** | `server` |
   | **Runtime** | Node |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm run bridge` |
   | **Plan** | Starter (Render’s free tier usually doesn’t include background workers; Starter is the lowest for workers) |

5. Click **Create Background Worker** (or **Apply** if using Blueprint).

---

## 3. Set environment variables

In the worker’s **Environment** tab, add:

| Key | Value | Notes |
|-----|--------|--------|
| `MQTT_URL` | `mqtts://c085e007016c498f841249078237ab48.s1.eu.hivemq.cloud:8883` | Your HiveMQ cluster URL (mqtts or wss) |
| `MQTT_USER` | `WaterQuality` | Your HiveMQ username |
| `MQTT_PASS` | (your HiveMQ password) | Same as in your forwarder |
| `SUPABASE_URL` | `https://htrqixgpmbncbkifizty.supabase.co` | From Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | (your service_role key) | From Supabase → Settings → API (keep secret) |
| `SUPABASE_TABLE` | `sensor_readings` | Optional; default is `sensor_readings` |

If you used the Blueprint with `sync: false`, Render will have prompted you for these when creating the service. If not, add them manually under **Environment**.

---

## 4. Deploy

1. Click **Manual Deploy** → **Deploy latest commit** (or push a commit to trigger a deploy).
2. Open the **Logs** tab. You should see something like:
   - `[MQTT] Connecting: mqtts://...`
   - `[MQTT] Connected`
   - `[MQTT] Subscribed to water-quality/#`
3. When the forwarder (or test script) publishes to HiveMQ, you should see:
   - `[MQTT] Received: water-quality/node1`
   - `✅ DB insert OK | node_id=N1 | id=...`

---

## 5. Check Supabase and the dashboard

- In **Supabase** → Table Editor → **sensor_readings**, new rows should appear as data is published.
- Your **WQMS dashboard** (e.g. on Vercel) reads from Supabase, so new data will show there after refresh or when the app refetches.

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| Build fails | Ensure **Root Directory** is `server` and that `server/package.json` and `server/bridge.js` exist. |
| "MQTT_URL is required" | Add `MQTT_URL` (and other vars) under **Environment** and redeploy. |
| "DB insert failed" | Check `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and that the `sensor_readings` table exists and RLS allows the service role to insert. |
| Worker exits or no logs | Check **Logs** for errors; ensure **Start Command** is exactly `npm run bridge`. |

---

## Summary

- **Render** runs the bridge 24/7 as a Background Worker.
- **Start command** is `npm run bridge` (from the `server` directory).
- **Env vars** must include MQTT (URL, user, pass) and Supabase (URL, service_role key).
- After deploy, MQTT data from HiveMQ is written to Supabase automatically; no need to run the bridge locally.
