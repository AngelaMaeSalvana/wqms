/**
 * Export data to JSON format
 */
export const exportToJSON = (data, filename = 'water-quality-data') => {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Export data to CSV format
 */
export const exportToCSV = (data, filename = 'water-quality-data') => {
  if (!Array.isArray(data) || data.length === 0) {
    console.error('Data must be a non-empty array');
    return;
  }

  // Get headers from first object
  const headers = Object.keys(data[0]);
  
  // Create CSV rows
  const csvRows = [
    headers.join(','), // Header row
    ...data.map(row => 
      headers.map(header => {
        const value = row[header];
        // Handle values that might contain commas or quotes
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',')
    )
  ];

  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Export data to Excel format (CSV with .xls extension and Excel mime type for compatibility)
 */
export const exportToExcel = (data, filename = 'water-quality-data') => {
  if (!Array.isArray(data) || data.length === 0) {
    console.error('Data must be a non-empty array');
    return;
  }
  const headers = Object.keys(data[0]);
  const escape = (v) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csvRows = [
    headers.join(','),
    ...data.map(row => headers.map(h => escape(row[h])).join(',')),
  ];
  const csvString = '\uFEFF' + csvRows.join('\r\n');
  const blob = new Blob([csvString], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().split('T')[0]}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Format readings data for export
 */
export const formatReadingsForExport = (readings) => {
  return readings.map(reading => ({
    date: reading.date || reading.timestamp,
    wqi: reading.wqi,
    temperature: reading.temperature,
    turbidity: reading.turbidity,
    pH: reading.pH || reading.ph,
    dissolvedOxygen: reading.dissolvedOxygen || reading.dissolved_oxygen,
    nh3: reading.nh3 || reading.NH3,
    nodeId: reading.nodeId || reading.node_id,
    location: reading.location,
  }));
};

/**
 * Format alerts data for export
 */
export const formatAlertsForExport = (alerts) => {
  return alerts.map(alert => ({
    id: alert.id,
    title: alert.title,
    detail: alert.detail || alert.message,
    severity: alert.severity,
    timestamp: alert.createdAt || alert.timestamp || alert.created_at,
  }));
};

