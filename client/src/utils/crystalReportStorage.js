/**
 * Storage for Crystal Report format/template selected in Settings.
 * Used for reporting (e.g. RPT/PDF exports reference the template name).
 */

const STORAGE_KEY = "wqms_crystal_report";

export function getCrystalReport() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ fileName: string, importedAt?: string }} value
 */
export function saveCrystalReport(value) {
  try {
    const payload = {
      fileName: value.fileName,
      importedAt: value.importedAt ?? new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("Could not save Crystal Report setting", e);
  }
}

export function clearCrystalReport() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("Could not clear Crystal Report setting", e);
  }
}
