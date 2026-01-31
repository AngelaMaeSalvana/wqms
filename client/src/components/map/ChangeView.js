import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Updates the map view (center/zoom) when props change.
 * Use inside MapContainer so the map auto-centers on the chosen node.
 */
export default function ChangeView({ center, zoom }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !center || !Array.isArray(center)) return;
    const lat = center[0];
    const lng = center[1];
    if (typeof lat !== "number" || typeof lng !== "number") return;
    const z = typeof zoom === "number" ? zoom : map.getZoom();
    map.setView([lat, lng], z, { animate: true });
  }, [map, center, zoom]);

  return null;
}
