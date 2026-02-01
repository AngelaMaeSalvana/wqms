import React, { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
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

const DEFAULT_COLLECTION_INTERVAL_MINUTES = 15;
const COLLECTION_INTERVAL_MIN_LIMIT = 1;
const COLLECTION_INTERVAL_MAX_LIMIT = 120;
const DEFAULT_COLLECTION_INTERVAL_MIN = 1;
const DEFAULT_COLLECTION_INTERVAL_MAX = 15;

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
  const [collectionIntervalMinutes, setCollectionIntervalMinutes] = useState(() => {
    const v = loadFromStorage("wqms_collection_interval_minutes", DEFAULT_COLLECTION_INTERVAL_MINUTES);
    const n = typeof v === "number" ? v : parseInt(v, 10);
    if (isNaN(n) || n < COLLECTION_INTERVAL_MIN_LIMIT || n > COLLECTION_INTERVAL_MAX_LIMIT) {
      return DEFAULT_COLLECTION_INTERVAL_MINUTES;
    }
    return n;
  });
  const [collectionIntervalMin, setCollectionIntervalMin] = useState(() => {
    const v = loadFromStorage("wqms_collection_interval_min_minutes", DEFAULT_COLLECTION_INTERVAL_MIN);
    const n = typeof v === "number" ? v : parseInt(v, 10);
    if (isNaN(n) || n < COLLECTION_INTERVAL_MIN_LIMIT || n > COLLECTION_INTERVAL_MAX_LIMIT) {
      return DEFAULT_COLLECTION_INTERVAL_MIN;
    }
    return n;
  });
  const [collectionIntervalMax, setCollectionIntervalMax] = useState(() => {
    const v = loadFromStorage("wqms_collection_interval_max_minutes", DEFAULT_COLLECTION_INTERVAL_MAX);
    const n = typeof v === "number" ? v : parseInt(v, 10);
    if (isNaN(n) || n < COLLECTION_INTERVAL_MIN_LIMIT || n > COLLECTION_INTERVAL_MAX_LIMIT) {
      return DEFAULT_COLLECTION_INTERVAL_MAX;
    }
    return n;
  });
  const [saveFeedback, setSaveFeedback] = useState(null);

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

  const updateCollectionInterval = (value) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= COLLECTION_INTERVAL_MIN_LIMIT && n <= COLLECTION_INTERVAL_MAX_LIMIT) {
      setCollectionIntervalMinutes(n);
      saveToStorage("wqms_collection_interval_minutes", n);
    }
  };

  const updateCollectionIntervalMin = (value) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= COLLECTION_INTERVAL_MIN_LIMIT && n <= COLLECTION_INTERVAL_MAX_LIMIT) {
      const newMin = Math.min(n, collectionIntervalMax);
      setCollectionIntervalMin(newMin);
      saveToStorage("wqms_collection_interval_min_minutes", newMin);
    }
  };

  const updateCollectionIntervalMax = (value) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= COLLECTION_INTERVAL_MIN_LIMIT && n <= COLLECTION_INTERVAL_MAX_LIMIT) {
      const newMax = Math.max(n, collectionIntervalMin);
      setCollectionIntervalMax(newMax);
      saveToStorage("wqms_collection_interval_max_minutes", newMax);
    }
  };

  const handleSaveAll = () => {
    saveToStorage("wqms_thresholds", thresholds);
    saveToStorage("wqms_calibration", calibration);
    saveToStorage("wqms_collection_interval_minutes", collectionIntervalMinutes);
    saveToStorage("wqms_collection_interval_min_minutes", collectionIntervalMin);
    saveToStorage("wqms_collection_interval_max_minutes", collectionIntervalMax);
    document.documentElement.setAttribute("data-font-size", fontSize);
    localStorage.setItem("fontPreference", fontSize);
    setSaveFeedback("Saved");
    setTimeout(() => setSaveFeedback(null), 2000);
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Calibration, thresholds, data collection, theme &amp; font</p>
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

        {/* Data collection frequency */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">Data collection &amp; updates</h2>
            <p className="card__desc">
              Set the allowed range (min/max) for data collection interval in minutes. Under normal or low-flow conditions the system uses the maximum interval; when flow rate rises it can increase frequency up to the minimum interval. Dashboard refresh uses the default interval.
            </p>
          </div>
          <div className="card__body">
            <div className="settings-grid">
              <label className="settings-label">
                <span>Default interval (minutes)</span>
                <input
                  type="number"
                  min={COLLECTION_INTERVAL_MIN_LIMIT}
                  max={COLLECTION_INTERVAL_MAX_LIMIT}
                  step={1}
                  className="settings-input"
                  value={collectionIntervalMinutes}
                  onChange={(e) => updateCollectionInterval(e.target.value)}
                  aria-label="Default data collection interval in minutes"
                />
                <span className="settings-hint">
                  Used for dashboard refresh. {COLLECTION_INTERVAL_MIN_LIMIT}–{COLLECTION_INTERVAL_MAX_LIMIT} min
                </span>
              </label>
              <label className="settings-label">
                <span>Minimum interval (minutes)</span>
                <input
                  type="number"
                  min={COLLECTION_INTERVAL_MIN_LIMIT}
                  max={COLLECTION_INTERVAL_MAX_LIMIT}
                  step={1}
                  className="settings-input"
                  value={collectionIntervalMin}
                  onChange={(e) => updateCollectionIntervalMin(e.target.value)}
                  aria-label="Minimum data collection interval in minutes"
                />
                <span className="settings-hint">
                  Fastest sampling (high flow). Must be ≤ maximum
                </span>
              </label>
              <label className="settings-label">
                <span>Maximum interval (minutes)</span>
                <input
                  type="number"
                  min={COLLECTION_INTERVAL_MIN_LIMIT}
                  max={COLLECTION_INTERVAL_MAX_LIMIT}
                  step={1}
                  className="settings-input"
                  value={collectionIntervalMax}
                  onChange={(e) => updateCollectionIntervalMax(e.target.value)}
                  aria-label="Maximum data collection interval in minutes"
                />
                <span className="settings-hint">
                  Slowest sampling (low flow). Must be ≥ minimum
                </span>
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
