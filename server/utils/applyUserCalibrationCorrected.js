/**
 * User-facing calibration (Settings → wqms_calibration): only temperature and pH offsets.
 * Turbidity, DO, NH₃, and flow use lab/backend values only (no user offset).
 */

const { calculateNH3FromTAN } = require('./nh3Wqi');

const DEFAULT = {
  temperatureOffset: 0,
  pHOffset: 0,
};

function parseNum(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Record<string, unknown>} labRow - after applySensorCorrections
 * @param {Record<string, number>} cal - merged calibration object
 */
function applyUserCalibrationCorrected(labRow, cal) {
  const c = { ...DEFAULT, ...cal };
  const t = parseNum(labRow.temperature);
  const ph = parseNum(labRow.pH ?? labRow.ph);
  const turb = parseNum(labRow.turbidity);
  const dox = parseNum(labRow.dissolvedOxygen ?? labRow.dissolved_oxygen);
  const flow = parseNum(labRow.flowRate ?? labRow.flow_rate);

  let nh3Base = parseNum(labRow.nh3 ?? labRow.NH3);
  const tan = parseNum(labRow.tan ?? labRow.TAN) ?? 0.5;
  if (nh3Base == null && ph != null && t != null) {
    nh3Base = calculateNH3FromTAN(tan, ph, t);
  }
  const nh3Corr = nh3Base;

  return {
    temperature_corrected: t != null ? t + (c.temperatureOffset ?? 0) : null,
    ph_corrected: ph != null ? ph + (c.pHOffset ?? 0) : null,
    turbidity_corrected: turb,
    dissolved_oxygen_corrected: dox,
    flow_rate_corrected: flow,
    nh3_corrected: nh3Corr,
  };
}

module.exports = { applyUserCalibrationCorrected, DEFAULT_USER_CALIBRATION: DEFAULT };
