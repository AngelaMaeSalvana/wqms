import React, { useMemo, useRef, useEffect, useCallback, useState } from "react";
import "../../utils/chartConfig";
import { Line } from "react-chartjs-2";
import { startOfDay, setHours, setMinutes } from "date-fns";
import "./dashboard.css";

const DATASET_META = [
  { label: "Temperature (°C)",      borderColor: "#1b9c85", bg: "rgba(27,156,133,0.1)" },
  { label: "Turbidity (NTU)",        borderColor: "#d45b5b", bg: "rgba(212,91,91,0.1)" },
  { label: "Water pH",               borderColor: "#f0a500", bg: "rgba(240,165,0,0.1)" },
  { label: "Ammonia / NH₃ (mg/L)",   borderColor: "#9b59b6", bg: "rgba(155,89,182,0.1)" },
  { label: "Flow Rate (L/min)",      borderColor: "#3498db", bg: "rgba(52,152,219,0.1)" },
  { label: "Dissolved O₂ (mg/L)",    borderColor: "#2ecc71", bg: "rgba(46,204,113,0.1)" },
];

const MINUTE_INTERVAL = 5;
const MINUTE_MS = 60 * 1000;

function buildHalfTimeData(todayData, isAM) {
  const timestamps = todayData?.timestamps ?? [];
  const srcDatasets = todayData?.datasets ?? [];
  if (timestamps.length === 0 || srcDatasets.length === 0) {
    const today = startOfDay(new Date());
    const startHour = isAM ? 0 : 12;
    const rangeStart = setHours(setMinutes(today, 0), startHour).getTime();
    const rangeEnd = rangeStart + 12 * 60 * MINUTE_MS - 1;
    return {
      min: rangeStart,
      max: rangeEnd,
      datasets: DATASET_META.map((meta) => ({
        label: meta.label,
        data: [],
        borderColor: meta.borderColor,
        backgroundColor: meta.bg,
        fill: true,
        tension: 0.3,
        spanGaps: false,
        pointRadius: 0,
        pointHoverRadius: 5,
      })),
    };
  }

  const startHour = isAM ? 0 : 12;
  const today = startOfDay(new Date(timestamps[0]));
  const rangeStart = setHours(setMinutes(today, 0), startHour).getTime();
  const rangeEnd = rangeStart + 12 * 60 * MINUTE_MS - 1;

  const datasets = DATASET_META.map((meta, di) => {
    const srcData = srcDatasets[di]?.data ?? [];
    const points = [];
    timestamps.forEach((ts, i) => {
      const t = new Date(ts).getTime();
      if (t >= rangeStart && t <= rangeEnd) {
        const val = srcData[i];
        if (val != null && !Number.isNaN(val)) {
          points.push({ x: t, y: val });
        }
      }
    });
    points.sort((a, b) => a.x - b.x);

    return {
      label: meta.label,
      data: points,
      borderColor: meta.borderColor,
      backgroundColor: meta.bg,
      fill: true,
      tension: 0.3,
      spanGaps: true,
      pointRadius: points.map(() => 2.5),
      pointHoverRadius: 6,
    };
  });

  return { min: rangeStart, max: rangeEnd, datasets };
}

// Draws mini vertical lines at 5-minute intervals (indication of minutes)
function makeMinuteLinesPlugin() {
  return {
    id: "minuteLines",
    afterDraw(chart) {
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale || xScale.type !== "time") return;

      const min = xScale.min;
      const max = xScale.max;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = "rgba(128,128,128,0.2)";
      ctx.lineWidth = 0.5;

      const step = MINUTE_INTERVAL * MINUTE_MS;
      let t = Math.ceil(min / step) * step;
      while (t < max) {
        const x = xScale.getPixelForValue(t);
        if (x >= xScale.left && x <= xScale.right) {
          ctx.beginPath();
          ctx.moveTo(x, yScale.top);
          ctx.lineTo(x, yScale.bottom);
          ctx.stroke();
        }
        t += step;
      }
      ctx.restore();
    },
  };
}

