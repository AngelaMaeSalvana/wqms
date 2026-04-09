// API service: uses Supabase when REACT_APP_SUPABASE_* are set, else backend API
import { isSupabaseEnabled, supabase } from '../lib/supabaseClient';
import * as supabaseService from './supabaseService';


const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const AUTH_TOKEN_KEY = 'wqms_auth_token';
const FORCE_BACKEND_API = true;

class ApiService {
  shouldUseSupabase() {
    return !FORCE_BACKEND_API && isSupabaseEnabled();
  }

  getStoredToken() {
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  setStoredToken(token) {
    try {
      if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
      else localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {}
  }

  async getAuthHeaders() {
    const customToken = this.getStoredToken();
    if (customToken) return { Authorization: `Bearer ${customToken}` };
    if (!supabase) return {};
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const authHeaders = await this.getAuthHeaders();
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...options.headers,
      },
      ...options,
    };
    try {
      const response = await fetch(url, config);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || `HTTP error! status: ${response.status}`);
      }
      return data;
    } catch (error) {
      console.error(`❌ API Error (${endpoint}):`, error);
      throw error;
    }
  }

  async getLatestReading(nodeId = null) {
    if (this.shouldUseSupabase()) return supabaseService.getLatestReading(nodeId);
    const params = nodeId ? `?nodeId=${nodeId}` : '';
    return this.request(`/readings/latest${params}`);
  }

  async getReadings({ startDate, endDate, nodeId, testRunId, monitoringOnly, limit = 100 }) {
    if (this.shouldUseSupabase()) return supabaseService.getReadings({ startDate, endDate, nodeId, testRunId, monitoringOnly, limit });
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (nodeId) params.append('nodeId', nodeId);
    if (testRunId) params.append('testRunId', testRunId);
    if (monitoringOnly) params.append('monitoringOnly', '1');
    // Backend requires a numeric limit; if caller requests "all", use a high cap.
    const effectiveLimit = (limit == null || limit === 0 || limit === Infinity) ? 100000 : limit;
    params.append('limit', effectiveLimit);
    return this.request(`/readings?${params.toString()}`);
  }

  /** Sensor readings: monitoring only (no test_run_id). Used by Sensor Logs, Reports (Water/Alerts/System). */
  async getSensorReadings({ startDate, endDate, nodeId, limit = 500 }) {
    if (this.shouldUseSupabase()) return supabaseService.getSensorReadings({ startDate, endDate, nodeId, limit });
    // If caller requests "all", use high cap for backend mode.
    const effectiveLimit = (limit == null || limit === 0 || limit === Infinity) ? 100000 : limit;
    return this.getReadings({ startDate, endDate, nodeId, monitoringOnly: true, limit: effectiveLimit });
  }

  async getDailySummaries({ startDate, endDate, nodeId }) {
    if (this.shouldUseSupabase()) return supabaseService.getDailySummaries({ startDate, endDate, nodeId });
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (nodeId) params.append('nodeId', nodeId);
    return this.request(`/summaries/daily?${params.toString()}`);
  }

  async getReadingByDate(date, nodeId = null) {
    if (this.shouldUseSupabase()) return supabaseService.getReadingByDate(date, nodeId);
    const params = nodeId ? `?nodeId=${nodeId}` : '';
    return this.request(`/readings/date/${date}${params}`);
  }

  async getAlerts({ limit = 50, severity, startDate, endDate, nodeId } = {}) {
    if (this.shouldUseSupabase()) return supabaseService.getAlerts({ limit, severity, startDate, endDate, nodeId });
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit);
    if (severity) params.append('severity', severity);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (nodeId) params.append('nodeId', nodeId);
    return this.request(`/alerts?${params.toString()}`);
  }

  async getTimestampLogs({ startDate, endDate, nodeId, limit = 200 } = {}) {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (nodeId) params.append('nodeId', nodeId);
    params.append('limit', limit);
    return this.request(`/timestamp-logs?${params.toString()}`);
  }

  async getTestRunsList({ limit = 50 } = {}) {
    if (this.shouldUseSupabase()) return supabaseService.getTestRunsList({ limit });
    const params = new URLSearchParams();
    params.append('limit', limit);
    return this.request(`/test-runs?${params.toString()}`);
  }

  async postReading(reading) {
    if (this.shouldUseSupabase()) return supabaseService.postReading(reading);
    return this.request('/readings', { method: 'POST', body: JSON.stringify(reading) });
  }

  async postAlert(alert) {
    if (this.shouldUseSupabase()) return supabaseService.postAlert(alert);
    return this.request('/alerts', { method: 'POST', body: JSON.stringify(alert) });
  }

  async upsertAlerts(alertsList) {
    if (this.shouldUseSupabase()) return supabaseService.upsertAlerts(alertsList);
    return [];
  }

  async healthCheck() {
    if (this.shouldUseSupabase()) return { status: 'ok', database: 'supabase' };
    return this.request('/health');
  }

  async getPerformanceReadings({ startDate, endDate, nodeId, testRunId, limit = 1000 }) {
    if (this.shouldUseSupabase()) return supabaseService.getPerformanceReadings({ startDate, endDate, nodeId, testRunId, limit });
    return this.getReadings({ startDate, endDate, nodeId, testRunId, limit });
  }

  async getPerformanceAlerts({ startDate, endDate, nodeId, limit = 200 }) {
    if (this.shouldUseSupabase()) return supabaseService.getPerformanceAlerts({ startDate, endDate, nodeId, limit });
    return this.getAlerts({ limit, startDate, endDate, nodeId });
  }

  /**
   * Record that an alert notification email was sent (for performance evaluation).
   * @param {string|number} alertId - Alert id (DB id or Supabase uuid)
   * @param {string|number} [emailSentAt] - ISO string or epoch ms; defaults to now
   */
  async recordAlertEmailSent(alertId, emailSentAt) {
    if (this.shouldUseSupabase()) {
      return supabaseService.patchAlertEmailSent(alertId, emailSentAt);
    }
    const body = emailSentAt
      ? { email_sent_at: typeof emailSentAt === 'number' ? new Date(emailSentAt).toISOString() : emailSentAt }
      : { email_sent_at: new Date().toISOString() };
    return this.request(`/alerts/${encodeURIComponent(alertId)}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  // ── Test Run endpoints (always go to backend REST, not Supabase directly) ──

  async startTestRun({ durationMs, intervalMs, nodeId }) {
    return this.request('/test-run/start', {
      method: 'POST',
      body: JSON.stringify({ durationMs, intervalMs, nodeId: nodeId ?? null }),
    });
  }

  async stopTestRun(testRunId) {
    return this.request('/test-run/stop', {
      method: 'POST',
      body: JSON.stringify({ test_run_id: testRunId }),
    });
  }

  async getActiveTestRun() {
    return this.request('/test-run/active');
  }

  async getTestRun(testRunId) {
    if (!testRunId) throw new Error('testRunId is required');
    return this.request(`/test-run/${encodeURIComponent(testRunId)}`);
  }

  /**
   * Publish a preset test scenario reading to MQTT (bridge will store to Supabase).
   * Body: { scenario, nodeId, test_run_id?, thresholds? } — thresholds from Settings used for scenario payloads
   */
  async publishTestScenario({ scenario, nodeId, testRunId, thresholds }) {
    return this.request('/test-scenario/publish', {
      method: 'POST',
      body: JSON.stringify({ scenario, nodeId, test_run_id: testRunId, thresholds }),
    });
  }

  /**
   * Broadcast acquisition settings to LoRa sensor nodes (MQTT → forwarder).
   * Firmware applies after the current sampling period ends.
   */
  async publishAcquisitionConfig({ frequency_mode, interval_minutes }) {
    return this.request('/acquisition-config', {
      method: 'POST',
      body: JSON.stringify({ frequency_mode, interval_minutes }),
    });
  }

  async getAuthMe() {
    return this.request('/auth/me');
  }

  async upsertProfile({ username, email, password }) {
    return this.request('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ username, email, password }),
    });
  }

  async signup({ username, email, password }) {
    const result = await this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        username,
        email: typeof email === 'string' ? email.trim().toLowerCase() : '',
        password,
      }),
    });
    if (result?.token) this.setStoredToken(result.token);
    return result;
  }

  async login({ username, password }) {
    const result = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (result?.token) this.setStoredToken(result.token);
    return result;
  }

  async requestForgotPassword({ emailOrUsername }) {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({
        emailOrUsername: typeof emailOrUsername === 'string' ? emailOrUsername.trim() : '',
      }),
    });
  }

  async resetPassword({ token, password }) {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token: typeof token === 'string' ? token.trim() : '',
        password,
      }),
    });
  }

  logout() {
    this.setStoredToken('');
  }
}

export default new ApiService();
