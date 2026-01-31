import React, { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { getCrystalReport, saveCrystalReport, clearCrystalReport } from "../utils/crystalReportStorage";
import "./Settings.css";

const FONT_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const DEFAULT_THRESHOLDS = {
  temperatureMin: 18,
  temperatureMax: 30,
  pHMin: 6.5,
  pHMax: 8.5,
  turbidityMax: 25,
  dissolvedOxygenMin: 4,
  nh3Max: 0.5,
};

const DEFAULT_CALIBRATION = {
  temperatureOffset: 0,
  pHOffset: 0,
  turbidityOffset: 0,
  dissolvedOxygenOffset: 0,
  nh3Offset: 0,
  flowRateOffset: 0,
};

function loadFromStorage(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("Could not save to localStorage", e);
  }
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [fontSize, setFontSize] = useState(() => localStorage.getItem("fontPreference") || "medium");
  const [thresholds, setThresholds] = useState(() => ({
    ...DEFAULT_THRESHOLDS,
    ...loadFromStorage("wqms_thresholds", {}),
  }));
  const [calibration, setCalibration] = useState(() => ({
    ...DEFAULT_CALIBRATION,
    ...loadFromStorage("wqms_calibration", {}),
  }));
  const [saveFeedback, setSaveFeedback] = useState(null);
  const [crystalReport, setCrystalReport] = useState(() => getCrystalReport());

  useEffect(() => {
    document.documentElement.setAttribute("data-font-size", fontSize);
    localStorage.setItem("fontPreference", fontSize);
  }, [fontSize]);

  const updateThreshold = (key, value) => {
    const n = parseFloat(value);
    if (!isNaN(n)) {
      const next = { ...thresholds, [key]: n };
      setThresholds(next);
      saveToStorage("wqms_thresholds", next);
    }
  };

  const updateCalibration = (key, value) => {
    const n = parseFloat(value);
    if (!isNaN(n)) {
      const next = { ...calibration, [key]: n };
      setCalibration(next);
      saveToStorage("wqms_calibration", next);
    }
  };

  const handleSaveAll = () => {
    saveToStorage("wqms_thresholds", thresholds);
    saveToStorage("wqms_calibration", calibration);
    document.documentElement.setAttribute("data-font-size", fontSize);
    localStorage.setItem("fontPreference", fontSize);
    setSaveFeedback("Saved");
    setTimeout(() => setSaveFeedback(null), 2000);
  };

  const handleCrystalReportImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name || "report.rpt";
    if (!/\.rptx?$/i.test(name)) {
      setSaveFeedback("Please select a .rpt or .rptx file");
      setTimeout(() => setSaveFeedback(null), 3000);
      e.target.value = "";
      return;
    }
    saveCrystalReport({ fileName: name });
    setCrystalReport(getCrystalReport());
    setSaveFeedback("Report format imported");
    setTimeout(() => setSaveFeedback(null), 2000);
    e.target.value = "";
  };

  const handleClearCrystalReport = () => {
    clearCrystalReport();
    setCrystalReport(null);
    setSaveFeedback("Report format cleared");
    setTimeout(() => setSaveFeedback(null), 2000);
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Calibration, thresholds, theme &amp; font</p>
        </div>
      </header>

      <div className="settings-content">
        {/* Calibration */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">Calibration</h2>
            <p className="card__desc">Sensor calibration offsets (applied to readings)</p>
          </div>
          <div className="card__body">
            <div className="settings-grid">
              <label className="settings-label">
                <span>Temperature offset (°C)</span>
                <input
                  type="number"
                  step="0.1"
                  className="settings-input"
                  value={calibration.temperatureOffset}
                  onChange={(e) => updateCalibration("temperatureOffset", e.target.value)}
                  aria-label="Temperature calibration offset"
                />
              </label>
              <label className="settings-label">
                <span>pH offset</span>
                <input
                  type="number"
                  step="0.1"
                  className="settings-input"
                  value={calibration.pHOffset}
                  onChange={(e) => updateCalibration("pHOffset", e.target.value)}
                  aria-label="pH calibration offset"
                />
              </label>
              <label className="settings-label">
                <span>Turbidity offset (NTU)</span>
                <input
                  type="number"
                  step="0.1"
                  className="settings-input"
                  value={calibration.turbidityOffset}
                  onChange={(e) => updateCalibration("turbidityOffset", e.target.value)}
                  aria-label="Turbidity calibration offset"
                />
              </label>
              <label className="settings-label">
                <span>Dissolved O₂ offset (mg/L)</span>
                <input
                  type="number"
                  step="0.1"
                  className="settings-input"
                  value={calibration.dissolvedOxygenOffset ?? 0}
                  onChange={(e) => updateCalibration("dissolvedOxygenOffset", e.target.value)}
                  aria-label="Dissolved oxygen calibration offset"
                />
              </label>
              <label className="settings-label">
                <span>NH₃ offset (mg/L)</span>
                <input
                  type="number"
                  step="0.01"
                  className="settings-input"
                  value={calibration.nh3Offset ?? 0}
                  onChange={(e) => updateCalibration("nh3Offset", e.target.value)}
                  aria-label="NH3 calibration offset"
                />
              </label>
              <label className="settings-label">
                <span>Flow rate offset (L/min)</span>
                <input
                  type="number"
                  step="0.1"
                  className="settings-input"
                  value={calibration.flowRateOffset ?? 0}
                  onChange={(e) => updateCalibration("flowRateOffset", e.target.value)}
                  aria-label="Flow rate calibration offset"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Thresholds */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">Thresholds</h2>
            <p className="card__desc">Alert thresholds for water quality parameters</p>
          </div>
          <div className="card__body">
            <div className="settings-grid">
              <label className="settings-label">
                <span>Temperature min (°C)</span>
                <input
                  type="number"
                  step="0.5"
                  className="settings-input"
                  value={thresholds.temperatureMin}
                  onChange={(e) => updateThreshold("temperatureMin", e.target.value)}
                  aria-label="Minimum temperature threshold"
                />
              </label>
              <label className="settings-label">
                <span>Temperature max (°C)</span>
                <input
                  type="number"
                  step="0.5"
                  className="settings-input"
                  value={thresholds.temperatureMax}
                  onChange={(e) => updateThreshold("temperatureMax", e.target.value)}
                  aria-label="Maximum temperature threshold"
                />
              </label>
              <label className="settings-label">
                <span>pH min</span>
                <input
                  type="number"
                  step="0.1"
                  className="settings-input"
                  value={thresholds.pHMin}
                  onChange={(e) => updateThreshold("pHMin", e.target.value)}
                  aria-label="Minimum pH threshold"
                />
              </label>
              <label className="settings-label">
                <span>pH max</span>
                <input
                  type="number"
                  step="0.1"
                  className="settings-input"
                  value={thresholds.pHMax}
                  onChange={(e) => updateThreshold("pHMax", e.target.value)}
                  aria-label="Maximum pH threshold"
                />
              </label>
              <label className="settings-label">
                <span>Turbidity max (NTU)</span>
                <input
                  type="number"
                  step="0.5"
                  className="settings-input"
                  value={thresholds.turbidityMax}
                  onChange={(e) => updateThreshold("turbidityMax", e.target.value)}
                  aria-label="Maximum turbidity threshold"
                />
              </label>
              <label className="settings-label">
                <span>Dissolved O₂ min (mg/L)</span>
                <input
                  type="number"
                  step="0.1"
                  className="settings-input"
                  value={thresholds.dissolvedOxygenMin}
                  onChange={(e) => updateThreshold("dissolvedOxygenMin", e.target.value)}
                  aria-label="Minimum dissolved oxygen threshold"
                />
              </label>
              <label className="settings-label">
                <span>NH₃ max (mg/L)</span>
                <input
                  type="number"
                  step="0.01"
                  className="settings-input"
                  value={thresholds.nh3Max}
                  onChange={(e) => updateThreshold("nh3Max", e.target.value)}
                  aria-label="Maximum NH3 threshold"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Theme */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">Theme</h2>
            <p className="card__desc">Dark or light mode</p>
          </div>
          <div className="card__body">
            <div className="settings-option-row">
              <span className="settings-option-label">Appearance</span>
              <div className="settings-theme-buttons">
                <button
                  type="button"
                  className={`settings-theme-btn ${theme === "dark" ? "settings-theme-btn--active" : ""}`}
                  onClick={() => setTheme("dark")}
                  aria-pressed={theme === "dark"}
                  aria-label="Dark mode"
                >
                  Dark
                </button>
                <button
                  type="button"
                  className={`settings-theme-btn ${theme === "light" ? "settings-theme-btn--active" : ""}`}
                  onClick={() => setTheme("light")}
                  aria-pressed={theme === "light"}
                  aria-label="Light mode"
                >
                  Light
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Font preference */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">Font size</h2>
            <p className="card__desc">Text size preference</p>
          </div>
          <div className="card__body">
            <div className="settings-option-row">
              <span className="settings-option-label">Size</span>
              <div className="settings-font-buttons">
                {FONT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`settings-font-btn ${fontSize === opt.value ? "settings-font-btn--active" : ""}`}
                    onClick={() => setFontSize(opt.value)}
                    aria-pressed={fontSize === opt.value}
                    aria-label={`Font size: ${opt.label}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Crystal Report format */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">Crystal Report format</h2>
            <p className="card__desc">Import a .rpt or .rptx template for use in Reports exports</p>
          </div>
          <div className="card__body">
            <div className="settings-crystal-report">
              <label className="settings-file-label">
                <span className="settings-file-btn">Choose report file</span>
                <input
                  type="file"
                  accept=".rpt,.rptx"
                  className="settings-file-input"
                  onChange={handleCrystalReportImport}
                  aria-label="Import Crystal Report (.rpt or .rptx)"
                />
              </label>
              {crystalReport ? (
                <div className="settings-crystal-report-current">
                  <span className="settings-crystal-report-name" title={crystalReport.importedAt}>
                    {crystalReport.fileName}
                  </span>
                  <span className="settings-crystal-report-meta">
                    Imported {crystalReport.importedAt ? new Date(crystalReport.importedAt).toLocaleDateString() : ""}
                  </span>
                  <button
                    type="button"
                    className="settings-crystal-report-clear"
                    onClick={handleClearCrystalReport}
                    aria-label="Clear Crystal Report template"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <p className="settings-crystal-report-empty">No report template selected</p>
              )}
            </div>
          </div>
        </section>

        <div className="settings-actions">
          <button
            type="button"
            className="settings-save-btn"
            onClick={handleSaveAll}
            aria-label="Save all settings"
          >
            Save settings
          </button>
          {saveFeedback && (
            <span className="settings-save-feedback" role="status">
              {saveFeedback}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
