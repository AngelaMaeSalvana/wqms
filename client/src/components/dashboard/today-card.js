import React from "react";
// import "./dashboard.css";

export default function TodayCard({ node }) {
  return (
    <div className="card card--fill">
      <div className="card__header">
        <div>
          <h2 className="card__title">Today</h2>
          <p className="card__desc">Last 24 hours — {node?.name || "—"}</p>
        </div>

        <div className="legend">
          <span className="legendItem legendItem--temp">Temperature</span>
          <span className="legendItem legendItem--turb">Turbidity</span>
          <span className="legendItem legendItem--ph">Water pH</span>
        </div>
      </div>

      <div className="card__body--fill">
        <div className="placeholder">Today chart placeholder</div>
      </div>
    </div>
  );
}
