/**
 * Apply calibration offsets from Settings (wqms_calibration) to a single reading.
 * Used when displaying readings in Dashboard, Reports, Map, and Alerts.
 * Offsets are read from localStorage at apply time.
 */

const CALIBRATION_KEY = "wqms_calibration";
const DEFAULT_OFFSETS = {
  temperatureOffset: 0,
  pHOffset: 0,
  turbidityOffset: 0,
  dissolvedOxygenOffset: 0,
  nh3Offset: 0,
  flowRateOffset: 0,
};

function getCalibration() {
  try {
    const s = localStorage.getItem(CALIBRATION_KEY);
    const parsed = s ? JSON.parse(s) : null;
    return { ...DEFAULT_OFFSETS, ...parsed };
  } catch {
    return DEFAULT_OFFSETS;
  }
}

/**
 * Returns a copy of the reading with calibration offsets applied.
 * Handles both API shape (snake_case) and display shape (camelCase).
 * @param {Object} reading - Raw reading: { temperature?, ph?, pH?, turbidity?, dissolved_oxygen?, dissolvedOxygen?, do?, nh3?, NH3?, flowRate? }
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
  if (reading.turbidity != null && !isNaN(reading.turbidity)) {
    out.turbidity = reading.turbidity + (off.turbidityOffset ?? 0);
  }
  const doVal = reading.dissolved_oxygen ?? reading.dissolvedOxygen ?? reading.do;
  if (doVal != null && !isNaN(doVal)) {
    const calibrated = doVal + (off.dissolvedOxygenOffset ?? 0);
    out.dissolved_oxygen = calibrated;
    out.dissolvedOxygen = calibrated;
    out.do = calibrated;
  }
  const nh3Val = reading.nh3 ?? reading.NH3;
  if (nh3Val != null && !isNaN(nh3Val)) {
    const calibrated = nh3Val + (off.nh3Offset ?? 0);
    out.nh3 = calibrated;
    out.NH3 = calibrated;
  }
  if (reading.flowRate != null && !isNaN(reading.flowRate)) {
    out.flowRate = reading.flowRate + (off.flowRateOffset ?? 0);
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
