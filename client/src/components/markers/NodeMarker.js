import React from "react";
import BatteryIndicator from "../BatteryIndicator";

export default function NodeMarker({ nodeId, onTestSensor, isTesting, testStatus, inactive, batteryVoltage, batteryPercentage }) {
  const handleClick = () => {
    if (onTestSensor && !isTesting && !inactive) onTestSensor(nodeId);
  };

  let backgroundColor = "#1E88E5";
  let borderColor = "white";
  let animation = "none";
  let icon = nodeId || 1;
  let titleText = `Node ${nodeId || 1} - Click to test sensor`;

  if (inactive) {
    backgroundColor = "#555";
    borderColor = "#777";
    icon = nodeId || 1;
    titleText = `Node ${nodeId || 1} - Inactive`;
  } else if (isTesting) {
    backgroundColor = "#f0a500";
    borderColor = "#f0a500";
    animation = "nodeMarkerPulse 1.5s ease-in-out infinite";
    icon = "⚙️";
    titleText = `Node ${nodeId || 1} - Testing sensors...`;
  } else if (testStatus === "offline") {
    backgroundColor = "#555";
    borderColor = "#888";
    icon = "📡";
    titleText = `Node ${nodeId || 1} - No recent data, node may be offline`;
  } else if (testStatus === "error" || testStatus === "failed") {
    backgroundColor = "#d45b5b";
    borderColor = "#d45b5b";
    animation = "nodeMarkerPulse 2s ease-in-out infinite";
    icon = "⚠️";
    titleText = `Node ${nodeId || 1} - Sensor check failed`;
  } else if (testStatus === "warning") {
    backgroundColor = "#f0a500";
    borderColor = "#f0a500";
    icon = "⚠️";
    titleText = `Node ${nodeId || 1} - One or more sensors not functional`;
  } else if (testStatus === "success") {
    backgroundColor = "#44d37e";
    borderColor = "#44d37e";
    icon = "✓";
    titleText = `Node ${nodeId || 1} - All sensors functional`;
  }

  const buttonStyle = {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    backgroundColor,
    color: "white",
    border: `3px solid ${borderColor}`,
    opacity: inactive ? 0.45 : 1,
    boxShadow: isTesting
      ? "0 0 12px rgba(240, 165, 0, 0.6)"
      : testStatus === "error" || testStatus === "failed"
      ? "0 0 12px rgba(212, 91, 91, 0.6)"
      : testStatus === "offline"
      ? "0 0 8px rgba(100, 100, 120, 0.5)"
      : "0 2px 8px rgba(0,0,0,0.3)",
    cursor: inactive ? "default" : isTesting ? "wait" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: isTesting || testStatus ? "18px" : "16px",
    fontWeight: "700",
    transition: "all 0.2s ease",
    padding: 0,
    animation,
  };

  const stopMapDrag = (e) => {
    e.stopPropagation();
  };

  return (
    <div
      className="node-marker-wrapper"
      style={{ position: "absolute", transform: "translate(-50%, -50%)", zIndex: 20 }}
      onMouseDown={stopMapDrag}
      onMouseUp={stopMapDrag}
      onClick={stopMapDrag}
    >
      <div className="node-marker-stack">
        <button
        disabled={isTesting || inactive}
        title={titleText}
        aria-label={titleText}
        className={inactive ? "node-marker-inactive" : isTesting ? "node-marker-testing" : (testStatus === "error" || testStatus === "failed") ? "node-marker-failed" : ""}
        style={buttonStyle}
        onMouseDown={stopMapDrag}
        onMouseUp={stopMapDrag}
        onClick={(e) => {
          stopMapDrag(e);
          handleClick();
        }}
        onMouseEnter={(e) => {
          if (!isTesting) {
            e.currentTarget.style.transform = "scale(1.1)";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isTesting) {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.boxShadow = buttonStyle.boxShadow;
          }
        }}
      >
          {icon}
        </button>
        {(batteryVoltage != null || batteryPercentage != null) && (
          <div className="node-marker-battery">
            <BatteryIndicator voltage={batteryVoltage} percentage={batteryPercentage} size="small" />
          </div>
        )}
      </div>
    </div>
  );
}
