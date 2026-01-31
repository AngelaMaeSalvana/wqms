/**
 * Build alerts for all nodes: threshold breaches, node status (needs fixing),
 * maintenance due, etc.
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
 * Build alerts for all nodes: threshold breaches (from real readings only), node status, maintenance.
 * @param {Array} nodes - List of nodes
 * @param {Object} [readingsByNode] - Optional { nodeId: { temperature, pH, turbidity, dissolvedOxygen, nh3, ... } } from MQTT/API. If missing or no reading for a node, threshold alerts are skipped for that node.
 */
export function buildAlertsForAllNodes(nodes = [], readingsByNode = {}) {
  const thresholds = getThresholds();
  const alerts = [];
  let id = 0;
  const now = Date.now();

  for (const node of nodes) {
    const nodeName = node.name || node.id || "Unknown node";
    const nodeId = node.id;
    const readings = readingsByNode && readingsByNode[nodeId];

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

    if (readings && readings.temperature != null && (readings.temperature < thresholds.temperatureMin || readings.temperature > thresholds.temperatureMax)) {
      const which = readings.temperature < thresholds.temperatureMin ? "below minimum" : "above maximum";
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "threshold",
        title: "Temperature out of range",
        detail: `Temperature at ${nodeName} is ${readings.temperature}°C (${which}: ${readings.temperature < thresholds.temperatureMin ? thresholds.temperatureMin : thresholds.temperatureMax}°C).`,
        severity: "high",
        parameter: "temperature",
        value: readings.temperature,
        thresholdMin: thresholds.temperatureMin,
        thresholdMax: thresholds.temperatureMax,
        timestamp: now,
        createdAt: new Date(now).toISOString(),
      });
    }

    if (readings && readings.pH != null && (readings.pH < thresholds.pHMin || readings.pH > thresholds.pHMax)) {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "threshold",
        title: "pH out of range",
        detail: `pH at ${nodeName} is ${readings.pH} (allowed: ${thresholds.pHMin}–${thresholds.pHMax}).`,
        severity: "high",
        parameter: "pH",
        value: readings.pH,
        thresholdMin: thresholds.pHMin,
        thresholdMax: thresholds.pHMax,
        timestamp: now,
        createdAt: new Date(now).toISOString(),
      });
    }

    if (readings && readings.turbidity != null && readings.turbidity > thresholds.turbidityMax) {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "threshold",
        title: "High turbidity",
        detail: `Turbidity at ${nodeName} is ${readings.turbidity} NTU (max: ${thresholds.turbidityMax} NTU).`,
        severity: "high",
        parameter: "turbidity",
        value: readings.turbidity,
        thresholdMax: thresholds.turbidityMax,
        timestamp: now,
        createdAt: new Date(now).toISOString(),
      });
    }

    if (readings && readings.dissolvedOxygen != null && readings.dissolvedOxygen < thresholds.dissolvedOxygenMin) {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "threshold",
        title: "Low dissolved oxygen",
        detail: `Dissolved O₂ at ${nodeName} is ${readings.dissolvedOxygen} mg/L (min: ${thresholds.dissolvedOxygenMin} mg/L).`,
        severity: "high",
        parameter: "dissolvedOxygen",
        value: readings.dissolvedOxygen,
        thresholdMin: thresholds.dissolvedOxygenMin,
        timestamp: now,
        createdAt: new Date(now).toISOString(),
      });
    }

    if (readings && readings.nh3 != null && readings.nh3 > thresholds.nh3Max) {
      alerts.push({
        id: `alert-${++id}`,
        nodeId,
        nodeName,
        type: "threshold",
        title: "NH₃ above threshold",
        detail: `NH₃ at ${nodeName} is ${readings.nh3} mg/L (max: ${thresholds.nh3Max} mg/L).`,
        severity: "medium",
        parameter: "nh3",
        value: readings.nh3,
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
