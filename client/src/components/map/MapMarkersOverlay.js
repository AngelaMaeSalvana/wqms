import React, { useState, useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import NodeMarker from "../markers/NodeMarker";

/**
 * Renders custom React markers (NodeMarker) at lat/lng by converting to pixel
 * positions. Re-renders on map move/zoom so markers stay in place.
 * Disables map dragging on marker mousedown so the button still receives
 * the click and the sensor test modal can open.
 */
export default function MapMarkersOverlay({ markers = [] }) {
  const map = useMap();
  const [, setUpdate] = useState(0);
  const overlayRef = useRef(null);

  useMapEvents({
    moveend: () => setUpdate((n) => n + 1),
    zoomend: () => setUpdate((n) => n + 1),
  });

  /* Ensure map fills container after layout resolves (fixes mobile half-height) */
  useEffect(() => {
    if (!map) return;
    map.invalidateSize();
    const t = setTimeout(() => map.invalidateSize(), 100);
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [map]);

  useEffect(() => {
    const container = map?.getContainer?.();
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    const onMarkerPointerDown = (e) => {
      if (overlay.contains(e.target)) {
        map.dragging?.disable();
        map.tap?.disable?.();
      }
    };
    const onPointerUp = () => {
      map.dragging?.enable();
      map.tap?.enable?.();
    };

    container.addEventListener("mousedown", onMarkerPointerDown, true);
    container.addEventListener("touchstart", onMarkerPointerDown, { capture: true, passive: true });
    document.addEventListener("mouseup", onPointerUp);
    document.addEventListener("touchend", onPointerUp);
    return () => {
      container.removeEventListener("mousedown", onMarkerPointerDown, true);
      container.removeEventListener("touchstart", onMarkerPointerDown, true);
      document.removeEventListener("mouseup", onPointerUp);
      document.removeEventListener("touchend", onPointerUp);
      map.dragging?.enable();
      map.tap?.enable?.();
    };
  }, [map]);

  if (!map || !markers.length) return null;

  return (
    <div
      ref={overlayRef}
      className="leaflet-marker-overlay"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1000,
      }}
    >
      {markers.map((m, i) => {
        const point = map.latLngToContainerPoint([m.lat, m.lng]);
        return (
          <div
            key={m.key ?? i}
            className="leaflet-marker-hitarea"
            style={{
              position: "absolute",
              left: point.x,
              top: point.y,
              transform: "translate(-50%, -50%)",
              width: 48,
              height: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "auto",
              cursor: "pointer",
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <NodeMarker
              nodeId={m.nodeId}
              onTestSensor={m.onTestSensor}
              isTesting={m.isTesting}
              testStatus={m.testStatus}
              inactive={m.inactive}
              batteryVoltage={m.batteryVoltage}
            />
          </div>
        );
      })}
    </div>
  );
}
