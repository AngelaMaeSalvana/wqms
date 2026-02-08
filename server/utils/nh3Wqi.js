/**
 * Server-side NH3 and WQI calculation (TAN → NH3; params → WQI).
 * NH3(mg/L) = TAN / (1 + 10^(pKa - pH)), pKa = 0.09018 + 2729.92/(T+273.15)
 * WQI = 0.10*Qtemp + 0.30*QDO + 0.20*QpH + 0.25*QNH3 + 0.15*Qturb
 */

function calculateNH3FromTAN(tan, ph, temperature) {
  if (tan == null || ph == null || temperature == null || isNaN(tan) || isNaN(ph) || isNaN(temperature)) return null;
  const pKa = 0.09018 + 2729.92 / (temperature + 273.15);
  return tan / (1 + Math.pow(10, pKa - ph));
}

function qDO(v) {
  if (v == null || isNaN(v)) return null;
  if (v >= 6 && v <= 9) return 100;
  if (v >= 4 && v < 6) return 50 + ((v - 4) / 2) * 50;
  if (v > 9 && v <= 12) return 100 - ((v - 9) / 3) * 50;
  if (v < 4) return Math.max(0, (v / 4) * 50);
  return Math.max(0, 50 - ((v - 12) / 8) * 50);
}
function qPH(v) {
  if (v == null || isNaN(v)) return null;
  if (v >= 6.5 && v <= 8.5) return 100;
  if (v >= 6 && v < 6.5) return 50 + ((v - 6) / 0.5) * 50;
  if (v > 8.5 && v <= 9) return 100 - ((v - 8.5) / 0.5) * 50;
  if (v < 6) return Math.max(0, (v / 6) * 50);
  return Math.max(0, 50 - ((v - 9) / 3) * 50);
}
function qNH3(v) {
  if (v == null || isNaN(v)) return null;
  if (v < 0.1) return 100;
  if (v <= 0.5) return 100 - ((v - 0.1) / 0.4) * 50;
  return Math.max(0, 50 - ((v - 0.5) / 1.5) * 50);
}
function qTurb(v) {
  if (v == null || isNaN(v)) return null;
  if (v < 5) return 100;
  if (v <= 25) return 100 - ((v - 5) / 20) * 50;
  return Math.max(0, 50 - ((v - 25) / 25) * 50);
}
function qTemp(v) {
  if (v == null || isNaN(v)) return null;
  if (v >= 20 && v <= 26) return 100;
  if (v >= 18 && v < 20) return 50 + ((v - 18) / 2) * 50;
  if (v > 26 && v <= 30) return 100 - ((v - 26) / 4) * 50;
  if (v < 18) return Math.max(0, (v / 18) * 50);
  return Math.max(0, 50 - ((v - 30) / 10) * 50);
}

const WEIGHTS = { do: 0.30, nh3: 0.25, ph: 0.20, turbidity: 0.15, temperature: 0.10 };

const DEFAULT_TAN_MG_L = 0.5;

function calculateWQI(params) {
  const { dissolvedOxygen, ph, temperature, turbidity } = params;
  const tan = params.tan ?? DEFAULT_TAN_MG_L;
  const nh3 = params.nh3 != null ? params.nh3 : calculateNH3FromTAN(tan, ph, temperature);
  const qDO_ = qDO(dissolvedOxygen);
  const qPH_ = qPH(ph);
  const qNH3_ = qNH3(nh3);
  const qTurb_ = qTurb(turbidity);
  const qTemp_ = qTemp(temperature);
  const parts = [];
  let sumW = 0;
  if (qDO_ != null) { parts.push(qDO_ * WEIGHTS.do); sumW += WEIGHTS.do; }
  if (qPH_ != null) { parts.push(qPH_ * WEIGHTS.ph); sumW += WEIGHTS.ph; }
  if (qNH3_ != null) { parts.push(qNH3_ * WEIGHTS.nh3); sumW += WEIGHTS.nh3; }
  if (qTurb_ != null) { parts.push(qTurb_ * WEIGHTS.turbidity); sumW += WEIGHTS.turbidity; }
  if (qTemp_ != null) { parts.push(qTemp_ * WEIGHTS.temperature); sumW += WEIGHTS.temperature; }
  if (parts.length < 3 || sumW === 0) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) / sumW);
}

module.exports = { calculateNH3FromTAN, calculateWQI };
