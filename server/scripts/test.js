/**
 * Alert Logic Test Publisher
 *
 * Publishes crafted MQTT readings to exercise the 3-layer alert system:
 *   Layer 1 — Threshold Deviation (LOW / MEDIUM / HIGH)
 *   Layer 2 — Persistence Escalation (repeat readings to escalate)
 *   Layer 3 — WQI Escalation (multi-param degradation, rapid WQI drop)
 *
 * Usage:
 *   node scripts/test.js                  → single normal (no-alert) reading
 *   node scripts/test.js --scenario <name> [--repeat <n>]
 *
 * Scenarios:
 *   normal            All parameters within limits — no alerts expected
 *   low-do            DO just inside early-warning zone (LOW)
 *   medium-do         DO 5–10% below min (MEDIUM)
 *   high-do           DO >10% below min (HIGH)
 *   low-ph            pH just above max (LOW)
 *   medium-ph         pH 5–10% above max (MEDIUM)
 *   high-ph           pH >10% above max (HIGH)
 *   low-turbidity     Turbidity just above max (LOW)
 *   medium-turbidity  Turbidity 5–10% above max (MEDIUM)
 *   high-turbidity    Turbidity >10% above max (HIGH)
 *   low-temp          Temperature just below min (LOW)
 *   high-temp         Temperature >10% above max (HIGH)
 *   low-nh3           NH3 just above max (LOW)
 *   high-nh3          NH3 >10% above max (HIGH)
 *   nh3-slope         NH3 rapid rise (slope alert)
 *   multi-param       Multiple parameters degraded (triggers WQI system-level HIGH)
 *   wqi-drop          Two readings: first good, second bad (WQI rapid drop)
 *   persistence       Send 3 identical LOW-DO readings to escalate via persistence
 *   all-clear         All parameters well within limits — clears persistence counters
 *
 * Long-running normal river baseline (not test-run mode; no test_run_id):
 *   node scripts/river-normal-24h.js
 *   (or: npm run river-normal-24h — from server/)
 *
 * --repeat <n>  Send the same scenario payload n times (useful for persistence testing).
 *
 * Examples:
 *   node scripts/test.js --scenario high-do
 *   node scripts/test.js --scenario low-do --repeat 3
 *   node scripts/test.js --scenario persistence
 *   node scripts/test.js --scenario wqi-drop
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

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const scenarioIdx = args.indexOf('--scenario');
const repeatIdx   = args.indexOf('--repeat');
const testRunIdIdx = args.indexOf('--test-run-id');
const nodeIdx     = args.indexOf('--node');
const scenarioArg = scenarioIdx !== -1 ? args[scenarioIdx + 1] : null;
const repeatCount = repeatIdx   !== -1 ? Math.max(1, parseInt(args[repeatIdx + 1], 10) || 1) : 1;
const testRunId   = testRunIdIdx !== -1 ? args[testRunIdIdx + 1] : null;
const nodeArg     = nodeIdx     !== -1 ? args[nodeIdx + 1] : 'node1';

// ── Thresholds (mirror client DEFAULT_THRESHOLDS) ─────────────────────────────

const T = {
  temperatureMin: 18,
  temperatureMax: 30,
  pHMin: 6.5,
  pHMax: 8.5,
  turbidityMax: 25,
  dissolvedOxygenMin: 4,
  nh3Max: 0.5,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function rand(min, max, dp = 2) {
  const n = min + Math.random() * (max - min);
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Build a base payload with all parameters safely within limits. */
function basePayload(overrides = {}) {
  const now       = Date.now();
  const tx_millis = randInt(10000, 2000000);
  const rx_millis = tx_millis + randInt(20, 400);
  return {
    nodeId:           'node1',
    seq:              randInt(1, 9999),
    temperature:      rand(20, 26),
    turbidity:        rand(1, 5),
    ph:               rand(6.8, 8.2),
    dissolved_oxygen: rand(6.5, 9.0),
    flow_rate:        rand(0.5, 5.0),
    tx_millis,
    rx_millis,
    location:         'Test Location',
    timestamp:        new Date(now).toISOString(),
    t_node:           now,
    t_fwd_rx:         now + randInt(50, 300),
    t_fwd_pub:        now + randInt(310, 600),
    rssi:             randInt(-85, -65),
    snr:              randInt(5, 12),
    ...overrides,
  };
}

