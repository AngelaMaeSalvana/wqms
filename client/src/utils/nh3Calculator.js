/**
 * NH3 (Ammonia) concentration from TAN (Total Ammonia Nitrogen).
 *
 * NH3(mg/L) = TAN / (1 + 10^(pKa - pH))
 * pKa = 0.09018 + 2729.92 / (T + 273.15)
 *
 * @param {number} tan - Total Ammonia Nitrogen (mg/L)
 * @param {number} ph - pH
 * @param {number} temperature - Temperature (°C)
 * @returns {number|null} - NH3 in mg/L or null if inputs invalid
 */
export function calculateNH3FromTAN(tan, ph, temperature) {
  if (
    tan == null || isNaN(tan) ||
    ph == null || isNaN(ph) ||
    temperature == null || isNaN(temperature)
  ) {
    return null;
  }
  const T = temperature;
  const pKa = 0.09018 + 2729.92 / (T + 273.15);
  const nh3 = tan / (1 + Math.pow(10, pKa - ph));
  return nh3;
}

/** Default TAN when not measured: 0.5 mg/L (as N) per common reference. */
const DEFAULT_TAN_MG_L = 0.5;

/**
 * Get NH3 from a reading: use stored nh3 if present, else compute from tan (or default 0.5 mg/L), ph, temperature.
 */
export function getNH3FromReading(reading) {
  if (!reading) return null;
  const stored = reading.nh3 ?? reading.NH3;
  if (stored != null && !isNaN(stored)) return stored;
  const tan = reading.tan ?? reading.TAN ?? DEFAULT_TAN_MG_L;
  const ph = reading.ph ?? reading.pH;
  const temp = reading.temperature;
  if (ph != null && temp != null) return calculateNH3FromTAN(tan, ph, temp);
  return null;
}

/**
 * Format an NH3 value to 5 significant figures for display.
 * e.g. 0.0008046375... → "0.00080464"
 *      1.23456789      → "1.2346"
 */
export function formatNH3(value) {
  if (value == null || isNaN(value)) return "—";
  return Number(value).toPrecision(5);
}

export default calculateNH3FromTAN;
