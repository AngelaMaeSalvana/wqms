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
const { calculateWQI } = require('./utils/nh3Wqi');

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

async function upsertTestRunToSupabase({ id, nodeId, durationMs, intervalMs, startedAt, endsAt }) {
  if (!id) return;
  const dur = Number(durationMs);
  const ivl = Number(intervalMs);
  const sAt = Number.isFinite(Number(startedAt)) ? Number(startedAt) : Date.now();
  const eAt = Number.isFinite(Number(endsAt))
    ? Number(endsAt)
    : (sAt + (Number.isFinite(dur) && dur > 0 ? dur : 0));
  const effectiveDur = Number.isFinite(dur) && dur > 0 ? dur : Math.max(0, eAt - sAt);

  const payload = {
    id: String(id),
    started_at: sAt,
    ends_at: eAt,
    duration_ms: effectiveDur,
    interval_ms: Number.isFinite(ivl) && ivl > 0 ? ivl : 1,
    node_id: nodeId && nodeId !== 'all' ? String(nodeId) : null,
    status: 'running',
  };

  const { error } = await supabase
    .from('test_runs')
    // IMPORTANT: do not overwrite started_at/ends_at on an existing run.
    // The backend is the source of truth for run timing; the bridge should only "ensure exists".
    .upsert(payload, { onConflict: 'id', ignoreDuplicates: true });

  if (error) {
    console.error(`❌ test_runs upsert failed: ${error.message}`);
  } else {
    console.log(`✅ test_runs upsert OK | id=${payload.id} node_id=${payload.node_id ?? 'all'}`);
  }
}

async function markTestRunStoppedInSupabase(id, status = 'stopped') {
  if (!id) return;
  const stoppedAt = Date.now();
  const { error } = await supabase
    .from('test_runs')
    .update({ status, stopped_at: stoppedAt })
    .eq('id', String(id));

  if (error) {
    console.error(`❌ test_runs update failed: ${error.message}`);
  } else {
    console.log(`✅ test_runs update OK | id=${id} status=${status}`);
  }
}

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

/**
 * Build DB row from parsed forwarder JSON + backend reception timestamp.
 *
 * Timestamp chain (all epoch ms / bigint):
 *   t_node    – epoch ms the sensor node transmitted (requires NTP on node; may be 0/null)
 *   t_fwd_rx  – epoch ms the forwarder received the LoRa packet  ← PRIMARY start timestamp
 *   t_fwd_pub – epoch ms the forwarder published to MQTT broker
 *   t_be_rx   – epoch ms this bridge received the MQTT message   ← always Date.now()
 *
 * Forwarder-to-Dashboard latency (computed client-side) = t_dash_rx - t_fwd_rx
 * Backend processing component                           = t_be_rx  - t_fwd_pub
 */
