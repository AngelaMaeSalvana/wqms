import { useState, useEffect, useCallback, useRef } from 'react';
import { isSupabaseEnabled } from '../lib/supabaseClient';

/**
 * A node is considered Online if it has sent a sensor reading within
 * ONLINE_THRESHOLD_MS AND at least one sensor field has a non-null value.
 * A node is Offline only when it has no recent reading OR all sensor fields are null.
 */
const ONLINE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const POLL_INTERVAL_MS = 60 * 1000;          // re-check every 60 seconds

// NH₃ is calculated, not a raw column — check the direct sensor fields only
const SENSOR_KEYS = ['temperature', 'turbidity', 'ph', 'dissolved_oxygen'];

function hasAnySensorData(row) {
  if (!row) return false;
  return SENSOR_KEYS.some((k) => row[k] != null && !isNaN(Number(row[k])));
}

/**
 * Derives Online/Offline status for each node based on the most recent
 * sensor reading stored in Supabase.
 * - Online: recent reading (within 15 min) with at least one sensor value present
 * - Offline: no recent reading, OR all sensor values are null/blank
 *
 * @param {Array} nodes - Array of node objects with at least { id }
 * @returns {{ nodeStatuses: Object, refreshStatuses: Function }}
 *   nodeStatuses: { [nodeId]: 'online' | 'offline' }
 *   refreshStatuses: call to force an immediate re-check
 */
export function useNodeStatus(nodes) {
  const [nodeStatuses, setNodeStatuses] = useState({});
  const timerRef = useRef(null);

  const fetchStatuses = useCallback(async () => {
    if (!Array.isArray(nodes) || nodes.length === 0) return;

    try {
      if (isSupabaseEnabled()) {
        const { getLatestReadingsPerNode } = await import('../services/supabaseService');
        const rowMap = await getLatestReadingsPerNode();
        const now = Date.now();
        const statuses = {};
        nodes.forEach(({ id }) => {
          const row = rowMap[id];
          if (row?.timestamp) {
            const age = now - new Date(row.timestamp).getTime();
            const recentEnough = age <= ONLINE_THRESHOLD_MS;
            const hasSensorData = hasAnySensorData(row);
            statuses[id] = recentEnough && hasSensorData ? 'online' : 'offline';
          } else {
            statuses[id] = 'offline';
          }
        });
        setNodeStatuses(statuses);
      } else {
        // Fallback: try the Express API for latest reading per node
        const { default: api } = await import('../services/api');
        const now = Date.now();
        const statuses = {};
        await Promise.all(
          nodes.map(async ({ id }) => {
            try {
              const row = await api.getLatestReading(id);
              const ts = row?.timestamp;
              if (ts) {
                const age = now - new Date(ts).getTime();
                const recentEnough = age <= ONLINE_THRESHOLD_MS;
                const hasSensorData = hasAnySensorData(row);
                statuses[id] = recentEnough && hasSensorData ? 'online' : 'offline';
              } else {
                statuses[id] = 'offline';
              }
            } catch {
              statuses[id] = 'offline';
            }
          })
        );
        setNodeStatuses(statuses);
      }
    } catch (e) {
      console.warn('useNodeStatus: failed to fetch statuses', e);
    }
  }, [nodes]);

  useEffect(() => {
    fetchStatuses();
    timerRef.current = setInterval(fetchStatuses, POLL_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchStatuses]);

  return { nodeStatuses, refreshStatuses: fetchStatuses };
}
