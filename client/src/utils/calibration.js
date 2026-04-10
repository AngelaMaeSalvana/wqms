import { loadFromStorage, SETTINGS_KEYS } from "./settingsStorage";

/**
 * Display pipeline for readings:
 * - If the row includes backend-stored *_corrected fields (from bridge + Supabase), use those only
 *   (offsets already applied server-side from wqms_calibration).
 * - Otherwise applyCalibration uses wqms_calibration from Supabase-backed cache (see settingsStorage),
 *   or localStorage when Supabase is disabled.
 */

const DEFAULT_OFFSETS = {
  temperatureOffset: 0,
  pHOffset: 0,
};

function getCalibration() {
  return loadFromStorage(SETTINGS_KEYS.calibration, DEFAULT_OFFSETS);
}

/**
 * Returns a copy of the reading with calibration offsets applied.
 * Handles both API shape (snake_case) and display shape (camelCase).
 * @param {Object} reading - Raw reading: { temperature?, ph?, pH?, turbidity?, dissolved_oxygen?, dissolvedOxygen?, do?, nh3?, NH3?, flowRate? } — only temp/pH offsets are applied client-side.
 * @returns {Object} New object with same keys plus calibrated numeric values where present
 */
export function applyCalibration(reading) {
  if (!reading || typeof reading !== "object") return reading;
  const off = getCalibration();
  const out = { ...reading };

  if (reading.temperature != null && !isNaN(reading.temperature)) {
    out.temperature = reading.temperature + (off.temperatureOffset ?? 0);
  }
  const phVal = reading.pH ?? reading.ph;
  if (phVal != null && !isNaN(phVal)) {
    const calibrated = phVal + (off.pHOffset ?? 0);
    out.pH = calibrated;
    out.ph = calibrated;
  }

  return out;
}

/**
 * Apply calibration to an array of readings (e.g. from API).
 */
export function applyCalibrationToReadings(readings) {
  if (!Array.isArray(readings)) return readings;
  return readings.map(applyCalibration);
}

/** True if any server-persisted corrected column is present (avoids double-applying local offsets). */
function hasBackendCorrected(reading) {
  if (!reading || typeof reading !== "object") return false;
  return (
    reading.temperature_corrected != null ||
    reading.ph_corrected != null ||
    reading.turbidity_corrected != null ||
    reading.dissolved_oxygen_corrected != null ||
    reading.flow_rate_corrected != null ||
    reading.nh3_corrected != null
  );
}

/**
 * Map *_corrected columns onto the primary field names used by charts and NH₃ helpers.
 */
export function normalizeReadingForDisplay(r) {
  if (!r || typeof r !== "object") return r;
  const temperatureRaw = r.temperature;
  const phRaw = r.ph ?? r.pH;
  const turbidityRaw = r.turbidity;
  const dissolvedOxygenRaw = r.dissolved_oxygen ?? r.dissolvedOxygen ?? r.do;
  const flowRateRaw = r.flow_rate ?? r.flowRate;
  const nh3Raw = r.nh3 ?? r.NH3;
  return {
    ...r,
    temperature_raw: temperatureRaw,
    ph_raw: phRaw,
    turbidity_raw: turbidityRaw,
    dissolved_oxygen_raw: dissolvedOxygenRaw,
    flow_rate_raw: flowRateRaw,
    nh3_raw: nh3Raw,
    temperature: r.temperature_corrected ?? r.temperature,
    ph: r.ph_corrected ?? r.ph,
    pH: r.ph_corrected ?? r.pH ?? r.ph,
    turbidity: r.turbidity_corrected ?? r.turbidity,
    dissolved_oxygen: r.dissolved_oxygen_corrected ?? r.dissolved_oxygen,
    dissolvedOxygen: r.dissolved_oxygen_corrected ?? r.dissolvedOxygen,
    do: r.dissolved_oxygen_corrected ?? r.do,
    flow_rate: r.flow_rate_corrected ?? r.flow_rate,
    flowRate: r.flow_rate_corrected ?? r.flowRate,
    nh3: r.nh3_corrected ?? r.nh3,
    NH3: r.nh3_corrected ?? r.NH3,
  };
}

export function displayReading(reading) {
  if (!reading || typeof reading !== "object") return reading;
  if (hasBackendCorrected(reading)) return normalizeReadingForDisplay(reading);
  return applyCalibration(reading);
}

export function displayReadings(readings) {
  if (!Array.isArray(readings)) return readings;
  return readings.map(displayReading);
}
