import React, { useState, useRef, useEffect } from "react";
import LastUpdated from "../LastUpdated";
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

export function AlertsSummaryCard({
  alerts = [],
  recentAlerts,
  isLoadingAlerts,
  lastUpdated,
  onExportJson,
  onExportCsv,
  formatDateShort = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"),
}) {
  const list = recentAlerts != null ? recentAlerts : alerts.slice(0, 5);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [readIds, setReadIds] = useState(new Set());
  const exportDropdownRef = useRef(null);

  useEffect(() => {
    if (!exportOpen) return;
    const handleClickOutside = (e) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [exportOpen]);

  const hasExport = onExportJson || onExportCsv;
  const unreadCount = list.filter((a) => !readIds.has(a.id || a.timestamp)).length;

  const handleMarkAllRead = () => {
    setReadIds(new Set(list.map((a) => a.id || a.timestamp)));
  };

  return (
    <div className="card card--fill alerts-summary-card alerts-notifications-panel">
      <div className="alerts-notifications-header">
        <h2 className="alerts-notifications-title">Notifications</h2>
        {hasExport && (
          <div className="alerts-notifications-header-actions">
            <div className="alerts-notifications-export" ref={exportDropdownRef}>
              <button
                type="button"
                className="ghost-btn export-dropdown__trigger"
                onClick={() => setExportOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={exportOpen}
                aria-label="Export alerts"
              >
                Export <span className="export-dropdown__chevron">▼</span>
              </button>
              {exportOpen && (
                <div className="export-dropdown__menu" role="menu">
                  {onExportJson && (
                    <button
                      type="button"
                      role="menuitem"
                      className="export-dropdown__item"
                      onClick={() => {
                        onExportJson(alerts);
                        setExportOpen(false);
                      }}
                    >
                      Export as JSON
                    </button>
                  )}
                  {onExportCsv && (
                    <button
                      type="button"
                      role="menuitem"
                      className="export-dropdown__item"
                      onClick={() => {
                        onExportCsv(alerts);
                        setExportOpen(false);
                      }}
                    >
                      Export as CSV
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="card__body alerts-notifications-body">
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
            message="No alerts for the selected node."
          />
        ) : (
          <>
            <ul className="alerts-list alerts-notifications-list" aria-label="Recent alerts">
              {list.map((a) => {
                const alertId = a.id || a.timestamp;
                const isUnread = !readIds.has(alertId);
                return (
                  <li key={alertId} className="alerts-list__item alerts-notifications-item">
                    <button
                      type="button"
                      className={`alert alert--${(a.severity || "info").toLowerCase()} alert--clickable alerts-notification-item`}
                      onClick={() => {
                        setReadIds((prev) => new Set([...prev, alertId]));
                        setSelectedAlert(a);
                      }}
                      aria-label={`View details: ${a.title || "Alert"}`}
                    >
                      {isUnread && <span className="alerts-notification-dot" aria-hidden />}
                      <span className="alerts-notification-content">
                        <span className="alert-title">{a.title || "Alert"}</span>
                        <span className="alert-date">{getRelativeTime(a.timestamp || a.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {unreadCount > 0 && (
              <button type="button" className="alerts-mark-all-read" onClick={handleMarkAllRead}>
                Mark all as read
              </button>
            )}
          </>
        )}
      </div>
      {selectedAlert && (
        <AlertDetailModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      )}
    </div>
  );
}

export default AlertsSummaryCard;
