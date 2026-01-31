import React from "react";
import "./dashboard.css";

const VALID_STATUSES = ["online", "offline", "testing", "passed", "failed"];

export function NodeStatus({ status, isLive }) {
  const normalized = status && VALID_STATUSES.includes(status) ? status : "offline";
  return (
    <span className="node-status-wrap" role="status">
      <span className={`node-status-pill node-status-pill--${normalized}`}>
        {normalized.charAt(0).toUpperCase() + normalized.slice(1)}
      </span>
      {isLive && (
        <span className="node-status-pill node-status-pill--live" aria-label="Live data from HiveMQ">
          Live
        </span>
      )}
    </span>
  );
}

export default NodeStatus;
