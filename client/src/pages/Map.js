import React, { useState, useEffect, useCallback, useMemo } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import MapMarkersOverlay from "../components/map/MapMarkersOverlay";
import PageDateWithStatus from "../components/PageDateWithStatus";
import api from "../services/api";
import { useMQTTContext } from "../contexts/MQTTContext";
import { calculateWQI } from "../utils/wqiCalculator";
import { getNodes, loadNodes } from "../utils/nodesStorage";
import "./Map.css";

const FALLBACK_CENTER = [8.462591, 124.707831];
const DEFAULT_ZOOM = 11;

function getWQIClass(wqi) {
  if (wqi == null || isNaN(wqi)) return { class: "N/A", label: "No Data", quality: "muted" };
  if (wqi < 50) return { class: "I", label: "Excellent", quality: "excellent" };
  if (wqi <= 100) return { class: "II", label: "Good", quality: "good" };
  if (wqi <= 200) return { class: "III", label: "Poor", quality: "poor" };
  if (wqi <= 300) return { class: "IV", label: "Very Poor", quality: "very-poor" };
  return { class: "V", label: "Unsuitable", quality: "unsuitable" };
}

function normalizeReading(r) {
  if (!r) return null;
  const temp = r.temperature ?? null;
  const turb = r.turbidity ?? null;
  const ph = r.pH ?? r.ph ?? null;
  const ammonia = r.nh3 ?? r.NH3 ?? null;
  const doVal = r.dissolvedOxygen ?? r.dissolved_oxygen ?? r.do ?? r.DO ?? null;
  let wqi = r.wqi ?? r.WQI;
  if (wqi == null && temp != null && turb != null && ph != null && ammonia != null && doVal != null) {
    wqi = calculateWQI({ temperature: temp, turbidity: turb, pH: ph, nh3: ammonia, dissolvedOxygen: doVal });
  }
  return {
    temperature: temp,
    turbidity: turb,
    pH: ph,
    nh3: ammonia,
    dissolvedOxygen: doVal,
    wqi: wqi != null ? Math.round(wqi) : null,
    nodeId: r.nodeId ?? r.node ?? null,
  };
}

