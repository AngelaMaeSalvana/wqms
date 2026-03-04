import React, { useMemo, useRef, useEffect, useCallback, useState } from "react";
import "../../utils/chartConfig";
import { Line } from "react-chartjs-2";
import "./dashboard.css";

const AM_LABELS = ["12am","1am","2am","3am","4am","5am","6am","7am","8am","9am","10am","11am"];
const PM_LABELS = ["12pm","1pm","2pm","3pm","4pm","5pm","6pm","7pm","8pm","9pm","10pm","11pm"];

const DATASET_META = [
  { label: "Temperature (°C)",      borderColor: "#1b9c85", bg: "rgba(27,156,133,0.1)" },
  { label: "Turbidity (NTU)",        borderColor: "#d45b5b", bg: "rgba(212,91,91,0.1)" },
  { label: "Water pH",               borderColor: "#f0a500", bg: "rgba(240,165,0,0.1)" },
  { label: "Ammonia / NH₃ (mg/L)",   borderColor: "#9b59b6", bg: "rgba(155,89,182,0.1)" },
  { label: "Flow Rate (L/min)",      borderColor: "#3498db", bg: "rgba(52,152,219,0.1)" },
  { label: "Dissolved O₂ (mg/L)",    borderColor: "#2ecc71", bg: "rgba(46,204,113,0.1)" },
];

function buildHalfData(todayData, isAM) {
  const halfLabels = isAM ? AM_LABELS : PM_LABELS;
  const startHour = isAM ? 0 : 12;

  const datasets = DATASET_META.map((meta, di) => {
    const slotData = Array(12).fill(null);
    const srcData = todayData?.datasets?.[di]?.data ?? [];
    const srcLabels = todayData?.labels ?? [];

    srcLabels.forEach((lbl, i) => {
      const h = parseInt(lbl.split(":")[0], 10);
      if (h >= startHour && h < startHour + 12) {
        const slot = h - startHour;
        const val = srcData[i];
        if (val != null) {
          if (slotData[slot] == null) slotData[slot] = val;
          else slotData[slot] = (slotData[slot] + val) / 2;
        }
      }
    });

    const pointRadii = slotData.map((v) => (v == null ? 0 : 3));
    const pointHoverRadii = slotData.map((v) => (v == null ? 0 : 5));

    return {
      label: meta.label,
      data: slotData,
      borderColor: meta.borderColor,
      backgroundColor: meta.bg,
      fill: true,
      tension: 0.3,
      spanGaps: false,
      pointRadius: pointRadii,
      pointHoverRadius: pointHoverRadii,
    };
  });

  return { labels: halfLabels, datasets };
}

// Draws a solid thin blue vertical line at the current hour slot
function makeNowPlugin(currentSlot) {
  return {
    id: "nowLine",
    afterDraw(chart) {
      if (currentSlot < 0 || currentSlot > 11) return;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return;
      const x = xScale.getPixelForValue(currentSlot);
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, yScale.top);
      ctx.lineTo(x, yScale.bottom);
      ctx.stroke();
      // Small blue dot at the top of the line
      ctx.fillStyle = "#3b82f6";
      ctx.beginPath();
      ctx.arc(x, yScale.top, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  };
}

const CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  layout: { padding: { top: 14, right: 8, bottom: 4, left: 2 } },
  plugins: { legend: { display: false }, tooltip: { enabled: true } },
  scales: {
    x: {
      grid: { display: false },
      ticks: { maxRotation: 0, font: { size: 9 }, padding: 2, autoSkip: false },
    },
    y: {
      beginAtZero: true,
      ticks: { font: { size: 8 }, padding: 2, maxTicksLimit: 6 },
    },
  },
};

export function LiveChart({ todayData }) {
  const amData = useMemo(() => buildHalfData(todayData, true),  [todayData]);
  const pmData = useMemo(() => buildHalfData(todayData, false), [todayData]);

  const legendItems = useMemo(
    () => DATASET_META.map((m) => ({ label: m.label, color: m.borderColor })),
    []
  );

  const currentHour = new Date().getHours();
  const [activePage, setActivePage] = useState(currentHour >= 12 ? 1 : 0);
  const amNowSlot = currentHour < 12 ? currentHour : -1;
  const pmNowSlot = currentHour >= 12 ? currentHour - 12 : -1;

  const nowPluginAm = useMemo(() => makeNowPlugin(amNowSlot), [amNowSlot]);
  const nowPluginPm = useMemo(() => makeNowPlugin(pmNowSlot), [pmNowSlot]);

  const scrollRef = useRef(null);
  const isMountedRef = useRef(false);

  // On first mount jump instantly to the correct half; smooth for user navigation
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const doScroll = (behavior) => {
      const w = el.offsetWidth;
      if (w > 0) {
        el.scrollTo({ left: activePage * w, behavior });
      }
    };

    if (!isMountedRef.current) {
      isMountedRef.current = true;
      // Use rAF to ensure layout is complete before reading offsetWidth
      requestAnimationFrame(() => doScroll("instant"));
    } else {
      doScroll("smooth");
    }
  }, [activePage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync indicator on manual swipe
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setActivePage(Math.round(el.scrollLeft / el.offsetWidth));
  }, []);

  const goTo = useCallback((page) => setActivePage(page), []);

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
        {/* AM / PM pager */}
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

        {/* Paged chart area */}
        <div className="live-chart-pages" ref={scrollRef} onScroll={handleScroll}>
          <div className="live-chart-page">
            <Line data={amData} options={CHART_OPTIONS} plugins={[nowPluginAm]} />
          </div>
          <div className="live-chart-page">
            <Line data={pmData} options={CHART_OPTIONS} plugins={[nowPluginPm]} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default LiveChart;
