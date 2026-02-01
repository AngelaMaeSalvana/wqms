# Testing the forwarder → HiveMQ → Bridge → Supabase

## Option A: Test without hardware (simulate forwarder)

1. **Start the bridge** (in one terminal):
   ```bash
   cd server
   npm run bridge
   ```
   Wait until you see: `[MQTT] Subscribed to water-quality/#`

2. **Publish a test reading** (in another terminal):
   ```bash
   cd server
   npm run test-publish
   ```
   This sends one JSON message to `water-quality/node1` on HiveMQ (same format as your LoRa forwarder).

3. **Check**:
   - Bridge terminal should log: `[MQTT] Received: water-quality/node1` and `✅ DB insert OK`
   - Supabase Dashboard → Table Editor → `water_quality_readings` → new row
   - WQMS dashboard (Vercel or local) → refresh → new reading for node1

---

## Option B: Plug the real LoRa forwarder

1. **Bridge running** (same as above):
   ```bash
   cd server
   npm run bridge
   ```

2. **Forwarder** (Heltec LoRa32):
   - Same HiveMQ credentials in the sketch: `MQTT_HOST` (your cluster), `MQTT_USER`, `MQTT_PASS`
   - WiFi: same SSID/password so it can reach HiveMQ Cloud
   - Upload the forwarder sketch and power the board

3. **Sensor node** (optional for end-to-end):
   - If you have a sender node that transmits LoRa packets, the forwarder will receive them, send ACK, and publish to `water-quality/{nodeId}`. The bridge will then insert into Supabase.

4. **What you’ll see**:
   - Forwarder OLED: “Forwarded OK” / “Sent to HiveMQ” when it publishes
   - Bridge terminal: `[MQTT] Received: water-quality/node1` (or node2, etc.) and `✅ DB insert OK`
   - Dashboard: new readings for the node

---

## Checklist

| Step | Action |
|------|--------|
| 1 | Bridge running (`npm run bridge`) |
| 2 | Same .env: MQTT + Supabase (bridge writes to `water_quality_readings`) |
| 3 | Test without hardware: `npm run test-publish` → check bridge log + Supabase + dashboard |
| 4 | Or: power forwarder (same HiveMQ + WiFi) and send LoRa from sensor → check same places |

If the test publisher works but the real forwarder doesn’t, check: forwarder Serial log for “Published”/errors, WiFi, and HiveMQ credentials in the sketch.
