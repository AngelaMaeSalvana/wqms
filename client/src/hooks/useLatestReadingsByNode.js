import { useState, useEffect, useMemo } from "react";
import api from "../services/api";

/**
 * Fetches the most recent readings and returns the latest reading per node.
 * Used for battery indicator and other per-node "latest" data.
 */
export function useLatestReadingsByNode() {
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getReadings({ monitoringOnly: true, limit: 200 })
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setReadings(rows);
      })
      .catch(() => {
        if (!cancelled) setReadings([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const readingsByNode = useMemo(() => {
    const byNode = {};
    const sorted = [...readings].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    sorted.forEach((r) => {
      const nid = r.node_id || r.nodeId || "1";
      if (!byNode[nid]) byNode[nid] = r;
    });
    return byNode;
  }, [readings]);

  return { readingsByNode, loading };
}
