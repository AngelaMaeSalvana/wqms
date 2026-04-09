/**
 * Email notifications via EmailJS.
 * Requires REACT_APP_EMAILJS_PUBLIC_KEY, REACT_APP_EMAILJS_SERVICE_ID, REACT_APP_EMAILJS_TEMPLATE_ID.
 */
import emailjs from '@emailjs/browser';
import { loadFromStorage } from '../utils/settingsStorage';

const PUBLIC_KEY = process.env.REACT_APP_EMAILJS_PUBLIC_KEY;
const SERVICE_ID = process.env.REACT_APP_EMAILJS_SERVICE_ID;
const TEMPLATE_ID = process.env.REACT_APP_EMAILJS_TEMPLATE_ID;

function maskToken(v) {
  if (!v) return 'missing';
  const s = String(v);
  if (s.length <= 6) return `${s[0] ?? ''}***`;
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}

/** Verbose EmailJS errors (incl. ids / masked key) — off by default; set localStorage wqms_debug_emailjs=1 or REACT_APP_DEBUG_EMAILJS=1 */
function isEmailJsDebugLogging() {
  try {
    if (process.env.REACT_APP_DEBUG_EMAILJS === '1') return true;
    return localStorage.getItem('wqms_debug_emailjs') === '1';
  } catch {
    return false;
  }
}

const DEFAULT_THRESHOLDS = {
  temperatureMin: 18,
  temperatureMax: 30,
  pHMin: 6.5,
  pHMax: 8.5,
  turbidityMax: 25,
  dissolvedOxygenMin: 4,
  nh3Max: 0.5,
};

export function isEmailJsConfigured() {
  return !!(String(PUBLIC_KEY || '').trim() && String(SERVICE_ID || '').trim() && String(TEMPLATE_ID || '').trim());
}

/**
 * Only LOW (early warning) and HIGH (critical) trigger notification emails — not MEDIUM.
 */
export function shouldSendAlertEmailBySeverity(alert) {
  const s = String(alert?.severity || 'info').toLowerCase();
  return s === 'low' || s === 'high';
}

function getThresholds() {
  const t = loadFromStorage('wqms_thresholds', {});
  return { ...DEFAULT_THRESHOLDS, ...t };
}

function formatSeverity(severity) {
  const s = (severity || 'info').toLowerCase();
  if (s === 'high') return 'Critical';
  if (s === 'low') return 'Warning';
  if (s === 'medium') return 'Warning';
  return 'Info';
}

