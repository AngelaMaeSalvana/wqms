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

const NOTIFICATIONS_KEY = 'wqms_notifications';
const SENT_ALERTS_KEY = 'wqms_alerts_emailed_ids';
const MAX_SENT_IDS = 500;

function loadSentIds() {
  try {
    const s = localStorage.getItem(SENT_ALERTS_KEY);
    const arr = s ? JSON.parse(s) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveSentIds(ids) {
  try {
    const arr = [...ids].slice(-MAX_SENT_IDS);
    localStorage.setItem(SENT_ALERTS_KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('Could not save emailed alert IDs', e);
  }
}

/**
 * @param {Array} alerts - List of alert objects with id, title, detail, nodeId, etc.
 * @param {Object} [readingsByNode] - Optional { [nodeId]: readings } for latest sensor values in the email
 */
export function useAlertEmailNotifications(alerts, readingsByNode = {}) {
  const sentIdsRef = useRef(loadSentIds());
  const prevAlertsRef = useRef([]);

  useEffect(() => {
    if (!alerts || !Array.isArray(alerts) || alerts.length === 0) return;

    const notifications = loadFromStorage(NOTIFICATIONS_KEY, {});
    const emailEnabled = notifications.emailEnabled && notifications.notificationEmail?.trim();
    const toEmail = emailEnabled ? notifications.notificationEmail.trim() : null;
    const sendEmail = emailEnabled && isEmailJsConfigured();
    const saveToSupabase = isSupabaseEnabled();

    const sentIds = sentIdsRef.current;
    let hasNew = false;

    for (const alert of alerts) {
      const id = alert.id || alert.timestamp || `${alert.nodeId}-${alert.type}-${alert.parameter || ''}`;
      if (!id || sentIds.has(id)) continue;

      hasNew = true;
      sentIds.add(id);

      // Save to Supabase (when configured)
      if (saveToSupabase) {
        const payload = {
          ...alert,
          timestamp: alert.timestamp || alert.createdAt || new Date().toISOString(),
        };
        api.postAlert(payload).catch((err) => {
          console.warn('Could not save alert to Supabase', err);
          sentIds.delete(id);
        });
      }

      // Send email (when configured)
      if (sendEmail && toEmail) {
        sendAlertEmail(alert, toEmail, readingsByNode).then((res) => {
          if (res.success) {
            saveSentIds(sentIds);
          } else {
            sentIds.delete(id);
          }
        });
      }
    }

    if (hasNew) {
      saveSentIds(sentIds);
    }

    prevAlertsRef.current = alerts;
  }, [alerts, readingsByNode]);
}
