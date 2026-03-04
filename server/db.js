/**
 * Database layer: uses Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set,
 * otherwise falls back to SQLite (wqms.db).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
let sqliteDb = null;
let sqlitePath = null;

if (useSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log('✅ Using Supabase database');
} else {
  const sqlite3 = require('sqlite3').verbose();
  const path = require('path');
  sqlitePath = path.join(__dirname, 'wqms.db');
  sqliteDb = new sqlite3.Database(sqlitePath, (err) => {
    if (err) console.error('❌ SQLite error:', err.message);
    else console.log('✅ Connected to SQLite database');
  });
}

// --- Helpers for SQLite ---
function sqliteRun(sql, params) {
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID });
    });
  });
}
function sqliteGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}
function sqliteAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// --- Readings ---
async function insertReading(row) {
  if (useSupabase) {
    const payload = {
      node_id: row.node_id,
      location: row.location,
      temperature: row.temperature,
      turbidity: row.turbidity,
      ph: row.ph,
      dissolved_oxygen: row.dissolved_oxygen,
      flow_rate: row.flow_rate ?? null,
      battery_voltage: row.battery_voltage ?? null,
      seq: row.seq ?? null,
      tx_millis: row.tx_millis ?? null,
      rx_millis: row.rx_millis ?? null,
      timestamp: row.timestamp,
      t_node: row.t_node ?? null,
      t_fwd_rx: row.t_fwd_rx ?? null,
      t_fwd_pub: row.t_fwd_pub ?? null,
      t_be_rx: row.t_be_rx ?? null,
      test_run_id: row.test_run_id ?? null,
    };
    const { data, error } = await supabase.from('sensor_readings').insert(payload).select('id').single();
    if (error) throw error;
    return { lastID: data?.id };
  }
  const sql = `INSERT INTO sensor_readings
    (node_id, location, temperature, turbidity, ph, dissolved_oxygen, flow_rate, battery_voltage,
     seq, tx_millis, rx_millis, timestamp, t_node, t_fwd_rx, t_fwd_pub, t_be_rx, test_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return sqliteRun(sql, [
    row.node_id, row.location, row.temperature, row.turbidity, row.ph,
    row.dissolved_oxygen, row.flow_rate ?? null, row.battery_voltage ?? null,
    row.seq ?? null, row.tx_millis ?? null, row.rx_millis ?? null, row.timestamp,
    row.t_node ?? null, row.t_fwd_rx ?? null, row.t_fwd_pub ?? null, row.t_be_rx ?? null,
    row.test_run_id ?? null,
  ]);
}

// --- Test Runs ---

async function createTestRun({ id, started_at, ends_at, duration_ms, interval_ms, node_id }) {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('test_runs')
      .insert({ id, started_at, ends_at, duration_ms, interval_ms, node_id: node_id ?? null, status: 'running' })
      .select('id')
      .single();
    if (error) throw error;
    return data;
  }
  await sqliteRun(
    `INSERT OR IGNORE INTO test_runs (id, started_at, ends_at, duration_ms, interval_ms, node_id, status) VALUES (?,?,?,?,?,?,?)`,
    [id, started_at, ends_at, duration_ms, interval_ms, node_id ?? null, 'running']
  );
  return { id };
}

async function closeTestRun({ id, status, stopped_at }) {
  if (useSupabase) {
    const { error } = await supabase
      .from('test_runs')
      .update({ status, stopped_at: stopped_at ?? null })
      .eq('id', id);
    if (error) throw error;
    return;
  }
  await sqliteRun(
    `UPDATE test_runs SET status=?, stopped_at=? WHERE id=?`,
    [status, stopped_at ?? null, id]
  );
}

async function getTestRun(id) {
  if (useSupabase) {
    const { data, error } = await supabase.from('test_runs').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }
  return sqliteGet(`SELECT * FROM test_runs WHERE id=?`, [id]);
}

async function getLatestReading(nodeId = null) {
  if (useSupabase) {
    let q = supabase.from('sensor_readings').select('*').order('timestamp', { ascending: false }).limit(1);
    if (nodeId) q = q.eq('node_id', nodeId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data || {};
  }
  let sql = 'SELECT * FROM sensor_readings';
  const params = [];
  if (nodeId) {
    sql += ' WHERE node_id = ?';
    params.push(nodeId);
  }
  sql += ' ORDER BY timestamp DESC LIMIT 1';
  const row = await sqliteGet(sql, params);
  return row || {};
}

async function getReadings({ startDate, endDate, nodeId, testRunId, limit = 100 }) {
  if (useSupabase) {
    let q = supabase.from('sensor_readings').select('*').order('timestamp', { ascending: false }).limit(parseInt(limit));
    if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
    if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
    if (nodeId) q = q.eq('node_id', nodeId);
    if (testRunId) q = q.eq('test_run_id', testRunId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  let sql = 'SELECT * FROM sensor_readings WHERE 1=1';
  const params = [];
  if (startDate) { sql += ' AND date(timestamp) >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND date(timestamp) <= ?'; params.push(endDate); }
  if (nodeId) { sql += ' AND node_id = ?'; params.push(nodeId); }
  if (testRunId) { sql += ' AND test_run_id = ?'; params.push(testRunId); }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));
  return sqliteAll(sql, params);
}

async function getReadingByDate(date, nodeId = null) {
  if (useSupabase) {
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    let q = supabase.from('sensor_readings').select('*').gte('timestamp', start).lte('timestamp', end).order('timestamp', { ascending: false }).limit(1);
    if (nodeId) q = q.eq('node_id', nodeId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data || {};
  }
  let sql = 'SELECT * FROM sensor_readings WHERE date(timestamp) = ?';
  const params = [date];
  if (nodeId) { sql += ' AND node_id = ?'; params.push(nodeId); }
  sql += ' ORDER BY timestamp DESC LIMIT 1';
  const row = await sqliteGet(sql, params);
  return row || {};
}

// --- Alerts ---
async function insertAlert(row) {
  if (useSupabase) {
    const payload = {
      node_id: row.node_id ?? null,
      title: row.title,
      detail: row.detail,
      severity: row.severity,
      type: row.type ?? null,
      node_name: row.node_name ?? null,
      parameter: row.parameter ?? null,
      value: row.value ?? null,
      threshold_min: row.threshold_min ?? null,
      threshold_max: row.threshold_max ?? null,
      status: row.status ?? 'active',
      seq: row.seq ?? null,
      timestamp: row.timestamp,
      t_alert_trigger: row.t_alert_trigger ?? null,
    };
    const { data, error } = await supabase.from('alerts').insert(payload).select('id').single();
    if (error) throw error;
    return { lastID: data?.id };
  }
  const sql = `INSERT INTO alerts
    (node_id, title, detail, severity, type, node_name, parameter, value,
     threshold_min, threshold_max, status, seq, timestamp, t_alert_trigger)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return sqliteRun(sql, [
    row.node_id ?? null, row.title, row.detail, row.severity,
    row.type ?? null, row.node_name ?? null, row.parameter ?? null, row.value ?? null,
    row.threshold_min ?? null, row.threshold_max ?? null, row.status ?? 'active',
    row.seq ?? null, row.timestamp, row.t_alert_trigger ?? null,
  ]);
}

async function getAlerts({ limit = 50, severity, startDate, endDate } = {}) {
  if (useSupabase) {
    let q = supabase.from('alerts').select('*').order('timestamp', { ascending: false }).limit(limit);
    if (severity) q = q.eq('severity', severity);
    if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
    if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  let sql = 'SELECT * FROM alerts WHERE 1=1';
  const params = [];
  if (severity) { sql += ' AND severity = ?'; params.push(severity); }
  if (startDate) { sql += ' AND date(timestamp) >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND date(timestamp) <= ?'; params.push(endDate); }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));
  return sqliteAll(sql, params);
}

async function getTestRunsList({ limit = 50 } = {}) {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('test_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }
  return sqliteAll('SELECT * FROM test_runs ORDER BY started_at DESC LIMIT ?', [parseInt(limit)]);
}

// --- Timestamp / Latency Logs ---
// Returns one row per seq_id with the full timestamp chain for pipeline latency analysis.
async function getTimestampLogs({ startDate, endDate, nodeId, limit = 200 } = {}) {
  if (useSupabase) {
    let q = supabase
      .from('sensor_readings')
      .select('id, node_id, seq, timestamp, t_node, t_fwd_rx, t_fwd_pub, t_be_rx, tx_millis, rx_millis')
      .order('timestamp', { ascending: false })
      .limit(parseInt(limit));
    if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
    if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
    if (nodeId) q = q.eq('node_id', nodeId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  let sql = `SELECT id, node_id, seq, timestamp, t_node, t_fwd_rx, t_fwd_pub, t_be_rx, tx_millis, rx_millis
    FROM sensor_readings WHERE 1=1`;
  const params = [];
  if (startDate) { sql += ' AND date(timestamp) >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND date(timestamp) <= ?'; params.push(endDate); }
  if (nodeId) { sql += ' AND node_id = ?'; params.push(nodeId); }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));
  return sqliteAll(sql, params);
}

// --- Daily summaries ---
async function getDailySummaries({ startDate, endDate, nodeId } = {}) {
  if (useSupabase) {
    let q = supabase.from('daily_summaries').select('*').order('date', { ascending: false });
    if (startDate) q = q.gte('date', startDate);
    if (endDate) q = q.lte('date', endDate);
    if (nodeId) q = q.eq('node_id', nodeId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  let sql = 'SELECT * FROM daily_summaries WHERE 1=1';
  const params = [];
  if (startDate) { sql += ' AND date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND date <= ?'; params.push(endDate); }
  if (nodeId) { sql += ' AND node_id = ?'; params.push(nodeId); }
  sql += ' ORDER BY date DESC';
  return sqliteAll(sql, params);
}

async function getDailySummaryByDateAndNode(date, nodeId) {
  if (useSupabase) {
    const { data, error } = await supabase.from('daily_summaries').select('*').eq('date', date).eq('node_id', nodeId).maybeSingle();
    if (error) throw error;
    return data;
  }
  const row = await sqliteGet('SELECT * FROM daily_summaries WHERE date = ? AND node_id = ?', [date, nodeId]);
  return row || null;
}

async function upsertDailySummary(row) {
  if (useSupabase) {
    const { error } = await supabase.from('daily_summaries').upsert(row, { onConflict: ['date', 'node_id'] });
    if (error) throw error;
    return;
  }
  const sql = `INSERT INTO daily_summaries (date, node_id, location, avg_temperature, avg_turbidity, avg_ph, avg_tan, avg_dissolved_oxygen, avg_flow_rate, avg_wqi, min_wqi, max_wqi, reading_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, node_id) DO UPDATE SET
    avg_temperature=excluded.avg_temperature, avg_turbidity=excluded.avg_turbidity, avg_ph=excluded.avg_ph, avg_tan=excluded.avg_tan,
    avg_dissolved_oxygen=excluded.avg_dissolved_oxygen, avg_flow_rate=excluded.avg_flow_rate, avg_wqi=excluded.avg_wqi, min_wqi=excluded.min_wqi, max_wqi=excluded.max_wqi, reading_count=excluded.reading_count`;
  await sqliteRun(sql, [
    row.date, row.node_id, row.location, row.avg_temperature, row.avg_turbidity, row.avg_ph, row.avg_tan ?? null,
    row.avg_dissolved_oxygen, row.avg_flow_rate ?? null, row.avg_wqi, row.min_wqi, row.max_wqi, row.reading_count
  ]);
}

// --- Initialize SQLite tables (when not using Supabase) ---
function initializeSqlite() {
  if (useSupabase || !sqliteDb) return;
  const run = (sql) => new Promise((res, rej) => sqliteDb.run(sql, (err) => (err ? rej(err) : res())));
  return Promise.all([
    run(`CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      location TEXT,
      temperature REAL,
      turbidity REAL,
      ph REAL,
      dissolved_oxygen REAL,
      flow_rate REAL,
      seq INTEGER,
      tx_millis INTEGER,
      rx_millis INTEGER,
      timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      t_node INTEGER,
      t_fwd_rx INTEGER,
      t_fwd_pub INTEGER,
      t_be_rx INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    run(`CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT,
      title TEXT,
      detail TEXT,
      severity TEXT,
      type TEXT,
      node_name TEXT,
      parameter TEXT,
      value REAL,
      threshold_min REAL,
      threshold_max REAL,
      status TEXT DEFAULT 'active',
      seq INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      t_alert_trigger INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    run(`CREATE TABLE IF NOT EXISTS daily_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE,
      node_id TEXT,
      location TEXT,
      avg_temperature REAL,
      avg_turbidity REAL,
      avg_ph REAL,
      avg_tan REAL,
      avg_dissolved_oxygen REAL,
      avg_flow_rate REAL,
      avg_wqi REAL,
      min_wqi INTEGER,
      max_wqi INTEGER,
      reading_count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, node_id)
    )`),
    // Migrate existing SQLite DBs: add columns if they don't exist yet (safe no-op if present)
    run(`ALTER TABLE sensor_readings ADD COLUMN t_node INTEGER`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN t_fwd_rx INTEGER`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN t_fwd_pub INTEGER`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN t_be_rx INTEGER`).catch(() => {}),
    run(`ALTER TABLE alerts ADD COLUMN type TEXT`).catch(() => {}),
    run(`ALTER TABLE alerts ADD COLUMN node_name TEXT`).catch(() => {}),
    run(`ALTER TABLE alerts ADD COLUMN parameter TEXT`).catch(() => {}),
    run(`ALTER TABLE alerts ADD COLUMN value REAL`).catch(() => {}),
    run(`ALTER TABLE alerts ADD COLUMN threshold_min REAL`).catch(() => {}),
    run(`ALTER TABLE alerts ADD COLUMN threshold_max REAL`).catch(() => {}),
    run(`ALTER TABLE alerts ADD COLUMN status TEXT DEFAULT 'active'`).catch(() => {}),
    run(`ALTER TABLE alerts ADD COLUMN seq INTEGER`).catch(() => {}),
    run(`ALTER TABLE alerts ADD COLUMN t_alert_trigger INTEGER`).catch(() => {}),
    run(`CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      interval_ms INTEGER NOT NULL,
      node_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      stopped_at INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    run(`ALTER TABLE sensor_readings ADD COLUMN test_run_id TEXT`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN battery_voltage REAL`).catch(() => {}),
  ]).then(() => console.log('✅ SQLite tables initialized'));
}

function close() {
  if (sqliteDb) {
    return new Promise((resolve, reject) => {
      sqliteDb.close((err) => (err ? reject(err) : resolve()));
    });
  }
  return Promise.resolve();
}

module.exports = {
  useSupabase: () => useSupabase,
  initializeSqlite,
  close,
  insertReading,
  getLatestReading,
  getReadings,
  getReadingByDate,
  insertAlert,
  getAlerts,
  getTimestampLogs,
  getDailySummaries,
  getDailySummaryByDateAndNode,
  upsertDailySummary,
  createTestRun,
  closeTestRun,
  getTestRun,
  getTestRunsList,
};
