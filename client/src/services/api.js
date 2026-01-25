// API service for backend communication
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
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`❌ API Error (${endpoint}):`, error);
      throw error;
    }
  }

  // Get latest reading
  async getLatestReading(nodeId = null) {
    const params = nodeId ? `?nodeId=${nodeId}` : '';
    return this.request(`/readings/latest${params}`);
  }

  // Get readings by date range
  async getReadings({ startDate, endDate, nodeId, limit = 100 }) {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (nodeId) params.append('nodeId', nodeId);
    params.append('limit', limit);
    
    return this.request(`/readings?${params.toString()}`);
  }

  // Get daily summaries
  async getDailySummaries({ startDate, endDate, nodeId }) {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (nodeId) params.append('nodeId', nodeId);
    
    return this.request(`/summaries/daily?${params.toString()}`);
  }

  // Get water quality for specific date
  async getReadingByDate(date, nodeId = null) {
    const params = nodeId ? `?nodeId=${nodeId}` : '';
    return this.request(`/readings/date/${date}${params}`);
  }

  // Get alerts
  async getAlerts({ limit = 50, severity } = {}) {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit);
    if (severity) params.append('severity', severity);
    
    return this.request(`/alerts?${params.toString()}`);
  }

  // POST: Store reading
  async postReading(reading) {
    return this.request('/readings', {
      method: 'POST',
      body: JSON.stringify(reading),
    });
  }

  // POST: Store alert
  async postAlert(alert) {
    return this.request('/alerts', {
      method: 'POST',
      body: JSON.stringify(alert),
    });
  }

  // Health check
  async healthCheck() {
    return this.request('/health');
  }
}

export default new ApiService();

