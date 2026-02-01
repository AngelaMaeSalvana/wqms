const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_USER = process.env.MQTT_USER || '';
const MQTT_PASS = process.env.MQTT_PASS || '';

app.use(cors());
app.use(express.json());

if (!db.useSupabase()) {
  db.initializeSqlite().catch((err) => console.error('❌ SQLite init:', err));
}

// MQTT Client setup (supports HiveMQ Cloud: mqtts + username/password)
let mqttClient = null;

function connectMQTT() {
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
    try {
      const data = JSON.parse(message.toString());
      handleMQTTMessage(topic, data).catch((err) => console.error('❌ MQTT handler:', err));
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

async function updateDailySummary(reading, nodeId) {
  const today = new Date().toISOString().split('T')[0];
  const wqi = Math.round(reading.wqi || reading.WQI || 0);
  const location = reading.location || 'Unknown';
  const ph = reading.pH ?? reading.ph;
  const nh3 = reading.nh3 ?? reading.NH3;
  const doVal = reading.dissolvedOxygen ?? reading.do;

  const existing = await db.getDailySummaryByDateAndNode(today, nodeId);
  if (existing) {
    const newCount = existing.reading_count + 1;
    await db.upsertDailySummary({
      date: today,
      node_id: nodeId,
      location: existing.location,
      avg_temperature: (existing.avg_temperature * existing.reading_count + reading.temperature) / newCount,
      avg_turbidity: (existing.avg_turbidity * existing.reading_count + reading.turbidity) / newCount,
      avg_ph: (existing.avg_ph * existing.reading_count + ph) / newCount,
      avg_nh3: (existing.avg_nh3 * existing.reading_count + nh3) / newCount,
      avg_dissolved_oxygen: (existing.avg_dissolved_oxygen * existing.reading_count + doVal) / newCount,
      avg_wqi: (existing.avg_wqi * existing.reading_count + wqi) / newCount,
      min_wqi: Math.min(existing.min_wqi, wqi),
      max_wqi: Math.max(existing.max_wqi, wqi),
      reading_count: newCount,
    });
  } else {
    await db.upsertDailySummary({
      date: today,
      node_id: nodeId,
      location,
      avg_temperature: reading.temperature,
      avg_turbidity: reading.turbidity,
      avg_ph: ph,
      avg_nh3: nh3,
      avg_dissolved_oxygen: doVal,
      avg_wqi: wqi,
      min_wqi: wqi,
      max_wqi: wqi,
      reading_count: 1,
    });
  }
}

async function handleMQTTMessage(topic, data) {
  if (topic.includes('water-quality') || topic.includes('sensor-data')) {
    const reading = data.sensorReading || data;
    const rawId = reading.nodeId || reading.node || extractNodeIdFromTopic(topic);
    const nodeId = normalizeNodeId(rawId);
    // Forwarder adds timestamp (ISO); use it when present
    const timestamp = reading.timestamp || data.timestamp || new Date().toISOString();
    const row = {
      node_id: nodeId,
      location: reading.location || 'Unknown',
      temperature: reading.temperature,
      turbidity: reading.turbidity,
      ph: reading.pH ?? reading.ph,
      nh3: reading.nh3 ?? reading.NH3,
      dissolved_oxygen: reading.dissolvedOxygen ?? reading.do,
      wqi: Math.round(reading.wqi || reading.WQI || 0),
      timestamp,
    };
    const result = await db.insertReading(row);
    console.log(`💾 Stored reading from Node ${nodeId} (ID: ${result.lastID})`);
    await updateDailySummary(reading, nodeId);
  } else if (topic.includes('alert')) {
    const alert = data.alert || data;
    const row = {
      node_id: alert.nodeId ?? alert.node ?? null,
      title: alert.title || 'Alert',
      detail: alert.detail ?? alert.message ?? '',
      severity: alert.severity || 'info',
      timestamp: new Date().toISOString(),
    };
    const result = await db.insertAlert(row);
    console.log(`🚨 Stored alert (ID: ${result.lastID})`);
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
    const { startDate, endDate, nodeId, limit = 100 } = req.query;
    const rows = await db.getReadings({ startDate, endDate, nodeId, limit });
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
    const { limit = 50, severity } = req.query;
    const rows = await db.getAlerts({ limit: parseInt(limit), severity });
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
      location: reading.location || 'Unknown',
      temperature: reading.temperature,
      turbidity: reading.turbidity,
      ph: reading.pH ?? reading.ph,
      nh3: reading.nh3 ?? reading.NH3,
      dissolved_oxygen: reading.dissolvedOxygen ?? reading.do,
      wqi: Math.round(reading.wqi ?? reading.WQI ?? 0),
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

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoints at http://localhost:${PORT}/api`);
  connectMQTT();
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  if (mqttClient) mqttClient.end();
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
