/**
 * Data acquisition interval: user-selected fixed interval vs auto-adapt from flow rate.
 * Auto-adapt uses linear mapping from [flow at slow river → 15 min] to [flow at fast river → 1 min].
 * Flow sensor is not wired yet; simulated flow is stored in settings for testing.
 */
import { loadFromStorage, SETTINGS_KEYS } from "./settingsStorage";

export const FREQUENCY_MODES = {
  USER_SELECTED: "user_selected",
  AUTO_ADAPT: "auto_adapt",
};

export const DEFAULT_DATA_COLLECTION = {
  frequencyMode: FREQUENCY_MODES.USER_SELECTED,
  /** User interval (1–120 min); merged when key missing from storage so Save/MQTT always has a valid value */
  defaultIntervalMinutes: 15,
  readingsLimit: 500,
  /** Simulated river flow (same unit as slow/fast mapping); editable until hardware exists */
  simulatedFlowRate: 1.5,
  /** Flow at or below this → longest interval (15 min) */
  flowRateAtSlowCondition: 0.5,
  /** Flow at or above this → shortest interval (1 min) */
  flowRateAtFastCondition: 5,
};

/**
 * @param {Record<string, unknown>} [stored]
 * @returns {typeof DEFAULT_DATA_COLLECTION & Record<string, unknown>}
 */
export function mergeDataCollection(stored) {
  return {
    ...DEFAULT_DATA_COLLECTION,
    ...(stored && typeof stored === "object" ? stored : {}),
  };
}

/**
 * @param {Record<string, unknown>} [stored] partial or full object; if omitted, reads localStorage
 */
export function getDataCollectionSettings(stored) {
  if (stored !== undefined && stored !== null) {
    return mergeDataCollection(stored);
  }
  return mergeDataCollection(loadFromStorage(SETTINGS_KEYS.dataCollection, {}));
}

/**
 * Map flow to acquisition interval (minutes). Low flow → 15 min, high flow → 1 min.
 * @returns {number} integer minutes in [1, 15]
 */
export function computeAutoAdaptIntervalMinutes(flow, flowSlow, flowFast) {
  const f = Number(flow);
  const slow = Number(flowSlow);
  const fast = Number(flowFast);
  if (!Number.isFinite(f)) return 15;
  if (!Number.isFinite(slow) || !Number.isFinite(fast) || fast <= slow) return 15;
  if (f <= slow) return 15;
  if (f >= fast) return 1;
  const t = (f - slow) / (fast - slow);
  const mins = 15 - t * 14;
  return Math.round(Math.min(15, Math.max(1, mins)));
}

/**
 * Effective interval for the next acquisition cycle (minutes).
 * User mode: minutes from settings only; null if unset or invalid.
 * Auto mode: linear map from simulated flow to [1, 15] minutes.
 * @returns {number|null}
 */
export function getEffectiveAcquisitionIntervalMinutes(partial) {
  const dc = partial !== undefined ? mergeDataCollection(partial) : getDataCollectionSettings();
  const mode =
    dc.frequencyMode === FREQUENCY_MODES.AUTO_ADAPT
      ? FREQUENCY_MODES.AUTO_ADAPT
      : FREQUENCY_MODES.USER_SELECTED;

  if (mode === FREQUENCY_MODES.USER_SELECTED) {
    const v = parseInt(String(dc.defaultIntervalMinutes), 10);
    if (Number.isFinite(v) && v >= 1 && v <= 120) return v;
    return null;
  }

  return computeAutoAdaptIntervalMinutes(
    dc.simulatedFlowRate,
    dc.flowRateAtSlowCondition,
    dc.flowRateAtFastCondition
  );
}

const ACQ_PUBLISH_FP_KEY = "wqms_acq_publish_fp";

/**
 * Body for POST /api/acquisition-config — derived from saved data collection (same rules as Settings Save).
 * @param {Record<string, unknown>} [partial]
 * @returns {{ frequency_mode: 'user_selected' | 'auto_adapt', interval_minutes: number } | null} null if user mode and interval not set in settings
 */
export function getAcquisitionPublishPayload(partial) {
  const dc = mergeDataCollection(partial);
  const fm =
    (dc.frequencyMode ?? FREQUENCY_MODES.USER_SELECTED) === FREQUENCY_MODES.AUTO_ADAPT
      ? "auto_adapt"
      : "user_selected";
  if (fm === "auto_adapt") {
    return {
      frequency_mode: "auto_adapt",
      interval_minutes: getEffectiveAcquisitionIntervalMinutes(dc),
    };
  }
  const v = parseInt(String(dc.defaultIntervalMinutes), 10);
  if (!Number.isFinite(v) || v < 1 || v > 120) return null;
  return { frequency_mode: "user_selected", interval_minutes: v };
}

/** Call after a successful publish so hydrate-on-load does not duplicate the same MQTT message. */
export function rememberAcquisitionPublishFingerprint(payload) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ACQ_PUBLISH_FP_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** @returns {boolean} true if payload matches last remembered publish (same tab session). */
export function isAcquisitionPublishFingerprintUnchanged(payload) {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(ACQ_PUBLISH_FP_KEY) === JSON.stringify(payload);
  } catch {
    return false;
  }
}
