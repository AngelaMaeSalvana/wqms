# WQMS — Complete Documentation

Single reference for the Water Quality Monitoring System: architecture, setup, hardware, server, client, and troubleshooting.

---

## Table of Contents

1. [System overview & architecture](#1-system-overview--architecture)
2. [Setup — new system](#2-setup--new-system)
3. [Supabase & Vercel setup](#3-supabase--vercel-setup)
4. [MQTT — quick start & broker setup](#4-mqtt--quick-start--broker-setup)
5. [ESP32 LoRa setup](#5-esp32-lora-setup)
6. [Microcontroller integration](#6-microcontroller-integration)
7. [Server (Node.js / MQTT bridge)](#7-server-nodejs--mqtt-bridge)
8. [Deploy MQTT bridge (24/7)](#8-deploy-mqtt-bridge-247)
9. [Deploy server to Render](#9-deploy-server-to-render)
10. [Testing (forwarder → HiveMQ → bridge → Supabase)](#10-testing-forwarder--hivemq--bridge--supabase)
11. [Client (React dashboard)](#11-client-react-dashboard)
12. [Deploy client to Vercel](#12-deploy-client-to-vercel)
13. [Dashboard page logic](#13-dashboard-page-logic)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. System overview & architecture

*Source: NEW_SYSTEM_FLOW.md, SYSTEM_FLOW.md*

### Updated architecture

- **Nodes (IoT sensors)** — Collect real-time water quality data (temperature, turbidity, pH, NH₃, dissolved oxygen, WQI).
- **Microcontroller** — Processes sensor signals and transmits data wirelessly to the MQTT broker.
- **MQTT broker** — Receives sensor data, publishes to Web Dashboard and Backend; manages real-time distribution.
- **Backend server** — Subscribes to MQTT, processes/filters data, stores to Database, provides REST API for historical data.
- **Database** — Stores filtered sensor data, alerts, daily summaries for historical tracking and analysis.
- **Web dashboard** — Subscribes to MQTT for live updates; requests historical data from Backend API; displays charts, metrics, alerts.

### Data flow

**Real-time:**
```
Nodes → Microcontroller → MQTT Broker → Web Dashboard (live)
                                    ↓
                                 Backend → Database (storage)
```

**Historical:**
```
Web Dashboard → Backend → Database
Web Dashboard ← Backend ← Database
```

### MQTT topics

- `water-quality/node1`, `water-quality/node2`, `water-quality/all`, `water-quality/+`
- `sensor-data/+`, `alerts/+`

### Expected MQTT message format

```json
{
  "nodeId": "1",
  "temperature": 25.5,
  "turbidity": 15.2,
  "pH": 7.0,
  "nh3": 0.5,
  "dissolvedOxygen": 8.2,
  "wqi": 45,
  "location": "Villanueva",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Backend API endpoints

- **Health:** `GET /api/health`
- **Readings:** `GET /api/readings/latest?nodeId=1`, `GET /api/readings?startDate=...&endDate=...&nodeId=1&limit=100`, `GET /api/readings/date/:date?nodeId=1`, `POST /api/readings`
- **Summaries:** `GET /api/summaries/daily?startDate=...&endDate=...&nodeId=1`
- **Alerts:** `GET /api/alerts?limit=50&severity=high`, `POST /api/alerts`

### Database schema (overview)

- **water_quality_readings** — id, node_id, location, temperature, turbidity, ph, nh3, dissolved_oxygen, wqi, timestamp
- **alerts** — id, node_id, title, detail, severity, timestamp
- **daily_summaries** — id, date, node_id, location, avg_*, min_wqi, max_wqi, reading_count

---

## 2. Setup — new system

*Source: SETUP_NEW_SYSTEM.md*

### Prerequisites

- Node.js v14+
- npm or yarn

### Steps

1. **Backend:** `cd server && npm install`
2. **Frontend:** `cd client && npm install`
3. **Environment**
   - **server/.env:** `PORT=5000`, `MQTT_URL` or `REACT_APP_MQTT_WS_URL` (e.g. `mqtt://xxx.s1.eu.hivemq.cloud`), `REACT_APP_MQTT_USER`, `REACT_APP_MQTT_PASS`
   - **client/.env:** `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`, `REACT_APP_MQTT_WS_URL`, `REACT_APP_MQTT_USER`, `REACT_APP_MQTT_PASS`
4. **MQTT:** Uses HiveMQ Cloud (no local broker needed)
5. **Start backend:** `cd server && npm start` or `npm run dev`
6. **Start frontend:** `cd client && npm start`

### Features

- **Frontend:** Real-time (MQTT), historical (API), fallback data, calendar, reports, alerts.
- **Backend:** MQTT subscription, SQLite (or Supabase) storage, daily summaries, REST API, CORS.

---

## 3. Supabase & Vercel setup

*Source: SUPABASE_VERCEL_SETUP.md*

1. **Create Supabase project** at supabase.com; run **`supabase/schema.sql`** in SQL Editor (creates tables + RLS).
2. **Get keys:** Settings → API → Project URL, anon key, service_role key.
3. **Vercel (client):** Settings → Environment Variables: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`; optional MQTT vars; redeploy.
4. **End-to-end:** Sensor node → LoRa → Forwarder (Heltec) → HiveMQ Cloud → Node bridge → Supabase; dashboard on Vercel reads from Supabase.
5. **Server (optional):** Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, MQTT vars; server writes MQTT to Supabase (otherwise uses SQLite).
6. **Local:** client uses `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY`; server optional with same Supabase vars.

---

## 4. MQTT — HiveMQ Cloud

WQMS uses **HiveMQ Cloud** as the MQTT broker. No local broker (e.g. Mosquitto) is required.

### Configuration

- **server/.env:** `REACT_APP_MQTT_WS_URL=mqtt://xxx.s1.eu.hivemq.cloud`, `REACT_APP_MQTT_USER`, `REACT_APP_MQTT_PASS` (or `MQTT_URL`, `MQTT_USER`, `MQTT_PASS`)
- **client/.env:** Same vars. The client auto-converts `mqtt://` HiveMQ URLs to `wss://` for browser WebSocket.

### Verify

- Connection indicator (top-right): green “Live” = connected to HiveMQ.
- Browser console: “MQTT Connected to broker: …”.
- Server/bridge: “✅ MQTT Connected to broker” or “Subscribed to water-quality/#”.

### Publish test

Use HiveMQ MQTT CLI or `server/scripts/test.js` (or `npm run test-publish` in server) to publish to `water-quality/node1`.

---

## 5. ESP32 LoRa setup

*Source: ESP32_LORA_SETUP.md*

### Hardware

- ESP32 LoRa (e.g. Heltec, TTGO), water quality sensors (temperature, turbidity, pH, NH3, dissolved O₂), USB cable, jumper wires.

### Software

- Arduino IDE; add ESP32 board URL; install “esp32” by Espressif; install **PubSubClient**, **ArduinoJson**.

### Pins (config.h)

| Sensor   | Default Pin | Notes        |
|----------|-------------|--------------|
| Temperature | GPIO34 | ADC1_CH6   |
| Turbidity   | GPIO35 | ADC1_CH7   |
| pH          | GPIO32 | ADC1_CH4   |
| NH3         | GPIO33 | ADC1_CH5   |
| Dissolved O₂| GPIO36 | ADC1_CH0   |

### Configuration (config.h)

- `WIFI_SSID`, `WIFI_PASSWORD`
- `MQTT_BROKER_IP` (from `node server/get-ip.js` on server)
- `NODE_ID`, `NODE_LOCATION`, `PUBLISH_INTERVAL_MS`
- Sensor calibration and pin overrides as needed

### Upload

- Open `esp32-lora-node/esp32_wqms_node.ino`; verify board/port; Verify → Upload; Serial Monitor 115200.

### Testing

- Serial: WiFi connected, MQTT connected, sensor readings, “Data published successfully” to `water-quality/node1`.
- Backend running; check API `GET /api/readings/latest?nodeId=1` and dashboard.

### Troubleshooting

- WiFi: SSID/password, 2.4 GHz, range.
- MQTT: broker running, correct IP, firewall 1883.
- Sensors: power, pins, calibration (0–3.3 V); capacitors/averaging for stability.
- Upload: USB drivers (CH340/CP2102), BOOT button, upload speed 115200.

---

## 6. Microcontroller integration

*Source: MICROCONTROLLER_INTEGRATION.md*

- **Local network:** Microcontroller and broker on same WiFi; no internet; low latency.
- **Cloud:** HiveMQ Cloud, etc.; internet required; scalable.
- **Requirements:** WiFi-enabled MCU (ESP32/ESP8266), MQTT client, JSON encoding.
- **Topics:** Publish to `water-quality/node1` (and similar) in the JSON format above.
- **Broker TCP:** For MCU (non-WebSocket), ensure broker listens on 1883; test broker script may need TCP listener.
- **Cloud:** Use broker URL and credentials in MCU code; consider TLS.

See **ESP32 LoRa setup** and **Server** sections for full flow and bridge.

---

## 7. Server (Node.js / MQTT bridge)

*Source: server/README.md, server/BRIDGE_README.md*

### Role

- Subscribes to HiveMQ (`water-quality/#`), stores readings in Supabase (or SQLite), exposes REST API.

### Prerequisites

- Node.js 18+ (or 16+), npm.

### Install & config

```bash
cd server
npm install
cp .env.example .env
```

**.env:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MQTT_URL` (e.g. `mqtts://...hivemq.cloud:8883`), `MQTT_USER`, `MQTT_PASS`, optional `PORT`. If Supabase vars are empty, server uses SQLite (`wqms.db`).

### Run

- **Production:** `npm start`
- **Development:** `npm run dev`
- **Bridge only (MQTT → DB):** `npm run bridge` or `node bridge.js`

Bridge: connect to HiveMQ over WSS, subscribe `water-quality/#`, ignore `.../command`, parse JSON, insert into Supabase (table configurable via `SUPABASE_TABLE`).

### Quick reference

- Health: `GET http://localhost:5000/api/health`
- Readings: `GET http://localhost:5000/api/readings?limit=10`
- Topics: `water-quality/#`, `sensor-data/+`, `alerts/+` (QoS 1)

---

## 8. Deploy MQTT bridge (24/7)

*Source: server/DEPLOY_BRIDGE.md*

- Bridge must run 24/7 to receive MQTT and write to Supabase. **Do not use Vercel** (serverless cannot hold long-lived MQTT).

### Railway

- New Project → Deploy from GitHub → Root Directory `server`. Variables: MQTT_URL, MQTT_USER, MQTT_PASS, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_TABLE. Start command: `npm run bridge`.

### Render

- New → Background Worker; repo → Root `server`; Build: `npm install`; Start: `npm run bridge`; same env vars.

### Fly.io

- `fly launch --no-deploy` in `server`; set secrets (MQTT_*, SUPABASE_*); in `fly.toml` set `cmd = ["node", "bridge.js"]` or `npm run bridge`; `fly deploy`.

---

## 9. Deploy server to Render

*Source: server/DEPLOY_RENDER.md*

- New → Background Worker; connect repo; Root Directory `server`; Build `npm install`; Start `npm run bridge`. Environment: MQTT_URL, MQTT_USER, MQTT_PASS, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_TABLE. Deploy and check Logs for MQTT connect and DB insert messages.

---

## 10. Testing (forwarder → HiveMQ → bridge → Supabase)

*Source: server/TESTING.md*

### Without hardware

1. Start bridge: `cd server && npm run bridge` (wait for “Subscribed to water-quality/#”).
2. Publish test: `cd server && npm run test-publish`.
3. Check: bridge log “Received” + “DB insert OK”; Supabase table new row; dashboard refresh.

### With LoRa forwarder

1. Bridge running as above.
2. Forwarder (Heltec): same HiveMQ credentials and WiFi; upload sketch and power.
3. Optional: sensor node sending LoRa; forwarder publishes `water-quality/{nodeId}`.
4. Confirm: forwarder OLED, bridge logs, dashboard readings.

---

## 11. Client (React dashboard)

*Source: client/README.md*

- **Run:** `npm start` → [http://localhost:3000](http://localhost:3000)
- **Build:** `npm run build`
- **Tests:** `npm test`
- Create React App; see CRA docs for deployment and advanced config.

---

## 12. Deploy client to Vercel

*Source: client/DEPLOY_VERCEL.md*

1. Vercel → Add New → Project → import repo; **Root Directory** = `client`.
2. Environment variables: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`; optional: `REACT_APP_MQTT_URL`, `REACT_APP_MQTT_USER`, `REACT_APP_MQTT_PASS`.
3. Deploy; app at `https://your-project.vercel.app`. Data from Supabase (and MQTT if configured).

CLI: `cd client && npx vercel`; set root; add env vars; `npx vercel --prod`.

---

## 13. Dashboard page logic

*Source: docs/dashboard_page_logic.md*

### Today’s overview

- Data: today’s readings for selected node (API, calibrated). Derived: low/avg/high per parameter. **TodayCard** shows one row per parameter; empty state when no data.

### WQI

- One WQI for the day and selected node: use daily parameter averages as input to `calculateWQI()`; label from `getWQIClass(wqi)`. **WqiCard** shows value and label.

### Live chart

- Today’s time series for selected node; updates on refresh and ~30 min auto-refresh; no mock data when empty. Concept: default sampling interval (e.g. 15 min); adaptive sampling when flow rate changes (firmware/backend); dashboard displays and can explain in tooltip/Settings.

### Mini map

- Nodes with lat/lng; center on selected node; markers; “Test sensor” per node using `useSensorTest(getReadingsForNode)`.

### Alerts summary

- Total count, severity breakdown (Critical / Warning / Info), recent list (e.g. 5), sort by severity then newest. Map `high`→Critical, `medium`→Warning, `low`/`info`→Info. Empty: “No alerts — all systems operating normally.” “See all alerts” → Alerts page. Sensor test failures can create alerts and appear here and on Alerts page.

### Data flow summary

Nodes + today’s readings (API, calibrated) → readingsByNode → selected node → todayData, todayStats, wqiValue/wqiLabel, alerts (buildAlertsForAllNodes), sensor test (getReadingsForNode). Refresh: manual + auto (e.g. 30 min or from Settings default interval).

---

## 14. Troubleshooting

*Source: TROUBLESHOOTING.md*

### MQTT disconnected

1. **Browser console (F12):** Check connection attempts and errors.
2. **HiveMQ config:** Verify `REACT_APP_MQTT_WS_URL`, `REACT_APP_MQTT_USER`, `REACT_APP_MQTT_PASS` in client `.env`.
3. **Server:** Verify `MQTT_URL` or `REACT_APP_MQTT_WS_URL` and credentials in server `.env`.

### Common issues

- **Wrong URL:** Use HiveMQ Cloud URL (e.g. `mqtt://xxx.s1.eu.hivemq.cloud`); no port in URL (auto 8883 server, 8884 browser).
- **Credentials:** HiveMQ Cloud requires username and password.
- **ECONNREFUSED localhost:1883:** Server is using localhost fallback — set `REACT_APP_MQTT_WS_URL` in server `.env`.

### Backend not connecting to MQTT

- Set `MQTT_URL` or `REACT_APP_MQTT_WS_URL` in server `.env` for HiveMQ. Server skips MQTT if not configured.

### Frontend not getting API data

- Backend on port 5000; correct REACT_APP_API_URL; browser console; frontend falls back to deterministic data if API fails.

### Database not created

- File permissions in server directory; backend logs; DB is created on first run.

---

*End of merged documentation. Original files remain in the repo for reference.*
