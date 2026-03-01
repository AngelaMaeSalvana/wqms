import React from "react";
import "./dashboard.css";

export function NodeStatus({ status }) {
  const normalized = status === "online" ? "online" : "offline";
  return (
    <span className={`node-status-pill node-status-pill--${normalized}`} role="status">
      {normalized === "online" ? "Online" : "Offline"}
    </span>
  );
}

export default NodeStatus;
