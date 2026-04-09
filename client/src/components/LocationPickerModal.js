import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "./LocationPickerModal.css";

function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
  }, [map]);
  return null;
}

const DEFAULT_CENTER = [8.462591, 124.707831];
const DEFAULT_ZOOM = 12;

/** Default Leaflet icon (fixes react-leaflet marker icon in bundlers) */
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function PickerMapContent({ position, onPositionChange, markerRef }) {
  useMapEvents({
    click(e) {
      onPositionChange(e.latlng.lat, e.latlng.lng);
    },
  });

  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current;
        if (marker) {
          const ll = marker.getLatLng();
          onPositionChange(ll.lat, ll.lng);
        }
      },
    }),
    [onPositionChange, markerRef]
  );

  if (position == null) return null;

  return (
    <Marker
      ref={markerRef}
      position={position}
      draggable
      eventHandlers={eventHandlers}
      icon={defaultIcon}
    />
  );
}

export default function LocationPickerModal({ open, initialLat, initialLng, onSelect, onClose }) {
  const markerRef = useRef(null);
  const [position, setPosition] = useState(null);
  const [mapMounted, setMapMounted] = useState(false);

  useEffect(() => {
    if (open) {
      setMapMounted(false);
      const t = setTimeout(() => setMapMounted(true), 100);
      return () => clearTimeout(t);
    } else {
      setMapMounted(false);
    }
  }, [open]);

  const initial = useMemo(() => {
    const lat = parseFloat(initialLat);
    const lng = parseFloat(initialLng);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return [lat, lng];
    }
    return DEFAULT_CENTER;
  }, [initialLat, initialLng]);

  useEffect(() => {
    if (open) {
      setPosition(initial);
    }
  }, [open, initial]);

  const handlePositionChange = useCallback((lat, lng) => {
    setPosition([lat, lng]);
  }, []);

  const handleApply = useCallback(() => {
    if (position && position.length === 2) {
      onSelect(position[0], position[1]);
    }
    onClose();
  }, [position, onSelect, onClose]);

  const handleBackdropClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    const onEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="location-picker-overlay"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="location-picker-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-picker-title"
      >
        <div className="location-picker-modal__header">
          <h2 id="location-picker-title">Pick location on map</h2>
          <button
            type="button"
            className="location-picker-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="location-picker-modal__hint">
          Click on the map or drag the marker to set the node location.
        </p>
        <div className="location-picker-map-wrap" style={{ minHeight: 320, height: 320 }}>
          {mapMounted && (
            <MapContainer
              center={position || initial}
              zoom={DEFAULT_ZOOM}
              className="location-picker-map"
              style={{ height: "100%", width: "100%", minHeight: 320 }}
              scrollWheelZoom
              key="location-picker-map"
            >
              <InvalidateSize />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <PickerMapContent
                position={position}
                onPositionChange={handlePositionChange}
                markerRef={markerRef}
              />
            </MapContainer>
          )}
        </div>
        <div className="location-picker-modal__coords">
          {position && (
            <span>
              {position[0].toFixed(6)}, {position[1].toFixed(6)}
            </span>
          )}
        </div>
        <div className="location-picker-modal__actions">
          <button type="button" className="nodes-btn nodes-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="nodes-btn nodes-btn--primary" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
