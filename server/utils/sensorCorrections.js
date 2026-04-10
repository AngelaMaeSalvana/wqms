/**
 * Apply telemetry normalization from sensor nodes.
 * Turbidity / DO: linear fit on raw ADC counts when those fields are present.
 * pH / temperature are kept as raw payload values; user offsets are applied later
 * in applyUserCalibrationCorrected.
 */

/** Minimum valid turbidity ADC counts (same as Heltec lab sketch; below = fault / disconnected). */
const TURB_RAW_MIN_VALID = 1500;

function parseNum(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Record<string, unknown>} reading - one MQTT / forwarder JSON object
 * @returns {Record<string, unknown>} shallow clone with corrected sensor fields
 */
function applySensorCorrections(reading) {
  const r = { ...reading };

  // Same as firmware: raw < 1500 → invalid; else NTU = -0.3881*raw + 822.39 (clamp ≥ 0).
  const turbRaw = parseNum(r.turRaw ?? r.turbidityRaw);
  if (turbRaw != null) {
    if (turbRaw < TURB_RAW_MIN_VALID) {
      r.turbidity = null;
    } else {
      let ntu = -0.3881 * turbRaw + 822.39;
      if (ntu < 0) ntu = 0;
      r.turbidity = ntu;
    }
  }

  const doRaw = parseNum(r.doRaw ?? r.dissolvedOxygenRaw);
  if (doRaw != null) {
    r.dissolvedOxygen = 0.00473 * doRaw - 0.292;
  }

  // Keep pH and temperature untouched here (raw from payload). Offsets are
  // applied once in applyUserCalibrationCorrected via Settings calibration.
  const ph0 = parseNum(r.pH ?? r.ph);
  if (ph0 != null) {
    r.pH = ph0;
    r.ph = ph0;
  }

  return r;
}

module.exports = { applySensorCorrections, parseNum };
