import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import "./AlertDetailModal.css";

const SEVERITY_LABELS = {
  high: "Needs attention",
  medium: "Check when you can",
  low: "Early warning",
  info: "Information",
};

const TRIGGER_LABELS = {
  threshold: "Sensor reading exceeded limit",
  node: "Monitoring node status change",
  maintenance: "Maintenance overdue",
  wqi: "Water Quality Index change",
  system: "System event",
};

const PARAMETER_LABELS = {
  temperature: "Temperature",
  turbidity: "Turbidity",
  ph: "Water pH",
  pH: "Water pH",
  nh3: "Ammonia (NH₃)",
  dissolvedOxygen: "Dissolved Oxygen",
  dissolved_oxygen: "Dissolved Oxygen",
  flowRate: "Flow Rate",
  flow_rate: "Flow Rate",
  wqi: "Water Quality Index (WQI)",
  system: "Multiple parameters",
};

export function AlertDetailModal({ alert: a, onClose }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (!a) return null;
  const severity = (a.severity || "info").toLowerCase();
  const severityLabel = SEVERITY_LABELS[severity] || a.severity || "Info";
  const dateStr = a.timestamp
    ? new Date(a.timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : (a.createdAt ? new Date(a.createdAt).toLocaleString() : "—");

  const hasThreshold = a.thresholdMin != null || a.thresholdMax != null;
  const thresholdStr = [a.thresholdMin, a.thresholdMax].filter(Boolean).join("–");

  return createPortal(
    <div
      className="alert-detail-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="alert-detail-title"
    >
      <div className="alert-detail-modal card" onClick={(e) => e.stopPropagation()}>
        <div className="alert-detail-modal__header">
          <span className={`alert-detail-modal__severity alert-detail-modal__severity--${severity}`}>
            {severityLabel}
          </span>
          <h2 id="alert-detail-title" className="alert-detail-modal__title">
            {a.title || "Alert"}
          </h2>
        </div>
        <div className="alert-detail-modal__body">
          <p className="alert-detail-modal__summary">{a.detail || a.message || "No additional details."}</p>

          <div className="alert-detail-modal__section">
            <h3 className="alert-detail-modal__section-title">Location</h3>
            {a.nodeName || a.nodeId ? (
              <p className="alert-detail-modal__row">
                {a.nodeName && <span className="alert-detail-modal__value">{a.nodeName}</span>}
                {a.nodeId && <span className="alert-detail-modal__muted"> ({a.nodeId})</span>}
              </p>
            ) : (
              <p className="alert-detail-modal__muted">—</p>
            )}
          </div>

          <div className="alert-detail-modal__section">
            <h3 className="alert-detail-modal__section-title">Date &amp; Time</h3>
            <p className="alert-detail-modal__row">{dateStr}</p>
          </div>

          {(a.parameter != null || a.type) && (
            <div className="alert-detail-modal__section">
              <h3 className="alert-detail-modal__section-title">Details</h3>
              <dl className="alert-detail-modal__details">
                {a.type && (
                  <>
                    <dt>Cause</dt>
                    <dd>{TRIGGER_LABELS[a.type] || a.type}</dd>
                  </>
                )}
                {a.parameter != null && (
                  <>
                    <dt>Affected Parameter</dt>
                    <dd>
                      {a.parameter === 'system' ? (
                        a.affectedParameters?.length > 0
                          ? a.affectedParameters.map((p) => PARAMETER_LABELS[p] || p).join(', ')
                          : 'Multiple parameters'
                      ) : (
                        <>
                          {PARAMETER_LABELS[a.parameter] || a.parameter}
                          {a.value != null && (
                            <span className="alert-detail-modal__value-inline">
                              {" "}— Measured: <strong>{a.value}</strong>
                              {hasThreshold && (
                                <span className="alert-detail-modal__muted"> (safe range: {thresholdStr})</span>
                              )}
                            </span>
                          )}
                        </>
                      )}
                    </dd>
                  </>
                )}
                {a.wqiEscalated && (
                  <>
                    <dt>Note</dt>
                    <dd className="alert-detail-modal__escalation-note">
                      Overall water quality score (WQI) worsened — alert severity was raised accordingly
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>
        <div className="alert-detail-modal__footer">
          <button type="button" className="alert-detail-modal__close" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default AlertDetailModal;