// ── Deviation helpers (mirror Layer 1 logic) ──────────────────────────────────
// LOW:    within 5% of limit (just inside early-warning zone)
// MEDIUM: 5–10% beyond limit
// HIGH:   >10% beyond limit

/** Value that is `pct`% below a minimum threshold. */
function belowMin(threshold, pct) {
  return +(threshold * (1 - pct / 100)).toFixed(3);
}

/** Value that is `pct`% above a maximum threshold. */
function aboveMax(threshold, pct) {
  return +(threshold * (1 + pct / 100)).toFixed(3);
}

// ── Scenario definitions ──────────────────────────────────────────────────────

const SCENARIOS = {
  // ── Normal / clear ──────────────────────────────────────────────────────────
  normal: {
    label: 'Normal — all within limits',
    expectedAlerts: 'none',
    payloads: () => [basePayload()],
  },

  'all-clear': {
    label: 'All-clear — well within limits (resets persistence counters)',
    expectedAlerts: 'none',
    payloads: () => [basePayload({
      temperature:      27,
      turbidity:        3,
      ph:               7.2,
      dissolved_oxygen: 8.0,
    })],
  },

  // ── DO scenarios ────────────────────────────────────────────────────────────
  'low-do': {
    label: 'DO — LOW (early warning, within 5% of min)',
    expectedAlerts: 'LOW dissolved oxygen',
    // Within 5% below min: e.g. min=4, value = 4 * (1 - 0.03) = 3.88
    payloads: () => [basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 3) })],
  },

  'medium-do': {
    label: 'DO — MEDIUM (5–10% below min)',
    expectedAlerts: 'MEDIUM dissolved oxygen',
    payloads: () => [basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 7) })],
  },

  'high-do': {
    label: 'DO — HIGH (>10% below min)',
    expectedAlerts: 'HIGH dissolved oxygen',
    payloads: () => [basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 15) })],
  },

  // ── pH scenarios ────────────────────────────────────────────────────────────
  'low-ph': {
    label: 'pH — LOW (just above max, within 5%)',
    expectedAlerts: 'LOW pH too high',
    payloads: () => [basePayload({ ph: aboveMax(T.pHMax, 3) })],
  },

  'medium-ph': {
    label: 'pH — MEDIUM (5–10% above max)',
    expectedAlerts: 'MEDIUM pH too high',
    payloads: () => [basePayload({ ph: aboveMax(T.pHMax, 7) })],
  },

  'high-ph': {
    label: 'pH — HIGH (>10% above max)',
    expectedAlerts: 'HIGH pH too high',
    payloads: () => [basePayload({ ph: aboveMax(T.pHMax, 15) })],
  },

  // ── Turbidity scenarios ─────────────────────────────────────────────────────
  'low-turbidity': {
    label: 'Turbidity — LOW (just above max, within 5%)',
    expectedAlerts: 'LOW high turbidity',
    payloads: () => [basePayload({ turbidity: aboveMax(T.turbidityMax, 3) })],
  },

  'medium-turbidity': {
    label: 'Turbidity — MEDIUM (5–10% above max)',
    expectedAlerts: 'MEDIUM high turbidity',
    payloads: () => [basePayload({ turbidity: aboveMax(T.turbidityMax, 7) })],
  },

  'high-turbidity': {
    label: 'Turbidity — HIGH (>10% above max)',
    expectedAlerts: 'HIGH high turbidity',
    payloads: () => [basePayload({ turbidity: aboveMax(T.turbidityMax, 15) })],
  },

  // ── Temperature scenarios ───────────────────────────────────────────────────
  'low-temp': {
    label: 'Temperature — LOW (just below min, within 5%)',
    expectedAlerts: 'LOW temperature below minimum',
    payloads: () => [basePayload({ temperature: belowMin(T.temperatureMin, 3) })],
  },

  'high-temp': {
    label: 'Temperature — HIGH (>10% above max)',
    expectedAlerts: 'HIGH temperature above maximum',
    payloads: () => [basePayload({ temperature: aboveMax(T.temperatureMax, 15) })],
  },

  // ── NH3 scenarios ───────────────────────────────────────────────────────────
  'low-nh3': {
    label: 'NH3 — LOW (just above max, within 5%)',
    expectedAlerts: 'LOW NH3 above threshold',
    // NH3 is derived from TAN via pH+temp. We set nh3 directly here.
    payloads: () => [basePayload({ nh3: aboveMax(T.nh3Max, 3) })],
  },

  'high-nh3': {
    label: 'NH3 — HIGH (>10% above max)',
    expectedAlerts: 'HIGH NH3 above threshold',
    payloads: () => [basePayload({ nh3: aboveMax(T.nh3Max, 15) })],
  },

  'nh3-slope': {
    label: 'NH3 — Rapid rise (slope alert, always HIGH)',
    expectedAlerts: 'HIGH NH3 rapid rise',
    // First reading: NH3 at 0.2 (below max). Second: jumps to 0.45 (delta = 0.25 > slopeLimit 0.15).
    payloads: () => [
      basePayload({ nh3: 0.2 }),
      basePayload({ nh3: 0.45 }),
    ],
  },

  // ── Multi-param (WQI Layer 3) ───────────────────────────────────────────────
  'multi-param': {
    label: 'Multi-param — 2+ parameters degraded → system-level HIGH (Layer 3)',
    expectedAlerts: 'HIGH system-level + individual MEDIUM/HIGH alerts',
    payloads: () => [basePayload({
      dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 7),   // MEDIUM DO
      turbidity:        aboveMax(T.turbidityMax, 7),          // MEDIUM turbidity
      ph:               aboveMax(T.pHMax, 7),                 // MEDIUM pH
    })],
  },

  // ── WQI rapid drop (Layer 3) ────────────────────────────────────────────────
  'wqi-drop': {
    label: 'WQI rapid drop — first reading good, second very bad (>15 pt WQI drop)',
    expectedAlerts: 'HIGH WQI rapid drop alert',
    payloads: () => [
      // Reading 1: excellent water quality
      basePayload({
        dissolved_oxygen: 8.5,
        turbidity:        2,
        ph:               7.2,
        temperature:      23,
      }),
      // Reading 2: severe degradation — WQI will drop >15 points
      basePayload({
        dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 20),
        turbidity:        aboveMax(T.turbidityMax, 30),
        ph:               aboveMax(T.pHMax, 20),
        temperature:      aboveMax(T.temperatureMax, 15),
      }),
    ],
  },

  // ── Persistence escalation (Layer 2) ────────────────────────────────────────
  persistence: {
    label: 'Persistence — 3× LOW-DO readings → escalates to HIGH via Layer 2',
    expectedAlerts: 'LOW → MEDIUM → HIGH (escalates over 3 readings)',
    // Sends 3 identical LOW-DO readings; persistence counter increments each time.
    payloads: () => [
      basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 3) }),
      basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 3) }),
      basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 3) }),
    ],
  },

  // ── Low battery (test trigger) ──────────────────────────────────────────────
  'low-battery': {
    label: 'Low battery — battery_percentage 8% → HIGH alert',
    expectedAlerts: 'HIGH Low battery',
    payloads: () => [basePayload({ battery_percentage: 8, battery_voltage: 3.35 })],
  },

  // ── Offline (test trigger, UI-only for full simulation) ─────────────────────
  offline: {
    label: 'Node offline — simulated by absence of data (use Scenario Evaluator for full test)',
    expectedAlerts: 'HIGH Node offline',
    payloads: () => [],  // No payloads; offline = no recent data
  },

  // ── Maintenance due (test trigger, UI-only for full simulation) ─────────────
  maintenance: {
    label: 'Maintenance due — depends on node.lastMaintenance (use Scenario Evaluator for full test)',
    expectedAlerts: 'MEDIUM Maintenance due',
    payloads: () => [basePayload()],  // Normal reading; maintenance alert comes from node metadata
  },
};

