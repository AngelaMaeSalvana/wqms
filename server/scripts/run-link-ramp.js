/**
 * Link-quality ramp publisher (RSSI/SNR walk-away simulation).
 *
 * Publishes "normal" sensor readings at a fixed cadence while RSSI/SNR
 * gradually degrade from strong → weak over the run.
 *
 * Usage:
 *   node scripts/run-link-ramp.js --minutes 9 --interval-seconds 5
 *   node scripts/run-link-ramp.js --minutes 9 --interval-seconds 5 --node node2 --test-run-id <uuid>
 *   node scripts/run-link-ramp.js --minutes 9 --interval-seconds 5 --rssi-start -55 --rssi-end -115 --snr-start 12 --snr-end -10
 *
 * Notes:
 * - Requires MQTT_URL (or REACT_APP_MQTT_WS_URL) in server/.env
 * - Publishes to: water-quality/<node>
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
  console.error('❌  Set MQTT_URL or REACT_APP_MQTT_WS_URL in server/.env');
  process.exit(1);
}

const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : fallback;
}
function hasArg(name) {
  return args.includes(name);
}

const minutes = Math.max(1, parseInt(getArg('--minutes', '9'), 10) || 9);
const intervalSeconds = Math.max(1, parseInt(getArg('--interval-seconds', '5'), 10) || 5);
const nodeArg = getArg('--node', 'node1');
const testRunId = getArg('--test-run-id', null);

const rssiStart = parseInt(getArg('--rssi-start', '-55'), 10);
const rssiEnd = parseInt(getArg('--rssi-end', '-115'), 10);
const snrStart = parseFloat(getArg('--snr-start', '12'));
const snrEnd = parseFloat(getArg('--snr-end', '-10'));
const noiseRssi = Math.max(0, parseInt(getArg('--noise-rssi', '1'), 10) || 0);
const noiseSnr = Math.max(0, parseFloat(getArg('--noise-snr', '0.5')) || 0);

const durationMs = minutes * 60 * 1000;
const intervalMs = intervalSeconds * 1000;
const total = Math.max(1, Math.floor(durationMs / intervalMs));

function rand(min, max, dp = 2) {
  const n = min + Math.random() * (max - min);
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function jitterInt(n, jitter) {
  if (!jitter) return n;
  return n + randInt(-jitter, jitter);
}
function jitterFloat(n, jitter) {
  if (!jitter) return n;
  return n + rand(-jitter, jitter, 2);
}

function basePayload(seq, overrides = {}) {
  const now = Date.now();
  const tx_millis = randInt(10000, 2000000);
  const rx_millis = tx_millis + randInt(20, 400);
  return {
    nodeId: nodeArg,
    seq,
    temperature: rand(20, 26),
    turbidity: rand(1, 5),
    ph: rand(6.8, 8.2),
    dissolved_oxygen: rand(6.5, 9.0),
    flow_rate: rand(0.5, 5.0),
    tx_millis,
    rx_millis,
    location: 'Test Location',
    timestamp: new Date(now).toISOString(),
    t_node: now,
    t_fwd_rx: now + randInt(50, 300),
    t_fwd_pub: now + randInt(310, 600),
    ...overrides,
  };
}

const topic = 'water-quality/' + nodeArg;
const opts = { clientId: 'wqms-link-ramp-' + Date.now(), clean: true };
if (MQTT_USER) opts.username = MQTT_USER;
if (MQTT_PASS) opts.password = MQTT_PASS;
if (MQTT_URL.startsWith('mqtts://')) opts.rejectUnauthorized = true;

console.log('\n[LinkRamp] Starting link-quality ramp');
console.log(`[LinkRamp] Node            : ${nodeArg}`);
console.log(`[LinkRamp] Topic           : ${topic}`);
console.log(`[LinkRamp] Duration        : ${minutes} min (${durationMs} ms)`);
console.log(`[LinkRamp] Interval        : ${intervalSeconds}s (${intervalMs} ms)`);
console.log(`[LinkRamp] Total payloads   : ~${total}`);
console.log(`[LinkRamp] RSSI ramp        : ${rssiStart} → ${rssiEnd} dBm (noise ±${noiseRssi})`);
console.log(`[LinkRamp] SNR ramp         : ${snrStart} → ${snrEnd} dB (noise ±${noiseSnr})`);
if (testRunId) console.log(`[LinkRamp] Test run id      : ${testRunId}`);
if (hasArg('--dry-run')) console.log('[LinkRamp] Dry run enabled: will not publish.');
console.log('');

const client = mqtt.connect(MQTT_URL, opts);

let sent = 0;
let startedAt = null;
let timer = null;

function buildReading(i) {
  const t = total <= 1 ? 1 : i / (total - 1);
  const rssi = jitterInt(Math.round(lerp(rssiStart, rssiEnd, t)), noiseRssi);
  const snr = jitterFloat(lerp(snrStart, snrEnd, t), noiseSnr);
  const payload = basePayload(i + 1, {
    rssi: clamp(rssi, -140, -20),
    snr: Math.round(clamp(snr, -30, 30) * 10) / 10,
  });
  if (testRunId) payload.test_run_id = testRunId;
  return payload;
}

function publishOnce() {
  const i = sent;
  if (i >= total) return;
  const payloadObj = buildReading(i);
  const payload = JSON.stringify(payloadObj);
  const time = new Date().toLocaleTimeString();

  if (hasArg('--dry-run')) {
    sent++;
    console.log(`[${time}] [LinkRamp] (dry) ${sent}/${total} rssi=${payloadObj.rssi} snr=${payloadObj.snr}`);
    return;
  }

  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error('[LinkRamp] Publish error:', err.message || err);
      cleanup(1);
      return;
    }
    sent++;
    console.log(`[${time}] [LinkRamp] ✓ ${sent}/${total} rssi=${payloadObj.rssi} snr=${payloadObj.snr}`);
  });
}

function cleanup(code) {
  if (timer) clearInterval(timer);
  try { client.end(); } catch (_) {}
  process.exit(code);
}

client.on('connect', () => {
  startedAt = Date.now();
  console.log('[LinkRamp] Connected to MQTT.\n');
  publishOnce();
  timer = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= durationMs || sent >= total) {
      console.log(`\n[LinkRamp] Done. Sent ${sent} payload(s).`);
      cleanup(0);
      return;
    }
    publishOnce();
  }, intervalMs);

  // Safety timeout measured from successful connect (not process start),
  // so slow DNS/TLS handshakes won't truncate the run early.
  setTimeout(() => {
    console.warn('\n[LinkRamp] Safety timeout reached, stopping.');
    cleanup(0);
  }, durationMs + 60000);
});

client.on('error', (err) => {
  console.error('[LinkRamp] MQTT error:', err.message || err);
  cleanup(1);
});

