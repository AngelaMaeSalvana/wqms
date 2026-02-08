/**
 * Publish test reading(s) to HiveMQ (simulates LoRa forwarder).
 * Use this to verify: MQTT → Bridge → Supabase without the physical forwarder.
 *
 * Schema (sensor_readings): node_id, location, temperature, turbidity, ph,
 * dissolved_oxygen, flow_rate, seq, tx_millis, rx_millis, timestamp. No TAN; NH3 default 0.5 mg/L in app.
 *
 * ~40% of readings include one parameter exceeding alert thresholds (temp, pH, turbidity, or DO)
 * so you can test threshold alerts on the dashboard.
 *
 * Run: node scripts/test.js [count]
 * (from server/ directory; loads .env)
 * Optional: count = number of readings to send (default 1).
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

const publishCount = Math.max(1, parseInt(process.argv[2], 10) || 1);

// Match client DEFAULT_THRESHOLDS (alertsData.js) for predictable alert testing
const THRESHOLDS = {
  temperatureMin: 18,
  temperatureMax: 30,
  pHMin: 6.5,
  pHMax: 8.5,
  turbidityMax: 25,
  dissolvedOxygenMin: 4,
  nh3Max: 0.5,
};

/** Random value between min and max, optional decimal places. */
function rand(min, max, decimals = 1) {
  const n = min + Math.random() * (max - min);
  return decimals === 0 ? Math.round(n) : Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/** ~40% chance to include at least one value exceeding thresholds (for alerts testing). */
const ALERT_BREACH_PROBABILITY = 0.4;

/** Random integer in [min, max] (inclusive). */
function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Build one test payload. Randomly includes out-of-range values when ALERT_BREACH_PROBABILITY. */
function buildPayload(overrides = {}) {
  // Simulate ESP32 millis(): tx when node sent, rx when gateway received (rx >= tx, small delay)
  const tx_millis = randInt(10000, 2000000);
  const rx_millis = tx_millis + randInt(20, 400);

  const base = {
    nodeId: 'node1',
    seq: Math.floor(Math.random() * 10000),
    temperature: rand(THRESHOLDS.temperatureMin, THRESHOLDS.temperatureMax),
    turbidity: rand(1, THRESHOLDS.turbidityMax),
    ph: rand(THRESHOLDS.pHMin, THRESHOLDS.pHMax),
    dissolved_oxygen: rand(THRESHOLDS.dissolvedOxygenMin, 12.0),
    flow_rate: rand(0.5, 5.0),
    tx_millis,
    rx_millis,
    location: 'Test Location',
    timestamp: new Date().toISOString(),
  };

  if (Math.random() < ALERT_BREACH_PROBABILITY) {
    const breach = Math.floor(Math.random() * 4); // 0=temp, 1=pH, 2=turbidity, 3=DO
    if (breach === 0) {
      base.temperature = Math.random() < 0.5
        ? rand(10, THRESHOLDS.temperatureMin - 0.5)
        : rand(THRESHOLDS.temperatureMax + 0.5, 38);
    } else if (breach === 1) {
      base.ph = Math.random() < 0.5
        ? rand(4.5, THRESHOLDS.pHMin - 0.2)
        : rand(THRESHOLDS.pHMax + 0.2, 9.5);
    } else if (breach === 2) {
      base.turbidity = rand(THRESHOLDS.turbidityMax + 1, 60);
    } else {
      base.dissolved_oxygen = rand(0.5, THRESHOLDS.dissolvedOxygenMin - 0.5);
    }
  }

  return { ...base, ...overrides };
}

const topic = 'water-quality/node1';

const opts = { clientId: 'wqms-test-pub-' + Date.now(), clean: true };
if (MQTT_USER) opts.username = MQTT_USER;
if (MQTT_PASS) opts.password = MQTT_PASS;
if (MQTT_URL.startsWith('mqtts://')) opts.rejectUnauthorized = true;

console.log('[Test] Connecting to HiveMQ...');
const client = mqtt.connect(MQTT_URL, opts);

let published = 0;
function publishNext() {
  if (published >= publishCount) {
    client.end();
    return;
  }
  const payloadObj = buildPayload();
  const payload = JSON.stringify(payloadObj);
  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error('[Test] Publish error:', err);
      process.exit(1);
    }
    published++;
    console.log('[Test] Published', published, '/', publishCount, ':', payload.slice(0, 100) + (payload.length > 100 ? '…' : ''));
    publishNext();
  });
}

client.on('connect', () => {
  console.log('[Test] Connected. Publishing', publishCount, 'reading(s) to', topic);
  publishNext();
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
