import { useState, useCallback } from "react";

const STORAGE_KEY_PREFIX = "sensorTest_";

function getStoredTestResults(nodeId) {
  try {
    const key = `${STORAGE_KEY_PREFIX}${nodeId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const data = JSON.parse(stored);
      const testDate = new Date(data.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      testDate.setHours(0, 0, 0, 0);
      if (testDate.getTime() === today.getTime()) return data.results;
    }
  } catch (e) {
    console.warn("getStoredTestResults", e);
  }
  return null;
}

/** Returns the latest stored sensor test for a node (any date). For reports. */
function getLatestStoredTestForNode(nodeId) {
  try {
    const key = `${STORAGE_KEY_PREFIX}${nodeId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const data = JSON.parse(stored);
      return data.results || null;
    }
  } catch (e) {
    console.warn("getLatestStoredTestForNode", e);
  }
  return null;
}

function storeTestResults(nodeId, results) {
  try {
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${nodeId}`,
      JSON.stringify({ date: new Date().toISOString(), results })
    );
  } catch (e) {
    console.warn("storeTestResults", e);
  }
}

/**
 * Build sensor test result from readings object.
 * readings: { temperature, ph, turbidity, dissolvedOxygen, nh3 } (scalars or null)
 */
function buildSensorTestFromReadings(nodeId, readings) {
  const fmt = (v, decimals, unit) =>
    v != null && !isNaN(v) ? `${Number(v).toFixed(decimals)}${unit}` : "N/A";
  const r = readings || {};
  const ph = r.pH ?? r.ph;
  const sensors = [
    { name: "Temperature Sensor", value: fmt(r.temperature, 1, "°C") },
    { name: "Turbidity Sensor", value: fmt(r.turbidity, 1, " NTU") },
    { name: "pH Sensor", value: fmt(ph, 1, "") },
    { name: "Dissolved Oxygen Sensor", value: fmt(r.dissolvedOxygen, 1, " mg/L") },
    { name: "NH₃ Sensor", value: fmt(r.nh3, 2, " mg/L") },
  ].map((sen) => {
    const hasData = sen.value !== "N/A";
    return {
      name: sen.name,
      status: hasData ? "pass" : "fail",
      value: sen.value,
      responseTime: hasData ? "—" : "No data",
    };
  });
  const failCount = sensors.filter((x) => x.status === "fail").length;
  let status = "success";
  let message = "Sensor test completed successfully";
  if (failCount === sensors.length) {
    status = "error";
    message = "No sensor data available.";
  } else if (failCount >= 2) {
    status = "error";
    message = `${failCount} sensors have no data`;
  } else if (failCount === 1) {
    status = "warning";
    message = "Sensor test completed with warnings - some data unavailable";
  }
  return { nodeId, status, message, timestamp: new Date().toISOString(), sensors };
}

/**
 * Hook for sensor test: storage, modal state, and run test.
 * @param { (nodeId: string) => { temperature?, ph?, turbidity?, dissolvedOxygen?, nh3? } } getReadingsForNode - returns current readings for a node (scalars)
 * @returns { runTest(nodeId, forceRun?, readingsOverride?), results, isOpen, close, isTesting }
 */
export function useSensorTest(getReadingsForNode) {
  const [results, setResults] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const runTest = useCallback(
    (nodeId, forceRun = false, readingsOverride = null) => {
      if (!nodeId) return;
      if (readingsOverride == null && !forceRun) {
        const stored = getStoredTestResults(nodeId);
        if (stored) {
          setResults(stored);
          setIsOpen(true);
          setIsTesting(false);
          return;
        }
      }
      setIsTesting(true);
      setIsOpen(true);
      const delay = readingsOverride != null ? 0 : 500;
      setTimeout(() => {
        const readings =
          readingsOverride != null
            ? readingsOverride
            : (getReadingsForNode ? getReadingsForNode(nodeId) : {});
        const result = buildSensorTestFromReadings(nodeId, readings);
        setResults(result);
        storeTestResults(nodeId, result);
        setIsTesting(false);
      }, delay);
    },
    [getReadingsForNode]
  );

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return { runTest, results, isOpen, close, isTesting };
}

export { getStoredTestResults, getLatestStoredTestForNode, storeTestResults, buildSensorTestFromReadings };
