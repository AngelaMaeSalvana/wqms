import React, { useMemo } from "react";
// import "./dashboard.css";

function computeWqiLabel(score) {
  if (score >= 90) return "Good";
  if (score >= 70) return "Fair";
  if (score >= 50) return "Poor";
  return "Critical";
}

export default function WaterQuality({ node }) {
  const wqi = useMemo(() => {
    if (!node) return null;
    if (node.status === "online") return 92;
    if (node.status === "warning") return 71;
    return 40;
  }, [node]);

  return (
    <div className="card card--fill">
      <div className="card__header">
        <div>
          <h2 className="card__title">WQI Score</h2>
          <p className="card__desc">{node?.name || "—"}</p>
        </div>
      </div>

      <div className="wqiBox">
        <div className="wqiScore">{wqi ?? "—"}</div>
        <div className="wqiLabel">{wqi != null ? computeWqiLabel(wqi) : "—"}</div>
        <div className="dashHint">Calculated from available readings</div>
      </div>
    </div>
  );
}
