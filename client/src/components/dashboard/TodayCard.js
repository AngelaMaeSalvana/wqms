import React, { useState, useRef, useEffect, useCallback } from "react";
import { MetricSkeleton } from "../LoadingSkeleton";
import CurrentClassification from "../CurrentClassification";
import { formatNH3, getNH3FromReading } from "../../utils/nh3Calculator";
import "./dashboard.css";

const PARAMS = [
  { key: "temperature", label: "Temperature", unit: "°C", color: "temp" },
  { key: "turbidity", label: "Turbidity", unit: " NTU", color: "turb" },
  { key: "ph", label: "Water pH", unit: "", color: "ph" },
  { key: "nh3", label: "Ammonia (NH₃)", unit: " mg/L", color: "nh3", fmt: formatNH3 },
  { key: "flowRate", label: "Flow Rate", unit: " L/min", color: "flow" },
  { key: "dissolvedOxygen", label: "Dissolved O₂", unit: " mg/L", color: "do" },
];

const OVERVIEW_TABS = [
  { id: "low", label: "Min", key: "low" },
  { id: "avg", label: "Avg", key: "avg" },
  { id: "high", label: "Max", key: "high" },
];

function ValWithUnit({ value, unit, fmt, hideUnit }) {
  if (value == null) return "—";
  const num = fmt ? fmt(value) : value;
  if (hideUnit) return num;
  const u = (unit || "").trim();
  if (!u) return num;
  return (
    <>
      {num}<span className="today-stat-block__val-unit">{u}</span>
    </>
  );
}

function getLastValue(reading, param) {
  if (!reading) return null;
  switch (param.key) {
    case "temperature": return reading.temperature;
    case "turbidity": return reading.turbidity;
    case "ph": return reading.ph ?? reading.pH;
    case "nh3": return reading.nh3 ?? reading.NH3 ?? getNH3FromReading(reading);
    case "flowRate": return reading.flow_rate ?? reading.flowRate;
    case "dissolvedOxygen": return reading.dissolved_oxygen ?? reading.dissolvedOxygen ?? reading.do;
    default: return null;
  }
}

function StatBlock({ label, low, avg, high, unit, colorClass, fmt }) {
  return (
    <div className={`today-stat-block today-stat-block--${colorClass}`}>
      <div className="today-stat-block__label">
        {label}{unit ? <span className="today-stat-block__unit"> ({unit.trim()})</span> : null}
      </div>
      <div className="today-stat-block__row">
        <span className="today-stat-block__item">
          <span className="today-stat-block__key">Low</span>
          <span className="today-stat-block__val"><ValWithUnit value={low} unit={unit} fmt={fmt} hideUnit /></span>
        </span>
        <span className="today-stat-block__item">
          <span className="today-stat-block__key">Avg</span>
          <span className="today-stat-block__val"><ValWithUnit value={avg} unit={unit} fmt={fmt} hideUnit /></span>
        </span>
        <span className="today-stat-block__item">
          <span className="today-stat-block__key">High</span>
          <span className="today-stat-block__val"><ValWithUnit value={high} unit={unit} fmt={fmt} hideUnit /></span>
        </span>
      </div>
    </div>
  );
}

function LastReadingBlock({ label, value, unit, colorClass, fmt }) {
  return (
    <div className={`today-stat-block today-stat-block--${colorClass}`}>
      <div className="today-stat-block__label">
        {label}{unit ? <span className="today-stat-block__unit"> ({unit.trim()})</span> : null}
      </div>
      <div className="today-stat-block__row today-stat-block__row--single">
        <span className="today-stat-block__item">
          <span className="today-stat-block__val today-stat-block__val--last"><ValWithUnit value={value} unit={unit} fmt={fmt} hideUnit /></span>
        </span>
      </div>
    </div>
  );
}

