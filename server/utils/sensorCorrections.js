/**
 * Apply lab calibration to telemetry from sensor nodes.
 * Turbidity / DO: linear fit on raw ADC counts when those fields are present.
 * pH / temperature: fixed offsets on measured values.
 */

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

  const turbRaw = parseNum(r.turRaw ?? r.turbidityRaw);
  if (turbRaw != null) {
    r.turbidity = -0.3881 * turbRaw + 822.39;
  }

  const doRaw = parseNum(r.doRaw ?? r.dissolvedOxygenRaw);
  if (doRaw != null) {
    r.dissolvedOxygen = 0.00473 * doRaw - 0.292;
  }

  const ph0 = parseNum(r.pH ?? r.ph);
  if (ph0 != null) {
    const ph1 = ph0 - 0.006;
    r.pH = ph1;
    r.ph = ph1;
  }

  const t0 = parseNum(r.temperature);
  if (t0 != null) {
    r.temperature = t0 - 0.41;
  }

  return r;
}

module.exports = { applySensorCorrections, parseNum };
