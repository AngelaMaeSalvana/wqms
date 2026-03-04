import React from "react";
import "./dashboard.css";

function getWqiColor(value) {
  if (value == null) return "var(--text-muted)";
  if (value >= 90) return "#44d37e";
  if (value >= 70) return "#90ee90";
  if (value >= 50) return "#f0a500";
  if (value >= 25) return "#ff6b6b";
  return "#d45b5b";
}

export function WqiCard({ value, label, minimal = false }) {
  const color = getWqiColor(value);

  if (minimal) {
    return (
      <div className="card wqi-card wqi-card--minimal">
        <div className="wqiBox wqiBox--minimal">
          <div className="wqiScore wqiScore--minimal" style={{ color }}>{value != null ? value : "—"}</div>
          <div className="wqiLabel">{label || (value != null ? "—" : "")}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="card card--fill wqi-card">
      <div className="card__header">
        <div>
          <p className="eyebrow">Water Quality</p>
          <h2 className="card__title">WQI Score</h2>
        </div>
      </div>
      <div className="wqiBox">
        <div className="wqiScore" style={{ color }}>{value != null ? value : "—"}</div>
        <div className="wqiLabel" style={value != null ? { color } : undefined}>{label || (value != null ? "—" : "No data")}</div>
        <div className="dashHint">0–100 scale · Higher is better</div>
      </div>
    </div>
  );
}

export default WqiCard;
