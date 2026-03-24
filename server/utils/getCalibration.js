/**
 * Cached fetch of wqms_calibration from Supabase settings (same shape as client Settings).
 */

const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) { /* optional */ }

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_CALIBRATION = {
  temperatureOffset: 0,
  pHOffset: 0,
};

let supabase = null;
function getSupabase() {
  if (!supabase && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return supabase;
}

let cache = { at: 0, value: DEFAULT_CALIBRATION };
const TTL_MS = 15000;

async function getCalibrationCached() {
  if (Date.now() - cache.at < TTL_MS) return cache.value;
  const sb = getSupabase();
  if (!sb) {
    cache = { at: Date.now(), value: DEFAULT_CALIBRATION };
    return cache.value;
  }
  try {
    const { data, error } = await sb.from('settings').select('value').eq('key', 'wqms_calibration').maybeSingle();
    if (error || !data?.value || typeof data.value !== 'object') {
      cache = { at: Date.now(), value: DEFAULT_CALIBRATION };
      return cache.value;
    }
    const merged = { ...DEFAULT_CALIBRATION, ...data.value };
    cache = { at: Date.now(), value: merged };
    return merged;
  } catch {
    cache = { at: Date.now(), value: DEFAULT_CALIBRATION };
    return cache.value;
  }
}

module.exports = { getCalibrationCached, DEFAULT_CALIBRATION };
