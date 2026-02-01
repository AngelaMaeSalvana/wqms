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
import { getNodes, loadNodes } from "../utils/nodesStorage";
import api from "../services/api";
import "../pages/Map.css";
import "./Dashboard.css";

function formatDateShort(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function Dashboard() {
  const [nodes, setNodes] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [todayReadings, setTodayReadings] = useState([]);
  const [readingsByNode, setReadingsByNode] = useState({});
  const [readingsLoaded, setReadingsLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [isLoadingAlerts] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSensorTestModalOpen, setIsSensorTestModalOpen] = useState(false);
  const [sensorTestResults, setSensorTestResults] = useState(null);
  const [isTestingSensor, setIsTestingSensor] = useState(false);
  const autoRefreshIntervalRef = useRef(null);

  useEffect(() => {
    loadNodes().then(() => {
      const list = getNodes();
      setNodes(list);
      setSelectedNodeId((id) => (id && list.some((n) => n.id === id) ? id : list[0]?.id ?? ""));
    });
  }, []);
  useEffect(() => {
    const onFocus = () => loadNodes().then(() => setNodes(getNodes()));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // All data from Supabase/API only; no dummy/test/mock data.
  useEffect(() => {
    setReadingsLoaded(false);
    const today = toDateStr(new Date());
    api.getReadings({ startDate: today, endDate: today, limit: 200 })
      .then((rows) => {
        setTodayReadings(Array.isArray(rows) ? rows : []);
        const byNode = {};
        (Array.isArray(rows) ? rows : []).forEach((r) => {
          const nid = r.node_id || r.nodeId || "1";
          if (!byNode[nid] || new Date(r.timestamp) > new Date(byNode[nid].timestamp)) {
            byNode[nid] = {
              temperature: r.temperature,
              pH: r.ph,
              ph: r.ph,
              turbidity: r.turbidity,
              dissolvedOxygen: r.dissolved_oxygen,
              dissolved_oxygen: r.dissolved_oxygen,
              do: r.dissolved_oxygen,
              nh3: r.nh3,
              NH3: r.nh3,
            };
          }
        });
        setReadingsByNode(byNode);
      })
      .catch(() => {
        setTodayReadings([]);
        setReadingsByNode({});
      })
      .finally(() => setReadingsLoaded(true));
  }, [lastUpdated]);

  const alerts = useMemo(() => buildAlertsForAllNodes(nodes, readingsByNode), [nodes, readingsByNode]);

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

  /** Today's data from API/Supabase only. One point per reading for selected node. */
  const todayData = useMemo(() => {
    const nodeId = selectedNode?.id || null;
    const list = (todayReadings || []).filter(
      (r) => (r.node_id || r.nodeId) === nodeId
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (list.length === 0) {
      return {
        labels: [],
        datasets: [
          { label: "Temperature °C", data: [], borderColor: "#1b9c85", backgroundColor: "rgba(27, 156, 133, 0.1)", fill: true },
          { label: "Turbidity", data: [], borderColor: "#d45b5b", backgroundColor: "rgba(212, 91, 91, 0.1)", fill: true },
          { label: "Water pH", data: [], borderColor: "#f0a500", backgroundColor: "rgba(240, 165, 0, 0.1)", fill: true },
          { label: "NH₃ mg/L", data: [], borderColor: "#9b59b6", backgroundColor: "rgba(155, 89, 182, 0.1)", fill: true },
          { label: "Flow rate L/min", data: [], borderColor: "#3498db", backgroundColor: "rgba(52, 152, 219, 0.1)", fill: true },
          { label: "Dissolved O₂ mg/L", data: [], borderColor: "#2ecc71", backgroundColor: "rgba(46, 204, 113, 0.1)", fill: true },
        ],
      };
    }
    const labels = list.map((r) => {
      const d = new Date(r.timestamp);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    });
    const tempData = list.map((r) => r.temperature ?? null);
    const turbData = list.map((r) => r.turbidity ?? null);
    const phData = list.map((r) => r.ph ?? r.pH ?? null);
    const nh3Data = list.map((r) => r.nh3 ?? r.NH3 ?? null);
    const flowData = list.map((r) => r.flowRate ?? null);
    const doData = list.map((r) => r.dissolved_oxygen ?? r.dissolvedOxygen ?? r.do ?? null);
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
  }, [selectedNode?.id, todayReadings]);

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

  /** Sensor test from real data only (todayStats from API/Supabase). No mock values. */
  const buildSensorTestFromReadings = useCallback((nodeId) => {
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
        responseTime: hasData ? "—" : "No data",
      };
    });
    const failCount = sensors.filter((x) => x.status === "fail").length;
    let status = "success";
    let message = "Sensor test completed successfully";
    if (failCount === sensors.length) {
      status = "error";
      message = "No sensor data available. Data comes from MQTT or Supabase.";
    } else if (failCount >= 2) {
      status = "error";
      message = `${failCount} sensors have no data`;
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
        const results = buildSensorTestFromReadings(id);
        setSensorTestResults(results);
        storeTestResults(id, results);
        setIsTestingSensor(false);
      }, 500);
    },
    [selectedNode?.id, getStoredTestResults, buildSensorTestFromReadings, storeTestResults]
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
        <NodeStatus status={selectedNode?.status} />
      </div>

      <div className="dash__grid">
        <section className="dash__cell dash__cell--today">
          <TodayCard todayStats={todayStats} selectedNode={selectedNode} readingsLoaded={readingsLoaded} />
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