function payloadToRow(topic, data, t_be_rx) {
  const rawId = data.nodeId ?? data.node ?? data.node_id ?? nodeIdFromTopic(topic) ?? 'unknown';
  const nodeId = normalizeNodeId(rawId);
  const timestamp = data.timestamp || new Date().toISOString();

  // seq: accept both seq_id (sender firmware) and seq (bridge alias)
  const seqRaw = data.seq ?? data.seq_id;
  const seq = seqRaw != null ? (typeof seqRaw === 'number' ? seqRaw : parseInt(seqRaw, 10)) : null;

  // t_fwd_rx MUST be preserved exactly as received — it is the canonical start timestamp
  // when sensor nodes do not have reliable NTP (t_node may be 0 or null).
  const t_fwd_rx = data.t_fwd_rx != null ? parseInt(data.t_fwd_rx, 10) : null;
  const t_fwd_pub = data.t_fwd_pub != null ? parseInt(data.t_fwd_pub, 10) : null;
  const t_node = data.t_node != null ? parseInt(data.t_node, 10) : null;

  if (t_fwd_rx == null) {
    console.warn(`[Bridge] ⚠️  t_fwd_rx missing | node=${nodeId} seq=${seq ?? '—'} — latency metrics will be degraded`);
  }

  // Attach test_run_id if there is an active run covering this node
  let test_run_id = data.test_run_id ?? null;
  if (!test_run_id && activeTestRunContext && Date.now() <= activeTestRunContext.endsAt) {
    const ctx = activeTestRunContext;
    if (!ctx.nodeId || ctx.nodeId === 'all' || normalizeNodeId(ctx.nodeId) === nodeId) {
      test_run_id = ctx.id;
    }
  }

  return {
    node_id: nodeId,
    location: data.location ?? 'Unknown',
    temperature: data.temperature ?? null,
    turbidity: data.turbidity ?? null,
    ph: data.pH ?? data.ph ?? null,
    dissolved_oxygen: data.dissolvedOxygen ?? data.do ?? data.dissolved_oxygen ?? null,
    flow_rate: data.flowRate ?? data.flow_rate ?? null,
    seq,
    tx_millis: data.tx_millis != null ? (typeof data.tx_millis === 'number' ? data.tx_millis : parseInt(data.tx_millis, 10)) : null,
    rx_millis: data.rx_millis != null ? (typeof data.rx_millis === 'number' ? data.rx_millis : parseInt(data.rx_millis, 10)) : null,
    timestamp,
    t_node,
    t_fwd_rx,   // preserved exactly from forwarder — PRIMARY latency start
    t_fwd_pub,
    t_be_rx,    // always Date.now() at MQTT message arrival
    test_run_id,
    rssi: data.rssi != null ? parseInt(data.rssi, 10) : null,
    snr:  data.snr  != null ? parseInt(data.snr,  10) : null,
  };
}

/** Columns allowed on sensor_readings (no nh3, no tan, no wqi). */
const SENSOR_READINGS_COLUMNS = [
  'node_id', 'location', 'temperature', 'turbidity', 'ph', 'dissolved_oxygen',
  'flow_rate', 'seq', 'tx_millis', 'rx_millis', 'timestamp',
  't_node', 't_fwd_rx', 't_fwd_pub', 't_be_rx', 'test_run_id',
  'rssi', 'snr',
];

// ─── Active test run context (polled from server every 10 s) ─────────────────
let activeTestRunContext = null; // { id, nodeId, endsAt, intervalMs } | null

const BACKEND_BASE = process.env.BACKEND_URL || 'http://localhost:5000';

