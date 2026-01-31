import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import NodeSelector from "../components/dashboard/NodeSelector";
import NodeStatus from "../components/dashboard/NodeStatus";
import TodayCard from "../components/dashboard/TodayCard";
import LiveChart from "../components/dashboard/LiveChart";
import WqiCard from "../components/dashboard/WqiCard";
import MiniMapCard from "../components/dashboard/MiniMapCard";
import AlertsSummaryCard from "../components/dashboard/AlertsSummaryCard";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { useMQTTContext } from "../contexts/MQTTContext";
import { calculateWQI, getWQIClass } from "../utils/wqiCalculator";
import { buildAlertsForAllNodes } from "../utils/alertsData";
import { exportToJSON, exportToCSV, formatAlertsForExport } from "../utils/exportData";
import { getNodes, loadNodes } from "../utils/nodesStorage";
import "../pages/Map.css";
import "./Dashboard.css";

function formatDateShort(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Dashboard() {
  const { isConnected: mqttConnected, getLatestReading, latestReadingsByNode } = useMQTTContext();
  const [nodes, setNodes] = useState(() => getNodes());
  const [selectedNodeId, setSelectedNodeId] = useState(() => getNodes()[0]?.id);
  const alerts = useMemo(() => buildAlertsForAllNodes(nodes, latestReadingsByNode), [nodes, latestReadingsByNode]);
  const liveReading = getLatestReading(selectedNodeId);

  useEffect(() => {
    loadNodes().then(() => setNodes(getNodes()));
  }, []);
  useEffect(() => {
    const onFocus = () => loadNodes().then(() => setNodes(getNodes()));
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

  /** Chart data: only from live MQTT (no mock). Empty when no data. */
  const todayData = useMemo(() => {
    if (!liveReading) return null;
    const ts = liveReading.timestamp ? new Date(liveReading.timestamp) : new Date();
    const label = `${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`;
    const v = (x) => (x != null && !isNaN(x) ? Number(x) : null);
    const temp = v(liveReading.temperature);
    const turb = v(liveReading.turbidity);
    const ph = v(liveReading.pH ?? liveReading.ph);
    const nh3 = v(liveReading.nh3);
    const flow = v(liveReading.flowRate);
    const doVal = v(liveReading.dissolvedOxygen);
    if (temp == null && turb == null && ph == null && nh3 == null && flow == null && doVal == null) return null;
    return {
      labels: [label],
      datasets: [
        { label: "Temperature °C", data: [temp], borderColor: "#1b9c85", backgroundColor: "rgba(27, 156, 133, 0.1)", fill: true },
        { label: "Turbidity", data: [turb], borderColor: "#d45b5b", backgroundColor: "rgba(212, 91, 91, 0.1)", fill: true },
        { label: "Water pH", data: [ph], borderColor: "#f0a500", backgroundColor: "rgba(240, 165, 0, 0.1)", fill: true },
        { label: "NH₃ mg/L", data: [nh3], borderColor: "#9b59b6", backgroundColor: "rgba(155, 89, 182, 0.1)", fill: true },
        { label: "Flow rate L/min", data: [flow], borderColor: "#3498db", backgroundColor: "rgba(52, 152, 219, 0.1)", fill: true },
        { label: "Dissolved O₂ mg/L", data: [doVal], borderColor: "#2ecc71", backgroundColor: "rgba(46, 204, 113, 0.1)", fill: true },
      ],
    };
  }, [liveReading]);

  const todayStatsFromLive = useMemo(() => {
    if (!liveReading) return null;
    const v = (x) => (x != null && !isNaN(x) ? Math.round(Number(x) * 10) / 10 : null);
    const one = (x) => {
      const a = v(x);
      return a != null ? { low: a, avg: a, high: a } : { low: null, avg: null, high: null };
    };
    return {
      temperature: one(liveReading.temperature),
      turbidity: one(liveReading.turbidity),
      ph: one(liveReading.pH ?? liveReading.ph),
      nh3: one(liveReading.nh3),
      flowRate: one(liveReading.flowRate),
      dissolvedOxygen: one(liveReading.dissolvedOxygen),
    };
  }, [liveReading]);

  const todayStats = liveReading && todayStatsFromLive ? todayStatsFromLive : null;

  /** WQI: use live reading WQI when connected, else from today's parameter averages. */
  const wqiValue = useMemo(() => {
    if (liveReading && liveReading.wqi != null && !isNaN(liveReading.wqi)) return Math.round(liveReading.wqi);
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
  }, [liveReading, todayStats]);

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
      setIsTestingSensor(false);
      setSensorTestResults({
        nodeId: id,
        status: "error",
        message: "No sensor data yet.",
        timestamp: new Date().toISOString(),
        sensors: [],
        empty: true,
      });
      setIsSensorTestModalOpen(true);
    },
    [selectedNode?.id, getStoredTestResults]
  );

  return (
    <div className="dash">
      <header className="dash__top">
        <div>
          <h1 className="dash__title">Dashboard</h1>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="dash__date" />
      </header>

      <div className="dash__controls">
        <NodeSelector
          nodes={nodes}
          value={selectedNodeId}
          onChange={setSelectedNodeId}
        />
        <NodeStatus status={selectedNode?.status} isLive={mqttConnected && !!liveReading} />
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
                  {sensorTestResults.empty ? (
                    <p className="sensor-test-empty-msg">Connect to HiveMQ and ensure the node is sending data.</p>
                  ) : (
                    <>
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
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
