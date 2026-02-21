import React from "react";
import "./dashboard.css";

export function WqiCard({ value, label, minimal = false }) {
  if (minimal) {
    return (
      <div className="card wqi-card wqi-card--minimal">
        <div className="wqiBox wqiBox--minimal">
          <div className="wqiScore wqiScore--minimal">{value != null ? value : "—"}</div>
          <div className="wqiLabel">{label || (value != null ? "—" : "")}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="card card--fill wqi-card">
      <div className="card__header">
        <div>
          <h2 className="card__title">WQI</h2>
        </div>
      </div>
      <div className="wqiBox">
        <div className="wqiScore">{value != null ? value : "—"}</div>
        <div className="wqiLabel">{label || (value != null ? "—" : "")}</div>
        <div className="dashHint">0–100 scale</div>
      </div>
    </div>
  );
}

export default WqiCard;
