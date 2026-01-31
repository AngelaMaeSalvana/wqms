import React from "react";
import "./dashboard.css";

export function NodeSelector({ nodes = [], value, onChange }) {
  const selected = nodes.find((n) => n.id === value);
  const title = selected
    ? (selected.location ? selected.name + " — " + selected.location : selected.name)
    : "";

  return (
    <div className="node-selector-pill">
      <select
        className="node-selector-pill__select"
        value={value || ""}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label="Select sensor node"
        title={title}
      >
        <option value="">Select node…</option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
            {n.location ? ` — ${n.location}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export default NodeSelector;
