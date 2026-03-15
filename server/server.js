// Load server/.env so MQTT_* / SUPABASE_* are available in dev/prod runs
const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (_) { /* optional */ }

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const mqtt = require('mqtt');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// HTTP server wrapping Express (needed for WebSocket upgrade)
const httpServer = http.createServer(app);

// WebSocket server — dashboard clients connect here for live telemetry + alerts
const wss = new WebSocket.Server({ server: httpServer });

/** Broadcast a JSON message to all connected WebSocket clients. */
function wsBroadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('🖥️  Dashboard client connected via WebSocket');
  ws.send(JSON.stringify({ type: 'connected', payload: { message: 'WQMS backend connected' } }));
  ws.on('close', () => console.log('🖥️  Dashboard client disconnected'));
});

let MQTT_URL = process.env.MQTT_URL || process.env.REACT_APP_MQTT_WS_URL || '';
// HiveMQ Cloud: mqtt://host (no port) → mqtts://host:8883 for Node MQTT
if (MQTT_URL && MQTT_URL.startsWith('mqtt://') && MQTT_URL.includes('hivemq') && !/:\d+(\/|$)/.test(MQTT_URL.slice(7))) {
  MQTT_URL = 'mqtts://' + MQTT_URL.slice(7) + ':8883';
}
const MQTT_USER = process.env.MQTT_USER || process.env.REACT_APP_MQTT_USER || '';
const MQTT_PASS = process.env.MQTT_PASS || process.env.REACT_APP_MQTT_PASS || '';

app.use(cors());
app.use(express.json());

if (!db.useSupabase()) {
  db.initializeSqlite().catch((err) => console.error('❌ SQLite init:', err));
}

// MQTT Client setup (HiveMQ Cloud: mqtts + username/password)
let mqttClient = null;

