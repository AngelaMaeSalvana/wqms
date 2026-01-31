/**
 * Normalize MQTT payload from forwarder (water-quality/{nodeId}) to dashboard reading shape.
 * Forwarder publishes JSON with: nodeId, seq, timestamp, temperature, turbidity, pH, nh3, dissolvedOxygen, flowRate, etc.
 */
import { calculateWQI } from './wqiCalculator';

export function normalizeMQTTReading(payload, topicNodeId) {
  if (!payload || typeof payload !== 'object') return null;
  const r = payload;
  const temp = r.temperature ?? null;
  const turb = r.turbidity ?? null;
  const ph = r.pH ?? r.ph ?? null;
  const ammonia = r.nh3 ?? r.NH3 ?? null;
  const doVal = r.dissolvedOxygen ?? r.dissolved_oxygen ?? r.do ?? r.DO ?? null;
  const flowRate = r.flowRate ?? r.flow ?? null;
  const nodeId = r.nodeId ?? r.node ?? topicNodeId ?? null;

  let wqi = r.wqi ?? r.WQI;
  if (wqi == null && temp != null && turb != null && ph != null && ammonia != null && doVal != null) {
    wqi = calculateWQI({ temperature: temp, turbidity: turb, pH: ph, nh3: ammonia, dissolvedOxygen: doVal });
  }

  return {
    temperature: temp,
    turbidity: turb,
    pH: ph,
    nh3: ammonia,
    dissolvedOxygen: doVal,
    flowRate: flowRate,
    wqi: wqi != null ? Math.round(wqi) : null,
    nodeId: nodeId,
    timestamp: r.timestamp ?? null,
    seq: r.seq ?? null,
  };
}
