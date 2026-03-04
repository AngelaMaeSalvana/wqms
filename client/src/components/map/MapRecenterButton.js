import React from "react";
import { useMap } from "react-leaflet";

/**
 * Floating button to recenter the map. Renders inside MapContainer.
 */
export default function MapRecenterButton({ center, className = "" }) {
  const map = useMap();

  const handleClick = () => {
    if (center && map) {
      map.flyTo(center, map.getZoom(), { duration: 0.5 });
    }
  };

  return (
    <div className={`map-recenter-btn-wrap ${className}`}>
      <button
        type="button"
        className="map-recenter-btn"
        onClick={handleClick}
        aria-label="Recenter map"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      </button>
    </div>
  );
}
