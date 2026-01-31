import React, { useEffect } from "react";
import "./AlertDetailModal.css";

export function AlertDetailModal({ alert: a, onClose }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (!a) return null;
  const dateStr = a.timestamp
    ? new Date(a.timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : (a.createdAt ? new Date(a.createdAt).toLocaleString() : "—");

  return (
    <div
      className="alert-detail-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="alert-detail-title"
    >
      <div className="alert-detail-modal card" onClick={(e) => e.stopPropagation()}>
        <div className="alert-detail-modal__header">
          <h2 id="alert-detail-title" className="alert-detail-modal__title">
            {a.title || "Alert"}
          </h2>
          <span className={`alert-detail-modal__severity alert-detail-modal__severity--${(a.severity || "info").toLowerCase()}`}>
            {a.severity || "Info"}
          </span>
        </div>
        <div className="alert-detail-modal__body">
          <p className="alert-detail-modal__detail">{a.detail || a.message || "—"}</p>
          {a.nodeName && (
            <p className="alert-detail-modal__node">
              <span className="alert-detail-modal__label">Node:</span> {a.nodeName}
              {a.nodeId && <span className="alert-detail-modal__id"> ({a.nodeId})</span>}
            </p>
          )}
          {a.type && (
            <p className="alert-detail-modal__type">
              <span className="alert-detail-modal__label">Type:</span> {a.type}
            </p>
          )}
          {a.parameter != null && (
            <p className="alert-detail-modal__param">
              <span className="alert-detail-modal__label">Parameter:</span> {a.parameter}
              {a.value != null && ` — Current: ${a.value}`}
              {(a.thresholdMin != null || a.thresholdMax != null) && (
                <span> (Threshold: {[a.thresholdMin, a.thresholdMax].filter(Boolean).join("–")})</span>
              )}
            </p>
          )}
          <p className="alert-detail-modal__date">
            <span className="alert-detail-modal__label">Date & time:</span> {dateStr}
          </p>
        </div>
        <div className="alert-detail-modal__footer">
          <button type="button" className="alert-detail-modal__close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default AlertDetailModal;
