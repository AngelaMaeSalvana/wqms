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
  defaultIntervalMinutes: 15,
  minIntervalMinutes: 1,
  maxIntervalMinutes: 15,
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
 * User mode: user-defined minutes, default 15 if missing/invalid.
 * Auto mode: linear map from simulated flow to [1, 15] minutes.
 */
export function getEffectiveAcquisitionIntervalMinutes(partial) {
  const dc = partial !== undefined ? mergeDataCollection(partial) : getDataCollectionSettings();
  const mode =
    dc.frequencyMode === FREQUENCY_MODES.AUTO_ADAPT
      ? FREQUENCY_MODES.AUTO_ADAPT
      : FREQUENCY_MODES.USER_SELECTED;

  if (mode === FREQUENCY_MODES.USER_SELECTED) {
    const v = parseInt(String(dc.defaultIntervalMinutes), 10);
    if (Number.isFinite(v) && v >= 1) return Math.min(120, v);
    return 15;
  }

  return computeAutoAdaptIntervalMinutes(
    dc.simulatedFlowRate,
    dc.flowRateAtSlowCondition,
    dc.flowRateAtFastCondition
  );
}
