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

export async function getReadings({ startDate, endDate, nodeId, limit = 100 }) {
  if (!isSupabaseEnabled()) return [];
  let q = supabase.from('sensor_readings').select('*');
  if (startDate) q = q.gte('timestamp', `${startDate}T00:00:00.000Z`);
  if (endDate) q = q.lte('timestamp', `${endDate}T23:59:59.999Z`);
  if (nodeId) q = q.eq('node_id', nodeId);
  q = q.order('timestamp', { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

/** Same table as getReadings; higher default limit for Reports. */
export async function getSensorReadings({ startDate, endDate, nodeId, limit = 500 }) {
  return getReadings({ startDate, endDate, nodeId, limit });
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
    location: reading.location || 'Unknown',
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

export async function getAlerts({ limit = 50, severity } = {}) {
  if (!isSupabaseEnabled()) return [];
  let q = supabase
    .from('alerts')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit);
  if (severity) q = q.eq('severity', severity);
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

// --- Nodes (Supabase as source of truth when enabled) ---

export async function getNodesFromSupabase() {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase
    .from('nodes')
    .select('id, name, location, status, lat, lng, last_maintenance')
    .order('id');
  if (error) throw new Error(error.message);
  return data;
}

export async function saveNodesToSupabase(nodes) {
  if (!isSupabaseEnabled()) throw new Error('Supabase not configured');
  const rows = nodes.map((n) => ({
    id: n.id,
    name: n.name ?? null,
    location: n.location ?? null,
    status: n.status ?? 'offline',
    lat: n.lat ?? null,
    lng: n.lng ?? null,
    last_maintenance: n.lastMaintenance ?? n.last_maintenance ?? null,
  }));
  const { error } = await supabase.from('nodes').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  return { success: true };
}

// --- Settings (thresholds, calibration, data collection, WQI weights) ---

const SETTINGS_KEYS = [
  'wqms_thresholds',
  'wqms_calibration',
  'wqms_data_collection',
  'wqms_wqi_weights',
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
