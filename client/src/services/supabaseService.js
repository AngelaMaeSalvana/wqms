/**
 * WQMS data layer using Supabase.
 * Used when Supabase env vars are set (Vercel + Supabase).
 */
import { supabase, isSupabaseEnabled } from '../lib/supabaseClient';

export { isSupabaseEnabled };

// --- Readings ---

export async function getLatestReading(nodeId = null) {
  if (!isSupabaseEnabled()) return null;
  let q = supabase
    .from('sensor_readings')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(1);
  if (nodeId) q = q.eq('node_id', nodeId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return data || {};
}

export async function getReadings({ startDate, endDate, nodeId, testRunId, monitoringOnly, limit = 100 }) {
  if (!isSupabaseEnabled()) return [];
  let q = supabase.from('sensor_readings').select('*');
  if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
  if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
  if (nodeId) q = q.eq('node_id', nodeId);
  if (testRunId) q = q.eq('test_run_id', testRunId);
  else if (monitoringOnly) q = q.is('test_run_id', null);
  q = q.order('timestamp', { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

/** Same table as getReadings; higher default limit. Monitoring only (no test_run_id). */
export async function getSensorReadings({ startDate, endDate, nodeId, limit = 500 }) {
  return getReadings({ startDate, endDate, nodeId, monitoringOnly: true, limit });
}

/**
 * Fetch raw timestamp-chain columns for IoT performance evaluation.
 * Returns: node_id, seq, t_node, t_fwd_rx, t_fwd_pub, t_be_rx, timestamp, rssi, snr
 */
export async function getPerformanceReadings({ startDate, endDate, nodeId, testRunId, limit = 1000 }) {
  if (!isSupabaseEnabled()) return [];
  let q = supabase
    .from('sensor_readings')
    .select('node_id, seq, t_node, t_fwd_rx, t_fwd_pub, t_be_rx, timestamp, rssi, snr');
  if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
  if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
  if (nodeId) q = q.eq('node_id', nodeId);
  if (testRunId) q = q.eq('test_run_id', testRunId);
  q = q.order('seq', { ascending: true, nullsFirst: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Fetch alerts with t_alert_trigger for alert responsiveness evaluation.
 */
export async function getPerformanceAlerts({ startDate, endDate, nodeId, limit = 200 }) {
  if (!isSupabaseEnabled()) return [];
  let q = supabase
    .from('alerts')
    .select('node_id, seq, t_alert_trigger, timestamp')
    .not('t_alert_trigger', 'is', null);
  if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
  if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
  if (nodeId) q = q.eq('node_id', nodeId);
  q = q.order('timestamp', { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getDailySummaries({ startDate, endDate, nodeId }) {
  if (!isSupabaseEnabled()) return [];
  let q = supabase
    .from('daily_summaries')
    .select('*')
    .order('date', { ascending: false });
  if (startDate) q = q.gte('date', startDate);
  if (endDate) q = q.lte('date', endDate);
  if (nodeId) q = q.eq('node_id', nodeId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getReadingByDate(date, nodeId = null) {
  if (!isSupabaseEnabled()) return null;
  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;
  let q = supabase
    .from('sensor_readings')
    .select('*')
    .gte('timestamp', start)
    .lte('timestamp', end)
    .order('timestamp', { ascending: false })
    .limit(1);
  if (nodeId) q = q.eq('node_id', nodeId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return data || {};
}

export async function postReading(reading) {
  if (!isSupabaseEnabled()) throw new Error('Supabase not configured');
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
  const { data, error } = await supabase
    .from('sensor_readings')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { success: true, id: data?.id, message: 'Reading stored successfully' };
}

// --- Alerts ---

export async function getAlerts({ limit = 50, severity, startDate, endDate } = {}) {
  if (!isSupabaseEnabled()) return [];
  let q = supabase
    .from('alerts')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit);
  if (severity) q = q.eq('severity', severity);
  if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
  if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function postAlert(alert) {
  if (!isSupabaseEnabled()) throw new Error('Supabase not configured');
  const row = {
    node_id: alert.nodeId ?? alert.node ?? null,
    title: alert.title || 'Alert',
    detail: alert.detail ?? alert.message ?? '',
    severity: alert.severity || 'info',
    type: alert.type ?? null,
    node_name: alert.nodeName ?? alert.node_name ?? null,
    parameter: alert.parameter ?? null,
    value: alert.value ?? null,
    threshold_min: alert.thresholdMin ?? alert.threshold_min ?? null,
    threshold_max: alert.thresholdMax ?? alert.threshold_max ?? null,
    status: alert.status ?? 'active',
    timestamp: alert.timestamp || new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('alerts')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { success: true, id: data?.id, message: 'Alert stored successfully' };
}

/**
 * Insert new alerts into the DB, skipping any that already exist today
 * for the same node_id + type + parameter combination.
 */
export async function upsertAlerts(alertsList) {
  if (!isSupabaseEnabled()) return [];
  if (!alertsList || alertsList.length === 0) return [];

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Fetch today's existing alerts to avoid duplicates.
  const { data: existing } = await supabase
    .from('alerts')
    .select('node_id, type, parameter')
    .gte('timestamp', todayStart.toISOString());

  const existingKeys = new Set(
    (existing || []).map((r) => `${r.node_id}|${r.type}|${r.parameter ?? ''}`)
  );

  const toInsert = alertsList
    .filter((a) => {
      const key = `${a.nodeId ?? a.node_id ?? ''}|${a.type ?? ''}|${a.parameter ?? ''}`;
      return !existingKeys.has(key);
    })
    .map((alert) => ({
      node_id: alert.nodeId ?? alert.node_id ?? null,
      title: alert.title || 'Alert',
      detail: alert.detail ?? alert.message ?? '',
      severity: alert.severity || 'info',
      type: alert.type ?? null,
      node_name: alert.nodeName ?? alert.node_name ?? null,
      parameter: alert.parameter ?? null,
      value: alert.value != null ? String(alert.value) : null,
      threshold_min: alert.thresholdMin ?? alert.threshold_min ?? null,
      threshold_max: alert.thresholdMax ?? alert.threshold_max ?? null,
      status: alert.status ?? 'active',
      timestamp: alert.timestamp
        ? (typeof alert.timestamp === 'number' ? new Date(alert.timestamp).toISOString() : alert.timestamp)
        : new Date().toISOString(),
    }));

  if (toInsert.length === 0) return [];

  const { data, error } = await supabase
    .from('alerts')
    .insert(toInsert)
    .select('id');
  if (error) throw new Error(error.message);
  return data || [];
}

// --- Nodes (Supabase as source of truth when enabled) ---

export async function getNodesFromSupabase() {
  if (!isSupabaseEnabled()) return null;
  // Select columns that exist in base schema (omit 'active' if migration 011 not run, last_sensor_test_* if 016 not run)
  const { data, error } = await supabase
    .from('nodes')
    .select('id, name, location, status, lat, lng, last_maintenance, active, last_sensor_test_at, last_sensor_test_status')
    .order('id');
  if (error) {
    // Retry without optional columns if missing (migrations 011, 016)
    if (/column.*does not exist/i.test(error.message)) {
      const { data: fallback, error: err2 } = await supabase
        .from('nodes')
        .select('id, name, location, status, lat, lng, last_maintenance')
        .order('id');
      if (err2) throw new Error(err2.message);
      const withDefault = (fallback || []).map((r) => ({ ...r, active: true, last_sensor_test_at: null, last_sensor_test_status: null }));
      const filtered = withDefault.filter((r) => r.status !== 'removed');
      if (filtered.length > 0) return filtered;
      const derived = await getNodesDerivedFromReadings();
      return derived.length > 0 ? derived : filtered;
    }
    throw new Error(error.message);
  }
  const filtered = (data || []).map((r) => ({
    ...r,
    last_sensor_test_at: r.last_sensor_test_at ?? null,
    last_sensor_test_status: r.last_sensor_test_status ?? null,
  })).filter((r) => r.status !== 'removed');
  if (filtered.length === 0) {
    const derived = await getNodesDerivedFromReadings();
    if (derived.length > 0) return derived;
  }
  return filtered;
}

/**
 * Update the last sensor test timestamp and status for a node.
 * Uses node_last_sensor_tests table so it works for any node_id (including derived nodes).
 */
export async function updateNodeLastSensorTest(nodeId, { timestamp, status }) {
  if (!isSupabaseEnabled()) return;
  const row = {
    node_id: nodeId,
    last_sensor_test_at: timestamp || new Date().toISOString(),
    last_sensor_test_status: status ?? null,
  };
  const { error } = await supabase
    .from('node_last_sensor_tests')
    .upsert(row, { onConflict: 'node_id' });
  if (error) {
    if (/relation.*does not exist|column.*does not exist/i.test(error.message)) return;
    throw new Error(error.message);
  }
}

/**
 * Fetch last sensor test for all nodes. Returns { [nodeId]: { last_sensor_test_at, last_sensor_test_status } }
 */
export async function getNodeLastSensorTestsMap() {
  if (!isSupabaseEnabled()) return {};
  const { data, error } = await supabase
    .from('node_last_sensor_tests')
    .select('node_id, last_sensor_test_at, last_sensor_test_status');
  if (error) {
    if (/relation.*does not exist/i.test(error.message)) return {};
    throw new Error(error.message);
  }
  const map = {};
  (data || []).forEach((r) => {
    map[r.node_id] = {
      last_sensor_test_at: r.last_sensor_test_at ?? null,
      last_sensor_test_status: r.last_sensor_test_status ?? null,
    };
  });
  return map;
}

/**
 * Returns synthetic node entries from distinct node_ids in sensor_readings.
 * Used when nodes table is empty but readings exist (e.g. bridge wrote data, nodes not yet added).
 * Location comes from nodes table via node_id; if node is missing, uses node_id as name/location.
 */
export async function getNodesDerivedFromReadings() {
  if (!isSupabaseEnabled()) return [];
  const { data: readingsData, error } = await supabase
    .from('sensor_readings')
    .select('node_id')
    .order('timestamp', { ascending: false })
    .limit(2000);
  if (error) return [];
  const seen = new Set();
  const nodeIds = [];
  (readingsData || []).forEach((r) => {
    const id = r.node_id || r.nodeId;
    if (!id || seen.has(id)) return;
    seen.add(id);
    nodeIds.push(id);
  });
  if (nodeIds.length === 0) return [];
  const { data: nodesRows } = await supabase.from('nodes').select('id, name, location').in('id', nodeIds);
  const nodesById = {};
  (nodesRows || []).forEach((n) => { nodesById[n.id] = n; });
  const nodes = nodeIds.map((id) => {
    const n = nodesById[id];
    return n
      ? { id: n.id, name: n.name ?? n.id, location: n.location ?? n.id, status: 'offline', lat: null, lng: null, last_maintenance: null, active: true }
      : { id, name: id, location: id, status: 'offline', lat: null, lng: null, last_maintenance: null, active: true };
  });
  return nodes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Returns a map of { [node_id]: latestTimestamp } for all nodes that have readings.
 * Used to auto-determine Online/Offline status.
 */
export async function getLatestReadingTimestampsPerNode() {
  if (!isSupabaseEnabled()) return {};
  const { data, error } = await supabase
    .from('sensor_readings')
    .select('node_id, timestamp')
    .order('timestamp', { ascending: false });
  if (error) throw new Error(error.message);
  const map = {};
  (data || []).forEach(({ node_id, timestamp }) => {
    if (!map[node_id]) map[node_id] = timestamp;
  });
  return map;
}

/**
 * Returns a map of { [node_id]: latestRow } with sensor field values for each node.
 * Used to determine if a node has at least one functional sensor.
 * A node is considered online if it has a recent reading with at least one non-null sensor value.
 */
export async function getLatestReadingsPerNode() {
  if (!isSupabaseEnabled()) return {};
  const { data, error } = await supabase
    .from('sensor_readings')
    .select('node_id, timestamp, temperature, turbidity, ph, dissolved_oxygen')
    .order('timestamp', { ascending: false });
  if (error) throw new Error(error.message);
  const map = {};
  (data || []).forEach((row) => {
    if (!map[row.node_id]) map[row.node_id] = row;
  });
  return map;
}

export async function saveNodesToSupabase(nodes) {
  if (!isSupabaseEnabled()) throw new Error('Supabase not configured');
  const idsToKeep = new Set(nodes.map((n) => n.id).filter(Boolean));

  // Soft delete: mark as removed instead of deleting from DB.
  // Nodes no longer in the list (user deleted them) get status = 'removed'.
  const { data: existing } = await supabase.from('nodes').select('id, status');
  const toMarkRemoved = (existing || []).filter((r) => !idsToKeep.has(r.id) && r.status !== 'removed');
  for (const { id } of toMarkRemoved) {
    await supabase.from('nodes').update({ status: 'removed' }).eq('id', id);
  }

  const rows = nodes.map((n) => {
    const isDeactivated = n.active === false;
    return {
      id: n.id,
      name: n.name ?? null,
      location: n.location ?? null,
      status: isDeactivated ? 'inactive' : (n.status ?? 'offline'),
      lat: n.lat ?? null,
      lng: n.lng ?? null,
      last_maintenance: n.lastMaintenance ?? n.last_maintenance ?? null,
      active: !isDeactivated,
    };
  });
  const { error } = await supabase.from('nodes').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  return { success: true };
}

// --- Settings (thresholds, calibration, data collection, WQI weights) ---

const SETTINGS_KEYS = [
  'wqms_thresholds',
  'wqms_threshold_classification',
  'wqms_calibration',
  'wqms_data_collection',
  'wqms_wqi_weights',
  'wqms_notifications',
];

export async function getSettingsFromSupabase() {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', SETTINGS_KEYS);
  if (error) throw new Error(error.message);
  const map = {};
  (data || []).forEach(({ key, value }) => {
    map[key] = value || {};
  });
  return map;
}

export async function saveSettingsToSupabase(settingsByKey) {
  if (!isSupabaseEnabled()) throw new Error('Supabase not configured');
  const rows = Object.entries(settingsByKey).map(([key, value]) => ({
    key,
    value: value || {},
  }));
  const { error } = await supabase
    .from('settings')
    .upsert(rows, { onConflict: 'key', ignoreDuplicates: false });
  if (error) throw new Error(error.message);
  return { success: true };
}
