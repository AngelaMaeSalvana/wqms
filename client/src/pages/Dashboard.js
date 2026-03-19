import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import NodeSelector from "../components/dashboard/NodeSelector";
import NodeStatus from "../components/dashboard/NodeStatus";
import BatteryIndicator, { batteryPropsFromReading } from "../components/BatteryIndicator";
import TodayCard from "../components/dashboard/TodayCard";
import LiveChart from "../components/dashboard/LiveChart";
import WqiCard from "../components/dashboard/WqiCard";
import MiniMapCard from "../components/dashboard/MiniMapCard";
import AlertsSummaryCard from "../components/dashboard/AlertsSummaryCard";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { calculateWQI, getWQIClass } from "../utils/wqiCalculator";
import { getNH3FromReading } from "../utils/nh3Calculator";
import { buildAlertsForAllNodes } from "../utils/alertsData";
import { getNodes, loadNodes, invalidateNodesCache } from "../utils/nodesStorage";
import api from "../services/api";
import { useSensorTest } from "../hooks/useSensorTest";
import { useNodeStatus } from "../hooks/useNodeStatus";
import { useRealtimeReadings } from "../hooks/useRealtimeReadings";
import { useAlertEmailNotifications } from "../hooks/useAlertEmailNotifications";
import { supabase } from "../lib/supabaseClient";
import { applyCalibrationToReadings } from "../utils/calibration";
import { PageLoader } from "../components/LoadingSkeleton";
import "../pages/Map.css";
import "./Dashboard.css";

/** Severity order for sort: Critical (high) first, then Warning (medium), then Info (low/info). */
function getSeverityOrder(severity) {
  const s = (severity || "info").toLowerCase();
  if (s === "high") return 0;
  if (s === "medium") return 1;
  return 2;
}

/** Test alerts for verifying severity display. Enable via ?testAlerts=1 or localStorage wqms_test_alerts=1 */
function getTestAlerts(selectedNodeId) {
  const enabled =
    typeof window !== "undefined" &&
    (new URLSearchParams(window.location.search).get("testAlerts") === "1" ||
      localStorage.getItem("wqms_test_alerts") === "1");
  if (!enabled || !selectedNodeId) return [];
  const now = Date.now();
  return [
    {
      id: "test-alert-high",
      nodeId: selectedNodeId,
      nodeName: "Test Node",
      type: "threshold",
      title: "[TEST] High severity alert",
      detail: "Simulated HIGH severity for visual verification.",
      severity: "high",
      parameter: "test",
      timestamp: now,
      createdAt: new Date(now).toISOString(),
    },
    {
      id: "test-alert-medium",
      nodeId: selectedNodeId,
      nodeName: "Test Node",
      type: "threshold",
      title: "[TEST] Medium severity alert",
      detail: "Simulated MEDIUM severity for visual verification.",
      severity: "medium",
      parameter: "test",
      timestamp: now - 60000,
      createdAt: new Date(now - 60000).toISOString(),
    },
    {
      id: "test-alert-low",
      nodeId: selectedNodeId,
      nodeName: "Test Node",
      type: "threshold",
      title: "[TEST] Low severity alert",
      detail: "Simulated LOW severity for visual verification.",
      severity: "low",
      parameter: "test",
      timestamp: now - 120000,
      createdAt: new Date(now - 120000).toISOString(),
    },
    {
      id: "test-alert-info",
      nodeId: selectedNodeId,
      nodeName: "Test Node",
      type: "threshold",
      title: "[TEST] Info severity alert",
      detail: "Simulated INFO severity for visual verification.",
      severity: "info",
      parameter: "test",
      timestamp: now - 180000,
      createdAt: new Date(now - 180000).toISOString(),
    },
  ];
}

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

const SELECTED_NODE_STORAGE_KEY = "wqms_selected_node_id";

