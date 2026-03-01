import React, { useState } from "react";
import { MetricSkeleton } from "../LoadingSkeleton";
import CurrentClassification from "../CurrentClassification";
import "./dashboard.css";

const PARAMS = [
  { key: "temperature", label: "Temperature", unit: "°C", color: "temp" },
  { key: "turbidity", label: "Turbidity", unit: "", color: "turb" },
  { key: "ph", label: "Water pH", unit: "", color: "ph" },
  { key: "nh3", label: "NH₃", unit: " mg/L", color: "nh3" },
  { key: "flowRate", label: "Flow rate", unit: " L/min", color: "flow" },
  { key: "dissolvedOxygen", label: "Dissolved O₂", unit: " mg/L", color: "do" },
];

const TABS = [
  { id: "low", label: "MIN", key: "low" },
  { id: "avg", label: "AVG", key: "avg" },
  { id: "high", label: "MAX", key: "high" },
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

export function TodayCard({ todayStats, selectedNode, readingsLoaded = false, variant = "grid" }) {
  const [activeTab, setActiveTab] = useState("avg");
  const hasStats =
    todayStats &&
    (todayStats.temperature || todayStats.turbidity || todayStats.ph ||
     todayStats.nh3 || todayStats.flowRate || todayStats.dissolvedOxygen);

  const renderTabsView = () => (
    <>
      <div className="today-card__tabs" role="tablist" aria-label="View MIN, AVG, or MAX values">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`today-card__tab ${activeTab === id ? "today-card__tab--active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="today-card__params">
        {PARAMS.map(({ key, label, unit, color }) => {
          const s = todayStats[key];
          const value = s?.[activeTab];
          return (
            <div key={key} className={`today-card__param today-card__param--${color}`}>
              <span className="today-card__param-name">{label}</span>
              <span className="today-card__param-value">
                {value != null ? `${value}${unit}` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );

  const renderGridView = () => (
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
  );

  return (
    <div className={`card card--fill today-card today-card--${variant}`}>
      <div className="card__header today-card__header">
        <div>
          <h2 className="card__title">Today&apos;s Overview</h2>
        </div>
        <CurrentClassification className="today-card__classification" />
      </div>
      <div className="card__body card__body--fill">
        {!hasStats && readingsLoaded ? (
          <div className="today-card-empty" aria-live="polite">
            <p>No data from database yet.</p>
            <p className="today-card-empty-hint">Add nodes or wait for sensor data.</p>
          </div>
        ) : !hasStats ? (
          <div className="today-stats-skeleton">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <MetricSkeleton key={i} />
            ))}
          </div>
        ) : variant === "tabs" ? (
          renderTabsView()
        ) : (
          renderGridView()
        )}
      </div>
    </div>
  );
}

export default TodayCard;
