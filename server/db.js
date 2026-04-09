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
      temperature: row.temperature,
      turbidity: row.turbidity,
      ph: row.ph,
      dissolved_oxygen: row.dissolved_oxygen,
      flow_rate: row.flow_rate ?? null,
      battery_voltage: row.battery_voltage ?? null,
      battery_percentage: row.battery_percentage ?? null,
      temperature_corrected: row.temperature_corrected ?? null,
      ph_corrected: row.ph_corrected ?? null,
      turbidity_corrected: row.turbidity_corrected ?? null,
      dissolved_oxygen_corrected: row.dissolved_oxygen_corrected ?? null,
      flow_rate_corrected: row.flow_rate_corrected ?? null,
      nh3_corrected: row.nh3_corrected ?? null,
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
    delete payload.location; // column removed from sensor_readings; location is in nodes
    const { data, error } = await supabase.from('sensor_readings').insert(payload).select('id').single();
    if (error) throw error;
    return { lastID: data?.id };
  }
  const sql = `INSERT INTO sensor_readings
    (node_id, temperature, turbidity, ph, dissolved_oxygen, flow_rate, battery_voltage, battery_percentage,
     temperature_corrected, ph_corrected, turbidity_corrected, dissolved_oxygen_corrected, flow_rate_corrected, nh3_corrected,
     seq, tx_millis, rx_millis, timestamp, t_node, t_fwd_rx, t_fwd_pub, t_be_rx, test_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return sqliteRun(sql, [
    row.node_id, row.temperature, row.turbidity, row.ph,
    row.dissolved_oxygen, row.flow_rate ?? null, row.battery_voltage ?? null, row.battery_percentage ?? null,
    row.temperature_corrected ?? null, row.ph_corrected ?? null, row.turbidity_corrected ?? null,
    row.dissolved_oxygen_corrected ?? null, row.flow_rate_corrected ?? null, row.nh3_corrected ?? null,
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

async function getReadings({ startDate, endDate, nodeId, testRunId, monitoringOnly, limit = 100 }) {
  if (useSupabase) {
    let q = supabase.from('sensor_readings').select('*').order('timestamp', { ascending: false }).limit(parseInt(limit));
    if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
    if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
    if (nodeId) q = q.eq('node_id', nodeId);
    if (testRunId) q = q.eq('test_run_id', testRunId);
    else if (monitoringOnly) q = q.is('test_run_id', null);
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
  else if (monitoringOnly) { sql += ' AND (test_run_id IS NULL OR test_run_id = \'\')'; }
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

async function getAlerts({ limit = 50, severity, startDate, endDate, nodeId } = {}) {
  if (useSupabase) {
    let q = supabase.from('alerts').select('*').order('timestamp', { ascending: false }).limit(limit);
    if (severity) q = q.eq('severity', severity);
    if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
    if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
    if (nodeId) q = q.eq('node_id', nodeId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  let sql = 'SELECT * FROM alerts WHERE 1=1';
  const params = [];
  if (severity) { sql += ' AND severity = ?'; params.push(severity); }
  if (startDate) { sql += ' AND date(timestamp) >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND date(timestamp) <= ?'; params.push(endDate); }
  if (nodeId) { sql += ' AND node_id = ?'; params.push(nodeId); }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));
  return sqliteAll(sql, params);
}

async function updateAlertEmailSent(id, emailSentAt) {
  const ts = emailSentAt ? new Date(emailSentAt).toISOString() : null;
  if (useSupabase) {
    const { error } = await supabase.from('alerts').update({ email_sent_at: ts }).eq('id', id);
    if (error) throw error;
    return;
  }
  await sqliteRun('UPDATE alerts SET email_sent_at = ? WHERE id = ?', [ts, id]);
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

// --- Users (app-managed auth) ---
async function getUserById(userId) {
  const isMissingEmailColumnError = (err) => {
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes("users.email") ||
      msg.includes("users.is_active") ||
      (msg.includes("column") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active"))) ||
      (msg.includes("schema cache") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active")))
    );
  };

  if (useSupabase) {
    const withEmail = await supabase
      .from('users')
      .select('id, username, email, password_hash, role, is_active, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();
    if (!withEmail.error) return withEmail.data || null;
    if (!isMissingEmailColumnError(withEmail.error)) {
      throw withEmail.error;
    }
    const legacy = await supabase
      .from('users')
      .select('id, username, password_hash, role, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();
    if (legacy.error) throw legacy.error;
    return legacy.data ? { ...legacy.data, email: null, is_active: true } : null;
  }
  return sqliteGet('SELECT id, username, email, password_hash, role, is_active, created_at, updated_at FROM users WHERE id = ?', [userId]);
}

async function getUserByUsername(username) {
  const isMissingEmailColumnError = (err) => {
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes("users.email") ||
      msg.includes("users.is_active") ||
      (msg.includes("column") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active"))) ||
      (msg.includes("schema cache") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active")))
    );
  };

  if (useSupabase) {
    const withEmail = await supabase
      .from('users')
      .select('id, username, email, password_hash, role, is_active, created_at, updated_at')
      .eq('username', username)
      .maybeSingle();
    if (!withEmail.error) return withEmail.data || null;
    if (!isMissingEmailColumnError(withEmail.error)) {
      throw withEmail.error;
    }
    const legacy = await supabase
      .from('users')
      .select('id, username, password_hash, role, created_at, updated_at')
      .eq('username', username)
      .maybeSingle();
    if (legacy.error) throw legacy.error;
    return legacy.data ? { ...legacy.data, email: null, is_active: true } : null;
  }
  return sqliteGet('SELECT id, username, email, password_hash, role, is_active, created_at, updated_at FROM users WHERE username = ?', [username]);
}

async function getUserByEmail(email) {
  const isMissingEmailColumnError = (err) => {
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes("users.email") ||
      msg.includes("users.is_active") ||
      (msg.includes("column") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active"))) ||
      (msg.includes("schema cache") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active")))
    );
  };

  if (!email) return null;
  if (useSupabase) {
    const { data, error } = await supabase
      .from('users')
      .select('id, username, email, password_hash, role, is_active, created_at, updated_at')
      .eq('email', email)
      .maybeSingle();
    if (error) {
      if (isMissingEmailColumnError(error)) return null;
      throw error;
    }
    return data || null;
  }
  return sqliteGet('SELECT id, username, email, password_hash, role, is_active, created_at, updated_at FROM users WHERE email = ?', [email]);
}

async function createUser({ id, username, email = null, password_hash, role = 'guest', is_active = true }) {
  const isMissingEmailColumnError = (err) => {
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes("users.email") ||
      msg.includes("users.is_active") ||
      (msg.includes("column") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active"))) ||
      (msg.includes("schema cache") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active")))
    );
  };

  if (useSupabase) {
    const payload = { id, username, email, password_hash, role, is_active: !!is_active, updated_at: new Date().toISOString() };
    const withEmail = await supabase
      .from('users')
      .insert(payload)
      .select('id, username, email, role, is_active, created_at, updated_at')
      .single();
    if (!withEmail.error) return withEmail.data;
    if (!isMissingEmailColumnError(withEmail.error)) {
      throw withEmail.error;
    }

    const legacyPayload = { id, username, password_hash, role, updated_at: new Date().toISOString() };
    const legacy = await supabase
      .from('users')
      .insert(legacyPayload)
      .select('id, username, role, created_at, updated_at')
      .single();
    if (legacy.error) throw legacy.error;
    return { ...legacy.data, email: null, is_active: true };
  }
  await sqliteRun(
    'INSERT INTO users (id, username, email, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    [id, username, email, password_hash, role, is_active ? 1 : 0]
  );
  return { id, username, email, role, is_active: !!is_active };
}

async function updateUserAccount({ id, username, email, password_hash }) {
  const isMissingEmailColumnError = (err) => {
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes("users.email") ||
      msg.includes("users.is_active") ||
      (msg.includes("column") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active"))) ||
      (msg.includes("schema cache") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active")))
    );
  };

  if (useSupabase) {
    const payload = { updated_at: new Date().toISOString() };
    if (username != null) payload.username = username;
    if (email !== undefined) payload.email = email;
    if (password_hash != null) payload.password_hash = password_hash;
    const withEmail = await supabase
      .from('users')
      .update(payload)
      .eq('id', id)
      .select('id, username, email, role, is_active, created_at, updated_at')
      .single();
    if (!withEmail.error) return withEmail.data;
    if (!isMissingEmailColumnError(withEmail.error)) {
      throw withEmail.error;
    }
    const legacyPayload = { updated_at: new Date().toISOString() };
    if (username != null) legacyPayload.username = username;
    if (password_hash != null) legacyPayload.password_hash = password_hash;
    const legacy = await supabase
      .from('users')
      .update(legacyPayload)
      .eq('id', id)
      .select('id, username, role, created_at, updated_at')
      .single();
    if (legacy.error) throw legacy.error;
    return { ...legacy.data, email: null, is_active: true };
  }

  const fields = [];
  const params = [];
  if (username != null) {
    fields.push('username = ?');
    params.push(username);
  }
  if (email !== undefined) {
    fields.push('email = ?');
    params.push(email);
  }
  if (password_hash != null) {
    fields.push('password_hash = ?');
    params.push(password_hash);
  }
  if (fields.length > 0) {
    fields.push('updated_at = CURRENT_TIMESTAMP');
    await sqliteRun(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
  }
  return sqliteGet('SELECT id, username, email, role, is_active, created_at, updated_at FROM users WHERE id = ?', [id]);
}

async function listUsers() {
  const isMissingEmailColumnError = (err) => {
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes("users.email") ||
      msg.includes("users.is_active") ||
      (msg.includes("column") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active"))) ||
      (msg.includes("schema cache") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active")))
    );
  };

  if (useSupabase) {
    const withEmail = await supabase
      .from('users')
      .select('id, username, email, role, is_active, created_at, updated_at')
      .order('created_at', { ascending: true });
    if (!withEmail.error) return withEmail.data || [];
    if (!isMissingEmailColumnError(withEmail.error)) {
      throw withEmail.error;
    }
    const legacy = await supabase
      .from('users')
      .select('id, username, role, created_at, updated_at')
      .order('created_at', { ascending: true });
    if (legacy.error) throw legacy.error;
    return (legacy.data || []).map((row) => ({ ...row, email: null, is_active: true }));
  }
  return sqliteAll('SELECT id, username, email, role, is_active, created_at, updated_at FROM users ORDER BY created_at ASC');
}

async function updateUserRole({ id, role }) {
  if (role !== 'admin' && role !== 'guest') {
    throw new Error('invalid role');
  }

  if (useSupabase) {
    const isMissingEmailColumnError = (err) => {
      const msg = String(err?.message || '').toLowerCase();
      return (
        msg.includes("users.email") ||
        msg.includes("users.is_active") ||
        (msg.includes("column") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active"))) ||
        (msg.includes("schema cache") && msg.includes("users") && (msg.includes("email") || msg.includes("is_active")))
      );
    };

    const withEmail = await supabase
      .from('users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, username, email, role, is_active, created_at, updated_at')
      .single();
    if (!withEmail.error) return withEmail.data;
    if (!isMissingEmailColumnError(withEmail.error)) {
      throw withEmail.error;
    }

    const legacy = await supabase
      .from('users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, username, role, created_at, updated_at')
      .single();
    if (legacy.error) throw legacy.error;
    return { ...legacy.data, email: null, is_active: true };
  }

  await sqliteRun('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [role, id]);
  return sqliteGet('SELECT id, username, email, role, is_active, created_at, updated_at FROM users WHERE id = ?', [id]);
}

async function updateUserActive({ id, is_active }) {
  const nextActive = !!is_active;
  if (useSupabase) {
    const withEmail = await supabase
      .from('users')
      .update({ is_active: nextActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, username, email, role, is_active, created_at, updated_at')
      .single();
    if (!withEmail.error) return withEmail.data;
    throw withEmail.error;
  }

  await sqliteRun('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nextActive ? 1 : 0, id]);
  return sqliteGet('SELECT id, username, email, role, is_active, created_at, updated_at FROM users WHERE id = ?', [id]);
}

function isMissingAuthSessionsError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('auth_sessions') &&
    (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('relation'))
  );
}

async function recordLoginSession({ id, user_id, login_at, ip_address = null, user_agent = null }) {
  const loginAtIso = login_at ? new Date(login_at).toISOString() : new Date().toISOString();
  if (useSupabase) {
    const { error } = await supabase.from('auth_sessions').insert({
      id,
      user_id,
      login_at: loginAtIso,
      ip_address: ip_address || null,
      user_agent: user_agent || null,
    });
    if (error) {
      if (isMissingAuthSessionsError(error)) return null;
      throw error;
    }
    return { id, user_id, login_at: loginAtIso };
  }
  await sqliteRun(
    'INSERT INTO auth_sessions (id, user_id, login_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
    [id, user_id, loginAtIso, ip_address || null, user_agent || null]
  );
  return { id, user_id, login_at: loginAtIso };
}

async function closeActiveSession({ user_id, logout_at }) {
  const logoutAtIso = logout_at ? new Date(logout_at).toISOString() : new Date().toISOString();
  if (useSupabase) {
    const active = await supabase
      .from('auth_sessions')
      .select('id')
      .eq('user_id', user_id)
      .is('logout_at', null)
      .order('login_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active.error) {
      if (isMissingAuthSessionsError(active.error)) return null;
      throw active.error;
    }
    if (!active.data?.id) return null;
    const { error } = await supabase
      .from('auth_sessions')
      .update({ logout_at: logoutAtIso })
      .eq('id', active.data.id);
    if (error) throw error;
    return { id: active.data.id, logout_at: logoutAtIso };
  }
  const row = await sqliteGet(
    'SELECT id FROM auth_sessions WHERE user_id = ? AND logout_at IS NULL ORDER BY login_at DESC LIMIT 1',
    [user_id]
  );
  if (!row?.id) return null;
  await sqliteRun('UPDATE auth_sessions SET logout_at = ? WHERE id = ?', [logoutAtIso, row.id]);
  return { id: row.id, logout_at: logoutAtIso };
}

async function listUserSessions({ user_id, limit = 20 }) {
  const maxLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  if (useSupabase) {
    const { data, error } = await supabase
      .from('auth_sessions')
      .select('id, user_id, login_at, logout_at, ip_address, user_agent, created_at')
      .eq('user_id', user_id)
      .order('login_at', { ascending: false })
      .limit(maxLimit);
    if (error) {
      if (isMissingAuthSessionsError(error)) return [];
      throw error;
    }
    return data || [];
  }
  return sqliteAll(
    `SELECT id, user_id, login_at, logout_at, ip_address, user_agent, created_at
     FROM auth_sessions
     WHERE user_id = ?
     ORDER BY login_at DESC
     LIMIT ?`,
    [user_id, maxLimit]
  );
}

async function recordUserRoleChange({ id, actor_user_id, target_user_id, from_role, to_role, changed_at }) {
  const changedAtIso = changed_at ? new Date(changed_at).toISOString() : new Date().toISOString();
  if (useSupabase) {
    const { error } = await supabase.from('user_role_audit').insert({
      id,
      actor_user_id,
      target_user_id,
      from_role,
      to_role,
      changed_at: changedAtIso,
    });
    if (error) return null;
    return { id, actor_user_id, target_user_id, from_role, to_role, changed_at: changedAtIso };
  }
  await sqliteRun(
    `INSERT INTO user_role_audit (id, actor_user_id, target_user_id, from_role, to_role, changed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, actor_user_id, target_user_id, from_role, to_role, changedAtIso]
  );
  return { id, actor_user_id, target_user_id, from_role, to_role, changed_at: changedAtIso };
}

