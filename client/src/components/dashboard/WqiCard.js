import React from "react";
import "./dashboard.css";

export function WqiCard({ value, label }) {
  return (
    <div className="card card--fill wqi-card">
      <div className="card__header">
        <div>
          <h2 className="card__title">WQI Score</h2>
          <p className="card__desc">Water Quality Index</p>
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
