import React, { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import InfoTooltip from "../components/InfoTooltip";
import { DEFAULT_WQI_WEIGHTS, getWQIWeights } from "../utils/wqiCalculator";
import {
  loadFromStorage,
  saveToStorage,
  syncSettingsFromSupabase,
  saveSettingsToSupabaseAndLocal,
  DEFAULT_MAINTENANCE,
  SETTINGS_KEYS,
} from "../utils/settingsStorage";
import { sendEventNotification } from "../services/emailService";
import { DEFAULT_ALERT_LOGIC, getAlertLogic, saveAlertLogic } from "../utils/alertsData";
import {
  DEFAULT_DATA_COLLECTION,
  FREQUENCY_MODES,
  getEffectiveAcquisitionIntervalMinutes,
  mergeDataCollection,
} from "../utils/dataAcquisition";
import "./Settings.css";

const DEFAULT_THRESHOLDS = {
  temperatureMin: 18,
  temperatureMax: 30,
  pHMin: 6.5,
  pHMax: 8.5,
  turbidityMax: 25,
  dissolvedOxygenMin: 4,
  nh3Max: 0.5,
};

/** TSS (mg/L) to NTU: 1 NTU ≈ 1.5 mg/L TSS → NTU = TSS / 1.5 */
const tssToNtu = (tss) => Math.round((tss / 1.5) * 10) / 10;

/** DENR DAO 2016-08/2021-19 water quality classifications and preset thresholds */
const THRESHOLD_CLASSIFICATIONS = {
  AA: {
    temperatureMin: 26,
    temperatureMax: 30,
    pHMin: 6.5,
    pHMax: 8.5,
    turbidityMax: tssToNtu(25),
    dissolvedOxygenMin: 5,
    nh3Max: 0.05,
  },
  A: {
    temperatureMin: 26,
    temperatureMax: 30,
    pHMin: 6.5,
    pHMax: 8.5,
    turbidityMax: tssToNtu(50),
    dissolvedOxygenMin: 5,
    nh3Max: 0.05,
  },
  B: {
    temperatureMin: 26,
    temperatureMax: 30,
    pHMin: 6.5,
    pHMax: 8.5,
    turbidityMax: tssToNtu(65),
    dissolvedOxygenMin: 5,
    nh3Max: 0.05,
  },
  C: {
    temperatureMin: 25,
    temperatureMax: 31,
    pHMin: 6.5,
    pHMax: 9,
    turbidityMax: tssToNtu(80),
    dissolvedOxygenMin: 5,
    nh3Max: 0.05,
  },
  D: {
    temperatureMin: 25,
    temperatureMax: 32,
    pHMin: 6,
    pHMax: 9,
    turbidityMax: tssToNtu(110),
    dissolvedOxygenMin: 2,
    nh3Max: 0.75,
  },
  SA: {
    temperatureMin: 26,
    temperatureMax: 30,
    pHMin: 7,
    pHMax: 8.5,
    turbidityMax: tssToNtu(25),
    dissolvedOxygenMin: 6,
    nh3Max: 0.04,
  },
  SB: {
    temperatureMin: 26,
    temperatureMax: 30,
    pHMin: 7,
    pHMax: 8.5,
    turbidityMax: tssToNtu(50),
    dissolvedOxygenMin: 6,
    nh3Max: 0.05,
  },
  SC: {
    temperatureMin: 25,
    temperatureMax: 31,
    pHMin: 6.5,
    pHMax: 8.5,
    turbidityMax: tssToNtu(80),
    dissolvedOxygenMin: 5,
    nh3Max: 0.05,
  },
  SD: {
    temperatureMin: 25,
    temperatureMax: 32,
    pHMin: 6,
    pHMax: 9,
    turbidityMax: tssToNtu(110),
    dissolvedOxygenMin: 2,
    nh3Max: 0.75,
  },
};

const CLASSIFICATION_OPTIONS = [...Object.keys(THRESHOLD_CLASSIFICATIONS), "Custom"];
const CLASSIFICATION_STORAGE_KEY = "wqms_threshold_classification";

const DEFAULT_CALIBRATION = {
  temperatureOffset: 0,
  pHOffset: 0,
};

function sanitizeCalibration(raw) {
  const t = parseFloat(raw?.temperatureOffset);
  const p = parseFloat(raw?.pHOffset);
  return {
    temperatureOffset: Number.isFinite(t) ? t : 0,
    pHOffset: Number.isFinite(p) ? p : 0,
  };
}

const DEFAULT_NOTIFICATIONS = {
  emailEnabled: false,
  notificationEmail: "",
};

const WQI_WEIGHTS_KEY = "wqms_wqi_weights";
const NOTIFICATIONS_KEY = "wqms_notifications";

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [thresholdClassification, setThresholdClassification] = useState(() => {
    const stored = loadFromStorage(CLASSIFICATION_STORAGE_KEY, "Custom");
    return CLASSIFICATION_OPTIONS.includes(stored) ? stored : "Custom";
  });
  const [thresholds, setThresholds] = useState(() => {
    const stored = loadFromStorage("wqms_thresholds", {});
    const cls = loadFromStorage(CLASSIFICATION_STORAGE_KEY, "Custom");
    const validCls = CLASSIFICATION_OPTIONS.includes(cls) ? cls : "Custom";
    const preset = validCls !== "Custom" ? THRESHOLD_CLASSIFICATIONS[validCls] : null;
    return {
      ...DEFAULT_THRESHOLDS,
      ...(preset || stored),
    };
  });
  const [calibration, setCalibration] = useState(() =>
    sanitizeCalibration({ ...DEFAULT_CALIBRATION, ...loadFromStorage("wqms_calibration", {}) })
  );
  const [dataCollection, setDataCollection] = useState(() =>
    mergeDataCollection(loadFromStorage("wqms_data_collection", {}))
  );
  const [wqiWeights, setWqiWeights] = useState(() => ({
    ...DEFAULT_WQI_WEIGHTS,
    ...loadFromStorage(WQI_WEIGHTS_KEY, {}),
  }));
  const [notifications, setNotifications] = useState(() => ({
    ...DEFAULT_NOTIFICATIONS,
    ...loadFromStorage(NOTIFICATIONS_KEY, {}),
  }));
  const [alertLogic, setAlertLogic] = useState(() => getAlertLogic());
  const [maintenance, setMaintenance] = useState(() => ({
    ...DEFAULT_MAINTENANCE,
    ...loadFromStorage(SETTINGS_KEYS.maintenance, {}),
  }));
  const [saveFeedback, setSaveFeedback] = useState(null);
  const [activeTab, setActiveTab] = useState("system"); // "system" | "preferences"
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load settings from Supabase on mount (when enabled)
  useEffect(() => {
    syncSettingsFromSupabase()
      .then(() => {
        const cls = loadFromStorage(CLASSIFICATION_STORAGE_KEY, "Custom");
        const validCls = CLASSIFICATION_OPTIONS.includes(cls) ? cls : "Custom";
        const stored = loadFromStorage("wqms_thresholds", {});
        const preset = validCls !== "Custom" ? THRESHOLD_CLASSIFICATIONS[validCls] : null;
        setThresholdClassification(validCls);
        setThresholds((t) => ({ ...t, ...(preset || stored) }));
        setCalibration(sanitizeCalibration({ ...DEFAULT_CALIBRATION, ...loadFromStorage("wqms_calibration", {}) }));
        setDataCollection(mergeDataCollection(loadFromStorage("wqms_data_collection", {})));
        setWqiWeights((w) => ({ ...w, ...loadFromStorage(WQI_WEIGHTS_KEY, {}) }));
        setNotifications((n) => ({ ...n, ...loadFromStorage(NOTIFICATIONS_KEY, {}) }));
        setMaintenance((m) => ({ ...m, ...loadFromStorage(SETTINGS_KEYS.maintenance, {}) }));
      })
      .finally(() => setSettingsLoaded(true));
  }, []);

  const isCustomClassification = thresholdClassification === "Custom";

  const isAutoAdaptMode =
    (dataCollection.frequencyMode ?? FREQUENCY_MODES.USER_SELECTED) === FREQUENCY_MODES.AUTO_ADAPT;
  const effectiveAutoAcquisitionMinutes = isAutoAdaptMode
    ? getEffectiveAcquisitionIntervalMinutes(dataCollection)
    : null;
  const flowMappingInvalid =
    isAutoAdaptMode &&
    Number(dataCollection.flowRateAtFastCondition) <= Number(dataCollection.flowRateAtSlowCondition);

  const updateThreshold = (key, value) => {
    if (!isCustomClassification) return;
    const n = parseFloat(value);
    if (!isNaN(n)) {
      const next = { ...thresholds, [key]: n };
      setThresholds(next);
      saveToStorage("wqms_thresholds", next);
    }
  };

  const handleClassificationChange = (value) => {
    setThresholdClassification(value);
    saveToStorage(CLASSIFICATION_STORAGE_KEY, value);
    if (value !== "Custom") {
      const preset = THRESHOLD_CLASSIFICATIONS[value];
      if (preset) {
        setThresholds(preset);
        saveToStorage("wqms_thresholds", preset);
      }
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

  const updateDataCollectionEnum = (key, value) => {
    const next = { ...dataCollection, [key]: value };
    setDataCollection(next);
    saveToStorage("wqms_data_collection", next);
  };

  const updateDataCollectionFloat = (key, value) => {
    const n = parseFloat(value);
    if (!Number.isNaN(n) && n >= 0) {
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

  const updateNotifications = (key, value) => {
    const next = { ...notifications, [key]: value };
    setNotifications(next);
    saveToStorage(NOTIFICATIONS_KEY, next);
  };

  const updateAlertLogic = (key, value) => {
    const n = parseFloat(value);
    if (!isNaN(n) && n >= 0) {
      const next = { ...alertLogic, [key]: n };
      setAlertLogic(next);
      saveAlertLogic(next);
    }
  };

  const updateMaintenance = (key, value) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 1) {
      const next = { ...maintenance, [key]: n };
      setMaintenance(next);
      saveToStorage(SETTINGS_KEYS.maintenance, next);
    }
  };

  const handleSaveAll = async () => {
    const prevThresholds = loadFromStorage("wqms_last_synced_thresholds", {});
    const thresholdKeys = ["temperatureMin", "temperatureMax", "pHMin", "pHMax", "turbidityMax", "dissolvedOxygenMin", "nh3Max"];
    const thresholdsChanged = thresholdKeys.some((k) => prevThresholds[k] !== undefined && prevThresholds[k] !== thresholds[k]);

    const settingsByKey = {
      wqms_thresholds: thresholds,
      wqms_threshold_classification: thresholdClassification,
      wqms_calibration: sanitizeCalibration(calibration),
      wqms_data_collection: dataCollection,
      [WQI_WEIGHTS_KEY]: wqiWeights,
      [NOTIFICATIONS_KEY]: notifications,
      [SETTINGS_KEYS.maintenance]: maintenance,
    };
    try {
      await saveSettingsToSupabaseAndLocal(settingsByKey);
      if (thresholdsChanged) {
        sendEventNotification("threshold_update", { previous: prevThresholds, current: thresholds });
      }
      saveToStorage("wqms_last_synced_thresholds", thresholds);
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
          <p className="page-subtitle">Sensor calibration, alert thresholds &amp; preferences</p>
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
            <h2 className="card__title">
              Calibration
              <InfoTooltip text="Adjust temperature and pH with a small offset if readings are consistently high or low. Turbidity, DO, NH₃, and flow use lab/backend correction only." label="Calibration help" />
            </h2>
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
            </div>
          </div>
        </section>

        {/* Thresholds */}
        <section className="settings-section card">
          <div className="card__header settings-threshold-header">
            <div>
              <h2 className="card__title">
                Thresholds
                <InfoTooltip text="Set the safe range for each parameter. An alert is triggered when a reading goes outside these limits." label="Thresholds help" />
              </h2>
            </div>
            <label className="settings-label settings-classification-select-wrap">
              <span>Classification</span>
              <select
                className="settings-input settings-select"
                value={thresholdClassification}
                onChange={(e) => handleClassificationChange(e.target.value)}
                aria-label="Water quality classification"
              >
                {CLASSIFICATION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {!isCustomClassification && (
                <InfoTooltip
                  text="This is a DENR standard preset — values are read-only. Switch to Custom to edit."
                  label="DENR preset info"
                />
              )}
            </label>
          </div>
          <div className="card__body">
            {isCustomClassification && (
              <p className="settings-helper settings-threshold-helper">
                Custom — you can freely edit the limit values below.
              </p>
            )}
            <div className="settings-grid">
              <label className="settings-label">
                <span>Temperature min (°C)</span>
                <input
                  type="number"
                  step="0.5"
                  className={`settings-input ${!isCustomClassification ? "settings-input--readonly" : ""}`}
                  value={thresholds.temperatureMin}
                  onChange={(e) => updateThreshold("temperatureMin", e.target.value)}
                  readOnly={!isCustomClassification}
                  aria-label="Minimum temperature threshold"
                />
              </label>
              <label className="settings-label">
                <span>Temperature max (°C)</span>
                <input
                  type="number"
                  step="0.5"
                  className={`settings-input ${!isCustomClassification ? "settings-input--readonly" : ""}`}
                  value={thresholds.temperatureMax}
                  onChange={(e) => updateThreshold("temperatureMax", e.target.value)}
                  readOnly={!isCustomClassification}
                  aria-label="Maximum temperature threshold"
                />
              </label>
              <label className="settings-label">
                <span>pH min</span>
                <input
                  type="number"
                  step="0.1"
                  className={`settings-input ${!isCustomClassification ? "settings-input--readonly" : ""}`}
                  value={thresholds.pHMin}
                  onChange={(e) => updateThreshold("pHMin", e.target.value)}
                  readOnly={!isCustomClassification}
                  aria-label="Minimum pH threshold"
                />
              </label>
              <label className="settings-label">
                <span>pH max</span>
                <input
                  type="number"
                  step="0.1"
                  className={`settings-input ${!isCustomClassification ? "settings-input--readonly" : ""}`}
                  value={thresholds.pHMax}
                  onChange={(e) => updateThreshold("pHMax", e.target.value)}
                  readOnly={!isCustomClassification}
                  aria-label="Maximum pH threshold"
                />
              </label>
              <label className="settings-label">
                <span>Turbidity max (NTU)</span>
                <input
                  type="number"
                  step="0.5"
                  className={`settings-input ${!isCustomClassification ? "settings-input--readonly" : ""}`}
                  value={thresholds.turbidityMax}
                  onChange={(e) => updateThreshold("turbidityMax", e.target.value)}
                  readOnly={!isCustomClassification}
                  aria-label="Maximum turbidity threshold"
                  title="Derived from TSS: 1 NTU ≈ 1.5 mg/L TSS"
                />
              </label>
              <label className="settings-label">
                <span>Dissolved O₂ min (mg/L)</span>
                <input
                  type="number"
                  step="0.1"
                  className={`settings-input ${!isCustomClassification ? "settings-input--readonly" : ""}`}
                  value={thresholds.dissolvedOxygenMin}
                  onChange={(e) => updateThreshold("dissolvedOxygenMin", e.target.value)}
                  readOnly={!isCustomClassification}
                  aria-label="Minimum dissolved oxygen threshold"
                />
              </label>
              <label className="settings-label">
                <span>NH₃ max (mg/L)</span>
                <input
                  type="number"
                  step="0.01"
                  className={`settings-input ${!isCustomClassification ? "settings-input--readonly" : ""}`}
                  value={thresholds.nh3Max}
                  onChange={(e) => updateThreshold("nh3Max", e.target.value)}
                  readOnly={!isCustomClassification}
                  aria-label="Maximum NH3 threshold"
                />
              </label>
            </div>
          </div>
        </section>

        {/* WQI Parameter Weights */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">
              Water Quality Index (WQI) Weights
              <InfoTooltip text="How much each parameter influences the overall water quality score. Higher weight = more impact on the final score. Values are automatically balanced to add up to 1." label="WQI weights help" />
            </h2>
          </div>
          <div className="card__body">
            <div className="settings-grid">
              <label className="settings-label">
                <span>Dissolved Oxygen weight</span>
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
                <span>Ammonia (NH₃) weight</span>
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
                <span>pH weight</span>
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
                <span>Turbidity weight</span>
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
                <span>Temperature weight</span>
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
                    Weights sum to {sum.toFixed(2)}
                    {sum !== 1 && " — auto-normalized to 1.00"}
                  </p>
                  {hasExtreme && (
                    <p className="settings-helper" role="alert" style={{ color: "var(--accent-warning, #f0a500)" }}>
                      ⚠ One parameter has a very high weight. This may cause the score to rely too heavily on a single reading. Consider spreading the weights more evenly.
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </section>

        {/* Alert Logic */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">
              Alert Sensitivity
              <InfoTooltip text="Control how sensitive the system is when triggering alerts." label="Alert sensitivity help" />
            </h2>
          </div>
          <div className="card__body">
            <div className="settings-grid">
              <label className="settings-label">
                <span>pH alert buffer <InfoTooltip text="How far pH must recover before the alert clears. Prevents repeated on/off alerts near the threshold. Default: 0.2" label="pH buffer help" /></span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step="0.05"
                  className="settings-input"
                  value={alertLogic.pHHysteresisOffset ?? DEFAULT_ALERT_LOGIC.pHHysteresisOffset}
                  onChange={(e) => updateAlertLogic("pHHysteresisOffset", e.target.value)}
                  aria-label="pH alert buffer"
                />
              </label>
              <label className="settings-label">
                <span>Ammonia (NH₃) rapid-rise limit (mg/L) <InfoTooltip text="Triggers a warning if ammonia rises by more than this amount between two consecutive readings. Default: 0.15 mg/L" label="NH3 rapid-rise help" /></span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step="0.01"
                  className="settings-input"
                  value={alertLogic.nh3SlopeLimit ?? DEFAULT_ALERT_LOGIC.nh3SlopeLimit}
                  onChange={(e) => updateAlertLogic("nh3SlopeLimit", e.target.value)}
                  aria-label="Ammonia rapid-rise limit"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Data collection & updates */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">
              Data collection &amp; updates
              <InfoTooltip text="Control how frequently sensor readings are recorded and how much data is loaded at a time." label="Data collection help" />
            </h2>
          </div>
          <div className="card__body">
            <div className="settings-grid">
              <label className="settings-label settings-label--full">
                <span>
                  Sampling mode{" "}
                  <InfoTooltip
                    text="User-selected keeps a fixed interval you set. Auto-adapt computes interval from river flow (1–15 min): slower flow → longer interval, faster flow → shorter. Flow is simulated until a sensor is connected."
                    label="Sampling mode help"
                  />
                </span>
                <select
                  className="settings-input"
                  value={dataCollection.frequencyMode ?? FREQUENCY_MODES.USER_SELECTED}
                  onChange={(e) => updateDataCollectionEnum("frequencyMode", e.target.value)}
                  aria-label="Data acquisition sampling mode"
                >
                  <option value={FREQUENCY_MODES.USER_SELECTED}>User-selected interval</option>
                  <option value={FREQUENCY_MODES.AUTO_ADAPT}>Auto-adapt from flow rate</option>
                </select>
              </label>

              {!isAutoAdaptMode && (
                <>
                  <label className="settings-label">
                    <span>
                      Acquisition interval (minutes){" "}
                      <InfoTooltip
                        text="Fixed minutes between readings while this mode is active. If unset, 15 minutes is used (typical for steady or slow flow)."
                        label="User interval help"
                      />
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      className="settings-input"
                      value={dataCollection.defaultIntervalMinutes ?? 15}
                      onChange={(e) => updateDataCollection("defaultIntervalMinutes", e.target.value)}
                      aria-label="User-selected data collection interval in minutes"
                    />
                  </label>
                  <label className="settings-label">
                    <span>Minimum interval (minutes) <InfoTooltip text="Must be ≤ max interval" label="Min interval help" /></span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      className="settings-input"
                      value={dataCollection.minIntervalMinutes ?? 1}
                      onChange={(e) => updateDataCollection("minIntervalMinutes", e.target.value)}
                      aria-label="Minimum sampling interval in minutes"
                    />
                  </label>
                  <label className="settings-label">
                    <span>Maximum interval (minutes) <InfoTooltip text="Must be ≥ min interval" label="Max interval help" /></span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      className="settings-input"
                      value={dataCollection.maxIntervalMinutes ?? 15}
                      onChange={(e) => updateDataCollection("maxIntervalMinutes", e.target.value)}
                      aria-label="Maximum sampling interval in minutes"
                    />
                  </label>
                </>
              )}

              {isAutoAdaptMode && (
                <>
                  <label className="settings-label">
                    <span>
                      Simulated flow rate{" "}
                      <InfoTooltip
                        text="Hard-coded flow value for testing until a physical flow sensor is available. Use the same units as the slow/fast reference values below (e.g. m³/s)."
                        label="Simulated flow help"
                      />
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="settings-input"
                      value={dataCollection.simulatedFlowRate ?? DEFAULT_DATA_COLLECTION.simulatedFlowRate}
                      onChange={(e) => updateDataCollectionFloat("simulatedFlowRate", e.target.value)}
                      aria-label="Simulated river flow rate for auto-adapt"
                    />
                  </label>
                  <label className="settings-label">
                    <span>
                      Flow at slow condition (→ 15 min){" "}
                      <InfoTooltip
                        text="At or below this flow, acquisition uses the longest interval (15 minutes)."
                        label="Slow flow mapping help"
                      />
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="settings-input"
                      value={dataCollection.flowRateAtSlowCondition ?? DEFAULT_DATA_COLLECTION.flowRateAtSlowCondition}
                      onChange={(e) => updateDataCollectionFloat("flowRateAtSlowCondition", e.target.value)}
                      aria-label="Flow rate mapped to 15 minute interval"
                    />
                  </label>
                  <label className="settings-label">
                    <span>
                      Flow at fast condition (→ 1 min){" "}
                      <InfoTooltip
                        text="At or above this flow, acquisition uses the shortest interval (1 minute). Must be greater than the slow-condition value."
                        label="Fast flow mapping help"
                      />
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="settings-input"
                      value={dataCollection.flowRateAtFastCondition ?? DEFAULT_DATA_COLLECTION.flowRateAtFastCondition}
                      onChange={(e) => updateDataCollectionFloat("flowRateAtFastCondition", e.target.value)}
                      aria-label="Flow rate mapped to 1 minute interval"
                    />
                  </label>
                  <p className="settings-acquisition-preview" role="status">
                    <strong>Effective acquisition interval:</strong>{" "}
                    {effectiveAutoAcquisitionMinutes} minute{effectiveAutoAcquisitionMinutes === 1 ? "" : "s"}
                    {flowMappingInvalid ? (
                      <span className="settings-acquisition-preview__warn">
                        {" "}
                        — set fast condition &gt; slow condition for linear mapping.
                      </span>
                    ) : null}
                  </p>
                </>
              )}

              <label className="settings-label">
                <span>Max readings to load <InfoTooltip text="How many recent readings to fetch at once (100–2000). Higher values show more history but may load slower." label="Readings limit help" /></span>
                <input
                  type="number"
                  min={100}
                  max={2000}
                  className="settings-input"
                  value={dataCollection.readingsLimit ?? 500}
                  onChange={(e) => updateDataCollection("readingsLimit", e.target.value)}
                  aria-label="Maximum readings to load"
                />
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
        {/* Email Notifications */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">
              Email Notifications
              <InfoTooltip text="Receive email notifications when alerts are triggered. Requires EmailJS to be configured in the system." label="Email notifications help" />
            </h2>
          </div>
          <div className="card__body">
            <div className="settings-option-row">
              <span className="settings-option-label">Enable email alerts</span>
              <label className="settings-toggle-wrap">
                <input
                  type="checkbox"
                  checked={!!notifications.emailEnabled}
                  onChange={(e) => updateNotifications("emailEnabled", e.target.checked)}
                  aria-label="Enable email notifications"
                />
                <span className="settings-toggle" aria-hidden="true" />
              </label>
            </div>
            {notifications.emailEnabled && (
              <div className="settings-option-row" style={{ marginTop: "12px" }}>
                <label className="settings-label" style={{ flex: 1, minWidth: 0 }}>
                  <span>Default notification email</span>
                  <input
                    type="email"
                    className="settings-input"
                    value={notifications.notificationEmail ?? ""}
                    onChange={(e) => updateNotifications("notificationEmail", e.target.value)}
                    placeholder="alerts@example.com"
                    aria-label="Email address for alerts and notifications"
                  />
                </label>
              </div>
            )}
          </div>
        </section>

        {/* Maintenance Schedule */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">
              Maintenance Schedule
              <InfoTooltip text="Get a reminder alert when a monitoring node hasn't been physically serviced or inspected within the chosen time period." label="Maintenance help" />
            </h2>
          </div>
          <div className="card__body">
            <div className="settings-maintenance-options">
              {[
                { label: "2 Weeks", days: 14 },
                { label: "1 Month", days: 30 },
                { label: "2 Months", days: 60 },
                { label: "3 Months", days: 90 },
                { label: "6 Months", days: 180 },
                { label: "Custom", days: null },
              ].map((opt) => {
                const isCustomOption = opt.days === null;
                const isPreset = !isCustomOption;
                const isActive = isPreset
                  ? maintenance.intervalDays === opt.days
                  : ![14, 30, 60, 90, 180].includes(maintenance.intervalDays);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    className={`settings-maintenance-chip${isActive ? " settings-maintenance-chip--active" : ""}`}
                    onClick={() => {
                      if (isPreset) updateMaintenance("intervalDays", opt.days);
                    }}
                    aria-pressed={isActive}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div className="settings-maintenance-custom">
              <label className="settings-label" style={{ maxWidth: 260 }}>
                <span>Custom interval (days)</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="settings-input"
                  value={maintenance.intervalDays}
                  onChange={(e) => updateMaintenance("intervalDays", e.target.value)}
                  aria-label="Maintenance interval in days"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Theme */}
        <section className="settings-section card">
          <div className="card__header">
            <h2 className="card__title">Theme</h2>
          </div>
          <div className="card__body">
            <div className="settings-option-row">
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
                <button
                  type="button"
                  className={`settings-theme-btn ${theme === "system" ? "settings-theme-btn--active" : ""}`}
                  onClick={() => setTheme("system")}
                  aria-pressed={theme === "system"}
                  aria-label="Follow system"
                >
                  System
                </button>
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