export default function Map() {
  const { isConnected: mqttConnected, latestReadingsByNode } = useMQTTContext();
  const [nodes, setNodes] = useState(() => getNodes());
  const [currentMetrics, setCurrentMetrics] = useState({
    temperature: null,
    turbidity: null,
    pH: null,
    nh3: null,
    dissolvedOxygen: null,
    wqi: null,
    nodeId: null,
  });
  const [isSensorTestModalOpen, setIsSensorTestModalOpen] = useState(false);
  const [sensorTestResults, setSensorTestResults] = useState(null);
  const [isTestingSensor, setIsTestingSensor] = useState(false);
  const [lastUpdated] = useState(() => new Date());

  const allNodes = useMemo(() => nodes, [nodes]);
  const mapCenter = useMemo(() => {
    const coords = allNodes.filter((n) => n.lat != null && n.lng != null).map((n) => [n.lat, n.lng]);
    if (coords.length === 0) return FALLBACK_CENTER;
    return [
      coords.reduce((s, c) => s + c[0], 0) / coords.length,
      coords.reduce((s, c) => s + c[1], 0) / coords.length,
    ];
  }, [allNodes]);

  useEffect(() => {
    loadNodes().then(() => setNodes(getNodes()));
  }, []);
  useEffect(() => {
    const onFocus = () => loadNodes().then(() => setNodes(getNodes()));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const fetchLatestReading = useCallback(async () => {
    try {
      const r = await api.getLatestReading();
      const norm = normalizeReading(r);
      if (norm) {
        setCurrentMetrics((prev) => ({
          ...prev,
          ...norm,
          nodeId: norm.nodeId ?? prev.nodeId,
        }));
      }
    } catch (err) {
      console.debug("Map: could not fetch latest reading", err.message);
    }
  }, []);

  useEffect(() => {
    if (mqttConnected && Object.keys(latestReadingsByNode).length > 0) {
      const readings = Object.values(latestReadingsByNode);
      const latest = readings.reduce((a, b) => ((a._receivedAt ?? 0) >= (b._receivedAt ?? 0) ? a : b));
      setCurrentMetrics((prev) => ({
        ...prev,
        temperature: latest.temperature ?? prev.temperature,
        turbidity: latest.turbidity ?? prev.turbidity,
        pH: latest.pH ?? latest.ph ?? prev.pH,
        nh3: latest.nh3 ?? prev.nh3,
        dissolvedOxygen: latest.dissolvedOxygen ?? prev.dissolvedOxygen,
        wqi: latest.wqi ?? prev.wqi,
        nodeId: latest.nodeId ?? prev.nodeId,
      }));
    }
  }, [mqttConnected, latestReadingsByNode]);

  useEffect(() => {
    if (mqttConnected) return;
    fetchLatestReading();
    const interval = setInterval(fetchLatestReading, 60000);
    return () => clearInterval(interval);
  }, [mqttConnected, fetchLatestReading]);

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

  const handleSensorTest = useCallback(
    (nodeId, forceRun = false) => {
      const id = nodeId ?? currentMetrics.nodeId;
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
    [currentMetrics.nodeId, getStoredTestResults]
  );

  const nodeIdForMarker = currentMetrics.nodeId ?? null;
  const isTestingThisNode = isTestingSensor && (sensorTestResults?.nodeId === nodeIdForMarker || !sensorTestResults);
  const testStatusForNode = sensorTestResults?.nodeId === nodeIdForMarker ? sensorTestResults?.status : null;

  const mapMarkers = allNodes.filter((n) => n.lat != null && n.lng != null).map((n) => {
    const stored = getStoredTestResults(n.id);
    const statusForNode = sensorTestResults?.nodeId === n.id ? sensorTestResults?.status : stored?.status ?? null;
    return {
      key: n.id,
      lat: n.lat,
      lng: n.lng,
      nodeId: n.id,
      onTestSensor: handleSensorTest,
      isTesting: isTestingSensor && (sensorTestResults?.nodeId === n.id || !sensorTestResults),
      testStatus: statusForNode,
    };
  });

  const nodesTableData = allNodes.map((n) => {
    const stored = getStoredTestResults(n.id);
    const result = sensorTestResults?.nodeId === n.id ? sensorTestResults : stored;
    let repairStatus = "Not tested";
    if (result?.status === "success") repairStatus = "OK";
    else if (result?.status === "warning") repairStatus = "Needs repair";
    else if (result?.status === "error") repairStatus = "Needs fix";
    return {
      ...n,
      lastTest: result ? new Date(result.timestamp).toLocaleString() : "—",
      repairStatus,
      resultStatus: result?.status ?? null,
    };
  });

  return (
    <div className="map-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Map &amp; Locations</h1>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta" />
      </header>

      <section className="card map-card">
        <div className="map-body">
          <div className="map-wrapper leaflet-map-wrapper">
            <MapContainer
              center={mapCenter}
              zoom={DEFAULT_ZOOM}
              className="leaflet-map"
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapMarkersOverlay markers={mapMarkers} />
            </MapContainer>
          </div>
        </div>
      </section>

      <section className="card map-nodes-card">
        <header className="section-header">
          <h2 className="card__title">All Nodes — Location &amp; Sensor Status</h2>
        </header>
        <div className="map-nodes-card__body">
          <div className="map-nodes-table-wrap">
            <table className="map-nodes-table" role="table">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Location</th>
                  <th>Coordinates</th>
                  <th>Last test</th>
                  <th>Sensor status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {nodesTableData.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="map-nodes-table__node-name">{row.name}</span>
                      <span className="map-nodes-table__node-id">{row.id}</span>
                    </td>
                    <td>{row.location}</td>
                    <td className="map-nodes-table__coords">
                      {row.lat != null && row.lng != null
                        ? `${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}`
                        : "—"}
                    </td>
                    <td>{row.lastTest}</td>
                    <td>
                      <span
                        className={`map-nodes-table__status map-nodes-table__status--${row.resultStatus ?? "none"}`}
                        title={row.resultStatus ? row.repairStatus : "No test run today"}
                      >
                        {row.repairStatus}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ghost-btn map-nodes-table__test-btn"
                        onClick={() => handleSensorTest(row.id)}
                        aria-label={`Test sensor for ${row.name}`}
                      >
                        Test sensor
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

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
                        onClick={() => handleSensorTest(sensorTestResults.nodeId ?? nodeIdForMarker, true)}
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
