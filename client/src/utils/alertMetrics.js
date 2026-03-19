/**
 * Alert responsiveness metrics: trigger latency (cause → backend) and email delay.
 * Shared by Performance Test page and Test Run Detail modal.
 */

const TRIGGER_LATENCY_WINDOW_MS = 10 * 60 * 1000; // 10 min before alert to look for cause reading
const TRIGGER_LATENCY_MAX_MS = 24 * 60 * 60 * 1000; // ignore if > 24h

/**
 * Find the best "cause" reading for an alert: same node, timestamp <= alert time, within window.
 * Returns { causeTime } (epoch ms) or null.
 */
function findCauseReading(alert, readings) {
  const triggerMs = alert.t_alert_trigger != null ? Number(alert.t_alert_trigger) : null;
  const alertTs = alert.timestamp ? new Date(alert.timestamp).getTime() : triggerMs;
  if (triggerMs == null || alertTs == null) return null;

  const nodeId = alert.node_id ?? alert.nodeId;
  const windowStart = alertTs - TRIGGER_LATENCY_WINDOW_MS;
  const candidates = (readings || []).filter((r) => {
    if ((r.node_id || r.nodeId) !== nodeId) return false;
    const rTime = r.t_node != null ? Number(r.t_node) : new Date(r.timestamp).getTime();
    return rTime <= alertTs && rTime >= windowStart;
  });
  if (candidates.length === 0) return null;
  const withSeq = alert.seq != null
    ? candidates.filter((r) => Number(r.seq) === Number(alert.seq))
    : candidates;
  const pool = withSeq.length > 0 ? withSeq : candidates;
  const best = pool.reduce((a, b) => {
    const aTime = a.t_node != null ? Number(a.t_node) : new Date(a.timestamp).getTime();
    const bTime = b.t_node != null ? Number(b.t_node) : new Date(b.timestamp).getTime();
    return bTime > aTime ? b : a;
  });
  const causeTime = best.t_node != null ? Number(best.t_node) : new Date(best.timestamp).getTime();
  return { causeTime };
}

/**
 * @param {Array} alertRows - Alerts with t_alert_trigger, timestamp, optional email_sent_at
 * @param {Array} [perfRows] - Sensor readings for matching cause (same node, time window)
 * @returns {{ count, meanMs, maxMs, triggerLatencyMeanMs, triggerLatencyMaxMs, triggerLatencySamples, emailSentCount, emailDelayMeanMs, emailDelayMaxMs }}
 */
export function computeAlertMetrics(alertRows, perfRows = []) {
  const withTrigger = alertRows.filter((r) => r.t_alert_trigger != null && r.timestamp != null);
  const responseTimes = withTrigger.map((r) => {
    const triggered = Number(r.t_alert_trigger);
    const stored = new Date(r.timestamp).getTime();
    return Math.abs(stored - triggered);
  }).filter((v) => v >= 0 && v < 300000);

  const triggerLatencies = [];
  for (const r of withTrigger) {
    const cause = findCauseReading(r, perfRows);
    if (!cause) continue;
    const latency = Number(r.t_alert_trigger) - cause.causeTime;
    if (latency > 0 && latency < TRIGGER_LATENCY_MAX_MS) triggerLatencies.push(latency);
  }

  const emailDelays = alertRows
    .filter((r) => r.t_alert_trigger != null && r.email_sent_at != null)
    .map((r) => {
      const triggerMs = Number(r.t_alert_trigger);
      const sentMs = new Date(r.email_sent_at).getTime();
      return sentMs - triggerMs;
    })
    .filter((d) => d >= 0 && d < 7 * 24 * 3600 * 1000);

  return {
    count: alertRows.length,
    meanMs: responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null,
    maxMs: responseTimes.length > 0 ? Math.max(...responseTimes) : null,
    triggerLatencyMeanMs: triggerLatencies.length > 0 ? triggerLatencies.reduce((a, b) => a + b, 0) / triggerLatencies.length : null,
    triggerLatencyMaxMs: triggerLatencies.length > 0 ? Math.max(...triggerLatencies) : null,
    triggerLatencySamples: triggerLatencies.length,
    emailSentCount: emailDelays.length,
    emailDelayMeanMs: emailDelays.length > 0 ? emailDelays.reduce((a, b) => a + b, 0) / emailDelays.length : null,
    emailDelayMaxMs: emailDelays.length > 0 ? Math.max(...emailDelays) : null,
  };
}
