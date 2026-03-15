import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer } from "react-leaflet";
import MapMarkersOverlay from "../components/map/MapMarkersOverlay";
import BatteryIndicator, { batteryPropsFromReading } from "../components/BatteryIndicator";
import MapRecenterButton from "../components/map/MapRecenterButton";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { getNodes, loadNodes } from "../utils/nodesStorage";
import { useSensorTest } from "../hooks/useSensorTest";
import { useLatestReadingsByNode } from "../hooks/useLatestReadingsByNode";
import { PageLoader } from "../components/LoadingSkeleton";
import "./Map.css";

const FALLBACK_CENTER = [8.462591, 124.707831];
const DEFAULT_ZOOM = 11;

export default function Map() {
  const [nodes, setNodes] = useState([]);
  const [nodesLoaded, setNodesLoaded] = useState(false);
  const [lastUpdated] = useState(() => new Date());
  const sensorTest = useSensorTest();
  const { readingsByNode } = useLatestReadingsByNode();

  // Mobile bottom sheet state
  const [selectedNode, setSelectedNode] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef(null);

  const isMobile = () => window.innerWidth <= 1024 || window.innerHeight <= 768;

  const handleNodeSelect = useCallback((nodeId) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setSelectedNode(node);
    setSheetOpen(true);
  }, [nodes]);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setTimeout(() => setSelectedNode(null), 300);
  }, []);

  // Close sheet on backdrop touch
  const handleSheetBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) closeSheet();
  }, [closeSheet]);

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
    loadNodes().then(() => setNodes(getNodes())).finally(() => setNodesLoaded(true));
  }, []);
  useEffect(() => {
    const onFocus = () => loadNodes().then(() => setNodes(getNodes()));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const handleSensorTest = useCallback(
    (nodeId) => {
      if (!nodeId) return;
      sensorTest.runTest(nodeId);
    },
    [sensorTest]
  );

  const handleMarkerClick = useCallback(
    (nodeId) => {
      if (!nodeId) return;
      if (isMobile()) {
        handleNodeSelect(nodeId);
      } else {
        handleSensorTest(nodeId);
      }
    },
    [handleNodeSelect, handleSensorTest] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const mapMarkers = allNodes.filter((n) => n.lat != null && n.lng != null && n.active !== false).map((n) => {
    const inactive = n.active === false;
    const statusForNode = sensorTest.allResults[n.id]?.status ?? n.lastSensorTestStatus ?? null;
    const latest = readingsByNode[n.id];
    const batteryVoltage = latest?.battery_voltage ?? latest?.batteryVoltage ?? null;
    const batteryPercentage = latest?.battery_percentage ?? latest?.batteryPercentage ?? null;
    return {
      key: n.id,
      lat: n.lat,
      lng: n.lng,
      nodeId: n.id,
      nodeName: n.name,
      nodeLocation: n.location,
      inactive,
      batteryVoltage,
      batteryPercentage,
      onTestSensor: inactive ? null : handleMarkerClick,
      isTesting: !inactive && sensorTest.isTesting && sensorTest.results === null,
      testStatus: inactive ? null : statusForNode,
    };
  });

  if (!nodesLoaded) {
    return (
      <div className="map-page">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="map-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Map &amp; Locations</h1>
          <p className="page-subtitle">Geographic overview of monitoring nodes</p>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta" showClassification={false} />
      </header>

      <section className="card map-page__card">
        <div className="map-page__map">
            <div className="map-nodes-overlay" aria-label="Node list">
              <div className="map-nodes-overlay__header">Nodes</div>
              <ul className="map-nodes-overlay__list">
                {allNodes.filter((n) => n.active !== false).map((node) => {
                  const result = sensorTest.allResults[node.id];
                  const lastTested = result?.timestamp
                    ? new Date(result.timestamp).toLocaleString()
                    : (node.lastSensorTestAt ? new Date(node.lastSensorTestAt).toLocaleString() : "—");
                  const status = result?.status ?? node.lastSensorTestStatus ?? null;
                  const statusLabels = { success: "OK", warning: "Issue", error: "Fail", offline: "Offline" };
                  const statusLabel = statusLabels[status] ?? "—";
                  return (
                    <li key={node.id} className="map-nodes-overlay__item">
                      <div className="map-nodes-overlay__info">
                        <span className="map-nodes-overlay__name">{node.name || node.id}</span>
                        <span className="map-nodes-overlay__meta">{lastTested}</span>
                      </div>
                      <span className={`map-nodes-overlay__status map-nodes-overlay__status--${status ?? "none"}`}>
                        {statusLabel}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
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
              <MapRecenterButton center={mapCenter} className="map-recenter-btn--mobile" />
            </MapContainer>
        </div>
      </section>

      {/* Mobile node detail bottom sheet */}
      {createPortal(
        <div
          className={`map-node-sheet-backdrop ${sheetOpen ? "map-node-sheet-backdrop--open" : ""}`}
          onClick={handleSheetBackdropClick}
          aria-hidden={!sheetOpen}
        >
          <div
            ref={sheetRef}
            className={`map-node-sheet ${sheetOpen ? "map-node-sheet--open" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={selectedNode ? `Node ${selectedNode.name || selectedNode.id} details` : "Node details"}
          >
            {selectedNode && (() => {
              const result = sensorTest.allResults[selectedNode.id] ?? null;
              const status = result?.status ?? null;
              const statusLabels = {
                success: "All sensors OK",
                warning: "Sensor issue",
                error: "Sensor failure",
                offline: "Node offline",
              };
              const statusLabel = statusLabels[status] ?? "Not checked";
              return (
                <>
                  <div className="map-node-sheet__handle" />
                  <div className="map-node-sheet__header">
                    <div className="map-node-sheet__title-row">
                      <div>
                        <h2 className="map-node-sheet__name">{selectedNode.name || selectedNode.id}</h2>
                        <p className="map-node-sheet__id">{selectedNode.id}</p>
                      </div>
                      <button
                        type="button"
                        className="map-node-sheet__close"
                        onClick={closeSheet}
                        aria-label="Close"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="map-node-sheet__body">
                    <div className="map-node-sheet__info-grid">
                      {selectedNode.location && (
                        <div className="map-node-sheet__info-item">
                          <span className="map-node-sheet__info-label">Location</span>
                          <span className="map-node-sheet__info-value">{selectedNode.location}</span>
                        </div>
                      )}
                      {selectedNode.lat != null && selectedNode.lng != null && (
                        <div className="map-node-sheet__info-item">
                          <span className="map-node-sheet__info-label">Coordinates</span>
                          <span className="map-node-sheet__info-value map-node-sheet__coords">
                            {selectedNode.lat.toFixed(4)}, {selectedNode.lng.toFixed(4)}
                          </span>
                        </div>
                      )}
                      {(readingsByNode[selectedNode.id]?.battery_voltage != null || readingsByNode[selectedNode.id]?.battery_percentage != null) && (
                        <div className="map-node-sheet__info-item">
                          <span className="map-node-sheet__info-label">Battery</span>
                          <span className="map-node-sheet__info-value">
                            <BatteryIndicator
                              {...batteryPropsFromReading(readingsByNode[selectedNode.id])}
                              showPercentage
                              size="medium"
                            />
                          </span>
                        </div>
                      )}
                      <div className="map-node-sheet__info-item">
                        <span className="map-node-sheet__info-label">Sensor status</span>
                        <span className={`map-node-sheet__status map-node-sheet__status--${status ?? "none"}`}>
                          {statusLabel}
                        </span>
                      </div>
                      {result?.timestamp && (
                        <div className="map-node-sheet__info-item">
                          <span className="map-node-sheet__info-label">Last tested</span>
                          <span className="map-node-sheet__info-value">
                            {new Date(result.timestamp).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="map-node-sheet__test-btn"
                      onClick={() => {
                        closeSheet();
                        handleSensorTest(selectedNode.id);
                      }}
                      disabled={sensorTest.isTesting}
                    >
                      {sensorTest.isTesting ? "Testing…" : "Run Sensor Test"}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>,
        document.body
      )}

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
