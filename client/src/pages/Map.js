import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer } from "react-leaflet";
import MapMarkersOverlay from "../components/map/MapMarkersOverlay";
import BatteryIndicator from "../components/BatteryIndicator";
import MapRecenterButton from "../components/map/MapRecenterButton";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { getNodes, loadNodes } from "../utils/nodesStorage";
import { useSensorTest } from "../hooks/useSensorTest";
import { useLatestReadingsByNode } from "../hooks/useLatestReadingsByNode";
import { PageLoader } from "../components/LoadingSkeleton";
import "./Map.css";

const FALLBACK_CENTER = [8.462591, 124.707831];
const DEFAULT_ZOOM = 11;

const MAP_NODES_PAGE_SIZE = 15;

export default function Map() {
  const [nodes, setNodes] = useState([]);
  const [mapNodesPage, setMapNodesPage] = useState(1);
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
    const statusForNode = sensorTest.allResults[n.id]?.status ?? null;
    const latest = readingsByNode[n.id];
    const batteryVoltage = latest?.battery_voltage ?? latest?.batteryVoltage ?? null;
    return {
      key: n.id,
      lat: n.lat,
      lng: n.lng,
      nodeId: n.id,
      nodeName: n.name,
      nodeLocation: n.location,
      inactive,
      batteryVoltage,
      onTestSensor: inactive ? null : handleMarkerClick,
      isTesting: !inactive && sensorTest.isTesting && sensorTest.results === null,
      testStatus: inactive ? null : statusForNode,
    };
  });

  const [mapTableSort, setMapTableSort] = useState({ column: "node", direction: "asc" });
  const [mapNodesSearch, setMapNodesSearch] = useState("");

  const nodesTableData = allNodes.filter((n) => n.active !== false).map((n) => {
    const result = sensorTest.allResults[n.id] ?? null;
    let repairStatus = "Not checked";
    if (result?.status === "success") repairStatus = "All sensors OK";
    else if (result?.status === "warning") repairStatus = "Sensor issue";
    else if (result?.status === "error") repairStatus = "Sensor failure";
    else if (result?.status === "offline") repairStatus = "Node offline";
    const lastTestTs = result?.timestamp ? new Date(result.timestamp).getTime() : 0;
    return {
      ...n,
      lastTest: result ? new Date(result.timestamp).toLocaleString() : "—",
      lastTestTimestamp: lastTestTs,
      repairStatus,
      resultStatus: result?.status ?? null,
    };
  });

  const filteredNodesTableData = useMemo(() => {
    const q = mapNodesSearch.trim().toLowerCase();
    if (!q) return nodesTableData;
    return nodesTableData.filter(
      (row) =>
        (row.id && row.id.toLowerCase().includes(q)) ||
        (row.name && row.name.toLowerCase().includes(q)) ||
        (row.location && row.location.toLowerCase().includes(q))
    );
  }, [nodesTableData, mapNodesSearch]);

  const sortedNodesTableData = useMemo(() => {
    const { column, direction } = mapTableSort;
    return [...filteredNodesTableData].sort((a, b) => {
      let cmp = 0;
      if (column === "node") cmp = String(a.name || a.id).localeCompare(String(b.name || b.id));
      else if (column === "location") cmp = String(a.location || "").localeCompare(String(b.location || ""));
      else if (column === "coordinates") {
        const va = a.lat != null && a.lng != null ? `${a.lat},${a.lng}` : "";
        const vb = b.lat != null && b.lng != null ? `${b.lat},${b.lng}` : "";
        cmp = va.localeCompare(vb);
      } else if (column === "lastTest") cmp = (a.lastTestTimestamp ?? 0) - (b.lastTestTimestamp ?? 0);
      else if (column === "sensorStatus") {
        const order = { success: 0, warning: 1, error: 2, offline: 3, null: 4 };
        const oa = order[a.resultStatus ?? "null"] ?? 3;
        const ob = order[b.resultStatus ?? "null"] ?? 3;
        cmp = oa - ob;
      }
      return direction === "asc" ? cmp : -cmp;
    });
  }, [filteredNodesTableData, mapTableSort]);

  const mapNodesTotal = sortedNodesTableData.length;
  const mapNodesTotalPages = Math.max(1, Math.ceil(mapNodesTotal / MAP_NODES_PAGE_SIZE));
  const mapNodesPageClamped = Math.min(mapNodesPage, mapNodesTotalPages);

  useEffect(() => {
    if (mapNodesPage > mapNodesTotalPages) setMapNodesPage(Math.max(1, mapNodesTotalPages));
  }, [mapNodesTotalPages, mapNodesPage]);

  useEffect(() => {
    setMapNodesPage(1);
  }, [mapNodesSearch]);

  const paginatedNodesTableData = useMemo(
    () =>
      sortedNodesTableData.slice(
        (mapNodesPageClamped - 1) * MAP_NODES_PAGE_SIZE,
        mapNodesPageClamped * MAP_NODES_PAGE_SIZE
      ),
    [sortedNodesTableData, mapNodesPageClamped]
  );

  if (!nodesLoaded) {
    return (
      <div className="map-page">
        <PageLoader />
      </div>
    );
  }

  const goToMapNodesPage = (page) => {
    const p = Math.max(1, Math.min(page, mapNodesTotalPages));
    setMapNodesPage(p);
  };

  return (
    <div className="map-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Map &amp; Locations</h1>
          <p className="page-subtitle">Geographic overview of monitoring nodes</p>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta" showClassification={false} />
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
              <MapRecenterButton center={mapCenter} className="map-recenter-btn--mobile" />
            </MapContainer>
          </div>
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
                      {(readingsByNode[selectedNode.id]?.battery_voltage ?? readingsByNode[selectedNode.id]?.batteryVoltage) != null && (
                        <div className="map-node-sheet__info-item">
                          <span className="map-node-sheet__info-label">Battery</span>
                          <span className="map-node-sheet__info-value">
                            <BatteryIndicator
                              voltage={readingsByNode[selectedNode.id]?.battery_voltage ?? readingsByNode[selectedNode.id]?.batteryVoltage}
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

      <section className="card map-nodes-card">
        <header className="section-header map-nodes-card__header">
          <h2 className="card__title">All Nodes — Location &amp; Sensor Status</h2>
          <input
            type="search"
            className="map-nodes-search"
            placeholder="Search nodes…"
            value={mapNodesSearch}
            onChange={(e) => setMapNodesSearch(e.target.value)}
            aria-label="Search nodes"
          />
        </header>
        <div className="map-nodes-card__body">
          <div className="map-nodes-table-wrap">
            <table className="map-nodes-table" role="table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className={`map-th-btn ${mapTableSort.column === "node" ? "map-th-btn--active" : ""}`}
                      onClick={() =>
                        setMapTableSort((s) => ({
                          column: "node",
                          direction: s.column === "node" && s.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Node {mapTableSort.column === "node" && (mapTableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`map-th-btn ${mapTableSort.column === "location" ? "map-th-btn--active" : ""}`}
                      onClick={() =>
                        setMapTableSort((s) => ({
                          column: "location",
                          direction: s.column === "location" && s.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Location {mapTableSort.column === "location" && (mapTableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`map-th-btn ${mapTableSort.column === "coordinates" ? "map-th-btn--active" : ""}`}
                      onClick={() =>
                        setMapTableSort((s) => ({
                          column: "coordinates",
                          direction: s.column === "coordinates" && s.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Coordinates {mapTableSort.column === "coordinates" && (mapTableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`map-th-btn ${mapTableSort.column === "lastTest" ? "map-th-btn--active" : ""}`}
                      onClick={() =>
                        setMapTableSort((s) => ({
                          column: "lastTest",
                          direction: s.column === "lastTest" && s.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Last test {mapTableSort.column === "lastTest" && (mapTableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`map-th-btn ${mapTableSort.column === "sensorStatus" ? "map-th-btn--active" : ""}`}
                      onClick={() =>
                        setMapTableSort((s) => ({
                          column: "sensorStatus",
                          direction: s.column === "sensorStatus" && s.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Sensor status {mapTableSort.column === "sensorStatus" && (mapTableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {paginatedNodesTableData.map((row) => {
                  const inactive = row.active === false;
                  return (
                    <tr key={row.id} className={inactive ? "map-nodes-table__row--inactive" : ""}>
                      <td>
                        <span className="map-nodes-table__node-name">{row.name}</span>
                        <span className="map-nodes-table__node-id">{row.id}</span>
                        {inactive && <span className="map-nodes-table__inactive-badge">Inactive</span>}
                      </td>
                      <td>{row.location}</td>
                      <td className="map-nodes-table__coords">
                        {row.lat != null && row.lng != null
                          ? `${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}`
                          : "—"}
                      </td>
                      <td>{inactive ? "—" : row.lastTest}</td>
                      <td>
                        {inactive ? (
                          <span className="map-nodes-table__status map-nodes-table__status--none">Inactive</span>
                        ) : (
                          <span
                            className={`map-nodes-table__status map-nodes-table__status--${row.resultStatus ?? "none"}`}
                            title={row.resultStatus ? row.repairStatus : "No test run today"}
                          >
                            {row.repairStatus}
                          </span>
                        )}
                      </td>
                      <td>
                        {!inactive && (
                          <button
                            type="button"
                            className="ghost-btn map-nodes-table__test-btn"
                            onClick={() => handleSensorTest(row.id)}
                            aria-label={`Test sensor for ${row.name}`}
                          >
                            Test sensor
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mapNodesTotalPages > 1 && (
            <div className="map-nodes-pagination">
              <span className="map-nodes-pagination__info">
                Page {mapNodesPageClamped} of {mapNodesTotalPages}
                {mapNodesTotal > 0 && (
                  <span className="map-nodes-pagination__count">
                    {" "}({mapNodesTotal} node{mapNodesTotal !== 1 ? "s" : ""})
                  </span>
                )}
              </span>
              <div className="map-nodes-pagination__btns">
                <button
                  type="button"
                  className="map-nodes-pagination__btn"
                  onClick={() => goToMapNodesPage(mapNodesPageClamped - 1)}
                  disabled={mapNodesPageClamped <= 1}
                  aria-label="Previous page"
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="map-nodes-pagination__btn"
                  onClick={() => goToMapNodesPage(mapNodesPageClamped + 1)}
                  disabled={mapNodesPageClamped >= mapNodesTotalPages}
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

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
