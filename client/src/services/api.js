// API service: uses Supabase when REACT_APP_SUPABASE_* are set, else backend API
import { isSupabaseEnabled } from '../lib/supabaseClient';
import * as supabaseService from './supabaseService';


const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

class ApiService {
  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };
    try {
      const response = await fetch(url, config);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`❌ API Error (${endpoint}):`, error);
      throw error;
    }
  }

  async getLatestReading(nodeId = null) {
    if (isSupabaseEnabled()) return supabaseService.getLatestReading(nodeId);
    const params = nodeId ? `?nodeId=${nodeId}` : '';
    return this.request(`/readings/latest${params}`);
  }

  async getReadings({ startDate, endDate, nodeId, testRunId, monitoringOnly, limit = 100 }) {
    if (isSupabaseEnabled()) return supabaseService.getReadings({ startDate, endDate, nodeId, testRunId, monitoringOnly, limit });
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (nodeId) params.append('nodeId', nodeId);
    if (testRunId) params.append('testRunId', testRunId);
    if (monitoringOnly) params.append('monitoringOnly', '1');
    params.append('limit', limit);
    return this.request(`/readings?${params.toString()}`);
  }

  /** Sensor readings: monitoring only (no test_run_id). Used by Sensor Logs, Reports (Water/Alerts/System). */
  async getSensorReadings({ startDate, endDate, nodeId, limit = 500 }) {
    if (isSupabaseEnabled()) return supabaseService.getSensorReadings({ startDate, endDate, nodeId, limit });
    return this.getReadings({ startDate, endDate, nodeId, monitoringOnly: true, limit });
  }

  async getDailySummaries({ startDate, endDate, nodeId }) {
    if (isSupabaseEnabled()) return supabaseService.getDailySummaries({ startDate, endDate, nodeId });
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (nodeId) params.append('nodeId', nodeId);
    return this.request(`/summaries/daily?${params.toString()}`);
  }

  async getReadingByDate(date, nodeId = null) {
    if (isSupabaseEnabled()) return supabaseService.getReadingByDate(date, nodeId);
    const params = nodeId ? `?nodeId=${nodeId}` : '';
    return this.request(`/readings/date/${date}${params}`);
  }

  async getAlerts({ limit = 50, severity, startDate, endDate } = {}) {
    if (isSupabaseEnabled()) return supabaseService.getAlerts({ limit, severity, startDate, endDate });
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit);
    if (severity) params.append('severity', severity);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
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
    const params = new URLSearchParams();
    params.append('limit', limit);
    return this.request(`/test-runs?${params.toString()}`);
  }

  async postReading(reading) {
    if (isSupabaseEnabled()) return supabaseService.postReading(reading);
    return this.request('/readings', { method: 'POST', body: JSON.stringify(reading) });
  }

  async postAlert(alert) {
    if (isSupabaseEnabled()) return supabaseService.postAlert(alert);
    return this.request('/alerts', { method: 'POST', body: JSON.stringify(alert) });
  }

  async upsertAlerts(alertsList) {
    if (isSupabaseEnabled()) return supabaseService.upsertAlerts(alertsList);
    return [];
  }

  async healthCheck() {
    if (isSupabaseEnabled()) return { status: 'ok', database: 'supabase' };
    return this.request('/health');
  }

  async getPerformanceReadings({ startDate, endDate, nodeId, testRunId, limit = 1000 }) {
    if (isSupabaseEnabled()) return supabaseService.getPerformanceReadings({ startDate, endDate, nodeId, testRunId, limit });
    return this.getReadings({ startDate, endDate, nodeId, testRunId, limit });
  }

  async getPerformanceAlerts({ startDate, endDate, nodeId, limit = 200 }) {
    if (isSupabaseEnabled()) return supabaseService.getPerformanceAlerts({ startDate, endDate, nodeId, limit });
    return this.getAlerts({ limit });
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
}

export default new ApiService();