async function pollActiveTestRun() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/test-run/active`);
    if (!res.ok) { activeTestRunContext = null; return; }
    const data = await res.json();
    activeTestRunContext = data; // null or { id, nodeId, endsAt, ... }

    // If the bridge starts mid-run, it may miss the test_start MQTT command.
    // Ensure the FK target exists so sensor_readings inserts won't fail.
    if (activeTestRunContext?.id && activeTestRunContext?.endsAt) {
      const startedAt = Number.isFinite(Number(activeTestRunContext.startedAt)) ? Number(activeTestRunContext.startedAt) : null;
      const endsAt = Number.isFinite(Number(activeTestRunContext.endsAt)) ? Number(activeTestRunContext.endsAt) : null;
      const durationMs =
        startedAt != null && endsAt != null ? Math.max(0, endsAt - startedAt) : (activeTestRunContext.durationMs ?? null);
      upsertTestRunToSupabase({
        id: activeTestRunContext.id,
        nodeId: activeTestRunContext.nodeId ?? 'all',
        durationMs,
        intervalMs: activeTestRunContext.intervalMs ?? 1,
        startedAt,
        endsAt,
      }).catch(() => {});
    }
  } catch (_) {
    // backend not reachable — keep last known context
  }
}

// Poll every 10 s; initial poll fires immediately
pollActiveTestRun();
const testRunPollInterval = setInterval(pollActiveTestRun, 10000);

/** Recalculate and upsert the daily summary for a node after a new reading is stored. */
async function updateDailySummary(data, nodeId) {
  const today = new Date().toISOString().split('T')[0];
  const location = data.location ?? 'Unknown';
  const ph = data.pH ?? data.ph ?? null;
  const tan = data.tan ?? data.TAN ?? 0.5;
  const doVal = data.dissolvedOxygen ?? data.do ?? data.dissolved_oxygen ?? null;
  const flowRate = data.flowRate ?? data.flow_rate ?? null;
  const temp = data.temperature ?? null;
  const turb = data.turbidity ?? null;
  const wqi = calculateWQI({
    temperature: temp,
    ph,
    tan,
    dissolvedOxygen: doVal,
    turbidity: turb,
  });

  const { data: existing, error: fetchErr } = await supabase
    .from('daily_summaries')
    .select('*')
    .eq('date', today)
    .eq('node_id', nodeId)
    .maybeSingle();

  if (fetchErr) {
    console.error(`[Bridge] daily_summaries fetch error: ${fetchErr.message}`);
    return;
  }

  /** Incremental running average: (old_avg * old_n + new_val) / new_n */
  const runAvg = (oldAvg, oldN, newVal) =>
    newVal != null ? ((oldAvg ?? 0) * oldN + newVal) / (oldN + 1) : (oldAvg ?? null);

  /** Track minimum, ignoring nulls */
  const runMin = (oldMin, newVal) =>
    newVal != null ? (oldMin != null ? Math.min(oldMin, newVal) : newVal) : oldMin;

  /** Track maximum, ignoring nulls */
  const runMax = (oldMax, newVal) =>
    newVal != null ? (oldMax != null ? Math.max(oldMax, newVal) : newVal) : oldMax;

  let summary;
  if (existing) {
    const n = existing.reading_count;
    summary = {
      date: today,
      node_id: nodeId,
      location: existing.location,
      // averages
      avg_temperature:      runAvg(existing.avg_temperature,      n, temp),
      avg_turbidity:        runAvg(existing.avg_turbidity,        n, turb),
      avg_ph:               runAvg(existing.avg_ph,               n, ph),
      avg_tan:              runAvg(existing.avg_tan,              n, tan),
      avg_dissolved_oxygen: runAvg(existing.avg_dissolved_oxygen, n, doVal),
      avg_flow_rate:        runAvg(existing.avg_flow_rate,        n, flowRate),
      avg_wqi:              runAvg(existing.avg_wqi,              n, wqi),
      // per-parameter min
      min_temperature:      runMin(existing.min_temperature,      temp),
      min_turbidity:        runMin(existing.min_turbidity,        turb),
      min_ph:               runMin(existing.min_ph,               ph),
      min_dissolved_oxygen: runMin(existing.min_dissolved_oxygen, doVal),
      min_flow_rate:        runMin(existing.min_flow_rate,        flowRate),
      min_wqi:              runMin(existing.min_wqi,              wqi),
      // per-parameter max
      max_temperature:      runMax(existing.max_temperature,      temp),
      max_turbidity:        runMax(existing.max_turbidity,        turb),
      max_ph:               runMax(existing.max_ph,               ph),
      max_dissolved_oxygen: runMax(existing.max_dissolved_oxygen, doVal),
      max_flow_rate:        runMax(existing.max_flow_rate,        flowRate),
      max_wqi:              runMax(existing.max_wqi,              wqi),
      reading_count: n + 1,
    };
  } else {
    summary = {
      date: today,
      node_id: nodeId,
      location,
      avg_temperature:      temp,
      avg_turbidity:        turb,
      avg_ph:               ph,
      avg_tan:              tan,
      avg_dissolved_oxygen: doVal,
      avg_flow_rate:        flowRate,
      avg_wqi:              wqi,
      min_temperature:      temp,
      min_turbidity:        turb,
      min_ph:               ph,
      min_dissolved_oxygen: doVal,
      min_flow_rate:        flowRate,
      min_wqi:              wqi,
      max_temperature:      temp,
      max_turbidity:        turb,
      max_ph:               ph,
      max_dissolved_oxygen: doVal,
      max_flow_rate:        flowRate,
      max_wqi:              wqi,
      reading_count: 1,
    };
  }

  const { error: upsertErr } = await supabase
    .from('daily_summaries')
    .upsert(summary, { onConflict: ['date', 'node_id'] });

  if (upsertErr) {
    console.error(`[Bridge] daily_summaries upsert error: ${upsertErr.message}`);
  } else {
    console.log(`[Bridge] daily_summaries updated | node=${nodeId} date=${today} n=${summary.reading_count} wqi=${wqi?.toFixed(1) ?? '—'}`);
  }
}

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
  console.log(`✅ DB insert OK | node_id=${row.node_id} | seq=${row.seq ?? '—'} | id=${data?.id ?? '—'}`);
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
  // Record backend reception time immediately upon message arrival (epoch ms, bigint)
  const t_be_rx = Date.now();

  let data;
  try {
    data = JSON.parse(message.toString());
  } catch (e) {
    console.error('[MQTT] Invalid JSON:', topic, message.toString().slice(0, 80));
    return;
  }

  // Handle command topics immediately to keep test_run_id tagging accurate.
  // Backend publishes:
  //   topic: water-quality/command                  (broadcast)
  //   topic: water-quality/{nodeId}/command         (per-node)
  //   payload: { type: "test_start"|"test_stop", test_run_id, interval_ms, duration_ms, node_id? }
  if (topic.endsWith('/command')) {
    const type = data?.type;
    const runId = data?.test_run_id;
    const nodeId = data?.node_id ?? data?.nodeId ?? 'all';

    if (type === 'test_start' && runId) {
      const durationMs = Number(data?.duration_ms ?? 0);
      const intervalMs = Number(data?.interval_ms ?? 0);
      const endsAt = Date.now() + (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0);

      // Ensure the FK target exists in Supabase before we start tagging readings.
      upsertTestRunToSupabase({ id: runId, nodeId, durationMs, intervalMs }).catch(() => {});

      activeTestRunContext = {
        id: String(runId),
        nodeId: nodeId == null ? 'all' : String(nodeId),
        endsAt,
        intervalMs: Number.isFinite(intervalMs) ? intervalMs : null,
      };
      console.log(`[Bridge] 🧪 Active test run set from command | id=${activeTestRunContext.id} node=${activeTestRunContext.nodeId} endsAt=${activeTestRunContext.endsAt}`);
    } else if (type === 'test_stop' && runId) {
      // Best-effort: mark stopped/completed in Supabase as well.
      const status = (activeTestRunContext && activeTestRunContext.id === String(runId) && Date.now() >= activeTestRunContext.endsAt)
        ? 'completed'
        : 'stopped';
      markTestRunStoppedInSupabase(runId, status).catch(() => {});

      if (activeTestRunContext && activeTestRunContext.id === String(runId)) {
        activeTestRunContext = null;
        console.log(`[Bridge] 🧪 Active test run cleared from command | id=${runId}`);
      } else {
        console.log(`[Bridge] 🧪 test_stop ignored (not active) | id=${runId}`);
      }
    } else {
      console.log('[Bridge] Ignored command topic:', topic, '| type:', type);
    }
    return;
  }

  const seqRaw = data.seq;
  if (seqRaw == null) {
    console.warn('[MQTT] Missing seq on topic:', topic, '— inserting with seq=null');
  }

  const fwdRxRaw = data.t_fwd_rx != null ? parseInt(data.t_fwd_rx, 10) : null;
  const fwdToBeMs = fwdRxRaw != null ? t_be_rx - fwdRxRaw : null;
  console.log(
    `[MQTT] Received: ${topic}`,
    `| seq: ${seqRaw ?? '—'}`,
    `| t_fwd_rx: ${fwdRxRaw ?? 'null'}`,
    `| t_be_rx: ${t_be_rx}`,
    fwdToBeMs != null ? `| fwd→be: ${fwdToBeMs}ms` : '',
  );

  const row = payloadToRow(topic, data, t_be_rx);
  insertReading(row)
    .then(({ ok }) => {
      if (ok) updateDailySummary(data, row.node_id).catch((err) => console.error('[Bridge] daily summary error:', err));
    })
    .catch((err) => console.error('[MQTT] Insert error:', err));
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
  clearInterval(testRunPollInterval);
  client.end();
  process.exit(0);
});
