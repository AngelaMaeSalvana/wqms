/**
 * WQMS data layer using Supabase.
 * Used when Supabase env vars are set (Vercel + Supabase).
 * Schema: nodes (id, node_code, name, lat, lng, status, last_seen_at, deactivated_at),
 *         sensor_readings (recorded_at, node_id text), alerts (triggered_at, message).
 * Date ranges (startDate/endDate) are interpreted as Philippines (Asia/Manila) calendar dates.
 */
import { supabase, isSupabaseEnabled } from '../lib/supabaseClient';

const PH_OFFSET = '+08:00'; // Asia/Manila, no DST

/** Convert a YYYY-MM-DD date in Philippines to UTC ISO range for Supabase queries. */
function phDateToUtcRange(dateStr) {
  const start = new Date(`${dateStr}T00:00:00${PH_OFFSET}`).toISOString();
  const end = new Date(`${dateStr}T23:59:59.999${PH_OFFSET}`).toISOString();
  return { start, end };
}

/** Normalize a reading row so UI sees timestamp + flowRate. */
function normalizeReading(row) {
  if (!row) return row;
  return {
    ...row,
    timestamp: row.recorded_at ?? row.timestamp,
    flowRate: row.flow_rate ?? row.flowRate,
  };
}

// --- Readings (sensor_readings: recorded_at, node_id text) ---