// ── Print scenario list if no args ────────────────────────────────────────────

if (!scenarioArg) {
  console.log('\nAvailable scenarios (--scenario <name>):\n');
  const maxLen = Math.max(...Object.keys(SCENARIOS).map((k) => k.length));
  for (const [name, s] of Object.entries(SCENARIOS)) {
    console.log(`  ${name.padEnd(maxLen + 2)} ${s.label}`);
  }
  console.log('\nOptions: --scenario <name> [--repeat N] [--test-run-id <uuid>] [--node node1|node2]');
  console.log('\nLong run: node scripts/river-normal-24h.js [--hours 24] [--interval-seconds 300] [--node node1]');
  console.log('\nExamples:');
  console.log('  node scripts/test.js --scenario high-do');
  console.log('  node scripts/test.js --scenario low-do --repeat 3');
  console.log('  node scripts/test.js --scenario persistence');
  console.log('  node scripts/test.js --scenario wqi-drop');
  console.log('  node scripts/test.js --scenario low-battery');
  console.log('  node scripts/test.js --scenario offline   (no payloads; use Scenario Evaluator for full test)');
  console.log('  node scripts/test.js --scenario maintenance (use Scenario Evaluator for full test)\n');
  process.exit(0);
}

const scenario = SCENARIOS[scenarioArg];
if (!scenario) {
  console.error(`❌  Unknown scenario: "${scenarioArg}". Run without arguments to list all scenarios.`);
  process.exit(1);
}

