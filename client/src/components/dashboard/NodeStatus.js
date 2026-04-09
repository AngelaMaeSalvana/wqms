import React from "react";
import "./dashboard.css";

export function NodeStatus({ status }) {
  const normalized = status === "online" ? "online" : "offline";
  return (
    <span className={`node-status-pill node-status-pill--${normalized}`} role="status">
      <span className={`node-status-dot node-status-dot--${normalized}`} aria-hidden="true" />
      {normalized === "online" ? "Online" : "Offline"}
    </span>
  );
}

export default NodeStatus;
