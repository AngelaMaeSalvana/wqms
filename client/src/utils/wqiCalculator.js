/**
 * Water Quality Index (WQI) Calculator
 * 
 * Formula: WQI = (Σ(Q_i × W_i)) / (Σ W_i)
 * 
 * Where:
 * - Q_i = quality rating of parameter i
 * - W_i = weight of parameter i
 * - n = 5 (number of parameters)
 * 
 * Parameter Weights:
 * - Dissolved Oxygen (DO): 0.30
 * - pH: 0.20
 * - NH₃: 0.20
 * - Turbidity: 0.15
 * - Temperature: 0.15
 * Total: 1.00
 */

// Parameter weights
const WEIGHTS = {
  dissolvedOxygen: 0.30,
  pH: 0.20,
  nh3: 0.20,
  turbidity: 0.15,
  temperature: 0.15,
};

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
 * 
 * Formula: WQI = (Σ(Q_i × W_i)) / (Σ W_i)
 * 
 * @param {Object} params - Sensor readings
 * @param {number} params.dissolvedOxygen - Dissolved Oxygen in mg/L
 * @param {number} params.pH - pH value
 * @param {number} params.nh3 - NH₃ (Ammonia) in mg/L
 * @param {number} params.turbidity - Turbidity in NTU
 * @param {number} params.temperature - Temperature in °C
 * @returns {number|null} - Calculated WQI value or null if insufficient data
 */
export const calculateWQI = (params) => {
  const { dissolvedOxygen, pH, nh3, turbidity, temperature } = params;

  // Calculate quality ratings for each parameter
  const qDO = calculateDOQuality(dissolvedOxygen);
  const qPH = calculatepHQuality(pH);
  const qNH3 = calculateNH3Quality(nh3);
  const qTurbidity = calculateTurbidityQuality(turbidity);
  const qTemperature = calculateTemperatureQuality(temperature);

  // Collect valid quality ratings and their weights
  const qualityRatings = [];
  const weights = [];

  if (qDO !== null) {
    qualityRatings.push(qDO);
    weights.push(WEIGHTS.dissolvedOxygen);
  }
  if (qPH !== null) {
    qualityRatings.push(qPH);
    weights.push(WEIGHTS.pH);
  }
  if (qNH3 !== null) {
    qualityRatings.push(qNH3);
    weights.push(WEIGHTS.nh3);
  }
  if (qTurbidity !== null) {
    qualityRatings.push(qTurbidity);
    weights.push(WEIGHTS.turbidity);
  }
  if (qTemperature !== null) {
    qualityRatings.push(qTemperature);
    weights.push(WEIGHTS.temperature);
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
 * Get quality ratings for all parameters (for debugging/display)
 */
export const getQualityRatings = (params) => {
  return {
    dissolvedOxygen: calculateDOQuality(params.dissolvedOxygen),
    pH: calculatepHQuality(params.pH),
    nh3: calculateNH3Quality(params.nh3),
    turbidity: calculateTurbidityQuality(params.turbidity),
    temperature: calculateTemperatureQuality(params.temperature),
  };
};

export default calculateWQI;

