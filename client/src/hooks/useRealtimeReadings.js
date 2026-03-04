import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { applyCalibrationToReadings } from '../utils/calibration';
import { getNH3FromReading } from '../utils/nh3Calculator';

/**
 * Subscribes to real-time INSERT events on the `sensor_readings` table.
 *
 * When a new row arrives it is calibrated, enriched with computed fields
 * (nh3, NH3, dissolvedOxygen aliases, etc.) and passed to `onNewReading`.
 *
 * @param {object} options
 * @param {string|null} options.nodeId   - If set, only events for this node_id are forwarded.
 * @param {string}      options.date     - ISO date string "YYYY-MM-DD". Rows whose timestamp
 *                                         falls outside this date are silently dropped.
 * @param {Function}    options.onNewReading - Called with the enriched row whenever a new
 *                                             reading arrives that matches the filters.
 * @returns {{ isSubscribed: React.MutableRefObject<boolean> }}
 */
export function useRealtimeReadings({ nodeId = null, date = null, onNewReading }) {
  const onNewReadingRef = useRef(onNewReading);
  onNewReadingRef.current = onNewReading;

  const isSubscribed = useRef(false);

  const handlePayload = useCallback((payload) => {
    const raw = payload.new;
    if (!raw) return;

    // Date filter: compare using local date to avoid UTC/local midnight mismatch.
    if (date && raw.timestamp) {
      const rowLocalDate = new Date(raw.timestamp).toLocaleDateString('en-CA'); // "YYYY-MM-DD" in local TZ
      if (rowLocalDate !== date) return;
    }

    // Drop rows for a different node (when a node filter is active).
    if (nodeId && raw.node_id !== nodeId) return;

    // Apply calibration and enrich with computed aliases.
    const [calibrated] = applyCalibrationToReadings([raw]);
    const enriched = {
      ...calibrated,
      pH: calibrated.ph,
      dissolvedOxygen: calibrated.dissolved_oxygen,
      do: calibrated.dissolved_oxygen,
      nh3: getNH3FromReading(calibrated),
      NH3: getNH3FromReading(calibrated),
      flowRate: calibrated.flow_rate ?? calibrated.flowRate,
    };

    onNewReadingRef.current?.(enriched);
  }, [nodeId, date]);

  useEffect(() => {
    if (!supabase) return;

    const channelName = nodeId
      ? `sensor_readings_live_${nodeId}`
      : 'sensor_readings_live';

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sensor_readings',
          ...(nodeId ? { filter: `node_id=eq.${nodeId}` } : {}),
        },
        handlePayload
      )
      .subscribe((status) => {
        isSubscribed.current = status === 'SUBSCRIBED';
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] sensor_readings channel subscribed', channelName);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] sensor_readings channel error:', status, channelName);
        }
      });

    return () => {
      isSubscribed.current = false;
      supabase.removeChannel(channel);
    };
  }, [nodeId, handlePayload]);

  return { isSubscribed };
}
