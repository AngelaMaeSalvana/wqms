const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_WS_URL = process.env.MQTT_WS_URL || 'ws://localhost:9001';

// Middleware
app.use(cors());
app.use(express.json());

// Database setup
const dbPath = path.join(__dirname, 'wqms.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Water quality readings table
    db.run(`CREATE TABLE IF NOT EXISTS water_quality_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT,
      location TEXT,
      temperature REAL,
      turbidity REAL,
      ph REAL,
      nh3 REAL,
      dissolved_oxygen REAL,
      wqi INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Alerts table
    db.run(`CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT,
      title TEXT,
      detail TEXT,
      severity TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Daily summaries table (for faster historical queries)
    db.run(`CREATE TABLE IF NOT EXISTS daily_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE,
      node_id TEXT,
      location TEXT,
      avg_temperature REAL,
      avg_turbidity REAL,
      avg_ph REAL,
      avg_nh3 REAL,
      avg_dissolved_oxygen REAL,
      avg_wqi REAL,
      min_wqi INTEGER,
      max_wqi INTEGER,
      reading_count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, node_id)
    )`);

    console.log('✅ Database tables initialized');
  });
}

// MQTT Client setup
let mqttClient = null;

function connectMQTT() {
  console.log('🔌 Connecting to MQTT broker:', MQTT_URL);
  
  mqttClient = mqtt.connect(MQTT_URL, {
    clientId: `wqms-backend-${Math.random().toString(16).substr(2, 8)}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
  });

  mqttClient.on('connect', () => {
    console.log('✅ MQTT Connected to broker');
    
    // Subscribe to all water quality topics
    mqttClient.subscribe('water-quality/+', { qos: 1 });
    mqttClient.subscribe('sensor-data/+', { qos: 1 });
    mqttClient.subscribe('alerts/+', { qos: 1 });
    
    console.log('📡 Subscribed to MQTT topics');
  });

  mqttClient.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      handleMQTTMessage(topic, data);
    } catch (err) {
      console.error('❌ Error parsing MQTT message:', err);
    }
  });

  mqttClient.on('error', (err) => {
    console.error('❌ MQTT Error:', err);
  });

  mqttClient.on('reconnect', () => {
    console.log('🔄 MQTT Reconnecting...');
  });
}

// Handle incoming MQTT messages
function handleMQTTMessage(topic, data) {
  if (topic.includes('water-quality') || topic.includes('sensor-data')) {
    // Store water quality reading
    const reading = data.sensorReading || data;
    const nodeId = reading.nodeId || reading.node || extractNodeIdFromTopic(topic);
    
    db.run(
      `INSERT INTO water_quality_readings 
       (node_id, location, temperature, turbidity, ph, nh3, dissolved_oxygen, wqi, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nodeId,
        reading.location || 'Unknown',
        reading.temperature,
        reading.turbidity,
        reading.pH || reading.ph,
        reading.nh3 || reading.NH3,
        reading.dissolvedOxygen || reading.do,
        Math.round(reading.wqi || reading.WQI || 0),
        new Date().toISOString()
      ],
      function(err) {
        if (err) {
          console.error('❌ Error storing reading:', err);
        } else {
          console.log(`💾 Stored reading from Node ${nodeId} (ID: ${this.lastID})`);
          updateDailySummary(reading, nodeId);
        }
      }
    );
  } else if (topic.includes('alert')) {
    // Store alert
    const alert = data.alert || data;
    
    db.run(
      `INSERT INTO alerts (node_id, title, detail, severity, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      [
        alert.nodeId || alert.node || null,
        alert.title || 'Alert',
        alert.detail || alert.message || '',
        alert.severity || 'info',
        new Date().toISOString()
      ],
      function(err) {
        if (err) {
          console.error('❌ Error storing alert:', err);
        } else {
          console.log(`🚨 Stored alert (ID: ${this.lastID})`);
        }
      }
    );
  }
}

// Extract node ID from MQTT topic
function extractNodeIdFromTopic(topic) {
  const match = topic.match(/node(\d+)/i);
  return match ? match[1] : '1';
}

// Update daily summary (for faster historical queries)
function updateDailySummary(reading, nodeId) {
  const today = new Date().toISOString().split('T')[0];
  
  db.get(
    `SELECT * FROM daily_summaries WHERE date = ? AND node_id = ?`,
    [today, nodeId],
    (err, row) => {
      if (err) {
        console.error('❌ Error checking daily summary:', err);
        return;
      }

      const wqi = Math.round(reading.wqi || reading.WQI || 0);
      
      if (row) {
        // Update existing summary
        const newCount = row.reading_count + 1;
        const newAvgTemp = ((row.avg_temperature * row.reading_count) + reading.temperature) / newCount;
        const newAvgTurb = ((row.avg_turbidity * row.reading_count) + reading.turbidity) / newCount;
        const newAvgPH = ((row.avg_ph * row.reading_count) + (reading.pH || reading.ph)) / newCount;
        const newAvgNH3 = ((row.avg_nh3 * row.reading_count) + (reading.nh3 || reading.NH3)) / newCount;
        const newAvgDO = ((row.avg_dissolved_oxygen * row.reading_count) + (reading.dissolvedOxygen || reading.do)) / newCount;
        const newAvgWQI = ((row.avg_wqi * row.reading_count) + wqi) / newCount;
        const newMinWQI = Math.min(row.min_wqi, wqi);
        const newMaxWQI = Math.max(row.max_wqi, wqi);

        db.run(
          `UPDATE daily_summaries SET
           avg_temperature = ?, avg_turbidity = ?, avg_ph = ?, avg_nh3 = ?,
           avg_dissolved_oxygen = ?, avg_wqi = ?, min_wqi = ?, max_wqi = ?,
           reading_count = ?
           WHERE date = ? AND node_id = ?`,
          [newAvgTemp, newAvgTurb, newAvgPH, newAvgNH3, newAvgDO, newAvgWQI, newMinWQI, newMaxWQI, newCount, today, nodeId]
        );
      } else {
        // Create new summary
        db.run(
          `INSERT INTO daily_summaries
           (date, node_id, location, avg_temperature, avg_turbidity, avg_ph, avg_nh3,
            avg_dissolved_oxygen, avg_wqi, min_wqi, max_wqi, reading_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            today,
            nodeId,
            reading.location || 'Unknown',
            reading.temperature,
            reading.turbidity,
            reading.pH || reading.ph,
            reading.nh3 || reading.NH3,
            reading.dissolvedOxygen || reading.do,
            wqi,
            wqi,
            wqi
          ]
        );
      }
    }
  );
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mqtt: mqttClient?.connected ? 'connected' : 'disconnected',
    database: 'connected'
  });
});

