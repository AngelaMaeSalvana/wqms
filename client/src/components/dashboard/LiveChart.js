import React, { useMemo } from "react";
import "../../utils/chartConfig";
import { Line } from "react-chartjs-2";
import EmptyState from "../EmptyState";
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
  const hasData = todayData && todayData.labels?.length && todayData.datasets?.length;
  const data = useMemo(() => {
    if (hasData) return todayData;
    return { labels: [], datasets: [] };
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
    <div className="card card--fill live-chart-card">
      <div className="card__header live-chart-card__header">
        <div>
          <h2 className="card__title">Live Chart</h2>
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
        {hasData ? (
          <div className="line-chart line-chart--horizontal-only">
            <Line data={data} options={options} />
          </div>
        ) : (
          <EmptyState
            icon="📊"
            title="No chart data"
            message="Live data will appear when sensors send readings via HiveMQ."
          />
        )}
      </div>
    </div>
  );
}

export default LiveChart;
