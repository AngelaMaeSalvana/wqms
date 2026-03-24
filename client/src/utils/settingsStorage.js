/**
 * Settings: when Supabase is enabled, authoritative values live in Supabase and are mirrored
 * in an in-memory cache (filled by syncSettingsFromSupabase). localStorage is not used for
 * those keys. Without Supabase, localStorage remains the source of truth.
 */
import { isSupabaseEnabled, getSettingsFromSupabase, saveSettingsToSupabase } from '../services/supabaseService';

export const SETTINGS_KEYS = {
  thresholds: 'wqms_thresholds',
  calibration: 'wqms_calibration',
  dataCollection: 'wqms_data_collection',
  wqiWeights: 'wqms_wqi_weights',
  notifications: 'wqms_notifications',
  maintenance: 'wqms_maintenance',
};

/** Keys loaded/saved via Supabase when enabled (values are JSONB; may be object or string). */
const SUPABASE_MANAGED_KEYS = new Set([
  'wqms_thresholds',
  'wqms_threshold_classification',
  'wqms_calibration',
  'wqms_data_collection',
  'wqms_wqi_weights',
  'wqms_notifications',
  'wqms_maintenance',
]);

const settingsMemoryCache = Object.create(null);

let supabaseSettingsHydrated = false;

export function isSupabaseSettingsHydrated() {
  return supabaseSettingsHydrated;
}

function setCacheEntry(key, value) {
  settingsMemoryCache[key] = value;
}

export const DEFAULT_MAINTENANCE = {
  intervalDays: 30,
};

export function getMaintenanceSettings() {
  return {
    ...DEFAULT_MAINTENANCE,
    ...loadFromStorage(SETTINGS_KEYS.maintenance, {}),
  };
}

/**
 * Read a setting. With Supabase enabled, uses memory cache populated by sync (not localStorage).
 */
export function loadFromStorage(key, fallback) {
  if (isSupabaseEnabled() && SUPABASE_MANAGED_KEYS.has(key)) {
    if (Object.prototype.hasOwnProperty.call(settingsMemoryCache, key)) {
      const cached = settingsMemoryCache[key];
      if (
        typeof fallback === 'object' &&
        fallback !== null &&
        !Array.isArray(fallback) &&
        typeof cached === 'object' &&
        cached !== null &&
        !Array.isArray(cached)
      ) {
        return { ...fallback, ...cached };
      }
      return cached !== undefined ? cached : fallback;
    }
    return typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback)
      ? { ...fallback }
      : fallback;
  }
  try {
    const s = localStorage.getItem(key);
    if (s == null) return fallback;
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

/**
 * Persist a single key. With Supabase enabled and managed key: updates memory cache only
 * (use saveSettingsToSupabaseAndLocal for remote persistence).
 */
export function saveToStorage(key, value) {
  if (isSupabaseEnabled() && SUPABASE_MANAGED_KEYS.has(key)) {
    setCacheEntry(key, value);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wqms:storage', { detail: { key, value } }));
    }
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wqms:storage', { detail: { key, value } }));
    }
  } catch (e) {
    console.warn('Could not save to localStorage', e);
  }
}

/**
 * Fetch settings from Supabase into memory cache (no localStorage write for managed keys).
 */
export async function syncSettingsFromSupabase() {
  if (!isSupabaseEnabled()) {
    supabaseSettingsHydrated = true;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wqms:settings-hydrated'));
    }
    return;
  }
  try {
    const map = await getSettingsFromSupabase();
    if (map && typeof map === 'object') {
      Object.entries(map).forEach(([key, value]) => {
        if (SUPABASE_MANAGED_KEYS.has(key)) {
          setCacheEntry(key, value);
        }
      });
    }
  } catch (e) {
    console.warn('Could not sync settings from Supabase', e);
  } finally {
    supabaseSettingsHydrated = true;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wqms:settings-hydrated'));
    }
  }
}

/**
 * Save to Supabase and update memory cache for managed keys (no localStorage for those keys).
 */
export async function saveSettingsToSupabaseAndLocal(settingsByKey) {
  Object.entries(settingsByKey).forEach(([key, value]) => {
    if (isSupabaseEnabled() && SUPABASE_MANAGED_KEYS.has(key)) {
      setCacheEntry(key, value);
    } else {
      saveToStorage(key, value);
    }
  });
  if (isSupabaseEnabled()) {
    await saveSettingsToSupabase(settingsByKey);
  }
}
