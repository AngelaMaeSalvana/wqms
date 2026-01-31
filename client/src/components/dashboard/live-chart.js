import React from "react";
// import "./dashboard.css";

export default function LiveChart({ node }) {
  return (
    <div className="card card--fill">
      <div className="card__header">
        <div>
          <h2 className="card__title">Live Charts</h2>
          <p className="card__desc">Real-time — {node?.name || "—"}</p>
        </div>
      </div>

      <div className="card__body--fill">
        <div className="placeholder">Live chart placeholder (Chart.js)</div>
      </div>
    </div>
  );
}
