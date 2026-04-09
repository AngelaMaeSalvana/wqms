import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { getWQIClass, getQualityRatings } from "../../utils/wqiCalculator";
import { formatNH3 } from "../../utils/nh3Calculator";
import "./WqiDetailModal.css";

const PARAM_LABELS = [
  { key: "temperature", label: "Temperature", unit: "°C", weight: "10%" },
  { key: "pH", label: "pH", unit: "", weight: "20%" },
  { key: "turbidity", label: "Turbidity", unit: "NTU", weight: "15%" },
  { key: "dissolvedOxygen", label: "Dissolved O₂", unit: "mg/L", weight: "30%" },
  { key: "nh3", label: "NH₃ (from TAN)", unit: "mg/L", weight: "25%" },
  { key: "flowRate", label: "Flow rate", unit: "L/min", weight: "—" },
];

const CLASS_DETAILS = {
  excellent: {
    description: "Water is of excellent quality, suitable for drinking, irrigation, and all aquatic life. All parameters are within optimal ranges. Safe for direct consumption without treatment.",
    uses: "Drinking water, irrigation, aquaculture, recreational activities",
    wqiRange: "90 – 100",
  },
  good: {
    description: "Water quality is good and generally safe for most uses. Minor deviations from optimal values may be present. Suitable for irrigation and most aquatic life. May require basic filtration for drinking.",
    uses: "Irrigation, aquaculture, recreational activities, drinking with treatment",
    wqiRange: "70 – 89",
  },
  fair: {
    description: "Water quality is fair. Some parameters may be outside optimal ranges. Suitable for irrigation with caution; treatment recommended for drinking.",
    uses: "Irrigation with caution, industrial use; treatment recommended for drinking",
    wqiRange: "50 – 69",
  },
  poor: {
    description: "Water quality is poor with significant deviations from optimal values. Not recommended for drinking without extensive treatment. Limited use for irrigation.",
    uses: "Limited irrigation (with caution), industrial cooling; NOT recommended for drinking or aquaculture",
    wqiRange: "25 – 49",
  },
  "very-poor": {
    description: "Water quality is very poor with severe contamination. High health risks if consumed. Unsuitable for most uses including irrigation and aquatic life. Requires immediate treatment and monitoring.",
    uses: "NOT SAFE for any human or animal consumption. Requires immediate remediation",
    wqiRange: "< 25",
  },
  unsuitable: {
    description: "Water is severely contaminated and unsuitable for any use. Extreme health hazards present. Immediate remediation required.",
    uses: "UNSUITABLE - No safe use possible. Requires emergency remediation measures",
    wqiRange: "< 25",
  },
};

/** WQI scale 0–100: position on bar (0% = very poor, 100% = excellent). */
function wqiToBarPosition(wqi) {
  const s = Number(wqi);
  if (isNaN(s)) return 0;
  return Math.min(100, Math.max(0, s));
}

export default function WqiDetailModal({ date, wqi, params, onClose }) {
  const qualityData = wqi != null ? getWQIClass(wqi) : null;
  const qualityRatings = params ? getQualityRatings(params) : null;

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  if (date == null) return null;

  const dateStr = date instanceof Date
    ? date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : String(date);

  const formatValue = (key, value) => {
    if (value == null || isNaN(value)) return "—";
    if (key === "pH") return value.toFixed(1);
    if (key === "nh3") return formatNH3(value);
    return value.toFixed(1);
  };

  return createPortal(
    <div className="wqi-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="wqi-modal-title">
      <div className="wqi-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wqi-modal-header">
          <h2 id="wqi-modal-title">WQI Score Details</h2>
          <button type="button" className="wqi-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="wqi-modal-body">
          <p className="wqi-modal-date">{dateStr}</p>
          {wqi != null && qualityData ? (
            <>
              <div className="wqi-modal-top">
                <div className="wqi-modal-score-block">
                  <div className={`wqi-modal-score wqi-modal-score--${qualityData.quality}`}>
                    <span className="wqi-modal-score-value">{Math.round(wqi)}</span>
                    <span className="wqi-modal-score-label">WQI</span>
                  </div>
                  <div className="wqi-modal-class">
                    <span className="wqi-modal-class-badge">Class {qualityData.class}</span>
                    <span className="wqi-modal-class-label">{qualityData.label}</span>
                  </div>
                  <div className="wqi-modal-score-subtitle">Water Quality Index</div>
                </div>
                {CLASS_DETAILS[qualityData.quality] && (
                  <div className={`wqi-modal-class-details wqi-modal-class-details--${qualityData.quality}`}>
                    <div className="wqi-modal-class-details-range">
                      WQI Range: {CLASS_DETAILS[qualityData.quality].wqiRange}
                    </div>
                    <p className="wqi-modal-class-details-desc">
                      {CLASS_DETAILS[qualityData.quality].description}
                    </p>
                    <div className="wqi-modal-class-details-uses">
                      <strong>Use:</strong> {CLASS_DETAILS[qualityData.quality].uses}
                    </div>
                  </div>
                )}
              </div>

              {params && qualityRatings && (
                <div className="wqi-modal-params">
                  <p className="wqi-modal-params-title">Parameter details</p>
                  <table className="wqi-modal-params-table">
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th>Value</th>
                        <th>Weight</th>
                        <th>Quality (Q)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PARAM_LABELS.map(({ key, label, unit, weight }) => (
                        <tr key={key}>
                          <td>{label}</td>
                          <td>{formatValue(key, params[key])}{unit ? ` ${unit}` : ""}</td>
                          <td>{weight}</td>
                          <td>{qualityRatings[key] != null ? Math.round(qualityRatings[key]) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="wqi-modal-legend">
                <p className="wqi-modal-legend-title">Status scale</p>
                <div className="wqi-modal-legend-bar-wrap">
                  <div className="legend-bar" aria-hidden="true" />
                  {wqi != null && (
                    <div
                      className="wqi-modal-legend-indicator"
                      style={{ left: `${wqiToBarPosition(wqi)}%` }}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="wqi-modal-legend-labels">
                  <span>Unsuitable (&gt;300)</span>
                  <span>Excellent (&lt;50)</span>
                </div>
              </div>
            </>
          ) : (
            <p className="wqi-modal-no-data">No WQI data for this date.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