export function TodayCard({
  todayStats,
  latestReading,
  selectedNode,
  readingsLoaded = false,
  variant = "grid",
  readingMode = "corrected",
  onReadingModeChange,
}) {
  const [activePage, setActivePage] = useState(0);
  const [overviewTab, setOverviewTab] = useState("avg");
  const scrollRef = useRef(null);
  const isMountedRef = useRef(false);

  const hasStats =
    todayStats &&
    (todayStats.temperature || todayStats.turbidity || todayStats.ph ||
     todayStats.nh3 || todayStats.flowRate || todayStats.dissolvedOxygen);

  const hasLastReading = latestReading && PARAMS.some((p) => getLastValue(latestReading, p) != null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const doScroll = (behavior) => {
      const w = el.offsetWidth;
      if (w > 0) el.scrollTo({ left: activePage * w, behavior });
    };
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      requestAnimationFrame(() => doScroll("instant"));
    } else {
      doScroll("smooth");
    }
  }, [activePage]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setActivePage(Math.round(el.scrollLeft / el.offsetWidth));
  }, []);

  const goTo = useCallback((page) => setActivePage(page), []);

  const renderLastPage = () => (
    <div className="today-stats-grid">
      {PARAMS.map((p) => (
        <LastReadingBlock
          key={p.key}
          label={p.label}
          value={getLastValue(latestReading, p)}
          unit={p.unit}
          colorClass={p.color}
          fmt={p.fmt}
        />
      ))}
    </div>
  );

  const renderOverviewTabsView = () => (
    <>
      <div className="today-card__tabs" role="tablist" aria-label="View Min, Avg, or Max values">
        {OVERVIEW_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={overviewTab === id}
            className={`today-card__tab ${overviewTab === id ? "today-card__tab--active" : ""}`}
            onClick={() => setOverviewTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="today-card__params">
        {PARAMS.map((p) => {
          const { key, label, unit, color, fmt } = p;
          const s = todayStats[key];
          const value = s?.[overviewTab];
          const num = value != null ? (fmt ? fmt(value) : value) : null;
          return (
            <div key={key} className={`today-card__param today-card__param--${color}`}>
              <span className="today-card__param-name">{label}{unit ? ` (${unit.trim()})` : ""}</span>
              <span className="today-card__param-value">{num == null ? "—" : num}</span>
            </div>
          );
        })}
      </div>
    </>
  );

  const renderOverviewGridView = () => (
    <div className="today-stats-grid">
      {PARAMS.map((p) => {
        const s = todayStats[p.key];
        return (
          <StatBlock
            key={p.key}
            label={p.label}
            low={s?.low}
            avg={s?.avg}
            high={s?.high}
            unit={p.unit}
            colorClass={p.color}
            fmt={p.fmt}
          />
        );
      })}
    </div>
  );

  const renderOverviewPage = () =>
    variant === "tabs" ? renderOverviewTabsView() : renderOverviewGridView();

  const isEmpty = !hasStats && !hasLastReading && readingsLoaded;

  const cardTitle = isEmpty || (!hasStats && !hasLastReading)
    ? "Today's Overview"
    : activePage === 0
      ? "Last Reading"
      : "Overview";

  return (
    <div className={`card card--fill today-card today-card--${variant} today-card--paged`}>
      <div className="card__header today-card__header">
        <div>
          <h2 className="card__title">{cardTitle}</h2>
        </div>
        <div className="today-card__header-right">
          <div className="today-card__mode-toggle" role="group" aria-label="Reading mode">
            <button
              type="button"
              className={`ghost-btn ${readingMode === "raw" ? "ghost-btn--active" : ""}`}
              onClick={() => onReadingModeChange?.("raw")}
            >
              Raw
            </button>
            <button
              type="button"
              className={`ghost-btn ${readingMode === "corrected" ? "ghost-btn--active" : ""}`}
              onClick={() => onReadingModeChange?.("corrected")}
            >
              Corrected
            </button>
          </div>
          <CurrentClassification className="today-card__classification" />
        </div>
      </div>
      <div className="card__body card__body--fill">
        {isEmpty ? (
          <div className="today-card-empty" aria-live="polite">
            <p>No readings available for today.</p>
            <p className="today-card-empty-hint">Make sure monitoring nodes are set up and sending data.</p>
          </div>
        ) : !hasStats && !hasLastReading ? (
          <div className="today-stats-skeleton">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <MetricSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            <div className="today-card-pages" ref={scrollRef} onScroll={handleScroll}>
              <div className="today-card-page">
                {hasLastReading ? renderLastPage() : (
                  <div className="today-card-empty">
                    <p>No last reading yet.</p>
                  </div>
                )}
              </div>
              <div className="today-card-page">
                {hasStats ? renderOverviewPage() : (
                  <div className="today-card-empty">
                    <p>No daily stats yet.</p>
                  </div>
                )}
              </div>
            </div>
            <div className="today-card-dots" role="tablist" aria-label="Switch between Current Reading and Overview">
              <button
                type="button"
                role="tab"
                aria-selected={activePage === 0}
                aria-label="Current Reading"
                className={`today-card-dot${activePage === 0 ? " today-card-dot--active" : ""}`}
                onClick={() => goTo(0)}
              />
              <button
                type="button"
                role="tab"
                aria-selected={activePage === 1}
                aria-label="Overview"
                className={`today-card-dot${activePage === 1 ? " today-card-dot--active" : ""}`}
                onClick={() => goTo(1)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TodayCard;