async function listUserRoleChanges({ target_user_id, limit = 20 }) {
  const maxLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  if (useSupabase) {
    const { data, error } = await supabase
      .from('user_role_audit')
      .select('id, actor_user_id, target_user_id, from_role, to_role, changed_at, created_at')
      .eq('target_user_id', target_user_id)
      .order('changed_at', { ascending: false })
      .limit(maxLimit);
    if (error) return [];
    return data || [];
  }
  return sqliteAll(
    `SELECT id, actor_user_id, target_user_id, from_role, to_role, changed_at, created_at
     FROM user_role_audit
     WHERE target_user_id = ?
     ORDER BY changed_at DESC
     LIMIT ?`,
    [target_user_id, maxLimit]
  );
}

async function recordAuditEvent({ id, actor_user_id, action, entity_type, entity_id = null, details = null }) {
  const payload = {
    id,
    actor_user_id,
    action,
    entity_type,
    entity_id: entity_id || null,
    details: details || {},
    created_at: new Date().toISOString(),
  };
  if (useSupabase) {
    const { error } = await supabase.from('audit_events').insert(payload);
    if (error) return null;
    return payload;
  }
  await sqliteRun(
    `INSERT INTO audit_events (id, actor_user_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.id,
      payload.actor_user_id,
      payload.action,
      payload.entity_type,
      payload.entity_id,
      JSON.stringify(payload.details || {}),
      payload.created_at,
    ]
  );
  return payload;
}

async function listAuditEventsByActor({ actor_user_id, limit = 50 }) {
  const maxLimit = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
  if (useSupabase) {
    const { data, error } = await supabase
      .from('audit_events')
      .select('id, actor_user_id, action, entity_type, entity_id, details, created_at')
      .eq('actor_user_id', actor_user_id)
      .order('created_at', { ascending: false })
      .limit(maxLimit);
    if (error) return [];
    return data || [];
  }
  const rows = await sqliteAll(
    `SELECT id, actor_user_id, action, entity_type, entity_id, details, created_at
     FROM audit_events
     WHERE actor_user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [actor_user_id, maxLimit]
  );
  return (rows || []).map((r) => {
    let parsed = {};
    try {
      parsed = r.details ? JSON.parse(r.details) : {};
    } catch {
      parsed = {};
    }
    return { ...r, details: parsed };
  });
}

