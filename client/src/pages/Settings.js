import React, { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { DEFAULT_WQI_WEIGHTS, getWQIWeights } from "../utils/wqiCalculator";
import {
  loadFromStorage,
  saveToStorage,
  syncSettingsFromSupabase,
  saveSettingsToSupabaseAndLocal,
} from "../utils/settingsStorage";
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

const DEFAULT_DATA_COLLECTION = {
  defaultIntervalMinutes: 15,
  minIntervalMinutes: 1,
  maxIntervalMinutes: 15,
  readingsLimit: 500,
};

const WQI_WEIGHTS_KEY = "wqms_wqi_weights";

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
  const [dataCollection, setDataCollection] = useState(() => ({
    ...DEFAULT_DATA_COLLECTION,
    ...loadFromStorage("wqms_data_collection", {}),
  }));
  const [wqiWeights, setWqiWeights] = useState(() => ({
    ...DEFAULT_WQI_WEIGHTS,
    ...loadFromStorage(WQI_WEIGHTS_KEY, {}),
  }));
  const [saveFeedback, setSaveFeedback] = useState(null);
  const [activeTab, setActiveTab] = useState("system"); // "system" | "preferences"
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load settings from Supabase on mount (when enabled)
  useEffect(() => {
    syncSettingsFromSupabase()
      .then(() => {
        setThresholds((t) => ({ ...t, ...loadFromStorage("wqms_thresholds", {}) }));
        setCalibration((c) => ({ ...c, ...loadFromStorage("wqms_calibration", {}) }));
        setDataCollection((d) => ({ ...d, ...loadFromStorage("wqms_data_collection", {}) }));
        setWqiWeights((w) => ({ ...w, ...loadFromStorage(WQI_WEIGHTS_KEY, {}) }));
      })
      .finally(() => setSettingsLoaded(true));
  }, []);

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

  const updateDataCollection = (key, value) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 0) {
      const next = { ...dataCollection, [key]: n };
      setDataCollection(next);
      saveToStorage("wqms_data_collection", next);
    }
  };

  const updateWqiWeight = (key, value) => {
    const n = parseFloat(value);
    if (!isNaN(n) && n >= 0) {
      const next = { ...wqiWeights, [key]: n };
      setWqiWeights(next);
      saveToStorage(WQI_WEIGHTS_KEY, next);
    }
  };

  const handleSaveAll = async () => {
    document.documentElement.setAttribute("data-font-size", fontSize);
    localStorage.setItem("fontPreference", fontSize);
    const settingsByKey = {
      wqms_thresholds: thresholds,
      wqms_calibration: calibration,
      wqms_data_collection: dataCollection,
      [WQI_WEIGHTS_KEY]: wqiWeights,
    };
    try {
      await saveSettingsToSupabaseAndLocal(settingsByKey);
      setSaveFeedback("Saved");
    } catch (e) {
      setSaveFeedback("Error saving");
      console.warn(e);
    }
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

      <div className="settings-tabs" role="tablist" aria-label="Settings categories">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "system"}
          aria-controls="settings-panel-system"
          id="tab-system"
          className={`settings-tab ${activeTab === "system" ? "settings-tab--active" : ""}`}
          onClick={() => setActiveTab("system")}
        >
          Calibration, Threshold &amp; Data
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "preferences"}
          aria-controls="settings-panel-preferences"
          id="tab-preferences"
          className={`settings-tab ${activeTab === "preferences" ? "settings-tab--active" : ""}`}
          onClick={() => setActiveTab("preferences")}
        >
          User Preferences
        </button>
      </div>

      <div className="settings-content">
        {/* Tab panel: Calibration, Threshold, Data Collection */}
        <div
          id="settings-panel-system"
          role="tabpanel"
          aria-labelledby="tab-system"
          hidden={activeTab !== "system"}
          className="settings-tab-panel"
        >
          {/* Calibration */}
          <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">Calibration</h2>
            <p className="card__desc">Sensor calibration offsets. Applied to displayed readings across the app.</p>
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

        {/* WQI Parameter Weights */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">Water Quality Index (WQI) Weights</h2>
            <p className="card__desc">
              Adjust how much each parameter contributes to the WQI. Weights are normalized (sum = 1.00).
              Higher weight = greater influence on the final score.
            </p>
          </div>
          <div className="card__body">
            <div className="settings-grid">
              <label className="settings-label">
                <span>Dissolved O₂ (W_DO)</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  className="settings-input"
                  value={wqiWeights.dissolvedOxygen ?? DEFAULT_WQI_WEIGHTS.dissolvedOxygen}
                  onChange={(e) => updateWqiWeight("dissolvedOxygen", e.target.value)}
                  aria-label="Weight for Dissolved Oxygen"
                />
              </label>
              <label className="settings-label">
                <span>NH₃ (W_NH3)</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  className="settings-input"
                  value={wqiWeights.nh3 ?? DEFAULT_WQI_WEIGHTS.nh3}
                  onChange={(e) => updateWqiWeight("nh3", e.target.value)}
                  aria-label="Weight for NH3"
                />
              </label>
              <label className="settings-label">
                <span>pH (W_pH)</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  className="settings-input"
                  value={wqiWeights.pH ?? DEFAULT_WQI_WEIGHTS.pH}
                  onChange={(e) => updateWqiWeight("pH", e.target.value)}
                  aria-label="Weight for pH"
                />
              </label>
              <label className="settings-label">
                <span>Turbidity (W_turb)</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  className="settings-input"
                  value={wqiWeights.turbidity ?? DEFAULT_WQI_WEIGHTS.turbidity}
                  onChange={(e) => updateWqiWeight("turbidity", e.target.value)}
                  aria-label="Weight for Turbidity"
                />
              </label>
              <label className="settings-label">
                <span>Temperature (W_temp)</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  className="settings-input"
                  value={wqiWeights.temperature ?? DEFAULT_WQI_WEIGHTS.temperature}
                  onChange={(e) => updateWqiWeight("temperature", e.target.value)}
                  aria-label="Weight for Temperature"
                />
              </label>
            </div>
            {(() => {
              const w = getWQIWeights();
              const sum = Object.values(w).reduce((a, v) => a + v, 0);
              const maxWeight = Math.max(...Object.values(w));
              const hasExtreme = maxWeight > 0.5;
              return (
                <>
                  <p className="settings-helper" style={{ marginTop: "0.75rem" }}>
                    Normalized formula in use: WQI = {w.dissolvedOxygen.toFixed(2)}×QDO + {w.nh3.toFixed(2)}×QNH3 + {w.pH.toFixed(2)}×QpH + {w.turbidity.toFixed(2)}×Qturb + {w.temperature.toFixed(2)}×Qtemp
                  </p>
                  <p className="settings-helper">
                    Weights sum to {sum.toFixed(2)}. {sum !== 1 ? "Values are auto-normalized so the total = 1.00." : ""}
                  </p>
                  {hasExtreme && (
                    <p className="settings-helper" role="alert" style={{ color: "var(--accent-warning, #f0a500)" }}>
                      ⚠ Extreme weight distribution may bias the index. Consider using more balanced weights.
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </section>

        {/* Data collection & updates */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">Data collection &amp; updates</h2>
            <p className="card__desc">
              Data collection interval settings.
            </p>
          </div>
          <div className="card__body">
            <div className="settings-grid">
              <label className="settings-label">
                <span>Default interval (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  className="settings-input"
                  value={dataCollection.defaultIntervalMinutes ?? 15}
                  onChange={(e) => updateDataCollection("defaultIntervalMinutes", e.target.value)}
                  aria-label="Default data collection interval in minutes"
                />
                <span className="settings-helper">1–120 min</span>
              </label>
              <label className="settings-label">
                <span>Minimum interval (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  className="settings-input"
                  value={dataCollection.minIntervalMinutes ?? 1}
                  onChange={(e) => updateDataCollection("minIntervalMinutes", e.target.value)}
                  aria-label="Minimum sampling interval in minutes"
                />
                <span className="settings-helper">≤ max</span>
              </label>
              <label className="settings-label">
                <span>Maximum interval (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  className="settings-input"
                  value={dataCollection.maxIntervalMinutes ?? 15}
                  onChange={(e) => updateDataCollection("maxIntervalMinutes", e.target.value)}
                  aria-label="Maximum sampling interval in minutes"
                />
                <span className="settings-helper">≥ min</span>
              </label>
              <label className="settings-label">
                <span>Readings limit</span>
                <input
                  type="number"
                  min={100}
                  max={2000}
                  className="settings-input"
                  value={dataCollection.readingsLimit ?? 500}
                  onChange={(e) => updateDataCollection("readingsLimit", e.target.value)}
                  aria-label="Maximum readings to load"
                />
                <span className="settings-helper">100–2000</span>
              </label>
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

        {/* Tab panel: User Preferences (Theme & Font) */}
        <div
          id="settings-panel-preferences"
          role="tabpanel"
          aria-labelledby="tab-preferences"
          hidden={activeTab !== "preferences"}
          className="settings-tab-panel"
        >
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
    </div>
  );
}
