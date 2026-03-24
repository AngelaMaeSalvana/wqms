/**
 * 3-Layer Alert System
 *
 * Layer 1 — Threshold Deviation (percentage-based severity)
 *   Computes how far a value is from its configured threshold as a %.
 *   Within 5% of limit → LOW (early warning)
 *   0–10% beyond limit → MEDIUM
 *   >10% beyond limit  → HIGH
 *
 * Layer 2 — Persistence Escalation (threshold alert title severity)
 *   Consecutive violations per node+parameter in localStorage.
 *   1st violation → LOW, 2nd → MEDIUM, 3+ → HIGH (not merged with Layer 1 % in the label).
 *   Normal/safe reading → reset counter; next breach starts again at LOW.
 *   If the previous reading was normal but the latest breaches, counter resets to 1 (all-clear → low-do).
 *   pH uses hysteresis — “normal” only after pH returns within the hysteresis band.
 *
 * Layer 3 — WQI Escalation
 *   WQI ≥ 80           → no escalation
 *   WQI 70–79          → floor at LOW
 *   WQI 50–69          → floor at MEDIUM
 *   WQI < 50           → force HIGH
 *   MEDIUM + WQI < 60  → upgrade to HIGH
 *   2+ MEDIUM params   → system-level HIGH
 *   WQI drops > 15 pts → HIGH
 */
import { getNH3FromReading, formatNH3 } from './nh3Calculator';
import { voltageToPercentage, isLowBatteryWarning } from './batteryUtils';
import { getMaintenanceSettings, loadFromStorage } from './settingsStorage';
import { calculateWQI } from './wqiCalculator';

const THRESHOLDS_KEY = 'wqms_thresholds';
const ALERT_LOGIC_KEY = 'wqms_alert_logic';
const PH_STATE_KEY = 'wqms_ph_alert_state';
const PERSISTENCE_KEY = 'wqms_alert_persistence';
const PREV_WQI_KEY = 'wqms_prev_wqi_by_node';

const DEFAULT_THRESHOLDS = {
  temperatureMin: 18,
  temperatureMax: 30,
  pHMin: 6.5,
  pHMax: 8.5,
  turbidityMax: 25,
  dissolvedOxygenMin: 4,
  nh3Max: 0.5,
};

export const DEFAULT_ALERT_LOGIC = {
  pHHysteresisOffset: 0.2,
  nh3SlopeLimit: 0.15,
};

// ── Storage helpers ────────────────────────────────────────────────────────────

