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

export function LiveChart({ todayData, todayChartOptions }) {
  const data = useMemo(() => {
    if (todayData && todayData.labels && todayData.datasets?.length) {
      return todayData;
    }
    return {
      labels: ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"],
      datasets: [
        {
          label: "Temperature °C",
          data: [24, 25, 26, 27, 26, 25],
          borderColor: "#1b9c85",
          backgroundColor: "rgba(27, 156, 133, 0.1)",
          fill: true,
        },
        {
          label: "Turbidity",
          data: [2, 2.2, 1.8, 2.5, 2.1, 2],
          borderColor: "#d45b5b",
          backgroundColor: "rgba(212, 91, 91, 0.1)",
          fill: true,
        },
        {
          label: "pH",
          data: [7.0, 7.1, 7.2, 7.1, 7.0, 6.9],
          borderColor: "#f0a500",
          backgroundColor: "rgba(240, 165, 0, 0.1)",
          fill: true,
        },
      ],
    };
  }, [todayData]);

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
    <div className="card card--fill live-chart-card">
      <div className="card__header live-chart-card__header">
        <div>
          <h2 className="card__title">Live Chart</h2>
          <p className="card__desc">00:00 to current hour · updates every 30 min</p>
        </div>
        {legendItems.length > 0 && (
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
        <div className="line-chart line-chart--horizontal-only">
          <Line data={data} options={options} />
        </div>
      </div>
    </div>
  );
}

export default LiveChart;
