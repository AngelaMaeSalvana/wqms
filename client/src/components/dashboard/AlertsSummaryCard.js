import React, { useState, useRef, useEffect } from "react";
import LastUpdated from "../LastUpdated";
import EmptyState from "../EmptyState";
import AlertDetailModal from "../AlertDetailModal";
import { AlertSkeleton } from "../LoadingSkeleton";
import "./dashboard.css";

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

  return (
    <div className="card card--fill alerts-summary-card">
      <div className="card__header alerts-summary-card__header">
        <div>
          <h2 className="card__title">Alerts Summary</h2>
          <p className="card__desc">
            {lastUpdated && <LastUpdated timestamp={lastUpdated} />}
          </p>
        </div>
        {hasExport && (
          <div className="export-dropdown" ref={exportDropdownRef}>
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
        )}
      </div>
      <div className="card__body">
        {isLoadingAlerts ? (
          <div className="alerts-list">
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
          <ul className="alerts-list" aria-label="Recent alerts">
            {list.map((a) => (
              <li key={a.id || a.timestamp} className="alerts-list__item">
                <button
                  type="button"
                  className={`alert alert--${(a.severity || "info").toLowerCase()} alert--clickable`}
                  onClick={() => setSelectedAlert(a)}
                  aria-label={`View details: ${a.title || "Alert"}`}
                >
                  <span className="alert-title">{a.title || "Alert"}</span>
                  <span className="alert-detail">{a.detail || a.message || ""}</span>
                  <span className="alert-date">{formatDateShort(a.timestamp || a.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selectedAlert && (
        <AlertDetailModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      )}
    </div>
  );
}

export default AlertsSummaryCard;