// Get latest reading
app.get('/api/readings/latest', (req, res) => {
  const nodeId = req.query.nodeId || null;
  
  let query = 'SELECT * FROM water_quality_readings';
  let params = [];
  
  if (nodeId) {
    query += ' WHERE node_id = ?';
    params.push(nodeId);
  }
  
  query += ' ORDER BY timestamp DESC LIMIT 1';
  
  db.get(query, params, (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(row || {});
    }
  });
});

// Get readings by date range
app.get('/api/readings', (req, res) => {
  const { startDate, endDate, nodeId, limit = 100 } = req.query;
  
  let query = 'SELECT * FROM water_quality_readings WHERE 1=1';
  let params = [];
  
  if (startDate) {
    query += ' AND date(timestamp) >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    query += ' AND date(timestamp) <= ?';
    params.push(endDate);
  }
  
  if (nodeId) {
    query += ' AND node_id = ?';
    params.push(nodeId);
  }
  
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));
  
  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Get daily summaries
app.get('/api/summaries/daily', (req, res) => {
  const { startDate, endDate, nodeId } = req.query;
  
  let query = 'SELECT * FROM daily_summaries WHERE 1=1';
  let params = [];
  
  if (startDate) {
    query += ' AND date >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    query += ' AND date <= ?';
    params.push(endDate);
  }
  
  if (nodeId) {
    query += ' AND node_id = ?';
    params.push(nodeId);
  }
  
  query += ' ORDER BY date DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Get water quality for specific date
app.get('/api/readings/date/:date', (req, res) => {
  const { date } = req.params;
  const nodeId = req.query.nodeId || null;
  
  let query = 'SELECT * FROM water_quality_readings WHERE date(timestamp) = ?';
  let params = [date];
  
  if (nodeId) {
    query += ' AND node_id = ?';
    params.push(nodeId);
  }
  
  query += ' ORDER BY timestamp DESC LIMIT 1';
  
  db.get(query, params, (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(row || {});
    }
  });
});

// Get alerts
app.get('/api/alerts', (req, res) => {
  const { limit = 50, severity } = req.query;
  
  let query = 'SELECT * FROM alerts WHERE 1=1';
  let params = [];
  
  if (severity) {
    query += ' AND severity = ?';
    params.push(severity);
  }
  
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));
  
  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// POST: Store reading (from web dashboard)
app.post('/api/readings', (req, res) => {
  const reading = req.body;
  
  db.run(
    `INSERT INTO water_quality_readings 
     (node_id, location, temperature, turbidity, ph, nh3, dissolved_oxygen, wqi, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reading.nodeId || reading.node || '1',
      reading.location || 'Unknown',
      reading.temperature,
      reading.turbidity,
      reading.pH || reading.ph,
      reading.nh3 || reading.NH3,
      reading.dissolvedOxygen || reading.do,
      Math.round(reading.wqi || reading.WQI || 0),
      reading.timestamp || new Date().toISOString()
    ],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ 
          success: true, 
          id: this.lastID,
          message: 'Reading stored successfully'
        });
      }
    }
  );
});

// POST: Store alert (from web dashboard)
app.post('/api/alerts', (req, res) => {
  const alert = req.body;
  
  db.run(
    `INSERT INTO alerts (node_id, title, detail, severity, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
    [
      alert.nodeId || alert.node || null,
      alert.title || 'Alert',
      alert.detail || alert.message || '',
      alert.severity || 'info',
      alert.timestamp || new Date().toISOString()
    ],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ 
          success: true, 
          id: this.lastID,
          message: 'Alert stored successfully'
        });
      }
    }
  );
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);
  connectMQTT();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  if (mqttClient) {
    mqttClient.end();
  }
  db.close((err) => {
    if (err) {
      console.error('❌ Error closing database:', err.message);
    } else {
      console.log('✅ Database connection closed');
    }
    process.exit(0);
  });
});