// --- Password reset tokens (hashed; raw token never stored) ---
async function deletePasswordResetTokensForUser(userId) {
  if (useSupabase) {
    const { error } = await supabase.from('password_reset_tokens').delete().eq('user_id', userId);
    if (error) throw error;
    return;
  }
  await sqliteRun('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
}

async function deleteExpiredPasswordResetTokens() {
  const nowIso = new Date().toISOString();
  if (useSupabase) {
    const { error } = await supabase.from('password_reset_tokens').delete().lt('expires_at', nowIso);
    if (error) throw error;
    return;
  }
  await sqliteRun('DELETE FROM password_reset_tokens WHERE expires_at < ?', [nowIso]);
}

async function insertPasswordResetToken({ id, user_id, token_hash, expires_at }) {
  const exp = typeof expires_at === 'string' ? expires_at : new Date(expires_at).toISOString();
  if (useSupabase) {
    const { error } = await supabase.from('password_reset_tokens').insert({
      user_id,
      token_hash,
      expires_at: exp,
    });
    if (error) throw error;
    return;
  }
  await sqliteRun(
    'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [id, user_id, token_hash, exp]
  );
}

async function getPasswordResetTokenRowByHash(token_hash) {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('password_reset_tokens')
      .select('*')
      .eq('token_hash', token_hash)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }
  return sqliteGet('SELECT * FROM password_reset_tokens WHERE token_hash = ?', [token_hash]);
}

