import React, { useMemo } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import MapMarkersOverlay from "../map/MapMarkersOverlay";
import ChangeView from "../map/ChangeView";
import "./dashboard.css";

const DEFAULT_CENTER = [8.54, 124.65];
const DEFAULT_ZOOM = 20;

export function MiniMapCard({ nodes = [], selectedNode, onTestSensor, isTestingSensor, sensorTestResults, readingsByNode = {} }) {
  const center = useMemo(() => {
    if (selectedNode && selectedNode.lat != null && selectedNode.lng != null) {
      return [selectedNode.lat, selectedNode.lng];
    }
    return DEFAULT_CENTER;
  }, [selectedNode]);

  // sensorTestResults is a map of { [nodeId]: result }
  const markers = useMemo(
    () =>
      nodes
        .filter((n) => n.lat != null && n.lng != null)
        .map((n) => {
          const r = readingsByNode[n.id];
          const batteryVoltage = r?.battery_voltage ?? r?.batteryVoltage ?? null;
          return {
            key: n.id,
            lat: n.lat,
            lng: n.lng,
            nodeId: n.id,
            batteryVoltage,
            onTestSensor,
            isTesting: isTestingSensor,
            testStatus: sensorTestResults?.[n.id]?.status ?? null,
          };
        }),
    [nodes, onTestSensor, isTestingSensor, sensorTestResults, readingsByNode]
  );

  return (
    <div className="card card--fill mini-map-card">
      <div className="card__header">
        <div>
          <h2 className="card__title">Mini Map</h2>
        </div>
      </div>
      <div className="card__body card__body--fill">
        <div className="mini-map-wrapper mini-map-wrapper--leaflet">
          <MapContainer
            center={center}
            zoom={DEFAULT_ZOOM}
            className="leaflet-mini-map"
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ChangeView center={center} zoom={DEFAULT_ZOOM} />
            <MapMarkersOverlay markers={markers} />
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

export default MiniMapCard;
