import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { buildAlertsForAllNodes } from "../utils/alertsData";
import { getNodes, loadNodes, invalidateNodesCache } from "../utils/nodesStorage";
import api from "../services/api";
import { useSensorTest } from "../hooks/useSensorTest";
import { useNodeStatus } from "../hooks/useNodeStatus";
import { useRealtimeReadings } from "../hooks/useRealtimeReadings";
import { useAlertEmailNotifications } from "../hooks/useAlertEmailNotifications";
import { supabase } from "../lib/supabaseClient";
import { displayReadings } from "../utils/calibration";
import { getNH3FromReading } from "../utils/nh3Calculator";

function getSeverityOrder(severity) {
  const s = (severity || "info").toLowerCase();
  if (s === "high") return 0;
  if (s === "medium") return 1;
  return 2;
}

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const LiveAlertsContext = createContext(null);

export function LiveAlertsProvider({ children }) {
  const [nodes, setNodes] = useState([]);
  const [todayReadings, setTodayReadings] = useState([]);
  const [readingsByNode, setReadingsByNode] = useState({});
  const [prevReadingsByNode, setPrevReadingsByNode] = useState({});
  const [readingsLoaded, setReadingsLoaded] = useState(false);
  const [nodesLoaded, setNodesLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());

  const sensorTest = useSensorTest();
  const { nodeStatuses } = useNodeStatus(nodes);

  const realtimeDate = toDateStr(new Date());
  useRealtimeReadings({
    date: realtimeDate,
    onNewReading: (enriched) => {
      setTodayReadings((prev) => {
        const key = `${enriched.node_id}_${enriched.timestamp}`;
        if (prev.some((r) => `${r.node_id}_${r.timestamp}` === key)) return prev;
        return [...prev, enriched];
      });
      const nid = enriched.node_id || enriched.nodeId || "1";
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

  useEffect(() => {
    if (supabase) return undefined;
    const interval = setInterval(() => setLastUpdated(new Date()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const refreshNodes = useCallback(() => {
    invalidateNodesCache();
    return loadNodes().then(() => {
      const list = getNodes();
      setNodes(list);
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

  useEffect(() => {
    setReadingsLoaded(false);
    const today = toDateStr(new Date());
    api
      .getReadings({ startDate: today, endDate: today, monitoringOnly: true, limit: 2000 })
      .then((rows) => {
        const list = displayReadings(Array.isArray(rows) ? rows : []);
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
      (a, b) =>
        getSeverityOrder(a.severity) - getSeverityOrder(b.severity) ||
        (b.timestamp || 0) - (a.timestamp || 0)
    );
  }, [builtAlerts, sensorTestAlerts]);

  useAlertEmailNotifications(alerts, readingsByNode, nodeStatuses);

  const { toasts, showToast, removeToast } = useToast();
  const seenAlertIdsRef = useRef(new Set());
  const isFirstAlertRenderRef = useRef(true);

  useEffect(() => {
    if (!alerts.length) return;
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

  const value = useMemo(
    () => ({
      nodes,
      refreshNodes,
      todayReadings,
      readingsByNode,
      prevReadingsByNode,
      readingsLoaded,
      nodesLoaded,
      lastUpdated,
      setLastUpdated,
      sensorTest,
      nodeStatuses,
      alerts,
    }),
    [
      nodes,
      refreshNodes,
      todayReadings,
      readingsByNode,
      prevReadingsByNode,
      readingsLoaded,
      nodesLoaded,
      lastUpdated,
      sensorTest,
      nodeStatuses,
      alerts,
    ]
  );

  return (
    <LiveAlertsContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </LiveAlertsContext.Provider>
  );
}

export function useLiveAlerts() {
  const ctx = useContext(LiveAlertsContext);
  if (!ctx) throw new Error("useLiveAlerts must be used within LiveAlertsProvider");
  return ctx;
}