async function deletePasswordResetTokenById(tokenRowId) {
  if (useSupabase) {
    const { error } = await supabase.from('password_reset_tokens').delete().eq('id', tokenRowId);
    if (error) throw error;
    return;
  }
  await sqliteRun('DELETE FROM password_reset_tokens WHERE id = ?', [tokenRowId]);
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
    run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'guest',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    run(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      login_at DATETIME NOT NULL,
      logout_at DATETIME,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    run(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_login ON auth_sessions (user_id, login_at DESC)`),
    run(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_logout ON auth_sessions (user_id, logout_at)`),
    run(`CREATE TABLE IF NOT EXISTS user_role_audit (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_role TEXT NOT NULL,
      to_role TEXT NOT NULL,
      changed_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    run(`CREATE INDEX IF NOT EXISTS idx_user_role_audit_target_changed ON user_role_audit (target_user_id, changed_at DESC)`),
    run(`CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    run(`CREATE INDEX IF NOT EXISTS idx_audit_events_actor_created ON audit_events (actor_user_id, created_at DESC)`),
    run(`ALTER TABLE users ADD COLUMN email TEXT`).catch(() => {}),
    run(`ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`).catch(() => {}),
    run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (email)`).catch(() => {}),
    run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`),
    run(`CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens (token_hash)`),
    run(`CREATE INDEX IF NOT EXISTS idx_password_reset_user_id ON password_reset_tokens (user_id)`),
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
    run(`ALTER TABLE alerts ADD COLUMN email_sent_at DATETIME`).catch(() => {}),
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
    run(`ALTER TABLE sensor_readings ADD COLUMN battery_percentage INTEGER`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN wqi INTEGER`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN temperature_corrected REAL`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN ph_corrected REAL`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN turbidity_corrected REAL`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN dissolved_oxygen_corrected REAL`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN flow_rate_corrected REAL`).catch(() => {}),
    run(`ALTER TABLE sensor_readings ADD COLUMN nh3_corrected REAL`).catch(() => {}),
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
  updateAlertEmailSent,
  getTimestampLogs,
  getDailySummaries,
  getDailySummaryByDateAndNode,
  upsertDailySummary,
  createTestRun,
  closeTestRun,
  getTestRun,
  getTestRunsList,
  getUserById,
  getUserByUsername,
  getUserByEmail,
  createUser,
  updateUserAccount,
  listUsers,
  updateUserRole,
  updateUserActive,
  recordLoginSession,
  closeActiveSession,
  listUserSessions,
  recordUserRoleChange,
  listUserRoleChanges,
  recordAuditEvent,
  listAuditEventsByActor,
  deletePasswordResetTokensForUser,
  deleteExpiredPasswordResetTokens,
  insertPasswordResetToken,
  getPasswordResetTokenRowByHash,
  deletePasswordResetTokenById,
};