function connectMQTT() {
  if (!MQTT_URL) {
    console.warn('⚠️ MQTT not configured. Set MQTT_URL or REACT_APP_MQTT_WS_URL in .env for HiveMQ.');
    return;
  }
  const opts = {
    clientId: `wqms-backend-${Math.random().toString(16).substr(2, 8)}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
  };
  if (MQTT_USER) opts.username = MQTT_USER;
  if (MQTT_PASS) opts.password = MQTT_PASS;
  // HiveMQ Cloud uses TLS; rejectUnauthorized true for Let's Encrypt
  if (MQTT_URL.startsWith('mqtts://')) {
    opts.rejectUnauthorized = true;
  }
  console.log('🔌 Connecting to MQTT broker:', MQTT_URL.replace(/:[^:@]+@/, ':****@'));
  mqttClient = mqtt.connect(MQTT_URL, opts);

  mqttClient.on('connect', () => {
    console.log('✅ MQTT Connected to broker');
    // Bridge: subscribe to all water-quality topics (matches forwarder water-quality/{nodeId})
    mqttClient.subscribe('water-quality/#', { qos: 1 }, (err) => {
      if (err) console.error('❌ Subscribe error (water-quality/#):', err);
      else console.log('📡 Subscribed to water-quality/#');
    });
    mqttClient.subscribe('sensor-data/+', { qos: 1 }, (err) => {
      if (err) console.error('❌ Subscribe error (sensor-data/+):', err);
      else console.log('📡 Subscribed to sensor-data/+');
    });
    mqttClient.subscribe('alerts/+', { qos: 1 }, (err) => {
      if (err) console.error('❌ Subscribe error (alerts/+):', err);
      else console.log('📡 Subscribed to alerts/+');
    });
  });

  mqttClient.on('message', (topic, message) => {
    // Ignore command channels (used to control nodes / forwarder).
    // These payloads may be raw strings (e.g. "test:start:...") and are not telemetry JSON.
    if (typeof topic === 'string' && topic.endsWith('/command')) {
      return;
    }
    const t_be_rx = Date.now();
    try {
      const data = JSON.parse(message.toString());
      handleMQTTMessage(topic, data, t_be_rx).catch((err) => console.error('❌ MQTT handler:', err));
    } catch (err) {
      console.error('❌ Error parsing MQTT message:', err);
    }
  });

  mqttClient.on('error', (err) => console.error('❌ MQTT Error:', err));
  mqttClient.on('reconnect', () => console.log('🔄 MQTT Reconnecting...'));
}

// Forwarder publishes to water-quality/{nodeId} (e.g. water-quality/node1)
function extractNodeIdFromTopic(topic) {
  const parts = topic.split('/');
  if (parts.length >= 2 && parts[0] === 'water-quality') return parts[1];
  const match = topic.match(/node(\d+)/i);
  return match ? (match[0].toLowerCase()) : 'node1';
}

/** Map node ID to nodes table format N1, N2, N3 (e.g. node1 → N1, N-001 → N1). */
function normalizeNodeId(id) {
  if (!id || typeof id !== 'string') return id;
  const s = id.trim();
  const m = s.match(/^N-?(\d+)$/i) || s.match(/^node(\d+)$/i);
  if (m) return 'N' + String(parseInt(m[1], 10));
  return s;
}

const { randomUUID } = require('crypto');

// ─── Active test run (in-memory; single concurrent run) ───────────────────────
let activeTestRun = null; // { id, nodeId, endsAt, intervalMs, timer }

function publishTestCommand(type, payload) {
  if (!mqttClient?.connected) return;
  const targetNode = payload?.nodeId ?? payload?.node_id ?? null;
  const normalized = targetNode && targetNode !== 'all' ? normalizeNodeId(String(targetNode)) : null;
  const topic = normalized
    ? `water-quality/${normalized}/command`
    : 'water-quality/command';

  // 1) Canonical JSON command for apps/services
  mqttClient.publish(topic, JSON.stringify({ type, ...payload }), { qos: 1 });

  // 2) Firmware-friendly raw command for forwarder → LoRa → sender
  // Forwarder accepts both JSON and raw text; raw format matches sender firmware parser.
  let raw = null;
  if (type === 'test_start' && payload?.test_run_id && payload?.interval_ms && payload?.duration_ms) {
    raw = `test:start:${payload.interval_ms}:${payload.duration_ms}:${payload.test_run_id}`;
  } else if (type === 'test_stop' && payload?.test_run_id) {
    raw = `test:stop:${payload.test_run_id}`;
  }
  if (raw) {
    mqttClient.publish(topic, raw, { qos: 1 });
  }

  console.log(`📤 Test command [${type}] published to ${topic}${raw ? ' (json+raw)' : ''}`);
}

async function expireTestRun(id) {
  if (!activeTestRun || activeTestRun.id !== id) return;
  clearTimeout(activeTestRun.timer);
  activeTestRun = null;
  try {
    await db.closeTestRun({ id, status: 'completed', stopped_at: Date.now() });
    publishTestCommand('test_stop', { test_run_id: id });
    wsBroadcast('test_run_expired', { test_run_id: id });
    console.log(`✅ Test run ${id} completed (duration expired)`);
  } catch (err) {
    console.error('❌ expireTestRun:', err.message);
  }
}


async function handleMQTTMessage(topic, data, t_be_rx) {
  if (topic.includes('water-quality') || topic.includes('sensor-data')) {
    const reading = data.sensorReading || data;
    const rawId = reading.nodeId || reading.node || extractNodeIdFromTopic(topic);
    const nodeId = normalizeNodeId(rawId);

    // Accept both seq and seq_id field names from the forwarder
    const seqRaw = reading.seq ?? reading.seq_id ?? data.seq ?? data.seq_id;
    if (seqRaw == null) {
      console.warn(`⚠️  Telemetry from ${nodeId} missing seq/seq_id — message discarded`);
      return;
    }
    const seq = typeof seqRaw === 'number' ? seqRaw : parseInt(seqRaw, 10);
    if (!Number.isFinite(seq)) {
      console.warn(`⚠️  Telemetry from ${nodeId} has invalid seq "${seqRaw}" — message discarded`);
      return;
    }

    // t_fwd_rx is the PRIMARY latency start timestamp (forwarder epoch ms when LoRa packet arrived).
    // Sensor nodes may not have reliable NTP so t_node can be 0/null — always prefer t_fwd_rx.
    // t_be_rx is stamped at the top of this handler (= Date.now()) and must never be overwritten.
    const t_fwd_rx_val = (reading.t_fwd_rx ?? data.t_fwd_rx) != null
      ? parseInt(reading.t_fwd_rx ?? data.t_fwd_rx, 10) : null;
    if (t_fwd_rx_val == null) {
      console.warn(`⚠️  Telemetry from ${nodeId} seq=${seq} missing t_fwd_rx — latency metrics will be degraded`);
    }

    // Forwarder adds timestamp (ISO); use it when present
    const timestamp = reading.timestamp || data.timestamp || new Date().toISOString();

    const fwdToBeMs = t_fwd_rx_val != null ? t_be_rx - t_fwd_rx_val : null;
    console.log(
      `📡 MQTT telemetry: node=${nodeId} seq=${seq}`,
      `| t_fwd_rx=${t_fwd_rx_val ?? 'null'} t_be_rx=${t_be_rx}`,
      fwdToBeMs != null ? `| fwd→be: ${fwdToBeMs}ms` : '',
    );

    const row = {
      node_id: nodeId,
      temperature: reading.temperature,
      turbidity: reading.turbidity,
      ph: reading.pH ?? reading.ph,
      dissolved_oxygen: reading.dissolvedOxygen ?? reading.do,
      flow_rate: reading.flowRate ?? reading.flow_rate ?? null,
      battery_voltage: reading.batteryVoltage ?? reading.battery_voltage ?? null,
      battery_percentage: reading.batteryPercentage ?? reading.battery_percentage ?? null,
      seq,
      tx_millis: reading.tx_millis != null ? (typeof reading.tx_millis === 'number' ? reading.tx_millis : parseInt(reading.tx_millis, 10)) : null,
      rx_millis: reading.rx_millis != null ? (typeof reading.rx_millis === 'number' ? reading.rx_millis : parseInt(reading.rx_millis, 10)) : null,
      timestamp,
      t_node:    (reading.t_node    ?? data.t_node)    != null ? parseInt(reading.t_node    ?? data.t_node,    10) : null,
      t_fwd_rx:  t_fwd_rx_val,
      t_fwd_pub: (reading.t_fwd_pub ?? data.t_fwd_pub) != null ? parseInt(reading.t_fwd_pub ?? data.t_fwd_pub, 10) : null,
      t_be_rx,
    };

    // Forward telemetry to all dashboard clients (DB write is handled exclusively by bridge.js)
    wsBroadcast('telemetry', row);

  } else if (topic.includes('alert')) {
    const alert = data.alert || data;
    // t_alert_trigger = epoch ms when the backend received the alert (bigint, same as t_be_rx)
    const t_alert_trigger = t_be_rx;
    const seqRaw = alert.seq ?? data.seq;
    const seq = seqRaw != null ? (typeof seqRaw === 'number' ? seqRaw : parseInt(seqRaw, 10)) : null;
    const row = {
      node_id: normalizeNodeId(alert.nodeId ?? alert.node ?? null),
      title: alert.title || 'Alert',
      detail: alert.detail ?? alert.message ?? '',
      severity: alert.severity || 'info',
      type: alert.type ?? null,
      node_name: alert.node_name ?? alert.nodeName ?? null,
      parameter: alert.parameter ?? null,
      value: alert.value != null ? parseFloat(alert.value) : null,
      threshold_min: alert.threshold_min ?? alert.thresholdMin ?? null,
      threshold_max: alert.threshold_max ?? alert.thresholdMax ?? null,
      status: alert.status ?? 'active',
      seq,
      timestamp: new Date(t_be_rx).toISOString(),
      t_alert_trigger,
    };
    const result = await db.insertAlert(row);
    console.log(`🚨 Stored alert from Node ${row.node_id} | seq=${seq ?? 'n/a'} | id=${result.lastID}`);

    // Publish alert event to all dashboard clients via dedicated alert channel
    wsBroadcast('alert', { ...row, db_id: result.lastID });
  }
}

// --- API Routes ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mqtt: mqttClient?.connected ? 'connected' : 'disconnected',
    database: db.useSupabase() ? 'supabase' : 'connected',
  });
});

app.get('/api/readings/latest', async (req, res) => {
  try {
    const nodeId = req.query.nodeId || null;
    const row = await db.getLatestReading(nodeId);
    res.json(row || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/readings', async (req, res) => {
  try {
    const { startDate, endDate, nodeId, testRunId, test_run_id, monitoringOnly, limit = 100 } = req.query;
    const rows = await db.getReadings({
      startDate,
      endDate,
      nodeId,
      testRunId: testRunId || test_run_id || null,
      monitoringOnly: monitoringOnly === '1' || monitoringOnly === 'true',
      limit,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/summaries/daily', async (req, res) => {
  try {
    const { startDate, endDate, nodeId } = req.query;
    const rows = await db.getDailySummaries({ startDate, endDate, nodeId });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/readings/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const nodeId = req.query.nodeId || null;
    const row = await db.getReadingByDate(date, nodeId);
    res.json(row || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/alerts', async (req, res) => {
  try {
    const { limit = 50, severity, startDate, endDate } = req.query;
    const rows = await db.getAlerts({ limit: parseInt(limit), severity, startDate, endDate });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/readings', async (req, res) => {
  try {
    const reading = req.body;
    const row = {
      node_id: reading.nodeId || reading.node || '1',
      temperature: reading.temperature,
      turbidity: reading.turbidity,
      ph: reading.pH ?? reading.ph,
      dissolved_oxygen: reading.dissolvedOxygen ?? reading.do,
      flow_rate: reading.flowRate ?? reading.flow_rate ?? null,
      seq: reading.seq != null ? (typeof reading.seq === 'number' ? reading.seq : parseInt(reading.seq, 10)) : null,
      tx_millis: reading.tx_millis != null ? (typeof reading.tx_millis === 'number' ? reading.tx_millis : parseInt(reading.tx_millis, 10)) : null,
      rx_millis: reading.rx_millis != null ? (typeof reading.rx_millis === 'number' ? reading.rx_millis : parseInt(reading.rx_millis, 10)) : null,
      timestamp: reading.timestamp || new Date().toISOString(),
    };
    const result = await db.insertReading(row);
    res.json({ success: true, id: result.lastID, message: 'Reading stored successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alerts', async (req, res) => {
  try {
    const alert = req.body;
    const row = {
      node_id: alert.nodeId ?? alert.node ?? null,
      title: alert.title || 'Alert',
      detail: alert.detail ?? alert.message ?? '',
      severity: alert.severity || 'info',
      timestamp: alert.timestamp || new Date().toISOString(),
    };
    const result = await db.insertAlert(row);
    res.json({ success: true, id: result.lastID, message: 'Alert stored successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SAMPLE DATA (testing only – remove this block and delete sampleDataGenerator.js when sensors are ready) ───
const ENABLE_SAMPLE_DATA = process.env.ENABLE_SAMPLE_DATA === '1' || process.env.ENABLE_SAMPLE_DATA === 'true';
let sampleDataIntervalId = null;

if (ENABLE_SAMPLE_DATA) {
  const sampleData = require('./sampleDataGenerator');

  /** POST /api/sample-data/generate — insert one or more sample readings (body: count?, nodeIds?, startDate?, endDate?, intervalMinutes?) */
  app.post('/api/sample-data/generate', async (req, res) => {
    try {
      const { count = 1, nodeIds, startDate, endDate, intervalMinutes } = req.body || {};
      const n = Math.min(Math.max(1, parseInt(count, 10) || 1), 500);
      const rows = sampleData.generateReadings(n, { nodeIds, startDate, endDate, intervalMinutes });
      let inserted = 0;
      for (const row of rows) {
        await db.insertReading(row);
        inserted++;
      }
      res.json({ success: true, inserted, message: `Inserted ${inserted} sample reading(s)` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/sample-data/start-interval — start auto-inserting sample data every N ms (body: intervalMs?) */
  app.post('/api/sample-data/start-interval', (req, res) => {
    if (sampleDataIntervalId) {
      return res.json({ success: true, message: 'Sample data interval already running', intervalMs: req.body?.intervalMs });
    }
    const intervalMs = Math.max(2000, parseInt(req.body?.intervalMs, 10) || 5000);
    sampleDataIntervalId = setInterval(async () => {
      try {
        const row = sampleData.generateOneReading();
        await db.insertReading(row);
        wsBroadcast('telemetry', { ...row, location: null });
      } catch (e) {
        console.error('[sample-data] interval insert failed:', e.message);
      }
    }, intervalMs);
    console.log(`📊 Sample data interval started: every ${intervalMs}ms`);
    res.json({ success: true, intervalMs, message: `Sample data will be inserted every ${intervalMs}ms` });
  });

  /** POST /api/sample-data/stop-interval — stop auto-insert */
  app.post('/api/sample-data/stop-interval', (req, res) => {
    if (sampleDataIntervalId) {
      clearInterval(sampleDataIntervalId);
      sampleDataIntervalId = null;
      console.log('📊 Sample data interval stopped');
    }
    res.json({ success: true, message: 'Sample data interval stopped' });
  });

  const sampleIntervalEnv = process.env.SAMPLE_DATA_INTERVAL_MS;
  if (sampleIntervalEnv && parseInt(sampleIntervalEnv, 10) > 0) {
    const ms = Math.max(2000, parseInt(sampleIntervalEnv, 10));
    sampleDataIntervalId = setInterval(async () => {
      try {
        const row = sampleData.generateOneReading();
        await db.insertReading(row);
        wsBroadcast('telemetry', { ...row, location: null });
      } catch (e) {
        console.error('[sample-data] interval insert failed:', e.message);
      }
    }, ms);
    console.log(`📊 Sample data auto-interval started (ENABLE_SAMPLE_DATA): every ${ms}ms`);
  }
}

// ─── Test Run endpoints ───────────────────────────────────────────────────────

/** GET /api/test-run/active — returns the currently active test run or null */
app.get('/api/test-run/active', (req, res) => {
  if (!activeTestRun) return res.json(null);
  res.json({
    id: activeTestRun.id,
    nodeId: activeTestRun.nodeId,
    startedAt: activeTestRun.startedAt,
    endsAt: activeTestRun.endsAt,
    intervalMs: activeTestRun.intervalMs,
    durationMs: Math.max(0, activeTestRun.endsAt - (activeTestRun.startedAt ?? activeTestRun.endsAt)),
    remainingMs: Math.max(0, activeTestRun.endsAt - Date.now()),
  });
});

/**
 * POST /api/test-run/start
 * Body: { durationMs, intervalMs, nodeId? }
 * Creates a test run, publishes test_start MQTT command to nodes.
 */
app.post('/api/test-run/start', async (req, res) => {
  try {
    if (activeTestRun && Date.now() < activeTestRun.endsAt) {
      return res.status(409).json({ error: 'A test run is already active', test_run_id: activeTestRun.id });
    }

    const { durationMs, intervalMs, nodeId } = req.body;
    if (!durationMs || durationMs <= 0) return res.status(400).json({ error: 'durationMs is required and must be > 0' });
    if (!intervalMs || intervalMs <= 0) return res.status(400).json({ error: 'intervalMs is required and must be > 0' });

    const id = randomUUID();
    const started_at = Date.now();
    const ends_at = started_at + Number(durationMs);

    await db.createTestRun({ id, started_at, ends_at, duration_ms: Number(durationMs), interval_ms: Number(intervalMs), node_id: nodeId ?? null });

    const timer = setTimeout(() => expireTestRun(id), Number(durationMs));
    activeTestRun = { id, nodeId: nodeId ?? 'all', startedAt: started_at, endsAt: ends_at, intervalMs: Number(intervalMs), timer };

    publishTestCommand('test_start', {
      test_run_id: id,
      interval_ms: Number(intervalMs),
      duration_ms: Number(durationMs),
      node_id: nodeId ?? null,
    });

    wsBroadcast('test_run_started', { test_run_id: id, ends_at, interval_ms: Number(intervalMs), node_id: nodeId ?? null });
    console.log(`🧪 Test run started: ${id} | duration=${durationMs}ms | interval=${intervalMs}ms | node=${nodeId ?? 'all'}`);

    res.json({ test_run_id: id, started_at, ends_at, duration_ms: Number(durationMs), interval_ms: Number(intervalMs) });
  } catch (err) {
    console.error('❌ test-run/start:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/test-run/stop
 * Body: { test_run_id }
 * Manually stops an active test run.
 */
app.post('/api/test-run/stop', async (req, res) => {
  try {
    const { test_run_id } = req.body;
    if (!activeTestRun) return res.status(404).json({ error: 'No active test run' });
    if (test_run_id && activeTestRun.id !== test_run_id) {
      return res.status(404).json({ error: 'test_run_id does not match active run' });
    }

    const id = activeTestRun.id;
    clearTimeout(activeTestRun.timer);
    activeTestRun = null;

    await db.closeTestRun({ id, status: 'stopped', stopped_at: Date.now() });
    publishTestCommand('test_stop', { test_run_id: id });
    wsBroadcast('test_run_stopped', { test_run_id: id });
    console.log(`🛑 Test run stopped: ${id}`);

    res.json({ ok: true, test_run_id: id, status: 'stopped' });
  } catch (err) {
    console.error('❌ test-run/stop:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/test-run/:id — fetch a specific test run record */
app.get('/api/test-run/:id', async (req, res) => {
  try {
    const run = await db.getTestRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Not found' });
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/test-runs — list all test runs (for Reports) */
app.get('/api/test-runs', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const rows = await db.getTestRunsList({ limit: parseInt(limit) });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/timestamp-logs', async (req, res) => {
  try {
    const { startDate, endDate, nodeId, limit = 200 } = req.query;
    const rows = await db.getTimestampLogs({ startDate, endDate, nodeId, limit });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoints at http://localhost:${PORT}/api`);
  console.log(`🔌 WebSocket server on ws://localhost:${PORT}`);
  if (MQTT_URL) {
    connectMQTT();
  }
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  if (mqttClient) mqttClient.end();
  wss.close();
  db.close()
    .then(() => {
      console.log('✅ Database connection closed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error closing database:', err.message);
      process.exit(1);
    });
});
