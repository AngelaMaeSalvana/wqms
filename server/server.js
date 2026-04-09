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
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID, createHash, randomBytes } = require('crypto');
const db = require('./db');
const { mqttToSensorRow } = require('./utils/mqttToSensorRow');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'wqms-dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RESET_TTL_MS = parseInt(process.env.PASSWORD_RESET_TTL_MS || '', 10) || 60 * 60 * 1000;
const APP_ORIGIN = String(process.env.APP_ORIGIN || process.env.CLIENT_URL || process.env.REACT_APP_DASHBOARD_URL || 'http://localhost:3000').replace(/\/$/, '');

function hashPasswordResetToken(raw) {
  return createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

function generatePasswordResetRawToken() {
  return randomBytes(32).toString('hex');
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_RESET_TEMPLATE_ID || process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;

  if (!serviceId || !templateId || !publicKey || !privateKey) {
    console.warn('⚠️ Password reset email not sent: set EMAILJS_SERVICE_ID, EMAILJS_RESET_TEMPLATE_ID (or EMAILJS_TEMPLATE_ID), EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY');
    console.warn('   Reset link:', resetUrl);
    return { sent: false };
  }

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: {
        to_email: toEmail,
        reset_link: resetUrl,
        message: `Reset your AQUALENS password using this link (expires in one hour): ${resetUrl}`,
        site_name: 'AQUALENS',
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS error ${res.status}: ${text}`);
  }
  return { sent: true };
}

async function requireAdmin(req, res, next) {
  try {
    const user = await db.getUserById(req.authUser.id);
    const role = (user?.role || 'guest').toLowerCase();
    if (role !== 'admin') {
      return res.status(403).json({ error: 'System Admin access required' });
    }
    req.authProfile = user;
    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function issueToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role || 'guest' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

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

/**
 * Push data-acquisition settings to LoRa nodes (via forwarder → broadcast CMD).
 * Nodes apply after the current acquisition period ends (firmware queues the change).
 */
function publishAcquisitionConfig(payload) {
  if (!mqttClient?.connected) return;
  const topic = 'water-quality/command';
  mqttClient.publish(topic, JSON.stringify({ type: 'acq_config', ...payload }), { qos: 1 });
  let raw = null;
  if (payload.frequency_mode === 'auto_adapt') {
    raw = 'acq:auto';
  } else if (payload.interval_minutes >= 1 && payload.interval_minutes <= 120) {
    raw = `acq:user:${payload.interval_minutes}`;
  }
  if (raw) {
    mqttClient.publish(topic, raw, { qos: 1 });
  }
  console.log(`📤 Acquisition config published to ${topic}${raw ? ' (json+raw)' : ''}`);
}

// Publish a crafted telemetry reading to MQTT (used by Scenario Evaluator).
function publishTestReadingToMQTT(nodeId, payload) {
  if (!mqttClient?.connected) return false;
  const normalized = normalizeNodeId(String(nodeId || 'N1'));
  const topic = `water-quality/${normalized}`;
  mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
  return true;
}

function rand(min, max, dp = 2) {
  const n = min + Math.random() * (max - min);
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function belowMin(threshold, pct) {
  return +(threshold * (1 - pct / 100)).toFixed(3);
}

function aboveMax(threshold, pct) {
  return +(threshold * (1 + pct / 100)).toFixed(3);
}

function buildScenarioPayloads(scenario, nodeId, testRunId, seqBase, clientThresholds) {
  const DEFAULT_T = {
    temperatureMin: 18,
    temperatureMax: 30,
    pHMin: 6.5,
    pHMax: 8.5,
    turbidityMax: 25,
    dissolvedOxygenMin: 4,
    nh3Max: 0.5,
  };
  const T = { ...DEFAULT_T, ...(clientThresholds || {}) };

  // Fixed in-range defaults so one-parameter scenarios do not randomly breach *other*
  // parameters under stricter client Settings (e.g. temperature min 26°C).
  const SAFE_SCENARIO_BASELINE = {
    temperature: 27,
    turbidity: 3,
    ph: 7.2,
    dissolved_oxygen: 8,
    flow_rate: 2,
  };

  let seqCursor = Number.isFinite(Number(seqBase)) ? Number(seqBase) : randInt(1, 9999);

  const basePayload = (overrides = {}) => {
    const now = Date.now();
    const tx_millis = randInt(10000, 2000000);
    const rx_millis = tx_millis + randInt(20, 400);
    return {
      nodeId: String(nodeId),
      seq: seqCursor++,
      ...SAFE_SCENARIO_BASELINE,
      tx_millis,
      rx_millis,
      location: 'Scenario Evaluator',
      timestamp: new Date(now).toISOString(),
      t_node: now,
      t_fwd_rx: now + randInt(50, 300),
      t_fwd_pub: now + randInt(310, 600),
      rssi: randInt(-85, -65),
      snr: randInt(5, 12),
      ...(testRunId ? { test_run_id: String(testRunId) } : {}),
      ...overrides,
    };
  };

  const scenarios = {
    normal: () => [basePayload()],
    'all-clear': () => [basePayload({ temperature: 27, turbidity: 3, ph: 7.2, dissolved_oxygen: 8.0 })],
    'low-do': () => [basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 3) })],
    'medium-do': () => [basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 7) })],
    'high-do': () => [basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 15) })],
    'low-ph': () => [basePayload({ ph: aboveMax(T.pHMax, 3) })],
    'medium-ph': () => [basePayload({ ph: aboveMax(T.pHMax, 7) })],
    'high-ph': () => [basePayload({ ph: aboveMax(T.pHMax, 15) })],
    'low-turbidity': () => [basePayload({ turbidity: aboveMax(T.turbidityMax, 3) })],
    'medium-turbidity': () => [basePayload({ turbidity: aboveMax(T.turbidityMax, 7) })],
    'high-turbidity': () => [basePayload({ turbidity: aboveMax(T.turbidityMax, 15) })],
    'low-temp': () => [basePayload({ temperature: belowMin(T.temperatureMin, 3) })],
    'high-temp': () => [basePayload({ temperature: aboveMax(T.temperatureMax, 15) })],
    'low-nh3': () => [basePayload({ nh3: aboveMax(T.nh3Max, 3) })],
    'high-nh3': () => [basePayload({ nh3: aboveMax(T.nh3Max, 15) })],
    'nh3-slope': () => [basePayload({ nh3: 0.2 }), basePayload({ nh3: 0.45 })],
    'multi-param': () => [basePayload({
      dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 7),
      turbidity: aboveMax(T.turbidityMax, 7),
      ph: aboveMax(T.pHMax, 7),
    })],
    'wqi-drop': () => [
      basePayload({ dissolved_oxygen: 8.5, turbidity: 2, ph: 7.2, temperature: 23 }),
      basePayload({
        dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 20),
        turbidity: aboveMax(T.turbidityMax, 30),
        ph: aboveMax(T.pHMax, 20),
        temperature: aboveMax(T.temperatureMax, 15),
      }),
    ],
    persistence: () => [
      basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 3) }),
      basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 3) }),
      basePayload({ dissolved_oxygen: belowMin(T.dissolvedOxygenMin, 3) }),
    ],
    'low-battery': () => [basePayload({ battery_percentage: 8, battery_voltage: 3.35 })],
  };

  const fn = scenarios[String(scenario || '').toLowerCase()];
  return fn ? fn() : null;
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
    const rawId = reading.nodeId || reading.node || reading.node_id || extractNodeIdFromTopic(topic);
    const nodeId = normalizeNodeId(rawId);

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

    const t_fwd_rx_val = (reading.t_fwd_rx ?? data.t_fwd_rx) != null
      ? parseInt(reading.t_fwd_rx ?? data.t_fwd_rx, 10) : null;
    if (t_fwd_rx_val == null) {
      console.warn(`⚠️  Telemetry from ${nodeId} seq=${seq} missing t_fwd_rx — latency metrics will be degraded`);
    }

    const fwdToBeMs = t_fwd_rx_val != null ? t_be_rx - t_fwd_rx_val : null;
    console.log(
      `📡 MQTT telemetry: node=${nodeId} seq=${seq}`,
      `| t_fwd_rx=${t_fwd_rx_val ?? 'null'} t_be_rx=${t_be_rx}`,
      fwdToBeMs != null ? `| fwd→be: ${fwdToBeMs}ms` : '',
    );

    const payload = { ...data, ...reading };
    let row;
    try {
      row = await mqttToSensorRow(topic, payload, t_be_rx, { activeTestRunContext: null });
    } catch (err) {
      console.error('⚠️  Telemetry row build failed:', err.message);
      return;
    }

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

app.post('/api/auth/signup', async (req, res) => {
  try {
    const usernameRaw = req.body?.username;
    const passwordRaw = req.body?.password;
    const emailRaw = req.body?.email;
    const username = typeof usernameRaw === 'string' ? usernameRaw.trim() : '';
    const password = typeof passwordRaw === 'string' ? passwordRaw : '';
    const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      return res.status(400).json({ error: 'username must be 3-32 chars and use letters, numbers, underscore' });
    }
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'invalid email format' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const existing = await db.getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ error: 'username already exists' });
    }
    const existingEmail = await db.getUserByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const user = await db.createUser({
      id: randomUUID(),
      username,
      email,
      password_hash,
      role: 'guest',
    });
    const token = issueToken(user);

    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, email: user.email || null, role: user.role || 'guest' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const usernameRaw = req.body?.username;
    const passwordRaw = req.body?.password;
    const username = typeof usernameRaw === 'string' ? usernameRaw.trim() : '';
    const password = typeof passwordRaw === 'string' ? passwordRaw : '';

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = issueToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email || null, role: user.role || 'guest' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Request reset link by email or username (email must be on file). Always 200 with same message if identifier looks valid. */
app.post('/api/auth/forgot-password', async (req, res) => {
  const generic = {
    ok: true,
    message: 'If an account matches that information and has an email on file, a reset link has been sent.',
  };
  try {
    const raw = typeof req.body?.emailOrUsername === 'string' ? req.body.emailOrUsername.trim() : '';
    if (!raw) {
      return res.status(400).json({ error: 'email or username is required' });
    }

    let user = null;
    if (raw.includes('@')) {
      const email = raw.toLowerCase();
      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ error: 'invalid email format' });
      }
      user = await db.getUserByEmail(email);
    } else {
      user = await db.getUserByUsername(raw);
    }

    if (!user || !user.email) {
      return res.json(generic);
    }

    await db.deleteExpiredPasswordResetTokens();
    await db.deletePasswordResetTokensForUser(user.id);

    const rawToken = generatePasswordResetRawToken();
    const token_hash = hashPasswordResetToken(rawToken);
    const expires_at = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
    await db.insertPasswordResetToken({
      id: randomUUID(),
      user_id: user.id,
      token_hash,
      expires_at,
    });

    const resetUrl = `${APP_ORIGIN}/reset-password?token=${encodeURIComponent(rawToken)}`;
    try {
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (emailErr) {
      console.error('❌ Password reset email failed:', emailErr.message || emailErr);
      return res.status(500).json({ error: 'Could not send reset email. Try again later.' });
    }

    return res.json(generic);
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes('password_reset_tokens') && (msg.includes('does not exist') || msg.includes('schema cache'))) {
      console.error('❌ password_reset_tokens table missing — run supabase/schema.sql migration');
      return res.status(503).json({ error: 'Password reset is not configured on the server.' });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const tokenRaw = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const passwordRaw = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!tokenRaw || !passwordRaw) {
      return res.status(400).json({ error: 'token and password are required' });
    }
    if (passwordRaw.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const token_hash = hashPasswordResetToken(tokenRaw);
    const row = await db.getPasswordResetTokenRowByHash(token_hash);
    if (!row || !row.expires_at || new Date(row.expires_at) <= new Date()) {
      return res.status(400).json({ error: 'invalid or expired reset link' });
    }

    const password_hash = await bcrypt.hash(passwordRaw, 12);
    await db.updateUserAccount({ id: row.user_id, password_hash });
    await db.deletePasswordResetTokenById(row.id);
    await db.deletePasswordResetTokensForUser(row.user_id);

    res.json({ ok: true, message: 'Password updated. You can sign in with your new password.' });
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes('password_reset_tokens') && (msg.includes('does not exist') || msg.includes('schema cache'))) {
      return res.status(503).json({ error: 'Password reset is not configured on the server.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await db.getUserById(req.authUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email || null,
        role: user.role || 'guest',
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const usernameRaw = req.body?.username;
    const username = typeof usernameRaw === 'string' ? usernameRaw.trim() : '';
    const emailRaw = req.body?.email;
    const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
    const passwordRaw = req.body?.password;
    const password = typeof passwordRaw === 'string' ? passwordRaw : '';

    const current = await db.getUserById(req.authUser.id);
    if (!current) return res.status(404).json({ error: 'User not found' });

    let nextUsername = null;
    if (username && username !== current.username) {
      if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
        return res.status(400).json({ error: 'username must be 3-32 chars and use letters, numbers, underscore' });
      }
      const existing = await db.getUserByUsername(username);
      if (existing && existing.id !== current.id) {
        return res.status(409).json({ error: 'username is already taken' });
      }
      nextUsername = username;
    }

    let password_hash = null;
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
      password_hash = await bcrypt.hash(password, 12);
    }

    let nextEmail;
    if (emailRaw === undefined) {
      nextEmail = undefined;
    } else if (!email) {
      nextEmail = null;
    } else {
      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ error: 'invalid email format' });
      }
      const existingByEmail = await db.getUserByEmail(email);
      if (existingByEmail && existingByEmail.id !== current.id) {
        return res.status(409).json({ error: 'email is already taken' });
      }
      nextEmail = email;
    }

    const updated = await db.updateUserAccount({
      id: current.id,
      username: nextUsername,
      email: nextEmail,
      password_hash,
    });
    res.json({ user: { id: updated.id, username: updated.username, email: updated.email || null, role: updated.role || 'guest' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    const { limit = 50, severity, startDate, endDate, nodeId } = req.query;
    const rows = await db.getAlerts({ limit: parseInt(limit), severity, startDate, endDate, nodeId });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/alerts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { email_sent_at } = req.body || {};
    await db.updateAlertEmailSent(id, email_sent_at);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/readings', requireAuth, requireAdmin, async (req, res) => {
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

app.post('/api/alerts', requireAuth, requireAdmin, async (req, res) => {
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

/**
 * POST /api/test-scenario/publish
 * Body: { scenario, nodeId, test_run_id? }
 * Publishes crafted telemetry to MQTT (bridge will store to Supabase).
 */
app.post('/api/test-scenario/publish', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mqttClient?.connected) {
      return res.status(503).json({ error: 'MQTT not connected' });
    }
    const { scenario, nodeId, test_run_id, thresholds } = req.body || {};
    if (!scenario) return res.status(400).json({ error: 'scenario is required' });
    if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });
    const seqBase = Date.now() % 1000000000;
    const payloads = buildScenarioPayloads(scenario, nodeId, test_run_id || null, seqBase, thresholds);
    if (!payloads) return res.status(400).json({ error: `Unknown scenario: ${scenario}` });

    payloads.forEach((p) => publishTestReadingToMQTT(nodeId, p));
    res.json({
      ok: true,
      published: payloads.length,
      nodeId,
      scenario,
      seqs: payloads.map((p) => p.seq),
      published_at: new Date().toISOString(),
    });
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
  app.post('/api/sample-data/generate', requireAuth, requireAdmin, async (req, res) => {
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
  app.post('/api/sample-data/start-interval', requireAuth, requireAdmin, (req, res) => {
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
  app.post('/api/sample-data/stop-interval', requireAuth, requireAdmin, (req, res) => {
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

/**
 * POST /api/acquisition-config
 * Body: { frequency_mode: 'user_selected' | 'auto_adapt', interval_minutes?: number }
 * Broadcasts MQTT so the forwarder can relay acq commands to sensor nodes.
 */
app.post('/api/acquisition-config', requireAuth, requireAdmin, (req, res) => {
  try {
    const { frequency_mode, interval_minutes } = req.body || {};
    const fm = frequency_mode === 'auto_adapt' ? 'auto_adapt' : 'user_selected';
    let iv = parseInt(interval_minutes, 10);
    if (fm === 'user_selected') {
      if (!Number.isFinite(iv) || iv < 1 || iv > 120) {
        return res.status(400).json({ error: 'interval_minutes must be 1–120 for user_selected mode' });
      }
    } else {
      iv = Number.isFinite(iv) && iv >= 1 ? iv : 15;
    }
    publishAcquisitionConfig({ frequency_mode: fm, interval_minutes: iv });
    res.json({ ok: true, frequency_mode: fm, interval_minutes: iv });
  } catch (err) {
    console.error('❌ acquisition-config:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
app.post('/api/test-run/start', requireAuth, requireAdmin, async (req, res) => {
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
app.post('/api/test-run/stop', requireAuth, requireAdmin, async (req, res) => {
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
