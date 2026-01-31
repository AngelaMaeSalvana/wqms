// API service: uses REACT_APP_API_URL from .env, else localhost
import { config } from '../config/env';
import { isSupabaseEnabled } from '../lib/supabaseClient';
import * as supabaseService from './supabaseService';

const API_BASE_URL = config.apiUrl || 'http://localhost:5000/api';

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

  async getReadings({ startDate, endDate, nodeId, limit = 100 }) {
    if (isSupabaseEnabled()) return supabaseService.getReadings({ startDate, endDate, nodeId, limit });
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (nodeId) params.append('nodeId', nodeId);
    params.append('limit', limit);
    return this.request(`/readings?${params.toString()}`);
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

  async getAlerts({ limit = 50, severity } = {}) {
    if (isSupabaseEnabled()) return supabaseService.getAlerts({ limit, severity });
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit);
    if (severity) params.append('severity', severity);
    return this.request(`/alerts?${params.toString()}`);
  }

  async postReading(reading) {
    if (isSupabaseEnabled()) return supabaseService.postReading(reading);
    return this.request('/readings', { method: 'POST', body: JSON.stringify(reading) });
  }

  async postAlert(alert) {
    if (isSupabaseEnabled()) return supabaseService.postAlert(alert);
    return this.request('/alerts', { method: 'POST', body: JSON.stringify(alert) });
  }

  async healthCheck() {
    if (isSupabaseEnabled()) return { status: 'ok', database: 'supabase' };
    return this.request('/health');
  }
}

export default new ApiService();
