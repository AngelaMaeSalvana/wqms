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

/** Map stored severity (high/medium/low/info) to display tier: critical, warning, info. */
function getDisplaySeverity(severity) {
  const s = (severity || "info").toLowerCase();
  if (s === "high") return "critical";
  if (s === "medium") return "warning";
  return "info";
}

const SEVERITY_PILLS = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

const SEVERITY_EMOJI = { critical: "🔴", warning: "🟡", info: "🟢" };

export function AlertsSummaryCard({
  alerts = [],
  isLoadingAlerts,
}) {
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [readIds, setReadIds] = useState(new Set());

  const severityCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 };
    alerts.forEach((a) => {
      const tier = getDisplaySeverity(a.severity);
      counts[tier]++;
    });
    return counts;
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    if (severityFilter === "all") return alerts;
    return alerts.filter((a) => getDisplaySeverity(a.severity) === severityFilter);
  }, [alerts, severityFilter]);

  const list = filteredAlerts.slice(0, 5);
  const hasAlerts = alerts.length > 0;

  return (
    <div className={`card card--fill alerts-summary-card alerts-notifications-panel ${!hasAlerts ? "alerts-summary-card--empty" : ""}`}>
      <div className="alerts-notifications-header">
        <div className="alerts-summary-title-row">
          <h2 className="alerts-notifications-title">Alerts Summary</h2>
          <span className="alerts-summary-count" aria-label={`${alerts.length} alerts`}>
            {alerts.length}
          </span>
        </div>
      </div>
      <div className="card__body alerts-notifications-body">
        {alerts.length > 0 && (
          <div className="alerts-summary-breakdown" aria-label="Severity breakdown">
            {severityCounts.critical > 0 && (
              <span className="alerts-summary-badge alerts-summary-badge--critical" title="Critical">
                <span className="alerts-summary-emoji" aria-hidden>{SEVERITY_EMOJI.critical}</span>
                {severityCounts.critical} Critical
              </span>
            )}
            {severityCounts.warning > 0 && (
              <span className="alerts-summary-badge alerts-summary-badge--warning" title="Warning">
                <span className="alerts-summary-emoji" aria-hidden>{SEVERITY_EMOJI.warning}</span>
                {severityCounts.warning} Warning
              </span>
            )}
            {severityCounts.info > 0 && (
              <span className="alerts-summary-badge alerts-summary-badge--info" title="Info">
                <span className="alerts-summary-emoji" aria-hidden>{SEVERITY_EMOJI.info}</span>
                {severityCounts.info} Info
              </span>
            )}
          </div>
        )}
        {alerts.length > 0 && (
          <div className="alerts-summary-pills" role="tablist" aria-label="Filter by severity">
            {SEVERITY_PILLS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="tab"
                aria-selected={severityFilter === p.value}
                className={`alerts-summary-pill ${severityFilter === p.value ? "alerts-summary-pill--active" : ""}`}
                onClick={() => setSeverityFilter(p.value)}
              >
                {p.label}
              </button>
            ))}
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
            icon="🔔"
            title="No alerts"
            message={alerts.length === 0 ? "No alerts — all systems operating normally." : `No ${severityFilter} alerts.`}
          />
        ) : (
          <>
            <ul className="alerts-list alerts-notifications-list" aria-label="Recent alerts">
              {list.map((a) => {
                const alertId = a.id || a.timestamp;
                const isUnread = !readIds.has(alertId);
                const displaySeverity = getDisplaySeverity(a.severity);
                const status = a.resolved ? "Resolved" : "Active";
                return (
                  <li key={alertId} className="alerts-list__item alerts-notifications-item">
                    <button
                      type="button"
                      className={`alert alert--${displaySeverity} alert--clickable alerts-notification-item`}
                      onClick={() => {
                        setReadIds((prev) => new Set([...prev, alertId]));
                        setSelectedAlert(a);
                      }}
                      aria-label={`View details: ${a.title || "Alert"}`}
                    >
                      {isUnread && <span className="alerts-notification-dot" aria-hidden />}
                      <span className="alerts-notification-content">
                        <span className="alert-title">{a.title || "Alert"}</span>
                        {a.parameter && <span className="alert-parameter">{a.parameter}</span>}
                        <span className="alert-meta">
                          <span className="alert-node">{a.nodeName || a.nodeId || "—"}</span>
                          <span className="alert-date">{getRelativeTime(a.timestamp || a.createdAt)}</span>
                          <span className={`alert-status alert-status--${a.resolved ? "resolved" : "active"}`}>{status}</span>
                        </span>
                        <span className="alert-view-details">View details</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {hasAlerts && (
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
