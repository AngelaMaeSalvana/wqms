/**
 * Water Quality Index (WQI) Calculator
 *
 * Final expanded formula: WQI = 0.10*Qtemp + 0.30*QDO + 0.20*QpH + 0.25*QNH3 + 0.15*Qturb
 *
 * Parameter Weights (suggested for environmental monitoring, Σ Wi = 1.00):
 * - DO: 0.30, NH3: 0.25, pH: 0.20, Turbidity: 0.15, Temperature: 0.10
 *
 * NH3 is computed from TAN, pH, and temperature when not provided.
 */

import { calculateNH3FromTAN } from './nh3Calculator';
import { loadFromStorage } from './settingsStorage';

const WQI_WEIGHTS_KEY = 'wqms_wqi_weights';

/** Default parameter weights (Σ Wi = 1.00): DO 0.30, NH3 0.25, pH 0.20, Turbidity 0.15, Temperature 0.10 */
export const DEFAULT_WQI_WEIGHTS = {
  dissolvedOxygen: 0.30,
  nh3: 0.25,
  pH: 0.20,
  turbidity: 0.15,
  temperature: 0.10,
};

/**
 * Get WQI parameter weights from localStorage (user-adjustable in Settings).
 * Returns normalized weights; falls back to defaults if invalid or missing.
 */
export function getWQIWeights() {
  try {
    const stored = loadFromStorage(WQI_WEIGHTS_KEY, {});
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_WQI_WEIGHTS };
    const merged = {
      dissolvedOxygen: parseFloat(stored.dissolvedOxygen),
      nh3: parseFloat(stored.nh3),
      pH: parseFloat(stored.pH),
      turbidity: parseFloat(stored.turbidity),
      temperature: parseFloat(stored.temperature),
    };
    const safe = (v, def) => (isFinite(v) && v >= 0 ? v : def);
    const d = DEFAULT_WQI_WEIGHTS;
    const raw = {
      dissolvedOxygen: safe(merged.dissolvedOxygen, d.dissolvedOxygen),
      nh3: safe(merged.nh3, d.nh3),
      pH: safe(merged.pH, d.pH),
      turbidity: safe(merged.turbidity, d.turbidity),
      temperature: safe(merged.temperature, d.temperature),
    };
    const sum = Object.values(raw).reduce((a, v) => a + v, 0);
    if (sum <= 0) return { ...DEFAULT_WQI_WEIGHTS };
    return {
      dissolvedOxygen: raw.dissolvedOxygen / sum,
      nh3: raw.nh3 / sum,
      pH: raw.pH / sum,
      turbidity: raw.turbidity / sum,
      temperature: raw.temperature / sum,
    };
  } catch {
    return { ...DEFAULT_WQI_WEIGHTS };
  }
}

/**
 * Calculate quality rating (Q_i) for Dissolved Oxygen
 * Optimal range: 6-9 mg/L (Q = 100)
 * Acceptable: 4-6 mg/L or 9-12 mg/L (Q = 50-100)
 * Poor: <4 mg/L or >12 mg/L (Q = 0-50)
 */
const calculateDOQuality = (doValue) => {
  if (doValue === null || doValue === undefined || isNaN(doValue)) return null;
  
  // Optimal range: 6-9 mg/L
  if (doValue >= 6 && doValue <= 9) {
    return 100;
  }
  // Good range: 4-6 mg/L or 9-12 mg/L
  if ((doValue >= 4 && doValue < 6) || (doValue > 9 && doValue <= 12)) {
    // Linear interpolation: closer to optimal = higher Q
    if (doValue >= 4 && doValue < 6) {
      return 50 + ((doValue - 4) / 2) * 50; // 4→50, 6→100
    } else {
      return 100 - ((doValue - 9) / 3) * 50; // 9→100, 12→50
    }
  }
  // Poor: <4 or >12
  if (doValue < 4) {
    return Math.max(0, (doValue / 4) * 50); // 0→0, 4→50
  } else {
    return Math.max(0, 50 - ((doValue - 12) / 8) * 50); // 12→50, 20→0
  }
};

/**
 * Calculate quality rating (Q_i) for pH
 * Optimal range: 6.5-8.5 (Q = 100)
 * Acceptable: 6.0-6.5 or 8.5-9.0 (Q = 50-100)
 * Poor: <6.0 or >9.0 (Q = 0-50)
 */