function formatAlertType(type) {
  const t = (type || '').toLowerCase();
  if (t === 'threshold') return 'Threshold breach';
  if (t === 'node') return 'Node status';
  if (t === 'maintenance') return 'Maintenance due';
  if (t === 'sensor_test') return 'Sensor test';
  if (t === 'threshold_update') return 'Threshold update';
  if (t === 'node_added') return 'Node added';
  if (t === 'system_update') return 'System update';
  return t || 'Alert';
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function fmt(v) {
  return v != null && v !== '' ? String(v) : '—';
}

/**
 * Send an alert notification email via EmailJS.
 * @param {Object} alert - Alert object { title, detail, severity, nodeName, nodeId, type, parameter, value, ... }
 * @param {string} toEmail - Recipient email address
 * @param {Object} [readingsByNode] - Optional { [nodeId]: { temperature, pH, dissolvedOxygen, turbidity } } for latest readings
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function sendAlertEmail(alert, toEmail, readingsByNode = {}) {
  if (!isEmailJsConfigured()) {
    return { success: false, error: 'EmailJS is not configured' };
  }
  if (!toEmail || typeof toEmail !== 'string' || !toEmail.includes('@')) {
    return { success: false, error: 'Invalid recipient email' };
  }

  const thresholds = getThresholds();
  const readings = readingsByNode[alert.nodeId] || readingsByNode[alert.node_id] || {};
  const temp = readings.temperature ?? readings.temp;
  const ph = readings.pH ?? readings.ph;
  const doVal = readings.dissolvedOxygen ?? readings.dissolved_oxygen ?? readings.do ?? readings.DO;
  const turbidity = readings.turbidity ?? readings.turb;

  const dashboardUrl = process.env.REACT_APP_DASHBOARD_URL || 'https://wqms-oj1u.vercel.app/';
  const alertLevel = formatSeverity(alert.severity);
  const isInfo = alertLevel === 'Info';
  const readingsSectionStyle = isInfo ? 'display: none !important;' : '';

  const params = {
    to_email: toEmail,
    to_name: (toEmail.split('@')[0] || 'User').replace(/[._]/g, ' '),
    message: alert.detail || alert.title || 'Water quality alert requires attention.',
    alert_level: alertLevel,
    readings_section_style: readingsSectionStyle,
    site_name: alert.nodeName || alert.node_name || 'Unknown site',
    node_id: alert.nodeId ?? alert.node_id ?? '—',
    alert_type: formatAlertType(alert.type),
    timestamp: formatTimestamp(alert.timestamp ?? alert.createdAt),
    temp: fmt(temp),
    temp_range: `${thresholds.temperatureMin}–${thresholds.temperatureMax} °C`,
    ph: fmt(ph),
    ph_range: `${thresholds.pHMin}–${thresholds.pHMax}`,
    do: fmt(doVal),
    do_range: `≥ ${thresholds.dissolvedOxygenMin} mg/L`,
    turbidity: fmt(turbidity),
    turbidity_range: `≤ ${thresholds.turbidityMax} NTU`,
    dashboard_url: dashboardUrl,
    year: new Date().getFullYear(),
    org_name: 'WQMS',
  };

  try {
    await emailjs.send(SERVICE_ID, TEMPLATE_ID, params, { publicKey: PUBLIC_KEY });
    return { success: true };
  } catch (err) {
    if (isEmailJsDebugLogging()) {
      console.warn(
        'EmailJS send failed:',
        err,
        '| debug:',
        {
          status: err?.status,
          text: err?.text || err?.message,
          publicKey: maskToken(PUBLIC_KEY),
          serviceId: SERVICE_ID || 'missing',
          templateId: TEMPLATE_ID || 'missing',
        }
      );
    }
    return { success: false, error: err?.text || err?.message || 'Send failed' };
  }
}

/**
 * Send notification for config/system events (threshold update, node added, system update).
 * Checks user notification preferences and only sends if email is enabled.
 * @param {'threshold_update'|'node_added'|'system_update'} eventType
 * @param {Object} eventData - Event-specific data
 */
export async function sendEventNotification(eventType, eventData = {}) {
  const notifications = loadFromStorage('wqms_notifications', {});
  if (!notifications.emailEnabled) return;
  if (!isEmailJsConfigured()) return;

  let toEmail = String(notifications.notificationEmail || '').trim();
  if (!toEmail) {
    try {
      const raw = localStorage.getItem('wqms_current_user') || '{}';
      const currentUser = JSON.parse(raw);
      toEmail = String(currentUser?.email || '').trim();
    } catch {
      toEmail = '';
    }
  }
  if (!toEmail) return;

  const now = Date.now();
  let alert = {};

  if (eventType === 'threshold_update') {
    const { previous = {}, current = {} } = eventData;
    const changes = [];
    const keys = ['temperatureMin', 'temperatureMax', 'pHMin', 'pHMax', 'turbidityMax', 'dissolvedOxygenMin', 'nh3Max'];
    for (const k of keys) {
      const p = previous[k];
      const c = current[k];
      if (p !== undefined && c !== undefined && p !== c) {
        changes.push(`${k}: ${p} → ${c}`);
      }
    }
    alert = {
      type: 'threshold_update',
      title: 'Thresholds updated',
      detail: changes.length > 0 ? `Updated: ${changes.join('; ')}` : 'Alert thresholds have been modified.',
      severity: 'info',
      nodeId: null,
      nodeName: 'System',
      timestamp: now,
      createdAt: new Date(now).toISOString(),
    };
  } else if (eventType === 'node_added') {
    const node = eventData.node || {};
    alert = {
      type: 'node_added',
      title: 'New node added',
      detail: `Node "${node.name || node.id}" (${node.id}) at ${node.location || 'unknown location'} was added to the monitoring system.`,
      severity: 'info',
      nodeId: node.id,
      nodeName: node.name || node.id || 'New node',
      timestamp: now,
      createdAt: new Date(now).toISOString(),
    };
  } else if (eventType === 'system_update') {
    const version = eventData.version || 'latest';
    alert = {
      type: 'system_update',
      title: 'System update',
      detail: `WQMS has been updated. Version: ${version}. Please refresh the dashboard for the latest features.`,
      severity: 'info',
      nodeId: null,
      nodeName: 'System',
      timestamp: now,
      createdAt: new Date(now).toISOString(),
    };
  }

  if (alert.type) {
    await sendAlertEmail(alert, toEmail, eventData.readingsByNode || {});
  }
}
