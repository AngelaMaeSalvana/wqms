/**
 * Battery voltage to percentage conversion for single Li-ion cell.
 * 4.2V = 100%, 3.3V = 0%. Clamped outside range.
 */
export const BATTERY_VOLTAGE_FULL = 4.2;
export const BATTERY_VOLTAGE_EMPTY = 3.3;

export function voltageToPercentage(voltage) {
  if (voltage == null || typeof voltage !== "number" || isNaN(voltage)) return null;
  if (voltage >= BATTERY_VOLTAGE_FULL) return 100;
  if (voltage <= BATTERY_VOLTAGE_EMPTY) return 0;
  const pct =
    ((voltage - BATTERY_VOLTAGE_EMPTY) / (BATTERY_VOLTAGE_FULL - BATTERY_VOLTAGE_EMPTY)) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

/**
 * Returns icon level: 'full' | 'three' | 'two' | 'one' | 'empty'
 * - ≥75%: full
 * - 50–74%: three-bar
 * - 25–49%: two-bar
 * - 10–24%: one-bar
 * - <10%: empty
 */
export function getBatteryIconLevel(percentage) {
  if (percentage == null || percentage < 0) return "empty";
  if (percentage >= 75) return "full";
  if (percentage >= 50) return "three";
  if (percentage >= 25) return "two";
  if (percentage >= 10) return "one";
  return "empty";
}

/** Battery is critically low (<10%) — show empty icon, mark as low. */
export function isBatteryLow(percentage) {
  return percentage != null && percentage < 10;
}

/** Triggers low battery warning when <15%. */
export function isLowBatteryWarning(percentage) {
  return percentage != null && percentage < 15;
}
