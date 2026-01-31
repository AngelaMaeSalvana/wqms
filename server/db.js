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
    const { data, error } = await supabase.from('water_quality_readings').insert(row).select('id').single();
    if (error) throw error;
    return { lastID: data?.id };
  }
  const sql = `INSERT INTO water_quality_readings (node_id, location, temperature, turbidity, ph, nh3, dissolved_oxygen, wqi, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return sqliteRun(sql, [row.node_id, row.location, row.temperature, row.turbidity, row.ph, row.nh3, row.dissolved_oxygen, row.wqi, row.timestamp]);
}

async function getLatestReading(nodeId = null) {
  if (useSupabase) {
    let q = supabase.from('water_quality_readings').select('*').order('timestamp', { ascending: false }).limit(1);
    if (nodeId) q = q.eq('node_id', nodeId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data || {};
  }
  let sql = 'SELECT * FROM water_quality_readings';
  const params = [];
  if (nodeId) {
    sql += ' WHERE node_id = ?';
    params.push(nodeId);
  }
  sql += ' ORDER BY timestamp DESC LIMIT 1';
  const row = await sqliteGet(sql, params);
  return row || {};
}

async function getReadings({ startDate, endDate, nodeId, limit = 100 }) {
  if (useSupabase) {
    let q = supabase.from('water_quality_readings').select('*').order('timestamp', { ascending: false }).limit(parseInt(limit));
    if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
    if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
    if (nodeId) q = q.eq('node_id', nodeId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  let sql = 'SELECT * FROM water_quality_readings WHERE 1=1';
  const params = [];
  if (startDate) { sql += ' AND date(timestamp) >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND date(timestamp) <= ?'; params.push(endDate); }
  if (nodeId) { sql += ' AND node_id = ?'; params.push(nodeId); }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));
  return sqliteAll(sql, params);
}

async function getReadingByDate(date, nodeId = null) {
  if (useSupabase) {
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    let q = supabase.from('water_quality_readings').select('*').gte('timestamp', start).lte('timestamp', end).order('timestamp', { ascending: false }).limit(1);
    if (nodeId) q = q.eq('node_id', nodeId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data || {};
  }
  let sql = 'SELECT * FROM water_quality_readings WHERE date(timestamp) = ?';
  const params = [date];
  if (nodeId) { sql += ' AND node_id = ?'; params.push(nodeId); }
  sql += ' ORDER BY timestamp DESC LIMIT 1';
  const row = await sqliteGet(sql, params);
  return row || {};
}

// --- Alerts ---
async function insertAlert(row) {
  if (useSupabase) {
    const { data, error } = await supabase.from('alerts').insert(row).select('id').single();
    if (error) throw error;
    return { lastID: data?.id };
  }
  const sql = `INSERT INTO alerts (node_id, title, detail, severity, timestamp) VALUES (?, ?, ?, ?, ?)`;
  return sqliteRun(sql, [row.node_id, row.title, row.detail, row.severity, row.timestamp]);
}

async function getAlerts({ limit = 50, severity } = {}) {
  if (useSupabase) {
    let q = supabase.from('alerts').select('*').order('timestamp', { ascending: false }).limit(limit);
    if (severity) q = q.eq('severity', severity);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  let sql = 'SELECT * FROM alerts WHERE 1=1';
  const params = [];
  if (severity) { sql += ' AND severity = ?'; params.push(severity); }
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
  const sql = `INSERT INTO daily_summaries (date, node_id, location, avg_temperature, avg_turbidity, avg_ph, avg_nh3, avg_dissolved_oxygen, avg_wqi, min_wqi, max_wqi, reading_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, node_id) DO UPDATE SET
    avg_temperature=excluded.avg_temperature, avg_turbidity=excluded.avg_turbidity, avg_ph=excluded.avg_ph, avg_nh3=excluded.avg_nh3,
    avg_dissolved_oxygen=excluded.avg_dissolved_oxygen, avg_wqi=excluded.avg_wqi, min_wqi=excluded.min_wqi, max_wqi=excluded.max_wqi, reading_count=excluded.reading_count`;
  await sqliteRun(sql, [
    row.date, row.node_id, row.location, row.avg_temperature, row.avg_turbidity, row.avg_ph, row.avg_nh3,
    row.avg_dissolved_oxygen, row.avg_wqi, row.min_wqi, row.max_wqi, row.reading_count
  ]);
}

// --- Initialize SQLite tables (when not using Supabase) ---
function initializeSqlite() {
  if (useSupabase || !sqliteDb) return;
  const run = (sql) => new Promise((res, rej) => sqliteDb.run(sql, (err) => (err ? rej(err) : res())));
  return Promise.all([
    run(`CREATE TABLE IF NOT EXISTS water_quality_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT, location TEXT, temperature REAL, turbidity REAL, ph REAL, nh3 REAL, dissolved_oxygen REAL, wqi INTEGER, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, created_at DATETIME DEFAULT CURRENT_TIMESTAMP )`),
    run(`CREATE TABLE IF NOT EXISTS alerts ( id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT, title TEXT, detail TEXT, severity TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, created_at DATETIME DEFAULT CURRENT_TIMESTAMP )`),
    run(`CREATE TABLE IF NOT EXISTS daily_summaries ( id INTEGER PRIMARY KEY AUTOINCREMENT, date DATE, node_id TEXT, location TEXT, avg_temperature REAL, avg_turbidity REAL, avg_ph REAL, avg_nh3 REAL, avg_dissolved_oxygen REAL, avg_wqi REAL, min_wqi INTEGER, max_wqi INTEGER, reading_count INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(date, node_id) )`)
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
  getDailySummaries,
  getDailySummaryByDateAndNode,
  upsertDailySummary,
};
