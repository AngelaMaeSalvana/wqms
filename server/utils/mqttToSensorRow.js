/**
 * Build sensor_readings row (+ WebSocket telemetry) from one MQTT JSON payload.
 * Applies lab corrections, then user calibration → *_corrected columns; WQI uses corrected params.
 */

const { applySensorCorrections } = require('./sensorCorrections');
const { getCalibrationCached } = require('./getCalibration');
const { applyUserCalibrationCorrected } = require('./applyUserCalibrationCorrected');
const { calculateWQI } = require('./nh3Wqi');

function nodeIdFromTopic(topic) {
  const parts = String(topic).split('/');
  if (parts[0] === 'water-quality' && parts[1] && parts[1] !== 'command') return parts[1];
  return null;
}

function normalizeNodeId(id) {
  if (!id || typeof id !== 'string') return id;
  const s = id.trim();
  const m = s.match(/^N-?(\d+)$/i) || s.match(/^node(\d+)$/i);
  if (m) return 'N' + String(parseInt(m[1], 10));
  return s;
}

/**
 * @param {string} topic
 * @param {Record<string, unknown>} data
 * @param {number} t_be_rx
 * @param {{ activeTestRunContext?: { id: string, nodeId?: string, endsAt: number } | null }} [options]
 */
async function mqttToSensorRow(topic, data, t_be_rx, options = {}) {
  const { activeTestRunContext = null } = options;

  const rawId = data.nodeId ?? data.node ?? data.node_id ?? nodeIdFromTopic(topic) ?? 'unknown';
  const nodeId = normalizeNodeId(rawId);
  const timestamp = data.timestamp || new Date().toISOString();

  const d = applySensorCorrections(data);
  const cal = await getCalibrationCached();
  const corr = applyUserCalibrationCorrected(d, cal);

  const seqRaw = data.seq ?? data.seq_id;
  const seq = seqRaw != null ? (typeof seqRaw === 'number' ? seqRaw : parseInt(seqRaw, 10)) : null;

  const t_fwd_rx = data.t_fwd_rx != null ? parseInt(data.t_fwd_rx, 10) : null;
  const t_fwd_pub = data.t_fwd_pub != null ? parseInt(data.t_fwd_pub, 10) : null;
  const t_node = data.t_node != null ? parseInt(data.t_node, 10) : null;

  if (t_fwd_rx == null) {
    console.warn(`[Telemetry] ⚠️  t_fwd_rx missing | node=${nodeId} seq=${seq ?? '—'} — latency metrics will be degraded`);
  }

  let test_run_id = data.test_run_id ?? null;
  if (!test_run_id && activeTestRunContext && Date.now() <= activeTestRunContext.endsAt) {
    const ctx = activeTestRunContext;
    if (!ctx.nodeId || ctx.nodeId === 'all' || normalizeNodeId(ctx.nodeId) === nodeId) {
      test_run_id = ctx.id;
    }
  }

  const phLab = d.pH ?? d.ph ?? null;
  const tan = d.tan ?? d.TAN ?? data.tan ?? data.TAN ?? 0.5;
  const doLab = d.dissolvedOxygen ?? d.do ?? d.dissolved_oxygen ?? null;
  const tempLab = d.temperature ?? null;
  const turbLab = d.turbidity ?? null;

  const wqi = calculateWQI({
    temperature: corr.temperature_corrected ?? tempLab,
    ph: corr.ph_corrected ?? phLab,
    tan,
    dissolvedOxygen: corr.dissolved_oxygen_corrected ?? doLab,
    turbidity: corr.turbidity_corrected ?? turbLab,
    nh3: corr.nh3_corrected,
  });

  return {
    node_id: nodeId,
    temperature: tempLab,
    turbidity: turbLab,
    ph: phLab,
    dissolved_oxygen: doLab,
    flow_rate: data.flowRate ?? data.flow_rate ?? null,
    battery_voltage: data.batteryVoltage ?? data.battery_voltage ?? null,
    battery_percentage: data.batteryPercentage ?? data.battery_percentage ?? null,
    temperature_corrected: corr.temperature_corrected,
    ph_corrected: corr.ph_corrected,
    turbidity_corrected: corr.turbidity_corrected,
    dissolved_oxygen_corrected: corr.dissolved_oxygen_corrected,
    flow_rate_corrected: corr.flow_rate_corrected,
    nh3_corrected: corr.nh3_corrected,
    tan,
    wqi: wqi != null ? wqi : null,
    seq,
    tx_millis: data.tx_millis != null ? (typeof data.tx_millis === 'number' ? data.tx_millis : parseInt(data.tx_millis, 10)) : null,
    rx_millis: data.rx_millis != null ? (typeof data.rx_millis === 'number' ? data.rx_millis : parseInt(data.rx_millis, 10)) : null,
    timestamp,
    t_node,
    t_fwd_rx,
    t_fwd_pub,
    t_be_rx,
    test_run_id,
    rssi: data.rssi != null ? parseInt(data.rssi, 10) : null,
    snr: data.snr != null ? parseInt(data.snr, 10) : null,
    // Optional LoRa raw diagnostics (not stored in sensor_readings)
    turRawV: data.turRawV ?? data.turbidityRawVoltage ?? null,
    doRawV: data.doRawV ?? data.dissolvedOxygenRawVoltage ?? null,
    turRaw: data.turRaw ?? data.turbidityRaw ?? null,
    doRaw: data.doRaw ?? data.dissolvedOxygenRaw ?? null,
  };
}

module.exports = { mqttToSensorRow, normalizeNodeId, nodeIdFromTopic };
