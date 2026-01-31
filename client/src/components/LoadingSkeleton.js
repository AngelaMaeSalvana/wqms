import React from "react";
import "./LoadingSkeleton.css";

export const MetricSkeleton = () => {
  return (
    <div className="metric-item skeleton">
      <div
        className="skeleton-line"
        style={{ width: "60%", height: "12px", marginBottom: "8px" }}
      />
      <div className="skeleton-line" style={{ width: "80%", height: "24px" }} />
    </div>
  );
};

export const ChartSkeleton = () => {
  return (
    <div className="chart-skeleton">
      <div
        className="skeleton-line"
        style={{ width: "100%", height: "200px", borderRadius: "8px" }}
      />
    </div>
  );
};

export const AlertSkeleton = () => {
  return (
    <div className="alert skeleton">
      <div
        className="skeleton-line"
        style={{ width: "70%", height: "16px", marginBottom: "8px" }}
      />
      <div
        className="skeleton-line"
        style={{ width: "100%", height: "14px", marginBottom: "4px" }}
      />
      <div className="skeleton-line" style={{ width: "50%", height: "12px" }} />
    </div>
  );
};

export const CalendarSkeleton = () => {
  return (
    <div className="calendar-skeleton">
      {Array.from({ length: 35 }).map((_, i) => (
        <div key={i} className="day skeleton" style={{ aspectRatio: "1" }} />
      ))}
    </div>
  );
};

/** Optional default export: single component only (not an object). */
function LoadingSkeleton() {
  return <ChartSkeleton />;
}

export default LoadingSkeleton;
