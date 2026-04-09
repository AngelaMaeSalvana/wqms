/**
 * Normal river baseline — publishes ordinary in-range telemetry for a long duration.
 *
 * This is NOT test-run mode: payloads never include test_run_id. Readings flow through
 * the bridge like normal node traffic (dashboard, history, alerts — no Reports test run).
 *
 * Values follow a smooth day/night cycle (temperature high in “afternoon”, DO
 * inversely related, modest turbidity/flow variation) with small noise. All
 * values stay comfortably inside default WQMS thresholds (see scripts/test.js).
 *
 * Usage (from server/):
 *   node scripts/river-normal-24h.js
 *   node scripts/river-normal-24h.js --hours 24 --interval-seconds 300
 *   node scripts/river-normal-24h.js --interval-minutes 5 --node node2
 *   node scripts/river-normal-24h.js --dry-run
 *
 * Options:
 *   --hours <n>             Wall-clock duration (default 24)
 *   --interval-seconds <n>  Seconds between publishes (default 300 = 5 min)
 *   --interval-minutes <n>  Same as interval in minutes (overrides seconds if both given)
 *   --node <id>             node1, node2, N1, … (default node1)
 *   --dry-run               Publish 3 samples then exit (sanity check)
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
  console.error('❌  Set MQTT_URL or REACT_APP_MQTT_WS_URL in .env');
  process.exit(1);
}

function argVal(name, def) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return def;
  return process.argv[i + 1];
}

function argNum(name, def) {
  const v = argVal(name, null);
  if (v == null) return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

const hours = Math.max(0.05, argNum('--hours', 24));
const intervalMin = process.argv.includes('--interval-minutes') ? argNum('--interval-minutes', 5) : null;
const intervalSec = intervalMin != null
  ? Math.max(10, intervalMin * 60)
  : Math.max(10, argNum('--interval-seconds', 300));
const nodeArg = argVal('--node', 'node1');
const dryRun = process.argv.includes('--dry-run');

if (process.argv.includes('--test-run-id')) {
  console.warn('[RiverSim] Ignoring --test-run-id: this feed is not test-run mode (no test_run_id on payloads).');
}

const topic = 'water-quality/' + (String(nodeArg).startsWith('node') ? nodeArg : 'node' + nodeArg);

const intervalMs = intervalSec * 1000;
const totalMs = hours * 3600000;
const maxPublishes = dryRun ? 3 : Math.max(1, Math.floor(totalMs / intervalMs));

function rand(min, max, dp = 3) {
  const n = min + Math.random() * (max - min);
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** Synthetic hour 0–24 from elapsed real time (one full diurnal cycle per simulated day). */
function syntheticHour(elapsedMs) {
  return (elapsedMs / 3600000) % 24;
}

function riverPayload(elapsedMs, seq) {
  const h = syntheticHour(elapsedMs);
  const theta = (h / 24) * 2 * Math.PI;
  // Cool at “night” (theta=-pi/2 → sin=-1), warm mid-“day”
  const tempBase = 22 + 3.1 * Math.sin(theta - Math.PI / 2);
  const temperature = clamp(tempBase + rand(-0.25, 0.25), 20.2, 25.9);
  // DO falls slightly as water warms (still well above min 4)
  let dissolvedOxygen = 8.25 - 0.38 * (temperature - 22) + rand(-0.12, 0.12);
  dissolvedOxygen = clamp(dissolvedOxygen, 5.85, 9.8);
  const ph = clamp(7.15 + 0.12 * Math.sin(theta * 2) + rand(-0.04, 0.04), 6.75, 8.05);
  const turbidity = clamp(2.1 + 0.9 * Math.sin(theta * 1.4 + 0.3) + rand(-0.2, 0.35), 1.0, 6.5);
  const flow_rate = clamp(1.8 + 0.9 * Math.sin(theta + 0.6) + rand(-0.15, 0.2), 0.6, 4.2);
  const now = Date.now();
  const tx_millis = randInt(10000, 2000000);
  const rx_millis = tx_millis + randInt(20, 400);
  const o = {
    nodeId: nodeArg.startsWith('node') ? nodeArg : 'node' + nodeArg,
    seq,
    temperature,
    turbidity,
    ph,
    dissolved_oxygen: dissolvedOxygen,
    flow_rate,
    tx_millis,
    rx_millis,
    location: 'River baseline (synthetic)',
    timestamp: new Date(now).toISOString(),
    t_node: now,
    t_fwd_rx: now + randInt(50, 300),
    t_fwd_pub: now + randInt(310, 600),
    rssi: randInt(-82, -68),
    snr: randInt(6, 12),
    tan: clamp(0.15 + 0.08 * Math.sin(theta * 0.8) + rand(-0.02, 0.02), 0.08, 0.35),
  };
  return o;
}

const opts = { clientId: 'wqms-river-sim-' + Date.now(), clean: true };
if (MQTT_USER) opts.username = MQTT_USER;
if (MQTT_PASS) opts.password = MQTT_PASS;
if (MQTT_URL.startsWith('mqtts://')) opts.rejectUnauthorized = true;

console.log('\n[RiverSim] Normal river telemetry');
console.log(`[RiverSim] Duration     : ${hours} h${dryRun ? ' (dry-run: 3 samples)' : ''}`);
console.log(`[RiverSim] Interval     : ${intervalSec}s (~${(3600 / intervalSec).toFixed(2)} readings/h)`);
console.log(`[RiverSim] Max publishes: ${maxPublishes}`);
console.log(`[RiverSim] Topic        : ${topic}`);
console.log('[RiverSim] Mode         : normal telemetry (no test_run_id)');
console.log('[RiverSim] Connecting…\n');

const client = mqtt.connect(MQTT_URL, opts);

let seq = randInt(1, 5000);
let count = 0;
let timer = null;
let startMs = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearTimeout(timer);
  client.end(true, () => {
    console.log('\n[RiverSim] Disconnected. Bye.');
    process.exit(code);
  });
  setTimeout(() => process.exit(code), 4000);
}

function scheduleNext() {
  if (shuttingDown) return;
  if (count >= maxPublishes) {
    console.log(`\n[RiverSim] Completed ${count} publish(es).`);
    shutdown(0);
    return;
  }
  const elapsed = startMs != null ? Date.now() - startMs : 0;
  const payload = riverPayload(elapsed, seq++);
  const json = JSON.stringify(payload);
  client.publish(topic, json, { qos: 1 }, (err) => {
    if (err) {
      console.error('[RiverSim] Publish error:', err);
      shutdown(1);
      return;
    }
    count++;
    const p = payload;
    console.log(
      `[RiverSim] ${count}/${maxPublishes}  h≈${syntheticHour(elapsed).toFixed(2)}` +
        `  DO=${p.dissolved_oxygen}  pH=${p.ph}  turb=${p.turbidity}  temp=${p.temperature}  flow=${p.flow_rate}`,
    );
    if (count >= maxPublishes) {
      console.log(`\n[RiverSim] Completed ${count} publish(es).`);
      shutdown(0);
      return;
    }
    timer = setTimeout(scheduleNext, intervalMs);
  });
}

client.on('connect', () => {
  console.log('[RiverSim] Connected. Publishing…\n');
  startMs = Date.now();
  scheduleNext();
});

client.on('error', (err) => {
  console.error('[RiverSim] MQTT error:', err.message);
  shutdown(1);
});

process.on('SIGINT', () => {
  console.log('\n[RiverSim] SIGINT — stopping…');
  shutdown(0);
});