export async function getLatestReading(nodeId = null) {
  if (!isSupabaseEnabled()) return null;
  let q = supabase
    .from('sensor_readings')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(1);
  if (nodeId) q = q.eq('node_id', nodeId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeReading(data) || {};
}

export async function getReadings({ startDate, endDate, nodeId, limit = 100 }) {
  if (!isSupabaseEnabled()) return [];
  let q = supabase.from('sensor_readings').select('*');
  if (startDate) {
    const { start } = phDateToUtcRange(startDate);
    q = q.gte('recorded_at', start);
  }
  if (endDate) {
    const { end } = phDateToUtcRange(endDate);
    q = q.lte('recorded_at', end);
  }
  if (nodeId) q = q.eq('node_id', nodeId);
  q = q.order('recorded_at', { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(normalizeReading);
}

export async function getSensorReadings({ startDate, endDate, nodeId, limit = 500 }) {
  return getReadings({ startDate, endDate, nodeId, limit });
}

/** Map daily_summaries columns (temperature_avg, etc.) to UI shape (avg_temperature, etc.). */
function normalizeDailySummary(row) {
  if (!row) return row;
  return {
    ...row,
    avg_temperature: row.temperature_avg ?? row.avg_temperature,
    avg_ph: row.ph_avg ?? row.avg_ph,
    avg_turbidity: row.turbidity_avg ?? row.avg_turbidity,
    avg_dissolved_oxygen: row.dissolved_oxygen_avg ?? row.avg_dissolved_oxygen,
    avg_nh3: row.nh3_avg ?? row.avg_nh3,
    avg_wqi: row.wqi_avg ?? row.avg_wqi,
  };
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
  return (data || []).map(normalizeDailySummary);
}

export async function getReadingByDate(date, nodeId = null) {
  if (!isSupabaseEnabled()) return null;
  const { start, end } = phDateToUtcRange(date);
  let q = supabase
    .from('sensor_readings')
    .select('*')
    .gte('recorded_at', start)
    .lte('recorded_at', end)
    .order('recorded_at', { ascending: false })
    .limit(1);
  if (nodeId) q = q.eq('node_id', nodeId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeReading(data) || {};
}

export async function postReading(reading) {
  if (!isSupabaseEnabled()) throw new Error('Supabase not configured');
  const row = {
    node_id: reading.nodeId ?? reading.node ?? '1',
    recorded_at: reading.recorded_at ?? reading.timestamp ?? new Date().toISOString(),
    temperature: reading.temperature ?? null,
    turbidity: reading.turbidity ?? null,
    ph: reading.pH ?? reading.ph ?? null,
    nh3: reading.nh3 ?? reading.NH3 ?? null,
    dissolved_oxygen: reading.dissolvedOxygen ?? reading.do ?? reading.dissolved_oxygen ?? null,
    flow_rate: reading.flow_rate ?? reading.flowRate ?? null,
    wqi: reading.wqi != null || reading.WQI != null ? Math.round(reading.wqi ?? reading.WQI ?? 0) : null,
  };
  const { data, error } = await supabase
    .from('sensor_readings')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { success: true, id: data?.id, message: 'Reading stored successfully' };
}

// --- Alerts (triggered_at, message, type, severity) ---

export async function getAlerts({ limit = 50, severity } = {}) {
  if (!isSupabaseEnabled()) return [];
  let q = supabase
    .from('alerts')
    .select('*')
    .order('triggered_at', { ascending: false })
    .limit(limit);
  if (severity) q = q.eq('severity', severity);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    ...row,
    title: row.message?.slice(0, 80) || 'Alert',
    detail: row.message,
    timestamp: row.triggered_at,
    createdAt: row.triggered_at,
  }));
}

export async function postAlert(alert) {
  if (!isSupabaseEnabled()) throw new Error('Supabase not configured');
  const row = {
    node_id: alert.nodeId ?? alert.node ?? null,
    type: alert.type ?? 'system',
    severity: alert.severity ?? 'info',
    message: alert.message ?? alert.detail ?? alert.title ?? 'Alert',
    parameter: alert.parameter ?? null,
    value: alert.value ?? null,
    triggered_at: alert.triggered_at ?? alert.timestamp ?? new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('alerts')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { success: true, id: data?.id, message: 'Alert stored successfully' };
}

// --- Nodes (id text, node_code, name, lat, lng, status, last_seen_at, deactivated_at) ---

/**
 * Fetch nodes from Supabase. By default returns only active (v_nodes_active).
 * @param {boolean} includeDeactivated - If true, fetch all nodes including deactivated.
 */
export async function getNodesFromSupabase(includeDeactivated = false) {
  if (!isSupabaseEnabled()) return null;
  const table = includeDeactivated ? 'nodes' : 'v_nodes_active';
  const { data, error } = await supabase
    .from(table)
    .select('id, node_code, name, lat, lng, status, last_seen_at, created_at, updated_at' + (includeDeactivated ? ', deactivated_at' : ''))
    .order('node_code');
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Save nodes to Supabase. Upsert by id. For "delete" pass deactivated_at set on the node.
 */
export async function saveNodesToSupabase(nodes) {
  if (!isSupabaseEnabled()) throw new Error('Supabase not configured');
  const rows = nodes.map((n) => ({
    id: n.id,
    node_code: n.node_code ?? n.nodeCode ?? n.id,
    name: n.name ?? null,
    status: n.status ?? 'offline',
    lat: n.lat ?? null,
    lng: n.lng ?? null,
    deactivated_at: n.deactivated_at ?? (n.deactivated ? new Date().toISOString() : null),
  }));
  const { error } = await supabase.from('nodes').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  return { success: true };
}

/**
 * Deactivate a node (soft delete). Sets deactivated_at and status = deactivated via trigger.
 */
export async function deactivateNodeInSupabase(nodeId) {
  if (!isSupabaseEnabled()) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('nodes')
    .update({ deactivated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', nodeId);
  if (error) throw new Error(error.message);
  return { success: true };
}

/**
 * Reactivate a node. Clears deactivated_at (status set to offline by trigger).
 */
export async function reactivateNodeInSupabase(nodeId) {
  if (!isSupabaseEnabled()) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('nodes')
    .update({ deactivated_at: null, updated_at: new Date().toISOString() })
    .eq('id', nodeId);
  if (error) throw new Error(error.message);
  return { success: true };
}
