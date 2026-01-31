/**
 * WQMS data layer using Supabase.
 * Used when Supabase env vars are set (Vercel + Supabase).
 */
import { supabase, isSupabaseEnabled } from '../lib/supabaseClient';

// --- Readings ---

export async function getLatestReading(nodeId = null) {
  if (!isSupabaseEnabled()) return null;
  let q = supabase
    .from('water_quality_readings')
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
  let q = supabase.from('water_quality_readings').select('*');
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
    .from('water_quality_readings')
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
    nh3: reading.nh3 ?? reading.NH3,
    dissolved_oxygen: reading.dissolvedOxygen ?? reading.do,
    wqi: Math.round(reading.wqi ?? reading.WQI ?? 0),
    timestamp: reading.timestamp || new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('water_quality_readings')
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
    .select('id, name, location, status, lat, lng')
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
  }));
  const { error } = await supabase.from('nodes').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  return { success: true };
}
