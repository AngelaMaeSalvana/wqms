import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import NodeSelector from "../components/dashboard/NodeSelector";
import NodeStatus from "../components/dashboard/NodeStatus";
import TodayCard from "../components/dashboard/TodayCard";
import LiveChart from "../components/dashboard/LiveChart";
import WqiCard from "../components/dashboard/WqiCard";
import MiniMapCard from "../components/dashboard/MiniMapCard";
import AlertsSummaryCard from "../components/dashboard/AlertsSummaryCard";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { calculateWQI, getWQIClass } from "../utils/wqiCalculator";
import { buildAlertsForAllNodes } from "../utils/alertsData";
import { exportToJSON, exportToCSV, formatAlertsForExport } from "../utils/exportData";
import { getNodes } from "../utils/nodesStorage";
import "../pages/Map.css";
import "./Dashboard.css";

function formatDateShort(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Dashboard() {
  const [nodes, setNodes] = useState(getNodes);
  const [selectedNodeId, setSelectedNodeId] = useState(() => getNodes()[0]?.id);
  const alerts = useMemo(() => buildAlertsForAllNodes(nodes), [nodes]);

  useEffect(() => {
    const onFocus = () => setNodes(getNodes());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const [isLoadingAlerts] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [isSensorTestModalOpen, setIsSensorTestModalOpen] = useState(false);
  const [sensorTestResults, setSensorTestResults] = useState(null);
  const [isTestingSensor, setIsTestingSensor] = useState(false);
  const autoRefreshIntervalRef = useRef(null);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || nodes[0],
    [nodes, selectedNodeId]
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setLastUpdated(new Date());
    }, 800);
  };

  const handleRefreshRef = useRef(handleRefresh);
  handleRefreshRef.current = handleRefresh;

  useEffect(() => {
    const intervalMs = 30 * 60 * 1000;
    autoRefreshIntervalRef.current = setInterval(() => handleRefreshRef.current(), intervalMs);
    return () => {
      if (autoRefreshIntervalRef.current) clearInterval(autoRefreshIntervalRef.current);
    };
  }, []);

  const handleExportJson = (data) => {
    exportToJSON(formatAlertsForExport(data || alerts), "wqms-alerts");
  };

  const handleExportCsv = (data) => {
    exportToCSV(formatAlertsForExport(data || alerts), "wqms-alerts");
  };

  /** Today's hourly data from 00:00 to current hour. Recomputes when lastUpdated (30 min) or selectedNode changes. */
  const todayData = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const currentHour = now.getHours();
    const nodeId = selectedNode?.id || "";
    const nodeSeed = nodeId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const dateSeed = today.getFullYear() * 372 + today.getMonth() * 31 + today.getDate();

    const labels = [];
    const tempData = [];
    const turbData = [];
    const phData = [];
    const nh3Data = [];
    const flowData = [];
    const doData = [];

    for (let h = 0; h <= currentHour; h++) {
      labels.push(`${String(h).padStart(2, "0")}:00`);
      const seed = dateSeed + nodeSeed * 7 + h * 11;
      const temp = 18 + (seed % 15);
      const turb = 1.5 + (seed % 20) / 10;
      const ph = 6.2 + (seed % 30) / 20;
      const nh3 = (seed % 30) / 100;
      const flow = 8 + (seed % 12);
      const doVal = 4 + (seed % 8);
      tempData.push(temp);
      turbData.push(Math.round(turb * 10) / 10);
      phData.push(Math.round(ph * 10) / 10);
      nh3Data.push(Math.round(nh3 * 100) / 100);
      flowData.push(flow);
      doData.push(Math.round(doVal * 10) / 10);
    }

    return {
      labels,
      datasets: [
        { label: "Temperature °C", data: tempData, borderColor: "#1b9c85", backgroundColor: "rgba(27, 156, 133, 0.1)", fill: true },
        { label: "Turbidity", data: turbData, borderColor: "#d45b5b", backgroundColor: "rgba(212, 91, 91, 0.1)", fill: true },
        { label: "Water pH", data: phData, borderColor: "#f0a500", backgroundColor: "rgba(240, 165, 0, 0.1)", fill: true },
        { label: "NH₃ mg/L", data: nh3Data, borderColor: "#9b59b6", backgroundColor: "rgba(155, 89, 182, 0.1)", fill: true },
        { label: "Flow rate L/min", data: flowData, borderColor: "#3498db", backgroundColor: "rgba(52, 152, 219, 0.1)", fill: true },
        { label: "Dissolved O₂ mg/L", data: doData, borderColor: "#2ecc71", backgroundColor: "rgba(46, 204, 113, 0.1)", fill: true },
      ],
    };
  }, [selectedNode?.id, lastUpdated]);

  const todayStats = useMemo(() => {
    if (!todayData?.datasets?.length) return null;
    const getStats = (arr) => {
      if (!Array.isArray(arr) || arr.length === 0) return { low: null, avg: null, high: null };
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      const sum = arr.reduce((a, b) => a + b, 0);
      const avg = arr.length ? Math.round((sum / arr.length) * 10) / 10 : null;
      return { low: Math.round(min * 10) / 10, avg, high: Math.round(max * 10) / 10 };
    };
    const ds = todayData.datasets;
    return {
      temperature: getStats(ds[0]?.data),
      turbidity: getStats(ds[1]?.data),
      ph: getStats(ds[2]?.data),
      nh3: getStats(ds[3]?.data),
      flowRate: getStats(ds[4]?.data),
      dissolvedOxygen: getStats(ds[5]?.data),
    };
  }, [todayData]);

  /** WQI from today's parameter averages (00:00 to current hour). Uses calculateWQI with avg values. */
  const wqiValue = useMemo(() => {
    if (!todayStats) return null;
    const { temperature, ph, nh3, turbidity, dissolvedOxygen } = todayStats;
    const avgTemp = temperature?.avg;
    const avgPh = ph?.avg;
    const avgNh3 = nh3?.avg;
    const avgTurb = turbidity?.avg;
    const avgDO = dissolvedOxygen?.avg;
    return calculateWQI({
      temperature: avgTemp ?? undefined,
      pH: avgPh ?? undefined,
      nh3: avgNh3 ?? undefined,
      turbidity: avgTurb ?? undefined,
      dissolvedOxygen: avgDO ?? undefined,
    });
  }, [todayStats]);

  const wqiLabel = useMemo(() => {
    if (wqiValue == null) return "—";
    const cls = getWQIClass(wqiValue);
    return cls?.label ?? "—";
  }, [wqiValue]);

  const todayChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "top" } },
    scales: { y: { beginAtZero: true } },
  }), []);

  const getStoredTestResults = useCallback((nodeId) => {
    try {
      const key = `sensorTest_${nodeId}`;
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
  }, []);

  const storeTestResults = useCallback((nodeId, results) => {
    try {
      localStorage.setItem(
        `sensorTest_${nodeId}`,
        JSON.stringify({ date: new Date().toISOString(), results })
      );
    } catch (e) {
      console.warn("storeTestResults", e);
    }
  }, []);

  const generateDummySensorTestResults = useCallback((nodeId) => {
    const getResponseTime = () => `${Math.floor(Math.random() * 70) + 80}ms`;
    const fmt = (v, decimals, unit) =>
      v != null && !isNaN(v) ? `${Number(v).toFixed(decimals)}${unit}` : "N/A";
    const s = todayStats || {};
    const sensors = [
      { name: "Temperature Sensor", value: fmt(s.temperature?.avg, 1, "°C") },
      { name: "Turbidity Sensor", value: fmt(s.turbidity?.avg, 1, " NTU") },
      { name: "pH Sensor", value: fmt(s.ph?.avg, 1, "") },
      { name: "Dissolved Oxygen Sensor", value: fmt(s.dissolvedOxygen?.avg, 1, " mg/L") },
      { name: "NH₃ Sensor", value: fmt(s.nh3?.avg, 2, " mg/L") },
    ].map((sen) => {
      const hasData = sen.value !== "N/A";
      return {
        name: sen.name,
        status: hasData ? "pass" : "fail",
        value: sen.value,
        responseTime: hasData ? getResponseTime() : "Timeout",
      };
    });
    const failCount = sensors.filter((x) => x.status === "fail").length;
    let status = "success";
    let message = "Sensor test completed successfully";
    if (failCount === sensors.length) {
      status = "error";
      message = "All sensors failed - no data available";
    } else if (failCount >= 2) {
      status = "error";
      message = `${failCount} sensors failed - missing data`;
    } else if (failCount === 1) {
      status = "warning";
      message = "Sensor test completed with warnings - some data unavailable";
    }
    return { nodeId, status, message, timestamp: new Date().toISOString(), sensors };
  }, [todayStats]);

  const handleSensorTest = useCallback(
    (nodeId, forceRun = false) => {
      const id = nodeId ?? selectedNode?.id;
      if (!id) return;
      if (!forceRun) {
        const stored = getStoredTestResults(id);
        if (stored) {
          setSensorTestResults(stored);
          setIsSensorTestModalOpen(true);
          setIsTestingSensor(false);
          return;
        }
      }
      setIsTestingSensor(true);
      setIsSensorTestModalOpen(true);
      setTimeout(() => {
        const results = generateDummySensorTestResults(id);
        setSensorTestResults(results);
        storeTestResults(id, results);
        setIsTestingSensor(false);
      }, 2000);
    },
    [selectedNode?.id, getStoredTestResults, generateDummySensorTestResults, storeTestResults]
  );

  return (
    <div className="dash">
      <header className="dash__top">
        <div>
          <h1 className="dash__title">Dashboard</h1>
          <p className="dash__subtitle">Live monitoring for the selected node</p>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="dash__date" />
      </header>

      <div className="dash__controls">
        <NodeSelector
          nodes={nodes}
          value={selectedNodeId}
          onChange={setSelectedNodeId}
        />
        <NodeStatus status={selectedNode?.status} />
      </div>

      <div className="dash__grid">
        <section className="dash__cell dash__cell--today">
          <TodayCard todayStats={todayStats} selectedNode={selectedNode} />
        </section>
        <section className="dash__cell dash__cell--wqi">
          <WqiCard value={wqiValue} label={wqiLabel} />
        </section>
        <section className="dash__cell dash__cell--live">
          <LiveChart todayData={todayData} todayChartOptions={todayChartOptions} />
        </section>
        <section className="dash__cell dash__cell--mini">
          <MiniMapCard
            nodes={nodes}
            selectedNode={selectedNode}
            onTestSensor={handleSensorTest}
            isTestingSensor={isTestingSensor}
            sensorTestResults={sensorTestResults}
          />
        </section>
        <section className="dash__cell dash__cell--alerts">
          <AlertsSummaryCard
            alerts={alerts}
            recentAlerts={alerts.slice(0, 5)}
            isLoadingAlerts={isLoadingAlerts}
            lastUpdated={lastUpdated}
            onExportJson={handleExportJson}
            onExportCsv={handleExportCsv}
            formatDateShort={formatDateShort}
          />
        </section>
      </div>

      {isSensorTestModalOpen && (
        <div
          className="map-modal-overlay"
          onClick={() => setIsSensorTestModalOpen(false)}
          role="presentation"
        >
          <div
            className="card sensor-test-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sensor-test-modal-title"
          >
            <header className="section-header">
              <h2 id="sensor-test-modal-title">Sensor Test Results</h2>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setIsSensorTestModalOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="sensor-test-modal-body">
              {isTestingSensor ? (
                <div className="sensor-test-loading">
                  <span className="sensor-test-loading-icon">⚙️</span>
                  <p>Testing sensors...</p>
                </div>
              ) : sensorTestResults ? (
                <>
                  <div
                    className={`sensor-test-summary sensor-test-summary--${sensorTestResults.status}`}
                  >
                    <span className="sensor-test-summary-icon">
                      {sensorTestResults.status === "success"
                        ? "✅"
                        : sensorTestResults.status === "warning"
                        ? "⚠️"
                        : "❌"}
                    </span>
                    <p className="sensor-test-summary-message">{sensorTestResults.message}</p>
                    <p className="sensor-test-summary-time">
                      {new Date(sensorTestResults.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div className="sensor-test-list">
                    <h3>Sensor Status</h3>
                    {sensorTestResults.sensors?.map((s, i) => (
                      <div key={i} className="sensor-test-item">
                        <div>
                          <p className="sensor-test-item-name">{s.name}</p>
                          <p className="sensor-test-item-response">Response: {s.responseTime}</p>
                        </div>
                        <div className="sensor-test-item-value">
                          <span className={`sensor-test-badge sensor-test-badge--${s.status}`}>
                            {s.status === "pass" ? "PASS" : "FAIL"}
                          </span>
                          <span>{s.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="ghost-btn sensor-test-run-again"
                    onClick={() => handleSensorTest(sensorTestResults.nodeId, true)}
                  >
                    Run Test Again
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
