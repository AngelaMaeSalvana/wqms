/**
 * Settings storage: Supabase when enabled, localStorage fallback.
 * Calibration, thresholds, data collection, and wqiCalculator read from localStorage.
 * This module syncs Supabase -> localStorage on init and writes to both on save.
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

export const DEFAULT_MAINTENANCE = {
  intervalDays: 30,
};

export function getMaintenanceSettings() {
  return {
    ...DEFAULT_MAINTENANCE,
    ...loadFromStorage(SETTINGS_KEYS.maintenance, {}),
  };
}

export function loadFromStorage(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

export function saveToStorage(key, value) {
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
 * Fetch settings from Supabase and merge into localStorage.
 * Call on app init so other modules (calibration, wqiCalculator, etc.) get latest.
 */
export async function syncSettingsFromSupabase() {
  if (!isSupabaseEnabled()) return;
  try {
    const map = await getSettingsFromSupabase();
    if (map && typeof map === 'object') {
      Object.entries(map).forEach(([key, value]) => {
        if (value != null) {
          saveToStorage(key, value);
        }
      });
    }
  } catch (e) {
    console.warn('Could not sync settings from Supabase', e);
  }
}

/**
 * Save settings to Supabase (and localStorage).
 * @param {Object} settingsByKey - e.g. { wqms_thresholds: {...}, wqms_calibration: {...}, ... }
 */
export async function saveSettingsToSupabaseAndLocal(settingsByKey) {
  Object.entries(settingsByKey).forEach(([key, value]) => {
    saveToStorage(key, value);
  });
  if (isSupabaseEnabled()) {
    await saveSettingsToSupabase(settingsByKey);
  }
}
