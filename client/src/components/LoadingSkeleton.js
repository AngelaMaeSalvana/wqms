import React from 'react';
import './LoadingSkeleton.css';

export const MetricSkeleton = () => (
  <div className="metric-item skeleton">
    <div className="skeleton-line" style={{ width: '60%', height: '12px', marginBottom: '8px' }} />
    <div className="skeleton-line" style={{ width: '80%', height: '24px' }} />
  </div>
);

export const ChartSkeleton = () => (
  <div className="chart-skeleton">
    <div className="skeleton-line" style={{ width: '100%', height: '200px', borderRadius: '8px' }} />
  </div>
);

export const AlertSkeleton = () => (
  <div className="alert skeleton">
    <div className="skeleton-line" style={{ width: '70%', height: '16px', marginBottom: '8px' }} />
    <div className="skeleton-line" style={{ width: '100%', height: '14px', marginBottom: '4px' }} />
    <div className="skeleton-line" style={{ width: '50%', height: '12px' }} />
  </div>
);

export const CalendarSkeleton = () => (
  <div className="calendar-skeleton">
    {Array.from({ length: 35 }).map((_, i) => (
      <div key={i} className="day skeleton" style={{ aspectRatio: '1' }} />
    ))}
  </div>
);

export default { MetricSkeleton, ChartSkeleton, AlertSkeleton, CalendarSkeleton };

