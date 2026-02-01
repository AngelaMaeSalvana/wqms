import React from "react";
import { MetricSkeleton } from "../LoadingSkeleton";
import "./dashboard.css";

const PARAMS = [
  { key: "temperature", label: "Temperature", unit: "°C", color: "temp" },
  { key: "turbidity", label: "Turbidity", unit: "", color: "turb" },
  { key: "ph", label: "Water pH", unit: "", color: "ph" },
  { key: "nh3", label: "NH₃", unit: " mg/L", color: "nh3" },
  { key: "flowRate", label: "Flow rate", unit: " L/min", color: "flow" },
  { key: "dissolvedOxygen", label: "Dissolved O₂", unit: " mg/L", color: "do" },
];

function StatBlock({ label, low, avg, high, unit, colorClass }) {
  return (
    <div className={`today-stat-block today-stat-block--${colorClass}`}>
      <div className="today-stat-block__label">{label}</div>
      <div className="today-stat-block__row">
        <span className="today-stat-block__item">
          <span className="today-stat-block__key">Low</span>
          <span className="today-stat-block__val">{low != null ? `${low}${unit}` : "—"}</span>
        </span>
        <span className="today-stat-block__item">
          <span className="today-stat-block__key">Avg</span>
          <span className="today-stat-block__val">{avg != null ? `${avg}${unit}` : "—"}</span>
        </span>
        <span className="today-stat-block__item">
          <span className="today-stat-block__key">High</span>
          <span className="today-stat-block__val">{high != null ? `${high}${unit}` : "—"}</span>
        </span>
      </div>
    </div>
  );
}

export function TodayCard({ todayStats, selectedNode, readingsLoaded = false }) {
  const hasStats =
    todayStats &&
    (todayStats.temperature || todayStats.turbidity || todayStats.ph ||
     todayStats.nh3 || todayStats.flowRate || todayStats.dissolvedOxygen);

  return (
    <div className="card card--fill today-card">
      <div className="card__header">
        <div>
          <h2 className="card__title">Today</h2>
        </div>
      </div>
      <div className="card__body card__body--fill">
        {!hasStats && readingsLoaded ? (
          <div className="today-card-empty" aria-live="polite">
            <p>No data from database yet.</p>
            <p className="today-card-empty-hint">Readings come from Supabase or MQTT. Add data in Nodes or wait for sensor uploads.</p>
          </div>
        ) : !hasStats ? (
          <div className="today-stats-skeleton">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <MetricSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="today-stats-grid">
            {PARAMS.map(({ key, label, unit, color }) => {
              const s = todayStats[key];
              return (
                <StatBlock
                  key={key}
                  label={label}
                  low={s?.low}
                  avg={s?.avg}
                  high={s?.high}
                  unit={unit}
                  colorClass={color}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default TodayCard;
