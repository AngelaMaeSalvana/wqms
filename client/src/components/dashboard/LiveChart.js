import React, { useMemo } from "react";
import "../../utils/chartConfig";
import { Line } from "react-chartjs-2";
import "./dashboard.css";

const defaultOptions = {
  responsive: true,
  maintainAspectRatio: false,
  layout: { padding: { top: 4, right: 8, bottom: 18, left: 2 } },
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { maxRotation: 0, font: { size: 8 }, padding: 2, autoSkip: true, maxTicksLimit: 8 },
    },
    y: {
      beginAtZero: true,
      ticks: { font: { size: 8 }, padding: 2, maxTicksLimit: 6 },
    },
  },
};

const EMPTY_CHART_DATA = {
  labels: [],
  datasets: [
    { label: "Temperature °C", data: [], borderColor: "#1b9c85", backgroundColor: "rgba(27, 156, 133, 0.1)", fill: true },
    { label: "Turbidity", data: [], borderColor: "#d45b5b", backgroundColor: "rgba(212, 91, 91, 0.1)", fill: true },
    { label: "Water pH", data: [], borderColor: "#f0a500", backgroundColor: "rgba(240, 165, 0, 0.1)", fill: true },
    { label: "NH₃ mg/L", data: [], borderColor: "#9b59b6", backgroundColor: "rgba(155, 89, 182, 0.1)", fill: true },
    { label: "Flow rate L/min", data: [], borderColor: "#3498db", backgroundColor: "rgba(52, 152, 219, 0.1)", fill: true },
    { label: "Dissolved O₂ mg/L", data: [], borderColor: "#2ecc71", backgroundColor: "rgba(46, 204, 113, 0.1)", fill: true },
  ],
};

export function LiveChart({ todayData, todayChartOptions }) {
  const hasData = useMemo(() => {
    if (!todayData?.labels?.length || !todayData?.datasets?.length) return false;
    return todayData.datasets.some((ds) => ds.data?.length > 0);
  }, [todayData]);

  const data = useMemo(() => {
    if (hasData && todayData?.labels && todayData?.datasets?.length) return todayData;
    return EMPTY_CHART_DATA;
  }, [todayData, hasData]);

  const options = useMemo(() => {
    const merged = { ...defaultOptions, ...(todayChartOptions || {}) };
    merged.plugins = { ...merged.plugins, legend: { ...merged.plugins?.legend, display: false } };
    return merged;
  }, [todayChartOptions]);

  const legendItems = useMemo(
    () => (data.datasets || []).map((d) => ({ label: d.label, color: d.borderColor || "#888" })),
    [data.datasets]
  );

  return (
    <>
      <div className="card card--fill live-chart-card">
        <div className="card__header live-chart-card__header">
          <div>
            <h2 className="card__title">Live Chart</h2>
          </div>
          {legendItems.length > 0 && hasData && (
            <div className="live-chart-legend" aria-hidden="true">
              {legendItems.map((item, i) => (
                <span key={i} className="live-chart-legend__item" style={{ ["--legend-color"]: item.color }}>
                  <span className="live-chart-legend__dot" />
                  {item.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="card__body card__body--fill live-chart-body">
          {!hasData ? (
            <div className="live-chart-empty" aria-live="polite">
              <p className="live-chart-empty-message">No data for today.</p>
              <p className="live-chart-empty-hint">Readings from the selected node will appear here as they are collected.</p>
            </div>
          ) : (
            <div className="line-chart line-chart--horizontal-only">
              <Line data={data} options={options} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default LiveChart;
