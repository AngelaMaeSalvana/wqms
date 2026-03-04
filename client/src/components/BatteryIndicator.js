import React from "react";
import {
  voltageToPercentage,
  getBatteryIconLevel,
  isBatteryLow,
} from "../utils/batteryUtils";
import "./BatteryIndicator.css";

/**
 * Battery indicator per node.
 * Converts voltage to percentage (4.2V=100%, 3.3V=0%) and displays the appropriate icon.
 * - ≥75%: full
 * - 50–74%: three-bar
 * - 25–49%: two-bar
 * - 10–24%: one-bar
 * - <10%: empty + low status
 */
export default function BatteryIndicator({ voltage, showPercentage, size = "medium" }) {
  const percentage = voltageToPercentage(voltage);
  const level = getBatteryIconLevel(percentage);
  const isLow = isBatteryLow(percentage);

  if (voltage == null || (typeof voltage === "number" && isNaN(voltage))) {
    return (
      <span className={`battery-indicator battery-indicator--${size}`} title="Battery unknown">
        <span className="battery-icon battery-icon--unknown" aria-hidden="true">
          —
        </span>
      </span>
    );
  }

  const title =
    percentage != null
      ? `Battery ${percentage}%${isLow ? " (low)" : ""}`
      : `Battery ${voltage?.toFixed(2) ?? "?"}V`;

  return (
    <span
      className={`battery-indicator battery-indicator--${size} ${isLow ? "battery-indicator--low" : ""}`}
      title={title}
      role="img"
      aria-label={title}
    >
      <span className={`battery-icon battery-icon--${level}`} aria-hidden="true">
        <BatteryIconSvg level={level} />
      </span>
      {showPercentage && percentage != null && (
        <span className="battery-percentage">{percentage}%</span>
      )}
    </span>
  );
}

function BatteryIconSvg({ level }) {
  const bars = { full: 4, three: 3, two: 2, one: 1, empty: 0 }[level] ?? 0;
  // Inner fill: x=3 y=2 width=14 height=8. Each bar = 2 units. Bottom-aligned.
  const barHeight = 2;
  const innerHeight = 8;
  const fillHeight = bars * barHeight;
  const fillY = 2 + innerHeight - fillHeight;

  return (
    <svg
      viewBox="0 0 24 12"
      className="battery-svg"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Battery body */}
      <rect x="1" y="1" width="18" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
      {/* Terminal */}
      <rect x="19" y="3" width="2" height="6" rx="0.5" fill="currentColor" />
      {/* Fill bars (bottom-aligned, distinct segments) */}
      {bars > 0 && (
        <rect
          x="3"
          y={fillY}
          width="14"
          height={fillHeight}
          rx="0.5"
          fill="currentColor"
        />
      )}
    </svg>
  );
}
