import React from "react";
// import "./dashboard.css";

export default function NodeSelector({ nodes = [], value, onChange }) {
  return (
    <div className="card">
      <div className="card__header">
        <div>
          <h2 className="card__title">Node</h2>
          <p className="card__desc">Select a sensor location</p>
        </div>
      </div>

      <select
        className="dashSelect"
        value={value || ""}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name} — {n.location}
          </option>
        ))}
      </select>

      <div className="dashHint">Dashboard-only selection</div>
    </div>
  );
}
