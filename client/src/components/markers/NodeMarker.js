import React from "react";

export default function NodeMarker({ nodeId, onTestSensor, isTesting, testStatus }) {
  const handleClick = () => {
    if (onTestSensor && !isTesting) onTestSensor(nodeId);
  };

  let backgroundColor = "#1E88E5";
  let borderColor = "white";
  let animation = "none";
  let icon = nodeId || 1;
  let titleText = `Node ${nodeId || 1} - Click to test sensor`;

  if (isTesting) {
    backgroundColor = "#f0a500";
    borderColor = "#f0a500";
    animation = "nodeMarkerPulse 1.5s ease-in-out infinite";
    icon = "⚙️";
    titleText = `Node ${nodeId || 1} - Testing sensors...`;
  } else if (testStatus === "error" || testStatus === "failed") {
    backgroundColor = "#d45b5b";
    borderColor = "#d45b5b";
    animation = "nodeMarkerPulse 2s ease-in-out infinite";
    icon = "⚠️";
    titleText = `Node ${nodeId || 1} - Sensor test failed`;
  } else if (testStatus === "warning") {
    backgroundColor = "#f0a500";
    borderColor = "#f0a500";
    icon = "⚠️";
    titleText = `Node ${nodeId || 1} - Sensor test completed with warnings`;
  } else if (testStatus === "success") {
    backgroundColor = "#44d37e";
    borderColor = "#44d37e";
    icon = "✓";
    titleText = `Node ${nodeId || 1} - Sensor test passed`;
  }

  const buttonStyle = {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    backgroundColor,
    color: "white",
    border: `3px solid ${borderColor}`,
    boxShadow: isTesting
      ? "0 0 12px rgba(240, 165, 0, 0.6)"
      : testStatus === "error" || testStatus === "failed"
      ? "0 0 12px rgba(212, 91, 91, 0.6)"
      : "0 2px 8px rgba(0,0,0,0.3)",
    cursor: isTesting ? "wait" : "pointer",
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
      style={{ position: "absolute", transform: "translate(-50%, -50%)", zIndex: 20 }}
      onMouseDown={stopMapDrag}
      onMouseUp={stopMapDrag}
      onClick={stopMapDrag}
    >
      <button
        onClick={handleClick}
        disabled={isTesting}
        title={titleText}
        aria-label={titleText}
        className={isTesting ? "node-marker-testing" : (testStatus === "error" || testStatus === "failed") ? "node-marker-failed" : ""}
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
    </div>
  );
}
