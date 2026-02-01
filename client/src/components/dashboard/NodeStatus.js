import React from "react";
import "./dashboard.css";

const VALID_STATUSES = ["online", "offline", "testing", "passed", "failed"];

export function NodeStatus({ status }) {
  const normalized = status && VALID_STATUSES.includes(status) ? status : "offline";
  return (
    <span className={`node-status-pill node-status-pill--${normalized}`} role="status">
      {normalized.charAt(0).toUpperCase() + normalized.slice(1)}
    </span>
  );
}

export default NodeStatus;