function loadPhState() {
  try {
    const s = localStorage.getItem(PH_STATE_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

function savePhState(state) {
  try { localStorage.setItem(PH_STATE_KEY, JSON.stringify(state)); } catch { /* non-fatal */ }
}

function loadPersistence() {
  try {
    const s = localStorage.getItem(PERSISTENCE_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

function savePersistence(state) {
  try { localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(state)); } catch { /* non-fatal */ }
}

function loadPrevWqi() {
  try {
    const s = localStorage.getItem(PREV_WQI_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

function savePrevWqi(state) {
  try { localStorage.setItem(PREV_WQI_KEY, JSON.stringify(state)); } catch { /* non-fatal */ }
}

function getThresholds() {
  const parsed = loadFromStorage(THRESHOLDS_KEY, {});
  return { ...DEFAULT_THRESHOLDS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
}

export function getAlertLogic() {
  try {
    const s = localStorage.getItem(ALERT_LOGIC_KEY);
    const parsed = s ? JSON.parse(s) : null;
    return { ...DEFAULT_ALERT_LOGIC, ...parsed };
  } catch {
    return { ...DEFAULT_ALERT_LOGIC };
  }
}

export function saveAlertLogic(values) {
  try {
    const current = getAlertLogic();
    localStorage.setItem(ALERT_LOGIC_KEY, JSON.stringify({ ...current, ...values }));
  } catch { /* non-fatal */ }
}

/**
 * Clear browser-side state used by the 3-layer alert system so isolated tests (e.g. Scenario Evaluator)
 * are not affected by prior dashboard visits or earlier runs.
 *
 * Removes: consecutive-violation counters (persistence), previous WQI per node (rapid-drop logic),
 * and pH hysteresis latch state. Does not change thresholds/settings or Supabase alerts.
 */
export function resetAlertPersistenceForTests() {
  try {
    localStorage.removeItem(PERSISTENCE_KEY);
    localStorage.removeItem(PREV_WQI_KEY);
    localStorage.removeItem(PH_STATE_KEY);
  } catch {
    /* non-fatal */
  }
}

// ── Layer 1: Deviation-based severity ─────────────────────────────────────────

/**
 * Compute severity from deviation % for a "max" type parameter (e.g. NH₃, turbidity).
 * deviation % = (value - threshold) / threshold × 100
 */
function deviationSeverityMax(value, threshold) {
  if (threshold === 0) return 'high';
  const pct = ((value - threshold) / threshold) * 100;
  if (pct <= 0) return null;           // within limit
  if (pct <= 5) return 'low';          // within 5% of limit — early warning
  if (pct <= 10) return 'medium';      // 0–10% beyond
  return 'high';                       // >10% beyond
}

/**
 * Compute severity from deviation % for a "min" type parameter (e.g. DO, temperature min).
 * deviation % = (threshold - value) / threshold × 100
 */
function deviationSeverityMin(value, threshold) {
  if (threshold === 0) return 'high';
  const pct = ((threshold - value) / threshold) * 100;
  if (pct <= 0) return null;
  if (pct <= 5) return 'low';
  if (pct <= 10) return 'medium';
  return 'high';
}

/**
 * For range parameters (temperature, pH) pick the breached side and compute severity.
 * Returns { severity, which: 'low'|'high' } or null.
 */
function deviationSeverityRange(value, min, max) {
  if (value < min) {
    const sev = deviationSeverityMin(value, min);
    return sev ? { severity: sev, which: 'low' } : null;
  }
  if (value > max) {
    const sev = deviationSeverityMax(value, max);
    return sev ? { severity: sev, which: 'high' } : null;
  }
  return null;
}

// ── Layer 2: Persistence state helpers ────────────────────────────────────────

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
const RANK_SEVERITY = ['', 'low', 'medium', 'high'];

function maxSeverity(a, b) {
  const ra = SEVERITY_RANK[a] ?? 0;
  const rb = SEVERITY_RANK[b] ?? 0;
  return RANK_SEVERITY[Math.max(ra, rb)] || 'low';
}

/**
 * Increment violation count for a node+param key, return escalated severity.
 * Strike ladder only: 1st violation → LOW, 2nd → MEDIUM, 3+ → HIGH.
 * Resets to 0 when readings return to safe range (violated=false).
 * When prevWasNormal, resets first so a normal reading (even if not the “latest” row alone)
 * starts the next breach at strike 1 again (e.g. all-clear then low-do).
 * baseSeverity (Layer 1) is not merged into the label — detail text still shows value vs limit.
 */
function applyPersistence(persistence, key, violated, _baseSeverity, prevWasNormal = false) {
  if (!violated) {
    persistence[key] = 0;
    return null;
  }
  if (prevWasNormal) persistence[key] = 0;
  persistence[key] = (persistence[key] || 0) + 1;
  const count = persistence[key];

  if (count >= 3) return 'high';
  if (count >= 2) return 'medium';
  return 'low';
}

// ── Layer 3: WQI escalation ────────────────────────────────────────────────────

/**
 * Apply WQI-based escalation rules to a list of parameter alerts for one node.
 * Mutates each alert's severity in-place and may add a system-level alert.
 *
 * @param {Array}  paramAlerts - Alerts already built for this node (threshold type only)
 * @param {number|null} wqi   - Current WQI for this node
 * @param {number|null} prevWqi - Previous WQI for this node
 * @param {string} nodeId
 * @param {string} nodeName
 * @param {number} now        - timestamp ms
 * @returns {Array} - Updated alerts (may include extra system-level alert)
 */
function applyWqiEscalation(paramAlerts, wqi, prevWqi, nodeId, nodeName, now) {
  if (wqi == null) return paramAlerts;

  const result = [...paramAlerts];

  // Rule: WQI floor — raise severity of ALL param alerts to meet minimum
  let wqiFloor = null;
  if (wqi < 50) wqiFloor = 'high';
  else if (wqi < 70) wqiFloor = 'medium';
  else if (wqi < 80) wqiFloor = 'low';

  if (wqiFloor) {
    result.forEach((a) => {
      if (a.type === 'threshold') {
        a.severity = maxSeverity(a.severity, wqiFloor);
      }
    });
  }

  // Rule: MEDIUM param + WQI < 60 → upgrade to HIGH
  if (wqi < 60) {
    result.forEach((a) => {
      if (a.type === 'threshold' && a.severity === 'medium') {
        a.severity = 'high';
        a.wqiEscalated = true;
      }
    });
  }

  // Rule: 2+ MEDIUM (or higher) params → system-level HIGH
  const degradedAlerts = result.filter(
    (a) => a.type === 'threshold' && (a.severity === 'medium' || a.severity === 'high')
  );
  const mediumOrHighCount = degradedAlerts.length;
  if (mediumOrHighCount >= 2) {
    const affectedParameters = degradedAlerts
      .map((a) => a.parameter)
      .filter(Boolean)
      .filter((p) => p !== 'system');
    result.push({
      id: `wqi-multi-param-${nodeId}`,
      nodeId,
      nodeName,
      type: 'threshold',
      title: 'Multiple parameters degraded',
      detail: `${mediumOrHighCount} parameters are at MEDIUM or HIGH severity at ${nodeName}. System-level water quality risk detected (WQI: ${wqi}).`,
      severity: 'high',
      parameter: 'system',
      affectedParameters,
      wqiEscalated: true,
      timestamp: now,
      createdAt: new Date(now).toISOString(),
    });
  }

  // Rule: WQI drops > 15 points in one interval → HIGH alert
  if (prevWqi != null && prevWqi - wqi > 15) {
    result.push({
      id: `wqi-rapid-drop-${nodeId}`,
      nodeId,
      nodeName,
      type: 'threshold',
      title: 'WQI rapid drop',
      detail: `WQI at ${nodeName} dropped ${(prevWqi - wqi).toFixed(0)} points (${prevWqi} → ${wqi}) in one interval — possible sudden contamination or sensor fault.`,
      severity: 'high',
      parameter: 'system',
      wqiEscalated: true,
      timestamp: now,
      createdAt: new Date(now).toISOString(),
    });
  }

  return result;
}

// ── Detail text helpers ────────────────────────────────────────────────────────

function persistenceNote(count) {
  if (count >= 3) return ` Sustained for ${count} consecutive readings.`;
  if (count === 2) return ' Persisted for 2 consecutive readings.';
  return '';
}

function severityLabel(sev) {
  return sev ? sev.toUpperCase() : '';
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Build alerts for all nodes using the 3-layer system.
 *
 * @param {Array}  nodes              - List of node objects.
 * @param {Object} readingsByNode     - { [nodeId]: latestReading }
 * @param {Object} nodeStatuses       - Optional { [nodeId]: 'online' | 'offline' }
 * @param {Object} prevReadingsByNode - Optional { [nodeId]: previousReading }
 */
export function buildAlertsForAllNodes(
  nodes = [],
  readingsByNode = {},
  nodeStatuses = {},
  prevReadingsByNode = {}
) {
  const thresholds = getThresholds();
  const logic = getAlertLogic();
  const phState = loadPhState();
  const persistence = loadPersistence();
  const prevWqiByNode = loadPrevWqi();
  const alerts = [];
  const now = Date.now();

  for (const node of nodes) {
    if (node.active === false) continue;

    const nodeName = node.name || node.id || 'Unknown node';
    const nodeId = node.id;
    const readings = readingsByNode[nodeId] || null;
    const prev = prevReadingsByNode[nodeId] || null;

    // ── Node offline ───────────────────────────────────────────────────────────
    const liveStatus = nodeStatuses[nodeId] ?? node.status ?? 'offline';
    if (liveStatus === 'offline') {
      alerts.push({
        id: `node-offline-${nodeId}`,
        nodeId,
        nodeName,
        type: 'node',
        title: 'Node offline',
        detail: `${nodeName} is offline and may need attention. Check connectivity and power.`,
        severity: 'high',
        timestamp: now - 3600000,
        createdAt: new Date(now - 3600000).toISOString(),
      });
    }

    if (!readings) continue;

    // ── Low battery warning (<15%) ───────────────────────────────────────────
    const batteryVoltage = readings.battery_voltage ?? readings.batteryVoltage ?? null;
    const batteryPctRaw = readings.battery_percentage ?? readings.batteryPercentage ?? null;
    const batteryPct = batteryPctRaw != null && typeof batteryPctRaw === "number" && !isNaN(batteryPctRaw)
      ? Math.round(Math.max(0, Math.min(100, batteryPctRaw)))
      : voltageToPercentage(batteryVoltage);
    if (batteryVoltage != null || batteryPct != null) {
      if (isLowBatteryWarning(batteryPct)) {
        alerts.push({
          id: `low-battery-${nodeId}`,
          nodeId,
          nodeName,
          type: 'battery',
          title: 'Low battery',
          detail: `${nodeName} battery is at ${batteryPct}%. Consider replacing or recharging soon.`,
          severity: batteryPct < 10 ? 'high' : 'medium',
          parameter: 'battery',
          value: batteryPct,
          timestamp: now,
          createdAt: new Date(now).toISOString(),
        });
      }
    }

    // ── Compute WQI for this reading ───────────────────────────────────────────
    const nh3ForWqi = getNH3FromReading(readings);
    const currentWqi = calculateWQI({
      dissolvedOxygen: readings.dissolvedOxygen ?? readings.dissolved_oxygen ?? readings.do ?? readings.DO,
      pH: readings.pH ?? readings.ph,
      nh3: nh3ForWqi,
      turbidity: readings.turbidity ?? readings.turb,
      temperature: readings.temperature ?? readings.temp,
    });
    const prevWqi = prevWqiByNode[nodeId] ?? null;

    // Collect threshold alerts for this node (to be WQI-escalated together)
    const nodeParamAlerts = [];

    // ── Temperature ────────────────────────────────────────────────────────────
    const temp = readings.temperature ?? readings.temp;
    const prevTemp = prev ? (prev.temperature ?? prev.temp) : null;
    const tempKey = `${nodeId}-temperature`;
    if (temp != null) {
      const breach = deviationSeverityRange(temp, thresholds.temperatureMin, thresholds.temperatureMax);
      const prevTempNormal = prevTemp != null && !deviationSeverityRange(prevTemp, thresholds.temperatureMin, thresholds.temperatureMax);
      const sev = applyPersistence(persistence, tempKey, !!breach, breach?.severity || 'low', prevTempNormal);
      if (sev) {
        const which = breach.which === 'low' ? 'below minimum' : 'above maximum';
        const limit = breach.which === 'low' ? thresholds.temperatureMin : thresholds.temperatureMax;
        const count = persistence[tempKey];
        nodeParamAlerts.push({
          id: `threshold-${nodeId}-temperature`,
          nodeId,
          nodeName,
          type: 'threshold',
          title: `Temperature ${which} [${severityLabel(sev)}]`,
          detail: `Temperature at ${nodeName} is ${temp}°C (${which}: ${limit}°C).${persistenceNote(count)}`,
          severity: sev,
          parameter: 'temperature',
          value: temp,
          thresholdMin: thresholds.temperatureMin,
          thresholdMax: thresholds.temperatureMax,
          timestamp: now,
          createdAt: new Date(now).toISOString(),
        });
      }
    } else {
      persistence[tempKey] = 0;
    }

    // ── pH — Hysteresis + deviation severity ───────────────────────────────────
    const ph = readings.pH ?? readings.ph;
    const phKey = `${nodeId}-pH`;
    if (ph != null) {
      const offset = logic.pHHysteresisOffset;
      const currentPhState = phState[nodeId] ?? null;
      let nextPhState = currentPhState;

      if (currentPhState === 'low') {
        if (ph >= thresholds.pHMin + offset) nextPhState = null;
      } else if (currentPhState === 'high') {
        if (ph <= thresholds.pHMax - offset) nextPhState = null;
      } else {
        if (ph < thresholds.pHMin) nextPhState = 'low';
        else if (ph > thresholds.pHMax) nextPhState = 'high';
      }
      if (nextPhState !== currentPhState) phState[nodeId] = nextPhState;

      const phViolated = nextPhState === 'low' || nextPhState === 'high';
      const phBreachSeverity = phViolated
        ? (nextPhState === 'low'
            ? (deviationSeverityMin(ph, thresholds.pHMin) || 'low')
            : (deviationSeverityMax(ph, thresholds.pHMax) || 'low'))
        : 'low';

      const prevPh = prev ? (prev.pH ?? prev.ph) : null;
      const prevPhNormal = prevPh != null && prevPh >= thresholds.pHMin && prevPh <= thresholds.pHMax;
      const sev = applyPersistence(persistence, phKey, phViolated, phBreachSeverity, prevPhNormal);
      if (sev && nextPhState) {
        const count = persistence[phKey];
        const isLow = nextPhState === 'low';
        nodeParamAlerts.push({
          id: `threshold-${nodeId}-pH`,
          nodeId,
          nodeName,
          type: 'threshold',
          title: `pH too ${isLow ? 'low' : 'high'} [${severityLabel(sev)}]`,
          detail: `pH at ${nodeName} is ${ph} (${isLow ? `below minimum: ${thresholds.pHMin}` : `above maximum: ${thresholds.pHMax}`}). Alert clears once pH ${isLow ? `rises above ${(thresholds.pHMin + offset).toFixed(2)}` : `falls below ${(thresholds.pHMax - offset).toFixed(2)}`}.${persistenceNote(count)}`,
          severity: sev,
          parameter: 'pH',
          value: ph,
          thresholdMin: thresholds.pHMin,
          thresholdMax: thresholds.pHMax,
          timestamp: now,
          createdAt: new Date(now).toISOString(),
        });
      }
    } else {
      persistence[phKey] = 0;
    }

    // ── Turbidity — 2-sample moving average + deviation severity ───────────────
    const turbidity = readings.turbidity ?? readings.turb;
    const prevTurbidity = prev ? (prev.turbidity ?? prev.turb) : null;
    const turbAvg = turbidity != null && prevTurbidity != null
      ? (turbidity + prevTurbidity) / 2
      : turbidity;
    const turbKey = `${nodeId}-turbidity`;

    if (turbAvg != null) {
      const baseSev = deviationSeverityMax(turbAvg, thresholds.turbidityMax);
      const prevTurbNormal = prevTurbidity != null && !deviationSeverityMax(prevTurbidity, thresholds.turbidityMax);
      const sev = applyPersistence(persistence, turbKey, !!baseSev, baseSev || 'low', prevTurbNormal);
      if (sev) {
        const usingAvg = prevTurbidity != null;
        const count = persistence[turbKey];
        nodeParamAlerts.push({
          id: `threshold-${nodeId}-turbidity`,
          nodeId,
          nodeName,
          type: 'threshold',
          title: `High turbidity [${severityLabel(sev)}]`,
          detail: `Turbidity at ${nodeName} is ${turbAvg.toFixed(1)} NTU${usingAvg ? ` (2-sample avg: ${prevTurbidity.toFixed(1)} → ${turbidity.toFixed(1)})` : ''} (max: ${thresholds.turbidityMax} NTU).${persistenceNote(count)}`,
          severity: sev,
          parameter: 'turbidity',
          value: turbAvg,
          thresholdMax: thresholds.turbidityMax,
          timestamp: now,
          createdAt: new Date(now).toISOString(),
        });
      }
    } else {
      persistence[turbKey] = 0;
    }

    // ── Dissolved Oxygen — deviation severity + persistence ────────────────────
    const doVal = readings.dissolvedOxygen ?? readings.dissolved_oxygen ?? readings.do ?? readings.DO;
    const prevDoVal = prev ? (prev.dissolvedOxygen ?? prev.dissolved_oxygen ?? prev.do ?? prev.DO) : null;
    const doKey = `${nodeId}-dissolvedOxygen`;

    if (doVal != null) {
      const baseSev = deviationSeverityMin(doVal, thresholds.dissolvedOxygenMin);
      const prevDoNormal = prevDoVal != null && !deviationSeverityMin(prevDoVal, thresholds.dissolvedOxygenMin);
      const sev = applyPersistence(persistence, doKey, !!baseSev, baseSev || 'low', prevDoNormal);
      if (sev) {
        const count = persistence[doKey];
        nodeParamAlerts.push({
          id: `threshold-${nodeId}-dissolvedOxygen`,
          nodeId,
          nodeName,
          type: 'threshold',
          title: `Low dissolved oxygen [${severityLabel(sev)}]`,
          detail: `Dissolved O₂ at ${nodeName} is ${doVal} mg/L${prevDoVal != null ? ` (previous: ${prevDoVal} mg/L)` : ''} — below minimum of ${thresholds.dissolvedOxygenMin} mg/L.${persistenceNote(count)}`,
          severity: sev,
          parameter: 'dissolvedOxygen',
          value: doVal,
          thresholdMin: thresholds.dissolvedOxygenMin,
          timestamp: now,
          createdAt: new Date(now).toISOString(),
        });
      }
    } else {
      persistence[doKey] = 0;
    }

    // ── NH₃ — absolute max + rapid-rise ───────────────────────────────────────
    const nh3 = getNH3FromReading(readings);
    const prevNh3 = prev ? getNH3FromReading(prev) : null;
    const nh3Key = `${nodeId}-nh3`;

    if (nh3 != null) {
      const baseSev = deviationSeverityMax(nh3, thresholds.nh3Max);
      const prevNh3Normal = prevNh3 != null && !deviationSeverityMax(prevNh3, thresholds.nh3Max);
      const sev = applyPersistence(persistence, nh3Key, !!baseSev, baseSev || 'low', prevNh3Normal);
      if (sev) {
        const count = persistence[nh3Key];
        nodeParamAlerts.push({
          id: `threshold-${nodeId}-nh3`,
          nodeId,
          nodeName,
          type: 'threshold',
          title: `NH₃ above threshold [${severityLabel(sev)}]`,
          detail: `NH₃ at ${nodeName} is ${formatNH3(nh3)} mg/L (max: ${thresholds.nh3Max} mg/L).${persistenceNote(count)}`,
          severity: sev,
          parameter: 'nh3',
          value: nh3,
          thresholdMax: thresholds.nh3Max,
          timestamp: now,
          createdAt: new Date(now).toISOString(),
        });
      }
    } else {
      persistence[nh3Key] = 0;
    }

    // NH₃ rapid-rise (slope) — always HIGH regardless of absolute level
    if (nh3 != null && prevNh3 != null) {
      const delta = nh3 - prevNh3;
      if (delta > logic.nh3SlopeLimit) {
        nodeParamAlerts.push({
          id: `threshold-${nodeId}-nh3-slope`,
          nodeId,
          nodeName,
          type: 'threshold',
          title: 'NH₃ rapid rise detected [HIGH]',
          detail: `NH₃ at ${nodeName} rose by ${formatNH3(delta)} mg/L (${formatNH3(prevNh3)} → ${formatNH3(nh3)}) — exceeds slope limit of ${logic.nh3SlopeLimit} mg/L per interval. Possible spill.`,
          severity: 'high',
          parameter: 'nh3',
          value: nh3,
          thresholdMax: thresholds.nh3Max,
          timestamp: now,
          createdAt: new Date(now).toISOString(),
        });
      }
    }

    // ── Layer 3: Apply WQI escalation to all param alerts for this node ────────
    const escalatedAlerts = applyWqiEscalation(
      nodeParamAlerts,
      currentWqi,
      prevWqi,
      nodeId,
      nodeName,
      now
    );
    alerts.push(...escalatedAlerts);

    // Store current WQI as previous for next run
    if (currentWqi != null) prevWqiByNode[nodeId] = currentWqi;

    // ── Maintenance due ────────────────────────────────────────────────────────
    const { intervalDays: maintenanceIntervalDays } = getMaintenanceSettings();
    const lastMaintenance = node.lastMaintenance ? new Date(node.lastMaintenance).getTime() : null;
    const daysSinceMaintenance = lastMaintenance
      ? (now - lastMaintenance) / (24 * 60 * 60 * 1000)
      : maintenanceIntervalDays + 1;
    if (daysSinceMaintenance >= maintenanceIntervalDays) {
      alerts.push({
        id: `maintenance-${nodeId}`,
        nodeId,
        nodeName,
        type: 'maintenance',
        title: 'Maintenance due',
        detail: `${nodeName} has not had maintenance in over ${maintenanceIntervalDays} days. Schedule calibration and sensor check.`,
        severity: 'medium',
        timestamp: now - 86400000,
        createdAt: new Date(now - 86400000).toISOString(),
      });
    }
  }

  // Persist all state after processing all nodes
  savePhState(phState);
  savePersistence(persistence);
  savePrevWqi(prevWqiByNode);

  return alerts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export { getThresholds };
