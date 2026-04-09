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

/** Full-page loading state with spinner. */
export const PageLoader = () => (
  <div className="page-loader" role="status" aria-label="Loading">
    <div className="page-loader__spinner" aria-hidden />
    <p className="page-loader__text">Loading…</p>
  </div>
);

/** Table skeleton for data tables. */
export const TableSkeleton = ({ rows = 9, cols = 10 }) => (
  <div className="table-skeleton">
    <div className="table-skeleton__header">
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="skeleton-line table-skeleton__cell" style={{ height: "12px" }} />
      ))}
    </div>
    <div className="table-skeleton__body">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="table-skeleton__row">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="skeleton-line table-skeleton__cell" style={{ height: "10px", width: j === 0 ? "80%" : "60%" }} />
          ))}
        </div>
      ))}
    </div>
  </div>
);

/** Optional default export: single component only (not an object). */
function LoadingSkeleton() {
  return <ChartSkeleton />;
}

export default LoadingSkeleton;