// ── Build publish queue ───────────────────────────────────────────────────────

// Each call to scenario.payloads() re-runs rand() so values differ every time.
// --repeat builds the queue by calling payloads()[0] freshly for each slot.
let queue;
if (repeatCount > 1) {
  const first = scenario.payloads()[0];
  queue = first != null ? Array.from({ length: repeatCount }, () => ({ ...first })) : [];
} else {
  queue = scenario.payloads();
}

if (testRunId) {
  queue = queue.map((p) => ({ ...p, test_run_id: testRunId }));
}

const topic = 'water-quality/' + (nodeArg.startsWith('node') ? nodeArg : 'node' + nodeArg);

// ── MQTT connection ───────────────────────────────────────────────────────────

const opts = { clientId: 'wqms-test-pub-' + Date.now(), clean: true };
if (MQTT_USER) opts.username = MQTT_USER;
if (MQTT_PASS) opts.password = MQTT_PASS;
if (MQTT_URL.startsWith('mqtts://')) opts.rejectUnauthorized = true;

console.log(`\n[Test] Scenario  : ${scenarioArg}`);
console.log(`[Test] Label     : ${scenario.label}`);
console.log(`[Test] Expected  : ${scenario.expectedAlerts}`);
console.log(`[Test] Payloads  : ${queue.length}`);
if (scenarioArg === 'offline' && queue.length === 0) {
  console.log('[Test] Note: Offline = no data. Use Scenario Evaluator "Node offline (test)" for immediate simulation.');
}
if (testRunId) console.log(`[Test] Test Run  : ${testRunId}`);
console.log(`[Test] Topic     : ${topic}\n`);
console.log('[Test] Connecting to MQTT broker...');

const client = mqtt.connect(MQTT_URL, opts);

let published = 0;

function publishNext() {
  if (published >= queue.length) {
    client.end();
    return;
  }
  const payloadObj = queue[published];
  const payload    = JSON.stringify(payloadObj);

  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error('[Test] Publish error:', err);
      process.exit(1);
    }
    published++;

    // Pretty-print key sensor values for this reading
    const p = payloadObj;
    console.log(
      `[Test] ✓ Published ${published}/${queue.length}` +
      `  DO=${p.dissolved_oxygen ?? '—'}` +
      `  pH=${p.ph ?? '—'}` +
      `  turb=${p.turbidity ?? '—'}` +
      `  temp=${p.temperature ?? '—'}` +
      (p.nh3 != null ? `  nh3=${p.nh3}` : '')
    );

    // Small delay between payloads so the bridge processes them in order
    if (published < queue.length) {
      setTimeout(publishNext, 600);
    } else {
      publishNext();
    }
  });
}

client.on('connect', () => {
  console.log('[Test] Connected.\n');
  publishNext();
});

client.on('error', (err) => {
  console.error('[Test] MQTT error:', err.message);
  process.exit(1);
});

client.on('close', () => {
  console.log('\n[Test] Done.');
  console.log('[Test] If the bridge is running, check the dashboard/alerts page for the expected alert.');
  process.exit(0);
});

// Allow 8s for connection + 800ms per payload
const timeoutMs = 8000 + queue.length * 800;
setTimeout(() => {
  console.error('[Test] Timeout — broker did not respond in time.');
  process.exit(1);
}, timeoutMs);
