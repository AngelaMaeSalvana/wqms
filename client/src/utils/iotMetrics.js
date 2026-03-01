/**
 * Compute IoT performance metrics from raw sensor_readings rows.
 * Uses seq gaps to infer missing packets (receiver-side inference).
 *
 * Formulas:
 *   PLR(%) = (sent - received) / sent × 100
 *   PDR(%) = received / sent × 100
 *   Availability(%) = received / (received + lost) × 100
 *
 * E2E latency (Fwd → BE) = t_be_rx - t_fwd_rx
 *
 * @param {object[]} rows - Raw sensor_readings rows.
 * @param {string|null} nodeId - Filter to a single node, or null/all for all nodes.
 * @param {number|null} expectedPerNode - Expected packet count per node (from test run config).
 *   When provided, totalSent = max(seq-inferred, expected) so that packets the node never
 *   transmitted (e.g. due to a delayed test-mode start) are counted as lost.
 */
export function computeIoTMetrics(rows, nodeId, expectedPerNode = null) {
  const perNode = {};

  rows.forEach((r) => {
    const nid = r.node_id;
    if (nodeId && nodeId !== "all" && nid !== nodeId) return;
    if (!perNode[nid]) perNode[nid] = [];
    perNode[nid].push(r);
  });

  const nodeResults = {};

  Object.entries(perNode).forEach(([nid, nodeRows]) => {
    const withSeq = nodeRows
      .filter((r) => r.seq != null && Number.isFinite(Number(r.seq)))
      .map((r) => ({ ...r, seq: Number(r.seq) }));

    const toMs = (r) => {
      if (r.t_fwd_rx != null && Number(r.t_fwd_rx) > 0) return Number(r.t_fwd_rx);
      if (r.t_be_rx != null && Number(r.t_be_rx) > 0) return Number(r.t_be_rx);
      if (r.timestamp) {
        const t = new Date(r.timestamp).getTime();
        if (Number.isFinite(t)) return t;
      }
      return 0;
    };
    withSeq.sort((a, b) => toMs(a) - toMs(b));

    let totalReceived = 0;
    let totalSent = 0;
    let missingSeqs = 0;

    let segMin = null;
    let segMax = null;
    let segSeqs = new Set();
    let lastSeq = null;

    const flushSegment = () => {
      if (segMin == null || segMax == null) return;
      const segSent = segMax - segMin + 1;
      const segRecv = segSeqs.size;
      totalSent += segSent;
      totalReceived += segRecv;
      missingSeqs += Math.max(0, segSent - segRecv);
      segMin = null;
      segMax = null;
      segSeqs = new Set();
      lastSeq = null;
    };

    for (const r of withSeq) {
      const s = r.seq;
      if (lastSeq != null && s < lastSeq) flushSegment();
      if (segMin == null || s < segMin) segMin = s;
      if (segMax == null || s > segMax) segMax = s;
      segSeqs.add(s);
      lastSeq = s;
    }
    flushSegment();

    if (withSeq.length <= 1) {
      totalReceived = withSeq.length;
      totalSent = withSeq.length;
      missingSeqs = 0;
    }

    // If an expected count is known (from test run config), use it as the floor for totalSent.
    // This catches packets the node never transmitted (delayed test-mode start, early stop)
    // which leave no seq gap but still count as lost against the configured test window.
    if (expectedPerNode != null && Number.isFinite(expectedPerNode) && expectedPerNode > totalSent) {
      missingSeqs += expectedPerNode - totalSent;
      totalSent = expectedPerNode;
    }

    const pdr = totalSent > 0 ? (totalReceived / totalSent) * 100 : null;
    const plr = totalSent > 0 ? (missingSeqs / totalSent) * 100 : null;
    const availability = totalSent > 0 ? (totalReceived / totalSent) * 100 : null;

    const e2eLatencies = nodeRows
      .filter((r) => r.t_fwd_rx != null && r.t_be_rx != null && Number(r.t_fwd_rx) > 0)
      .map((r) => Number(r.t_be_rx) - Number(r.t_fwd_rx))
      .filter((v) => v >= 0 && v < 60000);

    const e2eMean = e2eLatencies.length > 0 ? e2eLatencies.reduce((a, b) => a + b, 0) / e2eLatencies.length : null;
    const e2eSorted = [...e2eLatencies].sort((a, b) => a - b);
    const e2eP95 = e2eSorted.length > 0 ? e2eSorted[Math.floor(e2eSorted.length * 0.95)] : null;
    const e2eMax = e2eSorted.length > 0 ? e2eSorted[e2eSorted.length - 1] : null;

    const fwdToDash = nodeRows
      .filter((r) => r.t_fwd_rx != null && r.t_dash_rx != null && Number(r.t_fwd_rx) > 0)
      .map((r) => Number(r.t_dash_rx) - Number(r.t_fwd_rx))
      .filter((v) => v >= 0 && v < 120000);

    const fwdProc = nodeRows
      .filter((r) => r.t_fwd_rx != null && r.t_fwd_pub != null && Number(r.t_fwd_rx) > 0)
      .map((r) => Number(r.t_fwd_pub) - Number(r.t_fwd_rx))
      .filter((v) => v >= 0 && v < 30000);

    const mqttBackend = nodeRows
      .filter((r) => r.t_fwd_pub != null && r.t_be_rx != null)
      .map((r) => Number(r.t_be_rx) - Number(r.t_fwd_pub))
      .filter((v) => v >= 0 && v < 30000);

    const nodeToFwd = nodeRows
      .filter((r) => r.t_node != null && Number(r.t_node) > 0 && r.t_fwd_rx != null)
      .map((r) => Number(r.t_fwd_rx) - Number(r.t_node))
      .filter((v) => v >= 0 && v < 30000);

    const avg = (arr) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

    // LoRa link quality (captured by forwarder; null when not present)
    const rssiVals = nodeRows.map((r) => r.rssi).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
    const snrVals  = nodeRows.map((r) => r.snr).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);

    nodeResults[nid] = {
      totalReceived,
      totalSent,
      missingSeqs,
      pdr,
      plr,
      availability,
      e2eMean,
      e2eP95,
      e2eMax,
      e2eSampleCount: e2eLatencies.length,
      fwdToDashMean: avg(fwdToDash),
      fwdProcMean: avg(fwdProc),
      mqttBackendMean: avg(mqttBackend),
      nodeToFwdMean: avg(nodeToFwd),
      // Link quality
      rssiMean: avg(rssiVals),
      rssiMin:  rssiVals.length > 0 ? Math.min(...rssiVals) : null,
      rssiMax:  rssiVals.length > 0 ? Math.max(...rssiVals) : null,
      snrMean:  avg(snrVals),
      snrMin:   snrVals.length > 0 ? Math.min(...snrVals) : null,
      snrMax:   snrVals.length > 0 ? Math.max(...snrVals) : null,
      linkSampleCount: rssiVals.length,
    };
  });

  return nodeResults;
}