function getStoredNodeId() {
  try {
    return localStorage.getItem(SELECTED_NODE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function setStoredNodeId(id) {
  try {
    if (id) localStorage.setItem(SELECTED_NODE_STORAGE_KEY, id);
  } catch {}
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= breakpoint : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

export default function Dashboard() {
  const [nodes, setNodes] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(getStoredNodeId);
  const [todayReadings, setTodayReadings] = useState([]);
  const [readingsByNode, setReadingsByNode] = useState({});
  const [prevReadingsByNode, setPrevReadingsByNode] = useState({});
  const [readingsLoaded, setReadingsLoaded] = useState(false);
  const [nodesLoaded, setNodesLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [isLoadingAlerts] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const sensorTest = useSensorTest();
  const { nodeStatuses } = useNodeStatus(nodes);

  // Realtime: merge incoming rows into todayReadings without a full re-fetch.
  const realtimeDate = toDateStr(new Date());
  useRealtimeReadings({
    date: realtimeDate,
    onNewReading: (enriched) => {
      setTodayReadings((prev) => {
        // Deduplicate by timestamp + node_id in case the same row arrives twice.
        const key = `${enriched.node_id}_${enriched.timestamp}`;
        if (prev.some((r) => `${r.node_id}_${r.timestamp}` === key)) return prev;
        return [...prev, enriched];
      });
      // Update readingsByNode: push previous latest to prevByNode, set new latest.
      const nid = enriched.node_id || enriched.nodeId || '1';
      setReadingsByNode((prev) => {
        const updated = { ...prev };
        if (updated[nid]) {
          setPrevReadingsByNode((p) => ({ ...p, [nid]: updated[nid] }));
        }
        updated[nid] = enriched;
        return updated;
      });
    },
  });

  // Auto-refresh when Realtime is not available: poll every 60s so chart and WQI stay in sync with new data.
  useEffect(() => {
    if (supabase) return;
    const interval = setInterval(() => setLastUpdated(new Date()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const refreshNodes = useCallback(() => {
    invalidateNodesCache();
    return loadNodes().then(() => {
      const list = getNodes();
      setNodes(list);
      const activeList = list.filter((n) => n.active !== false);
      const stored = getStoredNodeId();
      setSelectedNodeId((id) => {
        const validCurrent = id && activeList.some((n) => n.id === id);
        if (validCurrent) return id;
        if (stored && activeList.some((n) => n.id === stored)) return stored;
        return activeList[0]?.id ?? list[0]?.id ?? "";
      });
    });
  }, []);

  useEffect(() => {
    refreshNodes().finally(() => setNodesLoaded(true));
  }, [refreshNodes]);

  useEffect(() => {
    window.addEventListener("focus", refreshNodes);
    const onNodesUpdated = () => refreshNodes();
    window.addEventListener("wqms-nodes-updated", onNodesUpdated);
    return () => {
      window.removeEventListener("focus", refreshNodes);
      window.removeEventListener("wqms-nodes-updated", onNodesUpdated);
    };
  }, [refreshNodes]);

  // All data from Supabase/API only; no dummy/test/mock data.
  useEffect(() => {
    setReadingsLoaded(false);
    const today = toDateStr(new Date());
    api.getReadings({ startDate: today, endDate: today, monitoringOnly: true, limit: 2000 })
      .then((rows) => {
        const list = applyCalibrationToReadings(Array.isArray(rows) ? rows : []);
        setTodayReadings(list);
        const byNode = {};
        const prevByNode = {};
        const sorted = [...list].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        sorted.forEach((r) => {
          const nid = r.node_id || r.nodeId || "1";
          const mapped = {
            ...r,
            temperature: r.temperature,
            pH: r.ph,
            ph: r.ph,
            turbidity: r.turbidity,
            dissolvedOxygen: r.dissolved_oxygen,
            dissolved_oxygen: r.dissolved_oxygen,
            do: r.dissolved_oxygen,
            tan: r.tan ?? r.TAN,
            nh3: getNH3FromReading(r),
            NH3: getNH3FromReading(r),
            flowRate: r.flow_rate ?? r.flowRate,
          };
          if (byNode[nid]) prevByNode[nid] = byNode[nid];
          byNode[nid] = mapped;
        });
        setReadingsByNode(byNode);
        setPrevReadingsByNode(prevByNode);
      })
      .catch(() => {
        setTodayReadings([]);
        setReadingsByNode({});
        setPrevReadingsByNode({});
      })
      .finally(() => setReadingsLoaded(true));
  }, [lastUpdated]);

  const builtAlerts = useMemo(
    () => buildAlertsForAllNodes(nodes, readingsByNode, nodeStatuses, prevReadingsByNode),
    [nodes, readingsByNode, nodeStatuses, prevReadingsByNode]
  );

  const sensorTestAlerts = useMemo(() => {
    const res = sensorTest.results;
    if (!res || res.status === "success") return [];
    const nodeName = nodes.find((n) => n.id === res.nodeId)?.name || res.nodeId || "Unknown node";
    const severity = res.status === "error" ? "high" : "medium";
    return [
      {
        id: `sensor-test-${res.nodeId}-${res.timestamp || Date.now()}`,
        nodeId: res.nodeId,
        nodeName,
        type: "sensor_test",
        title: "Sensor test failed",
        detail: res.message || "One or more sensors have no data or failed.",
        severity,
        timestamp: typeof res.timestamp === "string" ? new Date(res.timestamp).getTime() : Date.now(),
        createdAt: res.timestamp || new Date().toISOString(),
      },
    ];
  }, [sensorTest.results, nodes]);

  const alerts = useMemo(() => {
    const combined = [...builtAlerts, ...sensorTestAlerts];
    return combined.sort(
      (a, b) => getSeverityOrder(a.severity) - getSeverityOrder(b.severity) || (b.timestamp || 0) - (a.timestamp || 0)
    );
  }, [builtAlerts, sensorTestAlerts]);

  useAlertEmailNotifications(alerts, readingsByNode);

  const { toasts, showToast, removeToast } = useToast();
  const seenAlertIdsRef = useRef(new Set());
  const isFirstAlertRenderRef = useRef(true);

  useEffect(() => {
    if (!alerts.length) return;
    // Skip toasting on the initial load — only fire for genuinely new alerts
    if (isFirstAlertRenderRef.current) {
      alerts.forEach((a) => seenAlertIdsRef.current.add(a.id));
      isFirstAlertRenderRef.current = false;
      return;
    }
    alerts.forEach((a) => {
      if (seenAlertIdsRef.current.has(a.id)) return;
      seenAlertIdsRef.current.add(a.id);
      const sev = (a.severity || "info").toLowerCase();
      const toastType = sev === "high" ? "error" : sev === "medium" ? "warning" : "info";
      showToast(a.title || "New alert", toastType, 6000);
    });
  }, [alerts, showToast]);

  /** Alerts for the selected node on the current date only (for Dashboard Alerts Summary card) */
  const dashboardAlerts = useMemo(() => {
    const nodeId = selectedNodeId || null;
    const today = new Date().toDateString();
    const filtered = alerts.filter((a) => {
      const matchesNode = (a.nodeId || a.node_id) === nodeId;
      const ts = a.timestamp ?? a.createdAt;
      const alertDate = ts != null ? new Date(ts).toDateString() : today;
      const matchesToday = alertDate === today;
      return matchesNode && matchesToday;
    });
    const testAlerts = getTestAlerts(nodeId);
    if (testAlerts.length === 0) return filtered;
    const combined = [...filtered, ...testAlerts];
    return combined.sort(
      (a, b) => getSeverityOrder(a.severity) - getSeverityOrder(b.severity) || (b.timestamp || 0) - (a.timestamp || 0)
    );
  }, [alerts, selectedNodeId]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || nodes[0],
    [nodes, selectedNodeId]
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    refreshNodes().finally(() => {
      setIsRefreshing(false);
      setLastUpdated(new Date());
    });
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
        timestamps: [],
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
    const timestamps = list.map((r) => r.timestamp);
    const tempData = list.map((r) => r.temperature ?? null);
    const turbData = list.map((r) => r.turbidity ?? null);
    const phData = list.map((r) => r.ph ?? r.pH ?? null);
    const nh3Data = list.map((r) => getNH3FromReading(r));
    const flowData = list.map((r) => r.flow_rate ?? r.flowRate ?? null);
    const doData = list.map((r) => r.dissolved_oxygen ?? r.dissolvedOxygen ?? r.do ?? null);
    return {
      labels,
      timestamps,
      datasets: [
        { label: "Temperature °C", data: tempData, borderColor: "#1b9c85", backgroundColor: "rgba(27, 156, 133, 0.1)", fill: true },
        { label: "Turbidity", data: turbData, borderColor: "#d45b5b", backgroundColor: "rgba(212, 91, 91, 0.1)", fill: true },
        { label: "Water pH", data: phData, borderColor: "#f0a500", backgroundColor: "rgba(240, 165, 0, 0.1)", fill: true },
        { label: "NH₃ mg/L (calc)", data: nh3Data, borderColor: "#9b59b6", backgroundColor: "rgba(155, 89, 182, 0.1)", fill: true },
        { label: "Flow rate L/min", data: flowData, borderColor: "#3498db", backgroundColor: "rgba(52, 152, 219, 0.1)", fill: true },
        { label: "Dissolved O₂ mg/L", data: doData, borderColor: "#2ecc71", backgroundColor: "rgba(46, 204, 113, 0.1)", fill: true },
      ],
    };
  }, [selectedNode?.id, todayReadings]);

  const todayStats = useMemo(() => {
    if (!todayData?.datasets?.length) return null;
    const getStats = (arr, round = true) => {
      if (!Array.isArray(arr) || arr.length === 0) return { low: null, avg: null, high: null };
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      const sum = arr.reduce((a, b) => a + b, 0);
      const avg = arr.length ? sum / arr.length : null;
      if (round) {
        return {
          low: Math.round(min * 10) / 10,
          avg: avg != null ? Math.round(avg * 10) / 10 : null,
          high: Math.round(max * 10) / 10,
        };
      }
      return { low: min, avg, high: max };
    };
    const ds = todayData.datasets;
    return {
      temperature: getStats(ds[0]?.data),
      turbidity: getStats(ds[1]?.data),
      ph: getStats(ds[2]?.data),
      nh3: getStats(ds[3]?.data, false),
      flowRate: getStats(ds[4]?.data),
      dissolvedOxygen: getStats(ds[5]?.data),
    };
  }, [todayData]);

  /** WQI from today's parameter averages. Uses calculateWQI with avg values (NH3 from readings). */
  const wqiValue = useMemo(() => {
    if (!todayStats) return null;
    const { temperature, ph, nh3, turbidity, dissolvedOxygen } = todayStats;
    return calculateWQI({
      temperature: temperature?.avg ?? undefined,
      pH: ph?.avg ?? undefined,
      nh3: nh3?.avg ?? undefined,
      turbidity: turbidity?.avg ?? undefined,
      dissolvedOxygen: dissolvedOxygen?.avg ?? undefined,
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

  const isPageLoading = !nodesLoaded || !readingsLoaded;
  const isMobile = useIsMobile(768);

  const handleSensorTest = useCallback(
    (nodeId) => {
      sensorTest.runTest(nodeId ?? selectedNode?.id);
    },
    [selectedNode?.id, sensorTest]
  );

  if (isPageLoading) {
    return (
      <div className="dash">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="dash">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <header className="dash__top">
        <div>
          <h1 className="dash__title">Dashboard</h1>
          <p className="dash__subtitle">Real-time water quality monitoring</p>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="dash__date" showClassification={false} />
      </header>

      <div className="dash__controls">
        <span className="dash__controls-label">Node</span>
        <NodeSelector
          nodes={nodes.filter((n) => n.active !== false)}
          value={selectedNodeId}
          onChange={(id) => {
            setSelectedNodeId(id);
            setStoredNodeId(id);
          }}
        />
        <span className="dash__controls-divider" aria-hidden="true" />
        {selectedNode && (() => {
          const r = readingsByNode[selectedNode.id];
          const bp = batteryPropsFromReading(r);
          return (bp.voltage != null || bp.percentage != null) ? (
            <>
              <BatteryIndicator {...bp} showPercentage size="medium" />
              <span className="dash__controls-divider" aria-hidden="true" />
            </>
          ) : null;
        })()}
        <NodeStatus status={selectedNode ? (nodeStatuses[selectedNode.id] ?? 'offline') : 'offline'} />
      </div>

      <div className="dash__grid">
        <section className="dash__cell dash__cell--today">
          <TodayCard
            todayStats={todayStats}
            latestReading={readingsByNode[selectedNode?.id]}
            selectedNode={selectedNode}
            readingsLoaded={readingsLoaded}
            variant={isMobile ? "tabs" : "grid"}
          />
        </section>
        <section className={`dash__cell dash__cell--wqi ${isMobile ? "dash__cell--wqi-first" : ""}`}>
          <WqiCard value={wqiValue} label={wqiLabel} minimal={isMobile} />
        </section>
        <section className="dash__cell dash__cell--live">
          <LiveChart todayData={todayData} todayChartOptions={todayChartOptions} />
        </section>
        <section className="dash__cell dash__cell--mini">
          <MiniMapCard
            nodes={nodes}
            selectedNode={selectedNode}
            onTestSensor={handleSensorTest}
            isTestingSensor={sensorTest.isTesting}
            sensorTestResults={sensorTest.allResults}
            readingsByNode={readingsByNode}
          />
        </section>
        <section className="dash__cell dash__cell--alerts">
          {getTestAlerts(selectedNodeId).length > 0 && (
            <div className="dash__test-banner" role="status">
              Test alerts enabled — disable with ?testAlerts=0 or clear wqms_test_alerts
            </div>
          )}
          <AlertsSummaryCard
            alerts={dashboardAlerts}
            isLoadingAlerts={isLoadingAlerts}
          />
        </section>
      </div>

      {sensorTest.isOpen && createPortal(
        <div
          className="map-modal-overlay"
          onClick={sensorTest.close}
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
              <h2 id="sensor-test-modal-title">Sensor Status</h2>
              <button
                type="button"
                className="ghost-btn"
                onClick={sensorTest.close}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="sensor-test-modal-body">
              {sensorTest.isTesting ? (
                <div className="sensor-test-loading">
                  <span className="sensor-test-loading-icon">⚙️</span>
                  <p>Checking sensor data...</p>
                </div>
              ) : sensorTest.results ? (
                <>
                  <div
                    className={`sensor-test-summary sensor-test-summary--${sensorTest.results.status}`}
                  >
                    <span className="sensor-test-summary-icon">
                      {sensorTest.results.status === "success"
                        ? "✅"
                        : sensorTest.results.status === "warning"
                        ? "⚠️"
                        : sensorTest.results.status === "offline"
                        ? "📡"
                        : "❌"}
                    </span>
                    <p className="sensor-test-summary-message">{sensorTest.results.message}</p>
                    <p className="sensor-test-summary-time">
                      {sensorTest.results.dataAge
                        ? `Last data: ${sensorTest.results.dataAge}`
                        : `Checked: ${new Date(sensorTest.results.timestamp).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="sensor-test-list">
                    <h3>Sensor Status</h3>
                    {sensorTest.results.sensors?.map((s, i) => (
                      <div key={i} className="sensor-test-item">
                        <div>
                          <p className="sensor-test-item-name">{s.name}</p>
                          <p className="sensor-test-item-response">Response: {s.responseTime}</p>
                        </div>
                        <div className="sensor-test-item-value">
                          <span className={`sensor-test-badge sensor-test-badge--${s.status}`}>
                            {s.status === "pass" ? "PASS" : s.status === "stale" ? "NO DATA" : "FAIL"}
                          </span>
                          <span>{s.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="ghost-btn sensor-test-run-again"
                    onClick={() => handleSensorTest(sensorTest.results.nodeId)}
                  >
                    Refresh
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