// Draws a solid thin blue vertical line at the current time
function makeNowPlugin(isAM) {
  return {
    id: "nowLine",
    afterDraw(chart) {
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return;

      const now = new Date();
      const hour = now.getHours();
      const inThisHalf = isAM ? hour < 12 : hour >= 12;
      if (!inThisHalf) return;

      const nowMs = now.getTime();
      if (nowMs < xScale.min || nowMs > xScale.max) return;

      const x = xScale.getPixelForValue(nowMs);
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, yScale.top);
      ctx.lineTo(x, yScale.bottom);
      ctx.stroke();
      ctx.fillStyle = "#3b82f6";
      ctx.beginPath();
      ctx.arc(x, yScale.top, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  };
}

function getChartOptions(halfData) {
  const isAM = halfData?.min != null && new Date(halfData.min).getHours() === 0;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { top: 14, right: 8, bottom: 4, left: 2 } },
    parsing: false,
    plugins: { legend: { display: false }, tooltip: { enabled: true } },
    scales: {
      x: {
        type: "time",
        min: halfData?.min,
        max: halfData?.max,
        time: {
          unit: "hour",
          minUnit: "minute",
          displayFormats: {
            minute: "h:mm a",
            hour: "ha",
          },
          tooltipFormat: "h:mm a",
        },
        grid: {
          display: true,
          color: (ctx) => {
            const d = new Date(ctx.tick.value);
            return d.getMinutes() === 0 ? "rgba(128,128,128,0.4)" : "rgba(128,128,128,0.15)";
          },
          lineWidth: (ctx) => (new Date(ctx.tick.value).getMinutes() === 0 ? 1 : 0.5),
        },
        ticks: {
          maxRotation: 0,
          font: { size: 9 },
          padding: 2,
          maxTicksLimit: 13,
          callback: (value) => {
            const d = new Date(value);
            if (d.getMinutes() !== 0) return "";
            const h = d.getHours();
            if (h === 0) return "12am";
            if (h === 12) return "12pm";
            return h < 12 ? `${h}am` : `${h - 12}pm`;
          },
        },
      },
      y: {
        beginAtZero: true,
        ticks: { font: { size: 8 }, padding: 2, maxTicksLimit: 6 },
      },
    },
  };
}

const minuteLinesPlugin = makeMinuteLinesPlugin();

export function LiveChart({ todayData }) {
  const amData = useMemo(() => buildHalfTimeData(todayData, true), [todayData]);
  const pmData = useMemo(() => buildHalfTimeData(todayData, false), [todayData]);

  const legendItems = useMemo(
    () => DATASET_META.map((m) => ({ label: m.label, color: m.borderColor })),
    []
  );

  const currentHour = new Date().getHours();
  const [activePage, setActivePage] = useState(currentHour >= 12 ? 1 : 0);
  const nowPluginAm = useMemo(() => makeNowPlugin(true), []);
  const nowPluginPm = useMemo(() => makeNowPlugin(false), []);

  const chartOptionsAm = useMemo(() => getChartOptions(amData), [amData]);
  const chartOptionsPm = useMemo(() => getChartOptions(pmData), [pmData]);

  const scrollRef = useRef(null);
  const isMountedRef = useRef(false);

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
  }, [activePage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setActivePage(Math.round(el.scrollLeft / el.offsetWidth));
  }, []);

  const goTo = useCallback((page) => setActivePage(page), []);

  const plugins = [minuteLinesPlugin];

  return (
    <div className="card card--fill live-chart-card">
      <div className="card__header live-chart-card__header">
        <div>
          <h2 className="card__title">Live Chart</h2>
        </div>
        <div className="live-chart-legend" aria-hidden="true">
          {legendItems.map((item, i) => (
            <span key={i} className="live-chart-legend__item" style={{ ["--legend-color"]: item.color }}>
              <span className="live-chart-legend__dot" />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="card__body card__body--fill live-chart-body">
        <div className="live-chart-pager">
          <button
            className="live-chart-pager__btn"
            onClick={() => goTo(0)}
            aria-label="Show AM"
            disabled={activePage === 0}
          >‹</button>
          <div className="live-chart-pager__dots">
            <button
              className={`live-chart-pager__dot${activePage === 0 ? " live-chart-pager__dot--active" : ""}`}
              onClick={() => goTo(0)}
            ><span className="live-chart-pager__dot-label">AM</span></button>
            <button
              className={`live-chart-pager__dot${activePage === 1 ? " live-chart-pager__dot--active" : ""}`}
              onClick={() => goTo(1)}
            ><span className="live-chart-pager__dot-label">PM</span></button>
          </div>
          <button
            className="live-chart-pager__btn"
            onClick={() => goTo(1)}
            aria-label="Show PM"
            disabled={activePage === 1}
          >›</button>
        </div>

        <div className="live-chart-pages" ref={scrollRef} onScroll={handleScroll}>
          <div className="live-chart-page">
            <Line
              data={{ datasets: amData.datasets }}
              options={chartOptionsAm}
              plugins={[...plugins, nowPluginAm]}
            />
          </div>
          <div className="live-chart-page">
            <Line
              data={{ datasets: pmData.datasets }}
              options={chartOptionsPm}
              plugins={[...plugins, nowPluginPm]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default LiveChart;
