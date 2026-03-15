# How to Start Testing

## 1. Test the app with sample data (no sensors)

When sensors are not ready, use the sample data generator:

1. **Enable sample data**  
   In `server/.env` add:
   ```env
   ENABLE_SAMPLE_DATA=1
   ```
   Optional: auto-insert interval (e.g. every 5 seconds):
   ```env
   SAMPLE_DATA_INTERVAL_MS=5000
   ```

2. **Start the server**
   ```bash
   cd server
   npm start
   ```

3. **Generate sample readings**
   - **One-off batch** (e.g. 50 readings):
     ```bash
     curl -X POST http://localhost:5000/api/sample-data/generate -H "Content-Type: application/json" -d "{\"count\": 50}"
     ```
   - **Date range** (e.g. last 7 days, every 15 min):
     ```bash
     curl -X POST http://localhost:5000/api/sample-data/generate -H "Content-Type: application/json" -d "{\"count\": 100, \"startDate\": \"2025-03-01\", \"endDate\": \"2025-03-15\", \"intervalMinutes\": 15}"
     ```
   - **Live stream** (e.g. 1 every 5 s until you stop it):
     ```bash
     curl -X POST http://localhost:5000/api/sample-data/start-interval -H "Content-Type: application/json" -d "{\"intervalMs\": 5000}"
     ```
     Stop: `curl -X POST http://localhost:5000/api/sample-data/stop-interval`

4. **Start the client** and open the dashboard:
   ```bash
   cd client
   npm start
   ```

---

## 2. Frontend (React) unit tests

```bash
cd client
npm test
```

Runs Jest (react-scripts). Use watch mode to re-run on file changes.

---

## 3. Alert logic / MQTT test script (server)

Publishes crafted MQTT readings to test alert thresholds and persistence:

```bash
cd server
node scripts/test.js
```
Single normal reading (no alert).

```bash
node scripts/test.js --scenario high-do
node scripts/test.js --scenario low-do --repeat 3
```

Requires `MQTT_URL` (and optionally `MQTT_USER`, `MQTT_PASS`) in `server/.env`. The backend (or bridge) must be connected to the same MQTT broker so it receives the messages. See `server/scripts/test.js` for all scenarios (`normal`, `low-do`, `medium-do`, `high-do`, `persistence`, `wqi-drop`, etc.).
