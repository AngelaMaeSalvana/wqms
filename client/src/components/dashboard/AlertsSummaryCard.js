import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import EmptyState from "../EmptyState";
import AlertDetailModal from "../AlertDetailModal";
import { AlertSkeleton } from "../LoadingSkeleton";
import "./dashboard.css";

function getRelativeTime(date) {
  if (!date) return "—";
  const d = typeof date === "number" ? new Date(date) : new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "Now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Filter tier for pills: critical, warning, info. Node→critical, maintenance→info. */
function getFilterTier(alert) {
  const t = alert?.type;
  if (t === "node") return "critical";
  if (t === "maintenance") return "info";
  const s = (alert?.severity || "info").toLowerCase();
  if (s === "high") return "critical";
  if (s === "medium") return "warning";
  return "info";
}

/** Display class for styling: maintenance (blue), urgent (magenta), or severity-based for params. */
function getDisplayClass(alert) {
  const t = alert?.type;
  if (t === "maintenance") return "maintenance";
  if (t === "node") return "urgent";
  const s = (alert?.severity || "info").toLowerCase();
  if (s === "high") return "critical";
  if (s === "medium") return "warning";
  return "info";
}

const SEVERITY_PILLS = [
  { value: "all", label: "All", color: null },
  { value: "critical", label: "Critical", color: "critical" },
  { value: "warning", label: "Warning", color: "warning" },
  { value: "info", label: "Info", color: "info" },
];

export function AlertsSummaryCard({
  alerts = [],
  isLoadingAlerts,
}) {
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [readIds, setReadIds] = useState(new Set());
  const [collapsed, setCollapsed] = useState(false);

  const severityCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 };
    alerts.forEach((a) => {
      const tier = getFilterTier(a);
      counts[tier]++;
    });
    return counts;
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    if (severityFilter === "all") return alerts;
    return alerts.filter((a) => getFilterTier(a) === severityFilter);
  }, [alerts, severityFilter]);

  const list = filteredAlerts.slice(0, 5);
  const hasAlerts = alerts.length > 0;
  const hasVisibleAlerts = list.length > 0;
  const hasMore = alerts.length > 5;

  return (
    <div className={`card alerts-summary-card alerts-notifications-panel${collapsed ? " alerts-summary-card--collapsed" : " card--fill"}${!hasAlerts ? " alerts-summary-card--empty" : ""}${hasMore ? " alerts-summary-card--scrollable" : ""}`}>
      <div className="alerts-notifications-header">
        <div className="alerts-summary-title-row">
          <h2 className="alerts-notifications-title">Alerts Summary</h2>
          <span className="alerts-summary-count" aria-label={`${alerts.length} alerts`}>
            {alerts.length}
          </span>
        </div>
        <button
          type="button"
          className="alerts-summary-collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand alerts" : "Minimize alerts"}
          aria-expanded={!collapsed}
        >
          <span className={`alerts-summary-collapse-icon${collapsed ? " alerts-summary-collapse-icon--collapsed" : ""}`}>
            ‹
          </span>
        </button>
      </div>
      <div className={`card__body alerts-notifications-body${collapsed ? " alerts-notifications-body--hidden" : ""}`}>
        {alerts.length > 0 && (
          <div className="alerts-summary-pills" role="tablist" aria-label="Filter by severity">
            {SEVERITY_PILLS.map((p) => {
              const count = p.color ? severityCounts[p.value] : alerts.length;
              const isActive = severityFilter === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`alerts-summary-pill alerts-summary-pill--${p.color ?? "all"}${isActive ? " alerts-summary-pill--active" : ""}`}
                  onClick={() => setSeverityFilter(p.value)}
                >
                  {p.color && count > 0 && (
                    <span className={`alerts-summary-pill-dot alerts-summary-pill-dot--${p.color}`} aria-hidden />
                  )}
                  {p.label}
                  {count > 0 && (
                    <span className={`alerts-summary-pill-count${p.color ? ` alerts-summary-pill-count--${p.color}` : ""}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {isLoadingAlerts ? (
          <div className="alerts-list alerts-notifications-list">
            {[1, 2, 3].map((i) => (
              <AlertSkeleton key={i} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>}
            title="No alerts"
            message={alerts.length === 0 ? "No alerts — all systems operating normally." : `No ${severityFilter} alerts.`}
          />
        ) : (
          <ul className="alerts-list alerts-notifications-list" aria-label="Recent alerts">
            {list.map((a) => {
              const alertId = a.id || a.timestamp;
              const displayClass = getDisplayClass(a);
              return (
                <li key={alertId} className={`alerts-compact-item alert--${displayClass}`}>
                  <span className="alerts-compact-left">
                    <span className="alerts-compact-title">{a.title || "Alert"}</span>
                    <span className="alerts-compact-time">{getRelativeTime(a.timestamp || a.createdAt)}</span>
                  </span>
                  <button
                    type="button"
                    className="alerts-compact-btn"
                    onClick={() => {
                      setReadIds((prev) => new Set([...prev, alertId]));
                      setSelectedAlert(a);
                    }}
                    aria-label={`View details: ${a.title || "Alert"}`}
                  >
                    View
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {hasVisibleAlerts && hasMore && (
          <div className="alerts-summary-footer">
            <Link to="/alerts" className="alerts-summary-see-all">
              See more
            </Link>
          </div>
        )}
      </div>
      {selectedAlert && (
        <AlertDetailModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      )}
    </div>
  );
}

export default AlertsSummaryCard;
