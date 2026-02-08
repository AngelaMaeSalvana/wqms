/**
 * WQMS MQTT → Supabase Bridge
 *
 * Standalone always-on service that:
 * - Connects to HiveMQ Cloud via MQTT over WebSockets (WSS)
 * - Subscribes to water-quality/# (variable nodes)
 * - Ignores topics ending in /command
 * - Parses JSON, extracts nodeId from topic or payload
 * - Inserts into Supabase (sensor_readings or water_quality_readings)
 *
 * This is the ONLY component that subscribes to MQTT sensor data and writes to the DB.
 *
 * Requires: mqtt, @supabase/supabase-js
 * Run: node bridge.js  (or: node -r dotenv/config bridge.js to load .env)
 */

// Load .env from server directory (same .env as rest of project)
const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (_) { /* optional */ }

const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');

// ---------- Environment (use same .env: MQTT_* / SUPABASE_* or REACT_APP_* fallbacks) ----------
let MQTT_URL = process.env.MQTT_URL || process.env.REACT_APP_MQTT_WS_URL || '';
// Normalize HiveMQ Cloud: mqtt://host (no port) → mqtts://host:8883 for Node
if (MQTT_URL && MQTT_URL.startsWith('mqtt://') && MQTT_URL.includes('hivemq') && !/:\d+(\/|$)/.test(MQTT_URL.slice(7))) {
  MQTT_URL = 'mqtts://' + MQTT_URL.slice(7) + ':8883';
}
const MQTT_USER = process.env.MQTT_USER || process.env.REACT_APP_MQTT_USER || '';
const MQTT_PASS = process.env.MQTT_PASS || process.env.REACT_APP_MQTT_PASS || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'sensor_readings';

if (!MQTT_URL) {
  console.error('❌ Set MQTT_URL or REACT_APP_MQTT_WS_URL in .env');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------- Helpers ----------

/** Extract nodeId from topic water-quality/{nodeId} */
function nodeIdFromTopic(topic) {
  const parts = topic.split('/');
  if (parts[0] === 'water-quality' && parts[1] && parts[1] !== 'command') return parts[1];
  return null;
}

/** Map node ID to nodes table format N1, N2, N3 (e.g. node1 → N1, N-001 → N1). */
function normalizeNodeId(id) {
  if (!id || typeof id !== 'string') return id;
  const s = id.trim();
  const m = s.match(/^N-?(\d+)$/i) || s.match(/^node(\d+)$/i);
  if (m) return 'N' + String(parseInt(m[1], 10));
  return s;
}

/** Build DB row from parsed JSON (topic + payload). */
function payloadToRow(topic, data) {
  const rawId = data.nodeId ?? data.node ?? nodeIdFromTopic(topic) ?? 'unknown';
  const nodeId = normalizeNodeId(rawId);
  const timestamp = data.timestamp || new Date().toISOString();
  return {
    node_id: nodeId,
    location: data.location ?? 'Unknown',
    temperature: data.temperature ?? null,
    turbidity: data.turbidity ?? null,
    ph: data.pH ?? data.ph ?? null,
    dissolved_oxygen: data.dissolvedOxygen ?? data.do ?? data.dissolved_oxygen ?? null,
    flow_rate: data.flowRate ?? data.flow_rate ?? null,
    seq: data.seq != null ? (typeof data.seq === 'number' ? data.seq : parseInt(data.seq, 10)) : null,
    tx_millis: data.tx_millis != null ? (typeof data.tx_millis === 'number' ? data.tx_millis : parseInt(data.tx_millis, 10)) : null,
    rx_millis: data.rx_millis != null ? (typeof data.rx_millis === 'number' ? data.rx_millis : parseInt(data.rx_millis, 10)) : null,
    timestamp,
  };
}

/** Columns allowed on sensor_readings (no nh3, no tan, no wqi). */
const SENSOR_READINGS_COLUMNS = ['node_id', 'location', 'temperature', 'turbidity', 'ph', 'dissolved_oxygen', 'flow_rate', 'seq', 'tx_millis', 'rx_millis', 'timestamp'];

/** Insert one reading into Supabase. Only whitelisted columns are sent (never nh3/tan/wqi). */
async function insertReading(row) {
  const payload = {};
  for (const k of SENSOR_READINGS_COLUMNS) {
    payload[k] = row[k] ?? null;
  }
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    console.error(`❌ DB insert failed: ${error.message}`);
    return { ok: false, error };
  }
  console.log(`✅ DB insert OK | node_id=${row.node_id} | id=${data?.id ?? '—'}`);
  return { ok: true, data };
}

// ---------- MQTT Client ----------

const opts = {
  clientId: `wqms-bridge-${Math.random().toString(16).slice(2, 10)}`,
  clean: true,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
};
if (MQTT_USER) opts.username = MQTT_USER;
if (MQTT_PASS) opts.password = MQTT_PASS;
if (MQTT_URL.startsWith('wss://') || MQTT_URL.startsWith('mqtts://')) {
  opts.rejectUnauthorized = true;
}

console.log('[MQTT] Connecting:', MQTT_URL.replace(/:[^:@]+@/, ':****@'));

const client = mqtt.connect(MQTT_URL, opts);

client.on('connect', () => {
  console.log('[MQTT] Connected');
  client.subscribe('water-quality/#', { qos: 1 }, (err) => {
    if (err) {
      console.error('[MQTT] Subscribe error:', err);
      return;
    }
    console.log('[MQTT] Subscribed to water-quality/#');
  });
});

client.on('message', (topic, message) => {
  // Ignore command topics
  if (topic.endsWith('/command')) {
    console.log('[MQTT] Ignored (command topic):', topic);
    return;
  }

  let data;
  try {
    data = JSON.parse(message.toString());
  } catch (e) {
    console.error('[MQTT] Invalid JSON:', topic, message.toString().slice(0, 80));
    return;
  }

  console.log('[MQTT] Received:', topic, '| payload:', JSON.stringify(data).slice(0, 120) + (JSON.stringify(data).length > 120 ? '…' : ''));

  const row = payloadToRow(topic, data);
  insertReading(row).catch((err) => {
    console.error('[MQTT] Insert error:', err);
  });
});

client.on('error', (err) => {
  console.error('[MQTT] Error:', err.message);
});

client.on('reconnect', () => {
  console.log('[MQTT] Reconnecting…');
});

client.on('offline', () => {
  console.log('[MQTT] Offline');
});

client.on('close', () => {
  console.log('[MQTT] Connection closed');
});

// Keep process alive
process.on('SIGINT', () => {
  console.log('\n[Bridge] Shutting down…');
  client.end();
  process.exit(0);
});