const calculatepHQuality = (phValue) => {
  if (phValue === null || phValue === undefined || isNaN(phValue)) return null;
  
  // Optimal range: 6.5-8.5
  if (phValue >= 6.5 && phValue <= 8.5) {
    return 100;
  }
  // Good range: 6.0-6.5 or 8.5-9.0
  if ((phValue >= 6.0 && phValue < 6.5) || (phValue > 8.5 && phValue <= 9.0)) {
    if (phValue >= 6.0 && phValue < 6.5) {
      return 50 + ((phValue - 6.0) / 0.5) * 50; // 6.0→50, 6.5→100
    } else {
      return 100 - ((phValue - 8.5) / 0.5) * 50; // 8.5→100, 9.0→50
    }
  }
  // Poor: <6.0 or >9.0
  if (phValue < 6.0) {
    return Math.max(0, (phValue / 6.0) * 50); // 0→0, 6.0→50
  } else {
    return Math.max(0, 50 - ((phValue - 9.0) / 3.0) * 50); // 9.0→50, 12.0→0
  }
};

/**
 * Calculate quality rating (Q_i) for NH₃ (Ammonia)
 * Optimal: <0.1 mg/L (Q = 100)
 * Acceptable: 0.1-0.5 mg/L (Q = 50-100)
 * Poor: >0.5 mg/L (Q = 0-50)
 */
const calculateNH3Quality = (nh3Value) => {
  if (nh3Value === null || nh3Value === undefined || isNaN(nh3Value)) return null;
  
  // Optimal: <0.1 mg/L
  if (nh3Value < 0.1) {
    return 100;
  }
  // Acceptable: 0.1-0.5 mg/L
  if (nh3Value >= 0.1 && nh3Value <= 0.5) {
    return 100 - ((nh3Value - 0.1) / 0.4) * 50; // 0.1→100, 0.5→50
  }
  // Poor: >0.5 mg/L
  return Math.max(0, 50 - ((nh3Value - 0.5) / 1.5) * 50); // 0.5→50, 2.0→0
};

/**
 * Calculate quality rating (Q_i) for Turbidity
 * Optimal: <5 NTU (Q = 100)
 * Acceptable: 5-25 NTU (Q = 50-100)
 * Poor: >25 NTU (Q = 0-50)
 */
const calculateTurbidityQuality = (turbidityValue) => {
  if (turbidityValue === null || turbidityValue === undefined || isNaN(turbidityValue)) return null;
  
  // Optimal: <5 NTU
  if (turbidityValue < 5) {
    return 100;
  }
  // Acceptable: 5-25 NTU
  if (turbidityValue >= 5 && turbidityValue <= 25) {
    return 100 - ((turbidityValue - 5) / 20) * 50; // 5→100, 25→50
  }
  // Poor: >25 NTU
  return Math.max(0, 50 - ((turbidityValue - 25) / 25) * 50); // 25→50, 50→0
};

/**
 * Calculate quality rating (Q_i) for Temperature
 * Optimal: 20-26°C (Q = 100)
 * Acceptable: 18-20°C or 26-30°C (Q = 50-100)
 * Poor: <18°C or >30°C (Q = 0-50)
 */
const calculateTemperatureQuality = (tempValue) => {
  if (tempValue === null || tempValue === undefined || isNaN(tempValue)) return null;
  
  // Optimal range: 20-26°C
  if (tempValue >= 20 && tempValue <= 26) {
    return 100;
  }
  // Good range: 18-20°C or 26-30°C
  if ((tempValue >= 18 && tempValue < 20) || (tempValue > 26 && tempValue <= 30)) {
    if (tempValue >= 18 && tempValue < 20) {
      return 50 + ((tempValue - 18) / 2) * 50; // 18→50, 20→100
    } else {
      return 100 - ((tempValue - 26) / 4) * 50; // 26→100, 30→50
    }
  }
  // Poor: <18°C or >30°C
  if (tempValue < 18) {
    return Math.max(0, (tempValue / 18) * 50); // 0→0, 18→50
  } else {
    return Math.max(0, 50 - ((tempValue - 30) / 10) * 50); // 30→50, 40→0
  }
};

