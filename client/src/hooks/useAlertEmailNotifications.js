/**
 * Sends email notifications for new alerts when user has enabled them in Settings.
 * Saves new alerts to Supabase when configured.
 * Tracks sent/saved alert IDs in localStorage to avoid duplicates.
 */
import { useEffect, useRef } from 'react';
import { loadFromStorage } from '../utils/settingsStorage';
import { sendAlertEmail, isEmailJsConfigured } from '../services/emailService';
import { isSupabaseEnabled } from '../lib/supabaseClient';
import api from '../services/api';

/** Record email sent in DB for performance evaluation (when backend or Supabase is used). */
function recordEmailSentIfPossible(alert, api) {
  const id = alert.id ?? alert.db_id;
  if (id == null) return;
  api.recordAlertEmailSent(id).catch(() => {});
}

const NOTIFICATIONS_KEY = 'wqms_notifications';
const EMAILED_ALERTS_KEY = 'wqms_alerts_emailed_ids';
const SAVED_ALERTS_KEY = 'wqms_alerts_saved_ids';
const MAX_TRACKED_IDS = 800;

function loadIds(key) {
  try {
    const s = localStorage.getItem(key);
    const arr = s ? JSON.parse(s) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveIds(key, ids) {
  try {
    const arr = [...ids].slice(-MAX_TRACKED_IDS);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    console.warn('Could not save tracked alert IDs', e);
  }
}

function dedupeKeyForAlert(alert) {
  // DB rows have unique numeric/uuid ids; use those directly.
  if (alert?.db_id != null) return `db:${alert.db_id}`;
  if (alert?.id != null && (typeof alert.id === 'number' || /^\d+$/.test(String(alert.id)))) return `id:${alert.id}`;

  // For computed alerts, include timestamp so repeated occurrences can email again.
  const base = alert?.id || `${alert?.nodeId ?? alert?.node_id ?? ''}|${alert?.type ?? ''}|${alert?.parameter ?? ''}`;
  const ts = alert?.timestamp ?? alert?.createdAt ?? '';
  return `${base}|${ts}`;
}

/**
 * @param {Array} alerts - List of alert objects with id, title, detail, nodeId, etc.
 * @param {Object} [readingsByNode] - Optional { [nodeId]: readings } for latest sensor values in the email
 */
export function useAlertEmailNotifications(alerts, readingsByNode = {}) {
  const emailedIdsRef = useRef(loadIds(EMAILED_ALERTS_KEY));
  const savedIdsRef = useRef(loadIds(SAVED_ALERTS_KEY));

  useEffect(() => {
    if (!alerts || !Array.isArray(alerts) || alerts.length === 0) return;

    const notifications = loadFromStorage(NOTIFICATIONS_KEY, {});
    const emailEnabled = notifications.emailEnabled && notifications.notificationEmail?.trim();
    const toEmail = emailEnabled ? notifications.notificationEmail.trim() : null;
    const sendEmail = emailEnabled && isEmailJsConfigured();
    const saveToSupabase = isSupabaseEnabled();

    const emailedIds = emailedIdsRef.current;
    const savedIds = savedIdsRef.current;

    for (const alert of alerts) {
      const key = dedupeKeyForAlert(alert);
      if (!key) continue;

      // Save to Supabase (when configured)
      if (saveToSupabase && !savedIds.has(key)) {
        savedIds.add(key);
        const payload = {
          ...alert,
          timestamp: alert.timestamp || alert.createdAt || new Date().toISOString(),
        };
        api.postAlert(payload).catch((err) => {
          console.warn('Could not save alert to Supabase', err);
          savedIds.delete(key);
        });
      }

      // Send email (when configured)
      if (sendEmail && toEmail && !emailedIds.has(key)) {
        sendAlertEmail(alert, toEmail, readingsByNode).then((res) => {
          if (res.success) {
            emailedIds.add(key);
            saveIds(EMAILED_ALERTS_KEY, emailedIds);
            recordEmailSentIfPossible(alert, api);
          }
        });
      }
    }

    saveIds(SAVED_ALERTS_KEY, savedIds);
  }, [alerts, readingsByNode]);
}
