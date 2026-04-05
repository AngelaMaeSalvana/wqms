import { useState, useCallback } from "react";
import api from "../services/api";
import { updateNodeLastSensorTest, isSupabaseEnabled } from "../services/supabaseService";
import { displayReading } from "../utils/calibration";

/**
 * A reading is considered "live" if it arrived within this window.
 * Must be >= the node's normal transmission interval so a healthy node
 * always passes. 30 minutes is a safe default.
 */
const SENSOR_FRESH_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Build sensor status from a latest reading row.
 *
 * Three possible per-sensor outcomes:
 *   "pass"  — fresh reading, field has a value
 *   "fail"  — fresh reading, field is null/blank → sensor not functional
 *   "stale" — reading is older than SENSOR_FRESH_THRESHOLD_MS (or missing)
 *             → node is not transmitting; cannot determine sensor health
 *
 * Node-level status:
 *   "success" — all sensors pass
 *   "warning" — some sensors fail (but reading is fresh)
 *   "offline" — reading is stale or missing entirely
 *   "error"   — multiple sensors fail on a fresh reading
 */
function buildSensorStatusFromReading(nodeId, reading) {
  const r = reading || {};

  // ── Freshness check ───────────────────────────────────────────────────────
  const ts = r.timestamp ?? r.created_at ?? null;
  const ageMs = ts ? Date.now() - new Date(ts).getTime() : Infinity;
  const isStale = ageMs > SENSOR_FRESH_THRESHOLD_MS;

  // ── Sensor values ─────────────────────────────────────────────────────────
  const temp  = r.temperature ?? null;
  const turb  = r.turbidity ?? null;
  const ph    = r.pH ?? r.ph ?? null;
  const doVal = r.dissolved_oxygen ?? r.dissolvedOxygen ?? r.do ?? r.DO ?? null;

  const sensorDefs = [
    { name: "Temperature Sensor",      raw: temp,  fmt: (v) => `${Number(v).toFixed(1)}°C` },
    { name: "Turbidity Sensor",        raw: turb,  fmt: (v) => `${Number(v).toFixed(1)} NTU` },
    { name: "pH Sensor",               raw: ph,    fmt: (v) => `${Number(v).toFixed(1)}` },
    { name: "Dissolved Oxygen Sensor", raw: doVal, fmt: (v) => `${Number(v).toFixed(1)} mg/L` },
  ];

  const sensors = sensorDefs.map(({ name, raw, fmt }) => {
    if (isStale) {
      return { name, status: "stale", value: "—", responseTime: "No recent data" };
    }
    const hasData = raw != null && !isNaN(Number(raw));
    return {
      name,
      status: hasData ? "pass" : "fail",
      value: hasData ? fmt(raw) : "N/A",
      responseTime: hasData ? "—" : "No data",
    };
  });

  // ── Node-level summary ────────────────────────────────────────────────────
  let status, message;

  if (isStale) {
    status = "offline";
    if (!ts) {
      message = "No data found for this node";
    } else {
      const minutesAgo = Math.round(ageMs / 60000);
      message = `Last reading was ${minutesAgo} minute${minutesAgo !== 1 ? "s" : ""} ago — node may be offline`;
    }
  } else {
    const failCount = sensors.filter((s) => s.status === "fail").length;
    if (failCount === 0) {
      status = "success";
      message = "All sensors are functional";
    } else if (failCount === 1) {
      status = "warning";
      message = "One sensor is not functional";
    } else {
      status = "error";
      message = `${failCount} sensors are not functional`;
    }
  }

  // Human-readable age string shown in the modal subtitle
  let dataAge = null;
  if (ts && !isStale) {
    const mins = Math.round(ageMs / 60000);
    dataAge = mins <= 1 ? "just now" : `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  }

  return {
    nodeId,
    status,
    message,
    timestamp: new Date().toISOString(),
    dataAge,
    isStale,
    sensors,
  };
}

/**
 * Hook for sensor liveness check based on Supabase data.
 *
 * Fetches the latest reading for a node, checks its freshness against
 * SENSOR_FRESH_THRESHOLD_MS, then evaluates each sensor field.
 *
 * - `results`     — the result for the currently-open modal node
 * - `allResults`  — map of { [nodeId]: result } so every checked node
 *                   retains its status (used to keep marker icons after close)
 */
export function useSensorTest() {
  const [results, setResults] = useState(null);
  const [allResults, setAllResults] = useState({});
  const [isOpen, setIsOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const runTest = useCallback(async (nodeId) => {
    if (!nodeId) return;
    setIsTesting(true);
    setIsOpen(true);
    setResults(null);
    try {
      const raw = await api.getLatestReading(nodeId);
      const calibrated = displayReading(raw);
      const result = buildSensorStatusFromReading(nodeId, calibrated);
      setResults(result);
      setAllResults((prev) => ({ ...prev, [nodeId]: result }));
      if (isSupabaseEnabled()) {
        updateNodeLastSensorTest(nodeId, { timestamp: result.timestamp, status: result.status }).catch(() => {});
      }
    } catch (err) {
      const result = {
        nodeId,
        status: "offline",
        message: "Could not fetch sensor data — " + (err?.message || "unknown error"),
        timestamp: new Date().toISOString(),
        dataAge: null,
        isStale: true,
        sensors: [
          "Temperature Sensor",
          "Turbidity Sensor",
          "pH Sensor",
          "Dissolved Oxygen Sensor",
        ].map((name) => ({ name, status: "stale", value: "—", responseTime: "No recent data" })),
      };
      setResults(result);
      setAllResults((prev) => ({ ...prev, [nodeId]: result }));
      if (isSupabaseEnabled()) {
        updateNodeLastSensorTest(nodeId, { timestamp: result.timestamp, status: result.status }).catch(() => {});
      }
    } finally {
      setIsTesting(false);
    }
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return { runTest, results, allResults, isOpen, close, isTesting };
}

export { buildSensorStatusFromReading, SENSOR_FRESH_THRESHOLD_MS };