/**
 * Calculate Water Quality Index (WQI)
 * WQI = 0.10*Qtemp + 0.30*QDO + 0.20*QpH + 0.25*QNH3 + 0.15*Qturb
 *
 * @param {Object} params - Sensor readings
 * @param {number} params.dissolvedOxygen - Dissolved Oxygen in mg/L
 * @param {number} params.pH - pH value
 * @param {number} [params.nh3] - NH₃ (Ammonia) in mg/L (optional; computed from tan/pH/temperature if not provided)
 * @param {number} [params.tan] - TAN in mg/L (used with pH and temperature to compute NH3)
 * @param {number} params.turbidity - Turbidity in NTU
 * @param {number} params.temperature - Temperature in °C
 * @returns {number|null} - Calculated WQI value or null if insufficient data
 */
export const calculateWQI = (params) => {
  const { dissolvedOxygen, pH, nh3: nh3Param, tan, turbidity, temperature } = params;
  const nh3 = nh3Param != null && !isNaN(nh3Param)
    ? nh3Param
    : calculateNH3FromTAN(tan, pH, temperature);

  const qDO = calculateDOQuality(dissolvedOxygen);
  const qPH = calculatepHQuality(pH);
  const qNH3 = calculateNH3Quality(nh3);
  const qTurbidity = calculateTurbidityQuality(turbidity);
  const qTemperature = calculateTemperatureQuality(temperature);

  const w = getWQIWeights();
  const qualityRatings = [];
  const weights = [];

  if (qDO !== null) {
    qualityRatings.push(qDO);
    weights.push(w.dissolvedOxygen);
  }
  if (qPH !== null) {
    qualityRatings.push(qPH);
    weights.push(w.pH);
  }
  if (qNH3 !== null) {
    qualityRatings.push(qNH3);
    weights.push(w.nh3);
  }
  if (qTurbidity !== null) {
    qualityRatings.push(qTurbidity);
    weights.push(w.turbidity);
  }
  if (qTemperature !== null) {
    qualityRatings.push(qTemperature);
    weights.push(w.temperature);
  }

  // Need at least 3 parameters to calculate WQI
  if (qualityRatings.length < 3) {
    return null;
  }

  // Calculate weighted sum: Σ(Q_i × W_i)
  let weightedSum = 0;
  for (let i = 0; i < qualityRatings.length; i++) {
    weightedSum += qualityRatings[i] * weights[i];
  }

  // Calculate sum of weights: Σ W_i
  const sumOfWeights = weights.reduce((sum, w) => sum + w, 0);

  // Calculate WQI: (Σ(Q_i × W_i)) / (Σ W_i)
  const wqi = weightedSum / sumOfWeights;

  // Round to whole number (WQI is always a whole number)
  return Math.round(wqi);
};

/**
 * Get quality ratings for all parameters (for debugging/display).
 * Accepts nh3 directly or tan + pH + temperature to compute NH3.
 */
export const getQualityRatings = (params) => {
  const nh3 = params.nh3 != null && !isNaN(params.nh3)
    ? params.nh3
    : calculateNH3FromTAN(params.tan, params.pH, params.temperature);
  return {
    dissolvedOxygen: calculateDOQuality(params.dissolvedOxygen),
    pH: calculatepHQuality(params.pH),
    nh3: calculateNH3Quality(nh3),
    turbidity: calculateTurbidityQuality(params.turbidity),
    temperature: calculateTemperatureQuality(params.temperature),
  };
};

/**
 * Get WQI classification (class, label, quality key for styling)
 * Scale: 90–100 Excellent, 70–89 Good, 50–69 Fair, 25–49 Poor, <25 Very Poor
 */
export function getWQIClass(wqi) {
  if (wqi == null || isNaN(wqi)) return { class: "N/A", label: "No Data", quality: "muted" };
  if (wqi >= 90) return { class: "I", label: "Excellent", quality: "excellent" };
  if (wqi >= 70) return { class: "II", label: "Good", quality: "good" };
  if (wqi >= 50) return { class: "III", label: "Fair", quality: "fair" };
  if (wqi >= 25) return { class: "IV", label: "Poor", quality: "poor" };
  return { class: "V", label: "Very Poor", quality: "very-poor" };
}

export default calculateWQI;

