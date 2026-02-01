/**
 * Build alerts from real data only: threshold breaches (from readingsByNode), node status, maintenance.
 * No mock/dummy readings.
 */

const THRESHOLDS_KEY = "wqms_thresholds";
const DEFAULT_THRESHOLDS = {
  temperatureMin: 18,
  temperatureMax: 30,
  pHMin: 6.5,
  pHMax: 8.5,
  turbidityMax: 25,
  dissolvedOxygenMin: 4,
  nh3Max: 0.5,
};

function getThresholds() {
  try {
    const s = localStorage.getItem(THRESHOLDS_KEY);
    const parsed = s ? JSON.parse(s) : null;
    return { ...DEFAULT_THRESHOLDS, ...parsed };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

/**
 * Build alerts for nodes. Threshold alerts use only real readings from readingsByNode (MQTT/API/Supabase).
 * @param {Array} nodes - List of nodes
 * @param {Object} [readingsByNode] - Optional { [nodeId]: { temperature, pH, turbidity, dissolvedOxygen, nh3, ... } } from MQTT or API
 */
export function buildAlertsForAllNodes(nodes = [], readingsByNode = {}) {
  const thresholds = getThresholds();
  const alerts = [];
  let id = 0;
  const now = Date.now();

  for (const node of nodes) {
    const nodeName = node.name || node.id || "Unknown node";
    const nodeId = node.id;
    const readings = readingsByNode[nodeId] || null;

    if (node.status === "offline") {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "node",
        title: "Node offline",
        detail: `${nodeName} is offline and may need attention. Check connectivity and power.`,
        severity: "high",
        timestamp: now - 3600000,
        createdAt: new Date(now - 3600000).toISOString(),
      });
    }

    if (node.status === "testing") {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "node",
        title: "Node in testing",
        detail: `${nodeName} is in testing mode. Verify sensor readings before relying on data.`,
        severity: "medium",
        timestamp: now - 1800000,
        createdAt: new Date(now - 1800000).toISOString(),
      });
    }

    if (!readings) continue;

    const temp = readings.temperature ?? readings.temp;
    if (temp != null && (temp < thresholds.temperatureMin || temp > thresholds.temperatureMax)) {
      const which = temp < thresholds.temperatureMin ? "below minimum" : "above maximum";
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "threshold",
        title: "Temperature out of range",
        detail: `Temperature at ${nodeName} is ${temp}°C (${which}: ${temp < thresholds.temperatureMin ? thresholds.temperatureMin : thresholds.temperatureMax}°C).`,
        severity: "high",
        parameter: "temperature",
        value: temp,
        thresholdMin: thresholds.temperatureMin,
        thresholdMax: thresholds.temperatureMax,
        timestamp: now,
        createdAt: new Date(now).toISOString(),
      });
    }

    const ph = readings.pH ?? readings.ph;
    if (ph != null && (ph < thresholds.pHMin || ph > thresholds.pHMax)) {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "threshold",
        title: "pH out of range",
        detail: `pH at ${nodeName} is ${ph} (allowed: ${thresholds.pHMin}–${thresholds.pHMax}).`,
        severity: "high",
        parameter: "pH",
        value: ph,
        thresholdMin: thresholds.pHMin,
        thresholdMax: thresholds.pHMax,
        timestamp: now,
        createdAt: new Date(now).toISOString(),
      });
    }

    const turbidity = readings.turbidity ?? readings.turb;
    if (turbidity != null && turbidity > thresholds.turbidityMax) {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "threshold",
        title: "High turbidity",
        detail: `Turbidity at ${nodeName} is ${turbidity} NTU (max: ${thresholds.turbidityMax} NTU).`,
        severity: "high",
        parameter: "turbidity",
        value: turbidity,
        thresholdMax: thresholds.turbidityMax,
        timestamp: now,
        createdAt: new Date(now).toISOString(),
      });
    }

    const doVal = readings.dissolvedOxygen ?? readings.dissolved_oxygen ?? readings.do ?? readings.DO;
    if (doVal != null && doVal < thresholds.dissolvedOxygenMin) {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "threshold",
        title: "Low dissolved oxygen",
        detail: `Dissolved O₂ at ${nodeName} is ${doVal} mg/L (min: ${thresholds.dissolvedOxygenMin} mg/L).`,
        severity: "high",
        parameter: "dissolvedOxygen",
        value: doVal,
        thresholdMin: thresholds.dissolvedOxygenMin,
        timestamp: now,
        createdAt: new Date(now).toISOString(),
      });
    }

    const nh3 = readings.nh3 ?? readings.NH3;
    if (nh3 != null && nh3 > thresholds.nh3Max) {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "threshold",
        title: "NH₃ above threshold",
        detail: `NH₃ at ${nodeName} is ${nh3} mg/L (max: ${thresholds.nh3Max} mg/L).`,
        severity: "medium",
        parameter: "nh3",
        value: nh3,
        thresholdMax: thresholds.nh3Max,
        timestamp: now,
        createdAt: new Date(now).toISOString(),
      });
    }

    const lastMaintenance = node.lastMaintenance ? new Date(node.lastMaintenance).getTime() : null;
    const daysSinceMaintenance = lastMaintenance ? (now - lastMaintenance) / (24 * 60 * 60 * 1000) : 35;
    if (daysSinceMaintenance >= 30) {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "maintenance",
        title: "Maintenance due",
        detail: `${nodeName} has not had maintenance in over 30 days. Schedule calibration and sensor check.`,
        severity: "medium",
        timestamp: now - 86400000,
        createdAt: new Date(now - 86400000).toISOString(),
      });
    }
  }

  return alerts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export { getThresholds };
