/**
 * Sample sensor data generator for testing when real sensors are not ready.
 *
 * Enable: set ENABLE_SAMPLE_DATA=1 in server/.env
 * Optional: SAMPLE_DATA_INTERVAL_MS=5000 to auto-insert every 5s on server start.
 *
 * API (only when ENABLE_SAMPLE_DATA=1):
 *   POST /api/sample-data/generate   body: { count?, nodeIds?, startDate?, endDate?, intervalMinutes? }
 *   POST /api/sample-data/start-interval   body: { intervalMs? }  default 60s
 *   POST /api/sample-data/stop-interval
 *
 * TO REMOVE when sensors are live:
 * 1. Delete this file.
 * 2. In server.js, remove the "SAMPLE DATA" block (search for SAMPLE DATA).
 * 3. Unset ENABLE_SAMPLE_DATA (and SAMPLE_DATA_INTERVAL_MS) from .env.
 */

const DEFAULT_NODE_IDS = ['N1', 'N2'];

/** Clamp and round to 1 decimal */
function round1(val, min, max) {
  const v = Math.round(Math.max(min, Math.min(max, val)) * 10) / 10;
  return v;
}

/** Random in [min, max] with optional variance from a base */
function randomIn(base, variance, min, max) {
  const v = base + (Math.random() * 2 - 1) * (variance ?? 0);
  return round1(v, min, max);
}

/**
 * Generate one sample reading row (shape expected by db.insertReading).
 * @param {object} [options]
 * @param {string} [options.node_id] - e.g. 'N1', 'N2'
 * @param {string} [options.timestamp] - ISO string; default now
 * @param {number} [options.seq] - optional sequence
 */
function generateOneReading(options = {}) {
  const nodeId = options.node_id || DEFAULT_NODE_IDS[Math.floor(Math.random() * DEFAULT_NODE_IDS.length)];
  const timestamp = options.timestamp || new Date().toISOString();

  const temperature = randomIn(25, 4, 18, 35);
  const turbidity = randomIn(3, 3, 0.2, 20);
  const ph = randomIn(7.2, 0.6, 6.0, 9.0);
  const dissolved_oxygen = randomIn(7, 2.5, 2, 14);
  const flow_rate = randomIn(0.8, 0.4, 0.1, 2.5);
  const battery_voltage = randomIn(3.85, 0.2, 3.3, 4.2);
  const battery_pct = Math.round(Math.min(100, Math.max(0, ((battery_voltage - 3.3) / 0.9) * 100)));

  return {
    node_id: nodeId,
    temperature,
    turbidity,
    ph,
    dissolved_oxygen,
    flow_rate: round1(flow_rate, 0, 5),
    battery_voltage: round1(battery_voltage, 3.3, 4.2),
    battery_percentage: battery_pct,
    seq: options.seq ?? null,
    tx_millis: null,
    rx_millis: null,
    timestamp,
    t_node: null,
    t_fwd_rx: null,
    t_fwd_pub: null,
    t_be_rx: null,
    test_run_id: null,
  };
}

/**
 * Generate multiple sample readings, optionally spread over a date range.
 * @param {number} count - number of readings to generate
 * @param {object} [options]
 * @param {string[]} [options.nodeIds] - e.g. ['N1','N2']
 * @param {string} [options.startDate] - YYYY-MM-DD
 * @param {string} [options.endDate] - YYYY-MM-DD
 * @param {number} [options.intervalMinutes] - minutes between readings when using date range
 */
function generateReadings(count, options = {}) {
  const nodeIds = options.nodeIds || DEFAULT_NODE_IDS;
  const startDate = options.startDate;
  const endDate = options.endDate;
  const intervalMinutes = options.intervalMinutes ?? 15;

  const rows = [];
  let baseTime = Date.now();

  if (startDate && endDate) {
    baseTime = new Date(startDate + 'T00:00:00.000Z').getTime();
  }

  for (let i = 0; i < count; i++) {
    let ts;
    if (startDate && endDate) {
      const endMs = new Date(endDate + 'T23:59:59.999Z').getTime();
      ts = baseTime + i * intervalMinutes * 60 * 1000;
      if (ts > endMs) break;
    } else {
      ts = baseTime - (count - 1 - i) * intervalMinutes * 60 * 1000;
    }
    const nodeId = nodeIds[i % nodeIds.length];
    rows.push(generateOneReading({
      node_id: nodeId,
      timestamp: new Date(ts).toISOString(),
      seq: i + 1,
    }));
  }

  return rows;
}

module.exports = {
  generateOneReading,
  generateReadings,
  DEFAULT_NODE_IDS,
};
