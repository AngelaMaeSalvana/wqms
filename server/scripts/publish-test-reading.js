/**
 * Publish one test reading to HiveMQ (simulates LoRa forwarder).
 * Use this to verify: MQTT → Bridge → Supabase without the physical forwarder.
 *
 * Run: node scripts/publish-test-reading.js
 * (from server/ directory; loads .env)
 */

const path = require('path');
const mqtt = require('mqtt');

try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (_) {}

let MQTT_URL = process.env.MQTT_URL || process.env.REACT_APP_MQTT_WS_URL || '';
if (MQTT_URL && MQTT_URL.startsWith('mqtt://') && MQTT_URL.includes('hivemq') && !/:\d+(\/|$)/.test(MQTT_URL.slice(7))) {
  MQTT_URL = 'mqtts://' + MQTT_URL.slice(7) + ':8883';
}
const MQTT_USER = process.env.MQTT_USER || process.env.REACT_APP_MQTT_USER || '';
const MQTT_PASS = process.env.MQTT_PASS || process.env.REACT_APP_MQTT_PASS || '';

if (!MQTT_URL) {
  console.error('❌ Set MQTT_URL or REACT_APP_MQTT_WS_URL in .env');
  process.exit(1);
}

const topic = 'water-quality/node1';
const payload = JSON.stringify({
  nodeId: 'node1', // bridge maps to N1 to match nodes table
  seq: Math.floor(Math.random() * 10000),
  temperature: 25.2,
  turbidity: 12.0,
  ph: 7.1,
  nh3: 0.3,
  dissolved_oxygen: 7.5,
  wqi: 85,
  location: 'Test Location',
  timestamp: new Date().toISOString(),
});

const opts = { clientId: 'wqms-test-pub-' + Date.now(), clean: true };
if (MQTT_USER) opts.username = MQTT_USER;
if (MQTT_PASS) opts.password = MQTT_PASS;
if (MQTT_URL.startsWith('mqtts://')) opts.rejectUnauthorized = true;

console.log('[Test] Connecting to HiveMQ...');
const client = mqtt.connect(MQTT_URL, opts);

client.on('connect', () => {
  console.log('[Test] Connected. Publishing to', topic);
  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error('[Test] Publish error:', err);
      process.exit(1);
    }
    console.log('[Test] Published:', payload.slice(0, 80) + '...');
    client.end();
  });
});

client.on('error', (err) => {
  console.error('[Test] MQTT error:', err.message);
  process.exit(1);
});

client.on('close', () => {
  console.log('[Test] Done. If the bridge is running, you should see the reading in Supabase and on the dashboard.');
  process.exit(0);
});

setTimeout(() => {
  console.error('[Test] Timeout');
  process.exit(1);
}, 15000);
