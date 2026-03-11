import React, { useState, useRef, useEffect, useMemo, memo } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { createPortal } from "react-dom";
import "../utils/chartConfig";
import { Line, Bar, Doughnut } from "react-chartjs-2";
import PageDateWithStatus from "../components/PageDateWithStatus";
import CalendarCard from "../components/reports/calendar-card";
import WqiDetailModal from "../components/reports/WqiDetailModal";
import TestRunDetailModal from "../components/reports/TestRunDetailModal";
import { getWQIClass, calculateWQI } from "../utils/wqiCalculator";
import { getNH3FromReading, calculateNH3FromTAN } from "../utils/nh3Calculator";
import { getNodes, loadNodes } from "../utils/nodesStorage";
import api from "../services/api";
import { exportToCSV, exportToExcel } from "../utils/exportData";
import { PageLoader } from "../components/LoadingSkeleton";
import "./Reports.css";

const REPORT_TABS = [
  { id: "water", label: "Water Quality" },
  { id: "alerts", label: "Alerts & Compliance" },
  { id: "system", label: "System" },
  { id: "testing", label: "Testing" },
];

const MemoizedReportChart = memo(function MemoizedReportChart({ data, options, chartType }) {
  return chartType === "bar" ? (
    <Bar data={data} options={options} />
  ) : (
    <Line data={data} options={options} />
  );
});

const PARAMETER_OPTIONS = [
  { id: "temperature", label: "Temperature", unit: "°C" },
  { id: "pH", label: "pH", unit: "" },
  { id: "turbidity", label: "Turbidity", unit: " NTU" },
  { id: "dissolvedOxygen", label: "Dissolved O₂", unit: " mg/L" },
  { id: "nh3", label: "NH₃", unit: " mg/L" },
  { id: "flowRate", label: "Flow rate", unit: " L/min" },
  { id: "wqi", label: "WQI", unit: "" },
];

const PERIOD_OPTIONS = [
  { id: "week", label: "By week" },
  { id: "month", label: "By month" },
];

const CHART_TYPE_OPTIONS = [
  { id: "line", label: "Line chart" },
  { id: "bar", label: "Bar chart" },
];

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Week runs Sunday (getDay() === 0) through Saturday. */
function getWeekRange(date) {
  const d = new Date(date);
  const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayOfWeek, 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
  return { start, end };
}

function getMonthRange(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function formatDateRange(start, end) {
  if (!start || !end) return "";
  const s = start;
  const e = end;
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = s.getMonth() === e.getMonth();
  if (sameYear && sameMonth) {
    return `${MONTH_SHORT[s.getMonth()]} ${s.getDate()} - ${e.getDate()}, ${s.getFullYear()}`;
  }
  if (sameYear) {
    return `${MONTH_SHORT[s.getMonth()]} ${s.getDate()} - ${MONTH_SHORT[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${MONTH_SHORT[s.getMonth()]} ${s.getDate()}, ${s.getFullYear()} - ${MONTH_SHORT[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}

const MONTH_NAMES_FULL = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function formatDateRangeLong(start, end) {
  if (!start || !end) return "";
  const s = start;
  const e = end;
  return `${MONTH_NAMES_FULL[s.getMonth()]} ${s.getDate()} - ${MONTH_NAMES_FULL[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}

/** Get one label per day from start to end (e.g. "Jan 18", "Jan 19", "Jan 20"). */
function getDayLabelsInRange(rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd) return [];
  const labels = [];
  const cursor = new Date(rangeStart);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    labels.push(`${MONTH_SHORT[cursor.getMonth()]} ${cursor.getDate()}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return labels;
}

/** Get weekly bucket labels for a date range (e.g. "Dec 31 - Jan 6", "Jan 7 - Jan 13"). */
function getWeeklyLabelsInRange(rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd) return [];
  const labels = [];
  let weekStart = new Date(rangeStart);
  weekStart.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);
  end.setHours(23, 59, 59, 999);
  while (weekStart <= end) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const segmentEnd = weekEnd > end ? new Date(end) : weekEnd;
    const s = weekStart;
    const seg = segmentEnd;
    labels.push(
      `${MONTH_SHORT[s.getMonth()]} ${s.getDate()} - ${MONTH_SHORT[seg.getMonth()]} ${seg.getDate()}`
    );
    weekStart.setDate(weekStart.getDate() + 7);
  }
  return labels;
}

function isDateInRange(date, start, end) {
  if (!start || !end || !date) return false;
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const t = d.getTime();
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(23, 59, 59, 999);
  return t >= s.getTime() && t <= e.getTime();
}

/** Build calendar grid for date-range picker (year, month). Weeks start Sunday. */
function buildRangePickerDays(year, month) {
  const first = new Date(year, month, 1);
  const startPad = first.getDay(); // 0 = Sunday: pad so first cell is Sunday of week containing 1st
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;
  const days = [];
  for (let i = 0; i < totalCells; i++) {
    const dayOfMonth = 1 - startPad + i;
    const date = new Date(year, month, dayOfMonth);
    days.push({
      date,
      label: date.getDate().toString(),
      isCurrentMonth: date.getMonth() === month,
    });
  }
  return days;
}

/**
 * Build report chart from daily_summaries.
 * Uses stored min/max fields for true daily extremes.
 * Falls back to computing min/max across multiple node averages when
 * the per-parameter min/max columns are not yet populated (older rows).
 */
function buildReportChartFromSummaries(parameterId, periodId, rangeStart, rangeEnd, summaries) {
  const list = Array.isArray(summaries) ? summaries : [];
  const isWeek = periodId === "week";
  const labels = isWeek ? getDayLabelsInRange(rangeStart, rangeEnd) : getWeeklyLabelsInRange(rangeStart, rangeEnd);
  const n = labels.length || 1;
  if (list.length === 0) {
    return {
      labels: labels.length ? labels : ["No data"],
      minArr: Array(n).fill(null),
      avgArr: Array(n).fill(null),
      maxArr: Array(n).fill(null),
    };
  }
  const toDateStr = (d) => (typeof d === "string" ? d : (d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")));
  const byDate = {};
  list.forEach((s) => {
    const key = toDateStr(s.date);
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(s);
  });

  // Accessors for avg, min, max per parameter.
  // min/max use the stored DB columns when available; fall back to the avg value
  // so the band still renders correctly for older rows that lack those columns.
  const paramAccessors = {
    temperature:     { avg: (s) => s.avg_temperature,      min: (s) => s.min_temperature      ?? s.avg_temperature,      max: (s) => s.max_temperature      ?? s.avg_temperature      },
    pH:              { avg: (s) => s.avg_ph,                min: (s) => s.min_ph               ?? s.avg_ph,               max: (s) => s.max_ph               ?? s.avg_ph               },
    turbidity:       { avg: (s) => s.avg_turbidity,         min: (s) => s.min_turbidity        ?? s.avg_turbidity,        max: (s) => s.max_turbidity        ?? s.avg_turbidity        },
    dissolvedOxygen: { avg: (s) => s.avg_dissolved_oxygen,  min: (s) => s.min_dissolved_oxygen ?? s.avg_dissolved_oxygen,  max: (s) => s.max_dissolved_oxygen ?? s.avg_dissolved_oxygen  },
    nh3:             {
      avg: (s) => s.avg_nh3 ?? (s.avg_tan != null && s.avg_ph != null && s.avg_temperature != null ? calculateNH3FromTAN(s.avg_tan, s.avg_ph, s.avg_temperature) : null),
      min: (s) => s.avg_nh3 ?? (s.avg_tan != null && s.avg_ph != null && s.avg_temperature != null ? calculateNH3FromTAN(s.avg_tan, s.avg_ph, s.avg_temperature) : null),
      max: (s) => s.avg_nh3 ?? (s.avg_tan != null && s.avg_ph != null && s.avg_temperature != null ? calculateNH3FromTAN(s.avg_tan, s.avg_ph, s.avg_temperature) : null),
    },
    wqi:             { avg: (s) => s.avg_wqi,               min: (s) => s.min_wqi              ?? s.avg_wqi,              max: (s) => s.max_wqi              ?? s.avg_wqi              },
    flowRate:        { avg: (s) => s.avg_flow_rate ?? null,  min: (s) => s.min_flow_rate        ?? s.avg_flow_rate ?? null, max: (s) => s.max_flow_rate        ?? s.avg_flow_rate ?? null },
  };
  const accessors = paramAccessors[parameterId] || { avg: () => null, min: () => null, max: () => null };

  const r1 = (v) => v != null ? Math.round(v * 10) / 10 : null;

  const minArr = [];
  const avgArr = [];
  const maxArr = [];

  if (isWeek) {
    const cursor = new Date(rangeStart);
    const end = new Date(rangeEnd);
    cursor.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    while (cursor <= end) {
      const key = toDateStr(cursor);
      const daySummaries = byDate[key] || [];
      const avgs = daySummaries.map(accessors.avg).filter((v) => v != null);
      const mins = daySummaries.map(accessors.min).filter((v) => v != null);
      const maxs = daySummaries.map(accessors.max).filter((v) => v != null);
      if (avgs.length === 0) {
        minArr.push(null); avgArr.push(null); maxArr.push(null);
      } else {
        minArr.push(r1(Math.min(...mins)));
        avgArr.push(r1(avgs.reduce((a, b) => a + b, 0) / avgs.length));
        maxArr.push(r1(Math.max(...maxs)));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    let weekStart = new Date(rangeStart);
    const end = new Date(rangeEnd);
    weekStart.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    while (weekStart <= end) {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const segEnd = weekEnd > end ? end : weekEnd;
      const weekSummaries = list.filter((s) => {
        const d = typeof s.date === "string" ? new Date(s.date + "T12:00:00") : new Date(s.date);
          return d >= weekStart && d <= segEnd;
      });
      const avgs = weekSummaries.map(accessors.avg).filter((v) => v != null);
      const mins = weekSummaries.map(accessors.min).filter((v) => v != null);
      const maxs = weekSummaries.map(accessors.max).filter((v) => v != null);
      if (avgs.length === 0) {
        minArr.push(null); avgArr.push(null); maxArr.push(null);
      } else {
        minArr.push(r1(Math.min(...mins)));
        avgArr.push(r1(avgs.reduce((a, b) => a + b, 0) / avgs.length));
        maxArr.push(r1(Math.max(...maxs)));
      }
      weekStart.setDate(weekStart.getDate() + 7);
    }
  }
  return { labels, minArr, avgArr, maxArr };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** Calendar days from API daily summaries only. No mock data. */
function buildCalendarDays(year, month, summaries = []) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startPad = first.getDay();
  const daysInMonth = last.getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toDateStr = (d) => (typeof d === "string" ? d : (d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")));
  const byDate = {};
  (Array.isArray(summaries) ? summaries : []).forEach((s) => {
    const key = toDateStr(s.date);
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(s);
  });

  const days = [];
  const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const cellIndex = i - startPad;
    const date = new Date(year, month, cellIndex);
    const label = date.getDate().toString();
    const isCurrentMonth = date.getMonth() === month;
    const isToday = date.getTime() === today.getTime();
    const isFuture = date > today;

    let wqi = null;
    let params = null;
    if (isCurrentMonth && !isFuture) {
      const key = toDateStr(date);
      const daySummaries = byDate[key] || [];
      if (daySummaries.length > 0) {
        const firstS = daySummaries[0];
        const avgNh3 = firstS.avg_nh3 ?? (firstS.avg_tan != null && firstS.avg_ph != null && firstS.avg_temperature != null ? calculateNH3FromTAN(firstS.avg_tan, firstS.avg_ph, firstS.avg_temperature) : null);
        params = {
          temperature: firstS.avg_temperature,
          pH: firstS.avg_ph,
          turbidity: firstS.avg_turbidity,
          dissolvedOxygen: firstS.avg_dissolved_oxygen,
          nh3: avgNh3,
          tan: firstS.avg_tan,
          flowRate: firstS.avg_flow_rate ?? null,
        };
        wqi = firstS.avg_wqi != null ? Math.round(firstS.avg_wqi) : calculateWQI(params);
      }
    }
    const qualityData = wqi != null ? getWQIClass(wqi) : null;
    const quality = qualityData?.quality ?? null;

    days.push({
      date,
      label,
      isCurrentMonth,
      isToday,
      isFuture,
      wqi,
      params,
      qualityData,
      quality,
    });
  }
  return days;
}

function isSameDate(a, b) {
  if (!a || !b) return false;
  const d1 = a instanceof Date ? a : (a.date ?? a);
  const d2 = b instanceof Date ? b : (b.date ?? b);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

/** Node comparison: multi-line chart, one series per node. */
function buildNodeComparisonData(summaries, parameterId, periodId, rangeStart, rangeEnd, nodes) {
  const list = Array.isArray(summaries) ? summaries : [];
  const isWeek = periodId === "week";
  const labels = isWeek ? getDayLabelsInRange(rangeStart, rangeEnd) : getWeeklyLabelsInRange(rangeStart, rangeEnd);
  const paramMap = {
    temperature: (s) => s.avg_temperature,
    pH: (s) => s.avg_ph,
    turbidity: (s) => s.avg_turbidity,
    dissolvedOxygen: (s) => s.avg_dissolved_oxygen,
    nh3: (s) => s.avg_nh3 ?? (s.avg_tan != null && s.avg_ph != null && s.avg_temperature != null ? calculateNH3FromTAN(s.avg_tan, s.avg_ph, s.avg_temperature) : null),
    wqi: (s) => s.avg_wqi,
    flowRate: (s) => s.avg_flow_rate ?? null,
  };
  const getVal = paramMap[parameterId] || (() => null);
  const toDateStr = (d) => (typeof d === "string" ? d : (d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")));
  const byNodeAndDate = {};
  list.forEach((s) => {
    const nid = s.node_id ?? "?";
    if (!byNodeAndDate[nid]) byNodeAndDate[nid] = {};
    const key = toDateStr(s.date);
    if (!byNodeAndDate[nid][key]) byNodeAndDate[nid][key] = [];
    byNodeAndDate[nid][key].push(s);
  });
  const colors = ["#1b9c85", "#e07c24", "#6c5ce7", "#00b894", "#fd79a8", "#fdcb6e"];
  const nodeIds = nodes.length ? nodes.map((n) => n.id) : Object.keys(byNodeAndDate);
  const datasets = nodeIds.slice(0, 6).map((nid, i) => {
    const nodeName = nodes.find((n) => n.id === nid)?.name || nid;
    const data = [];
    if (isWeek) {
      const cursor = new Date(rangeStart);
      const end = new Date(rangeEnd);
      cursor.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      while (cursor <= end) {
        const key = toDateStr(cursor);
        const vals = (byNodeAndDate[nid]?.[key] || []).map(getVal).filter((v) => v != null);
        data.push(vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null);
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      let weekStart = new Date(rangeStart);
      const end = new Date(rangeEnd);
      weekStart.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      while (weekStart <= end) {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const segEnd = weekEnd > end ? end : weekEnd;
        const vals = list
          .filter((s) => (s.node_id ?? "?") === nid && (() => {
            const d = typeof s.date === "string" ? new Date(s.date) : new Date(s.date);
            return d >= weekStart && d <= segEnd;
          })())
          .map(getVal)
          .filter((v) => v != null);
        data.push(vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null);
        weekStart.setDate(weekStart.getDate() + 7);
      }
    }
    return { label: nodeName, data, borderColor: colors[i % colors.length], backgroundColor: "transparent", fill: false };
  });
  return { labels: labels.length ? labels : ["No data"], datasets };
}

/** WQI class breakdown from summaries. */
function buildWqiBreakdownData(summaries) {
  const list = Array.isArray(summaries) ? summaries : [];
  const counts = { excellent: 0, good: 0, fair: 0, poor: 0, veryPoor: 0 };
  list.forEach((s) => {
    const wqi = s.avg_wqi;
    if (wqi == null) return;
    const c = getWQIClass(wqi);
    const q = (c?.quality ?? "").toLowerCase().replace(/\s+/g, "");
    if (q === "excellent") counts.excellent++;
    else if (q === "good") counts.good++;
    else if (q === "fair") counts.fair++;
    else if (q === "poor") counts.poor++;
    else if (q === "verypoor") counts.veryPoor++;
  });
  const labels = ["Excellent", "Good", "Fair", "Poor", "Very Poor"];
  const data = [counts.excellent, counts.good, counts.fair, counts.poor, counts.veryPoor];
  const colors = ["#00b894", "#55efc4", "#fdcb6e", "#e17055", "#d63031"];
  return { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] };
}

const NodeComparisonChart = memo(function NodeComparisonChart({ summaries, parameter, period, rangeStart, rangeEnd, nodes }) {
  const param = PARAMETER_OPTIONS.find((p) => p.id === parameter);
  const { labels, datasets } = useMemo(
    () => buildNodeComparisonData(summaries, parameter, period, rangeStart, rangeEnd, nodes),
    [summaries, parameter, period, rangeStart, rangeEnd, nodes]
  );
  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "top" }, tooltip: { mode: "index", intersect: false } },
    scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, maxTicksLimit: 8 } }, y: { beginAtZero: true } },
  }), []);
  if (datasets.every((d) => d.data.every((v) => v == null))) {
    return <div className="reports-chart-placeholder">No data for node comparison</div>;
  }
  return <Line data={{ labels, datasets }} options={options} />;
});

function getChartLegendColor(theme) {
  const isLight = theme === "light" || (theme === "system" && typeof window !== "undefined" && !window.matchMedia("(prefers-color-scheme: dark)").matches);
  return isLight ? "#1d1d1f" : "rgba(255,255,255,0.9)";
}

const WqiBreakdownChart = memo(function WqiBreakdownChart({ summaries }) {
  const { theme } = useTheme();
  const chartData = useMemo(() => buildWqiBreakdownData(summaries), [summaries]);
  const total = chartData.datasets[0]?.data?.reduce((a, b) => a + b, 0) ?? 0;
  const legendColor = useMemo(() => getChartLegendColor(theme), [theme]);
  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "right",
        labels: {
          color: legendColor,
          usePointStyle: true,
          pointStyle: "circle",
          padding: 12,
          generateLabels: (chart) => {
            const data = chart.data;
            const ds = data.datasets?.[0];
            if (!ds) return [];
            return (data.labels ?? []).map((label, i) => ({
              text: label,
              fillStyle: ds.backgroundColor?.[i] ?? "#888",
              color: legendColor,
              hidden: false,
              index: i,
            }));
          },
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const pct = total > 0 ? Math.round((ctx.raw / total) * 100) : 0;
            return `${ctx.label}: ${ctx.raw} day${ctx.raw !== 1 ? "s" : ""} (${pct}%)`;
          },
        },
      },
    },
  }), [total, legendColor]);
  if (total === 0) return <div className="reports-chart-placeholder">No WQI data for selected period</div>;
  return (
    <div className="reports-wqi-breakdown-wrap">
      <div className="reports-wqi-breakdown-chart">
        <Doughnut data={chartData} options={options} />
      </div>
    </div>
  );
});

const SummaryStats = memo(function SummaryStats({ summaries, parameter }) {
  const list = Array.isArray(summaries) ? summaries : [];
  const paramMap = {
    temperature: (s) => s.avg_temperature,
    pH: (s) => s.avg_ph,
    turbidity: (s) => s.avg_turbidity,
    dissolvedOxygen: (s) => s.avg_dissolved_oxygen,
    nh3: (s) => s.avg_nh3 ?? (s.avg_tan != null && s.avg_ph != null && s.avg_temperature != null ? calculateNH3FromTAN(s.avg_tan, s.avg_ph, s.avg_temperature) : null),
    wqi: (s) => s.avg_wqi,
    flowRate: (s) => s.avg_flow_rate ?? null,
  };
  const getVal = paramMap[parameter] || (() => null);
  const vals = list.map(getVal).filter((v) => v != null);
  const min = vals.length ? Math.min(...vals) : null;
  const max = vals.length ? Math.max(...vals) : null;
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const param = PARAMETER_OPTIONS.find((p) => p.id === parameter);
  const unit = param?.unit ?? "";
  return (
    <div className="reports-summary-stats">
      <div className="reports-summary-stat"><span className="reports-summary-label">Min</span><span className="reports-summary-value">{min != null ? `${min}${unit}` : "—"}</span></div>
      <div className="reports-summary-stat"><span className="reports-summary-label">Avg</span><span className="reports-summary-value">{avg != null ? `${Math.round(avg * 10) / 10}${unit}` : "—"}</span></div>
      <div className="reports-summary-stat"><span className="reports-summary-label">Max</span><span className="reports-summary-value">{max != null ? `${max}${unit}` : "—"}</span></div>
      <div className="reports-summary-stat"><span className="reports-summary-label">Days</span><span className="reports-summary-value">{list.length}</span></div>
    </div>
  );
});

function toDateStr(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function RangeWqiStats({ summaries = [] }) {
  const stats = useMemo(() => {
    const wqis = summaries.map((s) => s.avg_wqi).filter((v) => v != null && !isNaN(v));
    if (wqis.length === 0) return null;
    const avg = wqis.reduce((a, b) => a + b, 0) / wqis.length;
    const min = Math.min(...wqis);
    const max = Math.max(...wqis);
    return { avg: Math.round(avg), min: Math.round(min), max: Math.round(max) };
  }, [summaries]);

  if (!stats) return (
    <div className="reports-wqi-stats">
      <div className="reports-wqi-stat reports-wqi-stat--empty">
        <span className="reports-wqi-stat__label">No data for selected range</span>
      </div>
    </div>
  );

  const items = [
    { label: "Avg WQI", value: stats.avg, cls: getWQIClass(stats.avg) },
    { label: "Min WQI", value: stats.min, cls: getWQIClass(stats.min) },
    { label: "Max WQI", value: stats.max, cls: getWQIClass(stats.max) },
  ];

  return (
    <div className="reports-wqi-stats">
      {items.map(({ label, value, cls }) => (
        <div key={label} className={`reports-wqi-stat reports-wqi-stat--${cls.quality}`}>
          <span className="reports-wqi-stat__label">{label}</span>
          <span className="reports-wqi-stat__value">{value}</span>
          <span className="reports-wqi-stat__badge">{cls.label}</span>
        </div>
      ))}
    </div>
  );
}

function AlertsComplianceTab({ reportRangeStart, reportRangeEnd, onSwitchToWater }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!reportRangeStart || !reportRangeEnd) return;
    const start = toDateStr(reportRangeStart);
    const end = toDateStr(reportRangeEnd);
    setLoading(true);
    api.getAlerts({ limit: 500, startDate: start, endDate: end })
      .then((rows) => setAlerts(Array.isArray(rows) ? rows : []))
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false));
  }, [reportRangeStart, reportRangeEnd]);
  const bySeverity = useMemo(() => {
    const m = {};
    alerts.forEach((a) => {
      const s = a.severity || "info";
      m[s] = (m[s] || 0) + 1;
    });
    return m;
  }, [alerts]);
  const byParam = useMemo(() => {
    const m = {};
    alerts.forEach((a) => {
      const p = a.parameter || "other";
      m[p] = (m[p] || 0) + 1;
    });
    return m;
  }, [alerts]);
  const complianceRows = useMemo(() => {
    return alerts
      .filter((a) => a.parameter && (a.value != null || a.threshold_min != null || a.threshold_max != null))
      .slice(0, 20)
      .map((a) => ({
        date: a.timestamp ? new Date(a.timestamp).toLocaleDateString() : "—",
        node: a.node_name || a.node_id || "—",
        parameter: a.parameter || "—",
        value: a.value != null ? a.value : "—",
        threshold: a.threshold_min != null || a.threshold_max != null ? `${a.threshold_min ?? "?"}–${a.threshold_max ?? "?"}` : "—",
      }));
  }, [alerts]);
  const handleExportAlerts = (fmt) => {
    const data = alerts.map((a) => ({
      timestamp: a.timestamp,
      severity: a.severity,
      node: a.node_name || a.node_id,
      parameter: a.parameter,
      value: a.value,
      title: a.title,
    }));
    if (fmt === "csv") exportToCSV(data, "wqms-alerts");
    else exportToExcel(data, "wqms-alerts");
  };
  const alertsBySeverityChart = useMemo(() => {
    const entries = Object.entries(bySeverity);
    if (entries.length === 0) return null;
    const severityOrder = ["critical", "high", "medium", "low", "info"];
    const sorted = entries.sort((a, b) => severityOrder.indexOf(a[0]) - severityOrder.indexOf(b[0]));
    return {
      labels: sorted.map(([s]) => s.charAt(0).toUpperCase() + s.slice(1)),
      datasets: [{ label: "Alerts", data: sorted.map(([, c]) => c), backgroundColor: ["#d63031", "#e17055", "#fdcb6e", "#74b9ff", "#81ecec"], borderWidth: 0 }],
    };
  }, [bySeverity]);
  const alertsByParamChart = useMemo(() => {
    const entries = Object.entries(byParam);
    if (entries.length === 0) return null;
    return {
      labels: entries.map(([p]) => p || "other"),
      datasets: [{ data: entries.map(([, c]) => c), backgroundColor: ["#1b9c85", "#e07c24", "#6c5ce7", "#00b894", "#fd79a8"], borderWidth: 0 }],
    };
  }, [byParam]);
  const alertsByDayChart = useMemo(() => {
    const byDay = {};
    alerts.forEach((a) => {
      const d = a.timestamp ? (typeof a.timestamp === "string" ? a.timestamp.slice(0, 10) : new Date(a.timestamp).toISOString().slice(0, 10)) : "";
      if (d) byDay[d] = (byDay[d] || 0) + 1;
    });
    const sorted = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
    if (sorted.length === 0) return null;
    return {
      labels: sorted.map(([d]) => MONTH_SHORT[parseInt(d.slice(5, 7), 10) - 1] + " " + d.slice(8, 10)),
      datasets: [{ label: "Alerts", data: sorted.map(([, c]) => c), borderColor: "#e17055", backgroundColor: "rgba(225, 112, 85, 0.2)", fill: true }],
    };
  }, [alerts]);
  const rangeStr = reportRangeStart && reportRangeEnd ? formatDateRange(reportRangeStart, reportRangeEnd) : "";
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "top" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
  }), []);
  return (
    <>
      <section className="reports-grid__chart card reports-tab-full">
        <div className="card__header">
          <h2 className="card__title">Alert summary</h2>
          {rangeStr && (
            <span className="reports-tab-range">
              {rangeStr}
            </span>
          )}
        </div>
        <div className="card__body">
          {loading ? <div className="reports-chart-placeholder">Loading…</div> : (
            <div className="reports-alerts-tab">
              <div className="reports-alerts-summary">
                <div className="reports-alerts-stat"><span className="reports-alerts-stat-value">{alerts.length}</span><span className="reports-alerts-stat-label">Total alerts</span></div>
                {Object.entries(bySeverity).map(([sev, count]) => (
                  <div key={sev} className="reports-alerts-stat"><span className="reports-alerts-stat-value">{count}</span><span className="reports-alerts-stat-label">{sev}</span></div>
                ))}
              </div>
              <div className="reports-alerts-charts">
                {alertsBySeverityChart && (
                  <div className="reports-alerts-chart-wrap">
                    <h3 className="reports-alerts-subtitle">By severity</h3>
                    <div className="reports-alerts-chart-inner">
                      <Bar data={alertsBySeverityChart} options={chartOptions} />
                    </div>
                  </div>
                )}
                {alertsByParamChart && (
                  <div className="reports-alerts-chart-wrap">
                    <h3 className="reports-alerts-subtitle">By parameter</h3>
                    <div className="reports-alerts-chart-inner">
                      <Doughnut data={alertsByParamChart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right" } } }} />
                    </div>
                  </div>
                )}
                {alertsByDayChart && (
                  <div className="reports-alerts-chart-wrap reports-alerts-chart-wrap--wide">
                    <h3 className="reports-alerts-subtitle">Alerts over time</h3>
                    <div className="reports-alerts-chart-inner">
                      <Line data={alertsByDayChart} options={chartOptions} />
                    </div>
                  </div>
                )}
              </div>
              <button type="button" className="reports-export-btn reports-export-btn--small" onClick={() => handleExportAlerts("csv")}>Export CSV</button>
            </div>
          )}
        </div>
      </section>
      <section className="reports-grid__placeholder card reports-tab-full">
        <div className="card__header"><h2 className="card__title">Compliance / threshold breaches</h2></div>
        <div className="card__body">
          {loading ? <div className="reports-chart-placeholder">Loading…</div> : (
            <div className="reports-compliance-table-wrap">
              {complianceRows.length === 0 ? <p className="reports-empty">No threshold breach data</p> : (
                <table className="reports-data-table">
                  <thead><tr><th>Date</th><th>Node</th><th>Parameter</th><th>Value</th><th>Threshold</th></tr></thead>
                  <tbody>
                    {complianceRows.map((r, i) => (
                      <tr key={i}><td>{r.date}</td><td>{r.node}</td><td>{r.parameter}</td><td>{r.value}</td><td>{r.threshold}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function TestingTab({ nodes = [] }) {
  const [testRuns, setTestRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState(null);
  useEffect(() => {
    setLoading(true);
    api.getTestRunsList({ limit: 20 })
      .then((tr) => setTestRuns(Array.isArray(tr) ? tr : []))
      .catch(() => setTestRuns([]))
      .finally(() => setLoading(false));
  }, []);
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "top" } },
    scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } }, y: { beginAtZero: true } },
  }), []);
  const testRunsChart = useMemo(() => {
    const valid = testRuns.filter((r) => r.duration_ms != null).slice(0, 10);
    if (valid.length === 0) return null;
    return {
      labels: valid.map((r) => String(r.id).slice(0, 8) + "…"),
      datasets: [{
        label: "Duration (s)",
        data: valid.map((r) => (r.duration_ms || 0) / 1000),
        backgroundColor: "rgba(225, 112, 85, 0.6)",
        borderColor: "#e17055",
        borderWidth: 1,
      }],
    };
  }, [testRuns]);
  const nodeLabel = (nid) => {
    if (!nid) return "All nodes";
    const n = nodes.find((x) => x.id === nid);
    return n?.name || nid;
  };
  return (
    <>
      <section className="reports-grid__chart card reports-tab-full">
        <div className="card__header"><h2 className="card__title">Test runs</h2></div>
        <div className="card__body">
          {loading ? <div className="reports-chart-placeholder">Loading…</div> : (
            <div className="reports-system-testruns">
              {testRunsChart && (
                <div className="reports-system-chart-wrap">
                  <h3 className="reports-alerts-subtitle">Duration by run</h3>
                  <div className="reports-system-chart-inner">
                    <Bar data={testRunsChart} options={chartOptions} />
                  </div>
                </div>
              )}
              {testRuns.length === 0 ? <p className="reports-empty">No test runs</p> : (
                <table className="reports-data-table reports-system-table reports-testruns-table">
                  <thead><tr><th>ID</th><th>Started</th><th>Duration</th><th>Node</th><th>Status</th></tr></thead>
                  <tbody>
                    {testRuns.slice(0, 10).map((r) => (
                      <tr
                        key={r.id}
                        className="reports-testruns-row"
                        onClick={() => setSelectedRunId(r.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedRunId(r.id); } }}
                      >
                        <td>{String(r.id).slice(0, 8)}…</td>
                        <td>{r.started_at ? new Date(r.started_at).toLocaleString() : "—"}</td>
                        <td>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                        <td>{nodeLabel(r.node_id)}</td>
                        <td>{r.status || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </section>
      {selectedRunId && (
        <TestRunDetailModal
          runId={selectedRunId}
          nodes={nodes}
          onClose={() => setSelectedRunId(null)}
        />
      )}
    </>
  );
}

function SystemTab({ reportRangeStart, reportRangeEnd, nodes, onSwitchToWater }) {
  const [readings, setReadings] = useState([]);
  const [timestampLogs, setTimestampLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!reportRangeStart || !reportRangeEnd) return;
    const start = toDateStr(reportRangeStart);
    const end = toDateStr(reportRangeEnd);
    setLoading(true);
    Promise.all([
      api.getSensorReadings({ startDate: start, endDate: end, limit: 1000 }),
      api.getTimestampLogs({ startDate: start, endDate: end, limit: 200 }).catch(() => []),
    ]).then(([r, t]) => {
      setReadings(Array.isArray(r) ? r : []);
      setTimestampLogs(Array.isArray(t) ? t : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [reportRangeStart, reportRangeEnd]);
  const dataQuality = useMemo(() => {
    const byNodeDate = {};
    readings.forEach((r) => {
      const key = (r.node_id || "?") + "|" + (typeof r.timestamp === "string" ? r.timestamp.slice(0, 10) : "");
      byNodeDate[key] = (byNodeDate[key] || 0) + 1;
    });
    const byNode = {};
    Object.entries(byNodeDate).forEach(([k, count]) => {
      const [nid] = k.split("|");
      if (!byNode[nid]) byNode[nid] = { total: 0, days: 0 };
      byNode[nid].total += count;
      byNode[nid].days++;
    });
    return Object.entries(byNode).map(([nid, v]) => ({
      node: nodes.find((n) => n.id === nid)?.name || nid,
      readings: v.total,
      days: v.days,
      avgPerDay: v.days ? Math.round(v.total / v.days) : 0,
    }));
  }, [readings, nodes]);
  const latencyStats = useMemo(() => {
    const withChain = timestampLogs.filter((r) => r.t_fwd_rx != null && r.t_be_rx != null);
    if (withChain.length === 0) return null;
    const latencies = withChain.map((r) => (r.t_be_rx || 0) - (r.t_fwd_rx || 0));
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    return { avg: Math.round(avg), min, max, samples: withChain.length };
  }, [timestampLogs]);
  const dataQualityChart = useMemo(() => {
    if (dataQuality.length === 0) return null;
    return {
      labels: dataQuality.map((r) => r.node),
      datasets: [{
        label: "Readings",
        data: dataQuality.map((r) => r.readings),
        backgroundColor: "rgba(27, 156, 133, 0.6)",
        borderColor: "#1b9c85",
        borderWidth: 1,
      }],
    };
  }, [dataQuality]);
  const latencyOverTimeChart = useMemo(() => {
    const withChain = timestampLogs.filter((r) => r.t_fwd_rx != null && r.t_be_rx != null);
    if (withChain.length < 2) return null;
    const sorted = [...withChain].sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
    const sampleStep = Math.max(1, Math.floor(sorted.length / 20));
    const sampled = sorted.filter((_, i) => i % sampleStep === 0);
    return {
      labels: sampled.map((r) => {
        const t = r.timestamp ? (typeof r.timestamp === "string" ? r.timestamp : new Date(r.timestamp).toISOString()) : "";
        return t ? t.slice(11, 19) : "";
      }),
      datasets: [{
        label: "Latency (ms)",
        data: sampled.map((r) => (r.t_be_rx || 0) - (r.t_fwd_rx || 0)),
        borderColor: "#6c5ce7",
        backgroundColor: "rgba(108, 92, 231, 0.2)",
        fill: true,
      }],
    };
  }, [timestampLogs]);
  const rangeStr = reportRangeStart && reportRangeEnd ? formatDateRange(reportRangeStart, reportRangeEnd) : "";
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "top" } },
    scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } }, y: { beginAtZero: true } },
  }), []);
  return (
    <>
      <section className="reports-grid__chart card reports-tab-full">
        <div className="card__header">
          <h2 className="card__title">Data quality / uptime</h2>
          {rangeStr && (
            <span className="reports-tab-range">
              {rangeStr}
            </span>
          )}
        </div>
        <div className="card__body">
          {loading ? <div className="reports-chart-placeholder">Loading…</div> : (
            <div className="reports-system-tab">
              {dataQualityChart ? (
                <div className="reports-system-chart-wrap">
                  <h3 className="reports-alerts-subtitle">Readings per node</h3>
                  <div className="reports-system-chart-inner">
                    <Bar data={dataQualityChart} options={chartOptions} />
                  </div>
                </div>
              ) : null}
              {dataQuality.length > 0 && (
                <table className="reports-data-table reports-system-table">
                  <thead><tr><th>Node</th><th>Readings</th><th>Days</th><th>Avg/day</th></tr></thead>
                  <tbody>
                    {dataQuality.map((r, i) => <tr key={i}><td>{r.node}</td><td>{r.readings}</td><td>{r.days}</td><td>{r.avgPerDay}</td></tr>)}
                  </tbody>
                </table>
              )}
              {dataQuality.length === 0 && <p className="reports-empty">No readings in range</p>}
            </div>
          )}
        </div>
      </section>
      <section className="reports-grid__placeholder card reports-tab-full">
        <div className="card__header"><h2 className="card__title">Pipeline latency</h2></div>
        <div className="card__body">
          {loading ? <div className="reports-chart-placeholder">Loading…</div> : (
            <div className="reports-system-latency">
              {latencyStats && (
                <p className="reports-latency-stats">Fwd &#8594; Backend: avg <strong>{latencyStats.avg} ms</strong>, min {latencyStats.min} ms, max {latencyStats.max} ms ({latencyStats.samples} samples)</p>
              )}
              {latencyOverTimeChart && (
                <div className="reports-system-chart-wrap">
                  <h3 className="reports-alerts-subtitle">Latency over time</h3>
                  <div className="reports-system-chart-inner">
                    <Line data={latencyOverTimeChart} options={chartOptions} />
                  </div>
                </div>
              )}
              {!latencyStats && !latencyOverTimeChart && <p className="reports-empty">No timestamp chain data</p>}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * Aggregate raw sensor_readings by date into daily-summary shape.
 * Used as a fallback when daily_summaries are not available from the DB.
 * Computes true per-parameter min/max from the raw readings.
 */
function aggregateReadingsToDailySummaries(readings) {
  const list = Array.isArray(readings) ? readings : [];
  if (list.length === 0) return [];
  const toDateStr = (r) => {
    const t = typeof r.timestamp === "string" ? r.timestamp : (r.timestamp && r.timestamp.toISOString ? r.timestamp.toISOString() : "");
    return t ? t.slice(0, 10) : "";
  };
  const byDate = {};
  list.forEach((r) => {
    const key = toDateStr(r);
    if (!key) return;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(r);
  });
  return Object.entries(byDate).map(([date, dayReadings]) => {
    const num = (get) => dayReadings.map(get).filter((v) => v != null);
    const temps    = num((r) => r.temperature);
    const phs      = num((r) => r.ph ?? r.pH);
    const turbs    = num((r) => r.turbidity);
    const dos      = num((r) => r.dissolved_oxygen ?? r.dissolvedOxygen ?? r.do);
    const nh3s     = dayReadings.map((r) => getNH3FromReading(r)).filter((v) => v != null);
    const tans     = num((r) => r.tan ?? r.TAN);
    const flowRates = num((r) => r.flow_rate ?? r.flowRate);

    const safeAvg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const safeMin = (arr) => arr.length ? Math.min(...arr) : null;
    const safeMax = (arr) => arr.length ? Math.max(...arr) : null;

    const avgTemp = safeAvg(temps);
    const avgPh   = safeAvg(phs);
    const avgTurb = safeAvg(turbs);
    const avgDO   = safeAvg(dos);
    const avgTan  = safeAvg(tans);
    const avgNh3  = safeAvg(nh3s);
    const avgFlow = safeAvg(flowRates);

    // Use stored wqi from backend when available; otherwise compute per reading
    const wqis = dayReadings.map((r) => {
      const stored = r.wqi;
      if (stored != null && !isNaN(stored)) return Math.round(stored);
      const rPh  = r.ph ?? r.pH;
      const rDO  = r.dissolved_oxygen ?? r.dissolvedOxygen ?? r.do;
      const rTan = r.tan ?? r.TAN;
      return calculateWQI({ temperature: r.temperature, pH: rPh, tan: rTan, turbidity: r.turbidity, dissolvedOxygen: rDO });
    }).filter((v) => v != null);

    return {
      date,
      node_id: dayReadings[0]?.node_id ?? dayReadings[0]?.nodeId,
      location: dayReadings[0]?.location,
      avg_temperature:      avgTemp,
      min_temperature:      safeMin(temps),
      max_temperature:      safeMax(temps),
      avg_ph:               avgPh,
      min_ph:               safeMin(phs),
      max_ph:               safeMax(phs),
      avg_turbidity:        avgTurb,
      min_turbidity:        safeMin(turbs),
      max_turbidity:        safeMax(turbs),
      avg_dissolved_oxygen: avgDO,
      min_dissolved_oxygen: safeMin(dos),
      max_dissolved_oxygen: safeMax(dos),
      avg_tan:              avgTan,
      avg_nh3:              avgNh3,
      avg_flow_rate:        avgFlow,
      min_flow_rate:        safeMin(flowRates),
      max_flow_rate:        safeMax(flowRates),
      avg_wqi:              safeAvg(wqis),
      min_wqi:              safeMin(wqis),
      max_wqi:              safeMax(wqis),
      reading_count: dayReadings.length,
    };
  });
}

export default function Reports() {
  const lastUpdated = new Date();
  const [nodes, setNodes] = useState([]);
  const [nodesLoaded, setNodesLoaded] = useState(false);
  /** Daily summaries fetched directly from the daily_summaries DB table. */
  const [reportReadingsForChart, setReportReadingsForChart] = useState([]);
  const [comparisonReadings, setComparisonReadings] = useState([]);
  const [calendarSummaries, setCalendarSummaries] = useState([]);
  /** reportReadingsForChart is already in daily-summary shape from the DB. */
  const reportSummaries = useMemo(() => Array.isArray(reportReadingsForChart) ? reportReadingsForChart : [], [reportReadingsForChart]);
  /** comparisonReadings is already daily-summary shape from the DB — use directly. */
  const reportSummariesByNode = useMemo(
    () => Array.isArray(comparisonReadings) ? comparisonReadings : [],
    [comparisonReadings]
  );
  const [activeTab, setActiveTab] = useState(REPORT_TABS[0].id);
  const [reportParameter, setReportParameter] = useState(PARAMETER_OPTIONS[0].id);
  const [reportNodeId, setReportNodeId] = useState("all");
  // Node comparison chart — only parameter is independent; date/node/period are shared
  const [comparisonParameter, setComparisonParameter] = useState(PARAMETER_OPTIONS[0].id);
  const [reportChartType, setReportChartType] = useState(CHART_TYPE_OPTIONS[0].id);
  const [reportPeriod, setReportPeriod] = useState(PERIOD_OPTIONS[0].id);
  const [reportRangeStart, setReportRangeStart] = useState(() => getWeekRange(new Date()).start);
  const [reportRangeEnd, setReportRangeEnd] = useState(() => getWeekRange(new Date()).end);
  const [dateRangePickerOpen, setDateRangePickerOpen] = useState(false);
  const [dateRangePickerView, setDateRangePickerView] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const dateRangePickerRef = useRef(null);
  const dateRangeButtonRef = useRef(null);
  const dateRangeOverlayRef = useRef(null);
  const [overlayPosition, setOverlayPosition] = useState({ top: 0, right: 0 });
  const [calendarView, setCalendarView] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  useEffect(() => {
    loadNodes().then(() => setNodes(getNodes())).finally(() => setNodesLoaded(true));
  }, []);
  useEffect(() => {
    const onFocus = () => loadNodes().then(() => setNodes(getNodes()));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (!reportRangeStart || !reportRangeEnd) return;
    const start = typeof reportRangeStart === "string" ? reportRangeStart : (reportRangeStart.getFullYear() + "-" + String(reportRangeStart.getMonth() + 1).padStart(2, "0") + "-" + String(reportRangeStart.getDate()).padStart(2, "0"));
    const end = typeof reportRangeEnd === "string" ? reportRangeEnd : (reportRangeEnd.getFullYear() + "-" + String(reportRangeEnd.getMonth() + 1).padStart(2, "0") + "-" + String(reportRangeEnd.getDate()).padStart(2, "0"));
    const nodeId = reportNodeId === "all" ? null : reportNodeId;
    api.getDailySummaries({ startDate: start, endDate: end, nodeId })
      .then((rows) => setReportReadingsForChart(Array.isArray(rows) ? rows : []))
      .catch(() => setReportReadingsForChart([]));
  }, [reportRangeStart, reportRangeEnd, reportNodeId, refreshTrigger]);

  // Comparison chart always fetches ALL nodes regardless of the node filter
  useEffect(() => {
    if (!reportRangeStart || !reportRangeEnd) return;
    const start = typeof reportRangeStart === "string" ? reportRangeStart : (reportRangeStart.getFullYear() + "-" + String(reportRangeStart.getMonth() + 1).padStart(2, "0") + "-" + String(reportRangeStart.getDate()).padStart(2, "0"));
    const end = typeof reportRangeEnd === "string" ? reportRangeEnd : (reportRangeEnd.getFullYear() + "-" + String(reportRangeEnd.getMonth() + 1).padStart(2, "0") + "-" + String(reportRangeEnd.getDate()).padStart(2, "0"));
    api.getDailySummaries({ startDate: start, endDate: end, nodeId: null })
      .then((rows) => setComparisonReadings(Array.isArray(rows) ? rows : []))
      .catch(() => setComparisonReadings([]));
  }, [reportRangeStart, reportRangeEnd, refreshTrigger]);

  useEffect(() => {
    const start = new Date(calendarView.year, calendarView.month, 1);
    const end = new Date(calendarView.year, calendarView.month + 1, 0);
    const startStr = start.getFullYear() + "-" + String(start.getMonth() + 1).padStart(2, "0") + "-" + String(start.getDate()).padStart(2, "0");
    const endStr = end.getFullYear() + "-" + String(end.getMonth() + 1).padStart(2, "0") + "-" + String(end.getDate()).padStart(2, "0");
    api.getDailySummaries({ startDate: startStr, endDate: endStr })
      .then((rows) => setCalendarSummaries(Array.isArray(rows) ? rows : []))
      .catch(() => setCalendarSummaries([]));
  }, [calendarView.year, calendarView.month, refreshTrigger]);

  useEffect(() => {
    if (!dateRangePickerOpen || !dateRangeButtonRef.current) return;
    const updatePosition = () => {
      if (!dateRangeButtonRef.current) return;
      const rect = dateRangeButtonRef.current.getBoundingClientRect();
      setOverlayPosition({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [dateRangePickerOpen]);

  const reportChartData = useMemo(() => {
    const { labels, minArr, avgArr, maxArr } = buildReportChartFromSummaries(
      reportParameter,
      reportPeriod,
      reportRangeStart,
      reportRangeEnd,
      reportSummaries
    );
    const param = PARAMETER_OPTIONS.find((p) => p.id === reportParameter);
    const unit = param?.unit ?? "";
    return {
      labels,
      datasets: [
        { label: `Min${unit}`, data: minArr, borderColor: "#6c757d", backgroundColor: "rgba(108, 117, 125, 0.1)", fill: false, borderDash: [4, 2] },
        { label: `Avg${unit}`, data: avgArr, borderColor: "#1b9c85", backgroundColor: "rgba(27, 156, 133, 0.15)", fill: true },
        { label: `Max${unit}`, data: maxArr, borderColor: "#d45b5b", backgroundColor: "rgba(212, 91, 91, 0.1)", fill: false, borderDash: [4, 2] },
      ],
    };
  }, [reportParameter, reportPeriod, reportRangeStart, reportRangeEnd, reportSummaries]);

  const reportChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 10, font: { size: 10 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255, 255, 255, 0.08)" },
          ticks: { font: { size: 10 } },
        },
      },
    }),
    []
  );

  const calendarDays = useMemo(
    () => buildCalendarDays(calendarView.year, calendarView.month, calendarSummaries),
    [calendarView.year, calendarView.month, calendarSummaries]
  );

  // Sync calendar view to the shared filter's date range
  useEffect(() => {
    if (!reportRangeStart) return;
    const d = typeof reportRangeStart === "string" ? new Date(reportRangeStart + "T00:00:00") : reportRangeStart;
    setCalendarView({ year: d.getFullYear(), month: d.getMonth() });
  }, [reportRangeStart]);

  const handlePrevMonth = () => {
    setCalendarView((v) => {
      if (v.month === 0) return { year: v.year - 1, month: 11 };
      return { year: v.year, month: v.month - 1 };
    });
  };

  const handleNextMonth = () => {
    setCalendarView((v) => {
      if (v.month === 11) return { year: v.year + 1, month: 0 };
      return { year: v.year, month: v.month + 1 };
    });
  };

  const handleSelectDate = (day) => {
    setSelectedDay(day);
    setModalOpen(true);
  };

  const handleReportPeriodChange = (e) => {
    const periodId = e.target.value;
    setReportPeriod(periodId);
    const now = new Date();
    if (periodId === "week") {
      const { start, end } = getWeekRange(now);
      setReportRangeStart(start);
      setReportRangeEnd(end);
    } else {
      const { start, end } = getMonthRange(now);
      setReportRangeStart(start);
      setReportRangeEnd(end);
    }
  };


  const handleRangePickerDayClick = (dayDate) => {
    if (reportPeriod === "week") {
      const { start, end } = getWeekRange(dayDate);
      setReportRangeStart(start);
      setReportRangeEnd(end);
    } else {
      const { start, end } = getMonthRange(dayDate);
      setReportRangeStart(start);
      setReportRangeEnd(end);
    }
    setDateRangePickerOpen(false);
  };

  const handleRangePickerToday = () => {
    const now = new Date();
    if (reportPeriod === "week") {
      const { start, end } = getWeekRange(now);
      setReportRangeStart(start);
      setReportRangeEnd(end);
    } else {
      const { start, end } = getMonthRange(now);
      setReportRangeStart(start);
      setReportRangeEnd(end);
    }
    setDateRangePickerView({ year: now.getFullYear(), month: now.getMonth() });
    setDateRangePickerOpen(false);
  };

  const reportMonth = reportRangeStart?.getMonth() ?? new Date().getMonth();
  const reportYear = reportRangeStart?.getFullYear() ?? new Date().getFullYear();

  const handleReportMonthChange = (e) => {
    const month = Number(e.target.value);
    const start = new Date(reportYear, month, 1);
    const end = new Date(reportYear, month + 1, 0);
    setReportRangeStart(start);
    setReportRangeEnd(end);
  };

  const handleReportYearChange = (e) => {
    const year = Number(e.target.value);
    const start = new Date(year, reportMonth, 1);
    const end = new Date(year, reportMonth + 1, 0);
    setReportRangeStart(start);
    setReportRangeEnd(end);
  };

  const rangePickerDays = useMemo(
    () => buildRangePickerDays(dateRangePickerView.year, dateRangePickerView.month),
    [dateRangePickerView.year, dateRangePickerView.month]
  );


  useEffect(() => {
    const handleClickOutside = (e) => {
      const inSelectors = dateRangePickerRef.current?.contains(e.target);
      const inOverlay = dateRangeOverlayRef.current?.contains(e.target);
      if (!inSelectors && !inOverlay) {
        setDateRangePickerOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  if (!nodesLoaded) {
    return (
      <div className="reports-page">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="reports-page">
      <header className="page-header reports-page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Analytics and historical water quality data</p>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta reports-header-meta" showClassification={false} />
      </header>

      <div className="reports-tabs-row">
        <nav className="reports-tabs" role="tablist" aria-label="Report sections">
          {REPORT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`reports-tab ${activeTab === tab.id ? "reports-tab--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "water" && (
        <div ref={dateRangePickerRef} className="reports-water-wrap">
        <div className="reports-filter-bar" role="group" aria-label="Shared filters">
          <div className="reports-filter-bar__control">
            <span className="reports-filter-bar__label">Period</span>
            <select className="reports-filter-bar__select" value={reportPeriod} onChange={handleReportPeriodChange} aria-label="Period">
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
          {reportPeriod === "month" ? (
            <>
              <div className="reports-filter-bar__control">
                <span className="reports-filter-bar__label">Month</span>
                <select className="reports-filter-bar__select" value={reportMonth} onChange={handleReportMonthChange} aria-label="Month">
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={i}>{String(i + 1).padStart(2, "0")}</option>
                  ))}
                </select>
              </div>
              <div className="reports-filter-bar__control">
                <span className="reports-filter-bar__label">Year</span>
                <select className="reports-filter-bar__select" value={reportYear} onChange={handleReportYearChange} aria-label="Year">
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div className="reports-filter-bar__control">
              <span className="reports-filter-bar__label">Date range</span>
              <button ref={dateRangeButtonRef} type="button" className="reports-filter-bar__date-btn" onClick={() => { if (dateRangeButtonRef.current) { const rect = dateRangeButtonRef.current.getBoundingClientRect(); setOverlayPosition({ top: rect.bottom + window.scrollY + 6, right: window.innerWidth - rect.right }); } setDateRangePickerView({ year: (reportRangeStart ?? new Date()).getFullYear(), month: (reportRangeStart ?? new Date()).getMonth() }); setDateRangePickerOpen((o) => !o); }} aria-expanded={dateRangePickerOpen} aria-label="Select date range">
                <span className="reports-filter-bar__date-text">{formatDateRange(reportRangeStart, reportRangeEnd) || "Select range"}</span>
                <span className="reports-filter-bar__date-icon" aria-hidden>📅</span>
              </button>
            </div>
          )}
          <div className="reports-filter-bar__control">
            <span className="reports-filter-bar__label">Node</span>
            <select className="reports-filter-bar__select" value={reportNodeId} onChange={(e) => setReportNodeId(e.target.value)} aria-label="Node">
              <option value="all">All nodes</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.name || n.id}</option>
              ))}
            </select>
          </div>
          <div className="reports-filter-bar__wqi">
            <RangeWqiStats summaries={reportSummaries} />
          </div>
        </div>

        <div className="reports-grid reports-grid--water">
        <section className="reports-grid__chart card">
          <div className="card__header reports-chart-header reports-chart-header--per-chart">
              <h2 className="card__title">Report chart</h2>
            <div className="reports-chart-header-controls">
              <div className="reports-chart-header-param">
                <span className="reports-chart-selector-label">Parameter</span>
                <select className="reports-chart-select reports-chart-select--header" value={reportParameter} onChange={(e) => setReportParameter(e.target.value)} aria-label="Parameter">
                  {PARAMETER_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
            </div>
              <div className="reports-chart-header-param">
                <span className="reports-chart-selector-label">Chart type</span>
                <select className="reports-chart-select reports-chart-select--header" value={reportChartType} onChange={(e) => setReportChartType(e.target.value)} aria-label="Chart type">
                {CHART_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
            </div>
          </div>
          <div className="reports-chart-content reports-chart-content--full">
            {reportPeriod === "month" && (
              <div className="reports-chart-report-title">
                <h3 className="reports-chart-report-heading">REPORT</h3>
                <p className="reports-chart-report-range">
                  {formatDateRangeLong(reportRangeStart, reportRangeEnd)}
                </p>
              </div>
            )}
            <div className="reports-chart-wrapper">
              <MemoizedReportChart data={reportChartData} options={reportChartOptions} chartType={reportChartType} />
            </div>
          </div>
        </section>

        <section className="reports-grid__placeholder-left card">
          <div className="card__header reports-chart-header reports-chart-header--per-chart">
            <h2 className="card__title">Node comparison</h2>
            <div className="reports-chart-header-controls">
              <div className="reports-chart-header-param">
                <span className="reports-chart-selector-label">Parameter</span>
                <select
                  className="reports-chart-select reports-chart-select--header"
                  value={comparisonParameter}
                  onChange={(e) => setComparisonParameter(e.target.value)}
                  aria-label="Comparison parameter"
                >
                  {PARAMETER_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="reports-comparison-content reports-comparison-content--full">
            <NodeComparisonChart summaries={reportSummariesByNode} parameter={comparisonParameter} period={reportPeriod} rangeStart={reportRangeStart} rangeEnd={reportRangeEnd} nodes={nodes} />
          </div>
        </section>

        <aside className="reports-grid__calendar card" aria-label="Calendar (clickable)">
          <div className="reports-calendar-wqi reports-calendar-wqi--mobile">
            <RangeWqiStats summaries={reportSummaries} />
          </div>
          <div className="reports-calendar-section">
            <CalendarCard
              monthName={MONTH_NAMES[calendarView.month]}
              year={calendarView.year}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              calendarDays={calendarDays}
              isSameDate={isSameDate}
              selectedDate={selectedDay?.date ?? null}
              onSelectDate={handleSelectDate}
              rangeStart={reportRangeStart}
              rangeEnd={reportRangeEnd}
            />
          </div>
            </aside>

        <section className="reports-grid__placeholder card">
          <div className="card__header">
            <h2 className="card__title">WQI quality class breakdown</h2>
            <span className="reports-wqi-breakdown-hint" title="WQI 90–100 Excellent, 70–89 Good, 50–69 Fair, 25–49 Poor, &lt;25 Very Poor">ⓘ</span>
          </div>
          <div className="card__body reports-chart-body--compact">
            <WqiBreakdownChart summaries={reportSummaries} />
          </div>
        </section>
        </div>
        </div>
        )}

        {activeTab === "alerts" && (
          <div className="reports-grid reports-grid--alerts">
          <AlertsComplianceTab
            reportRangeStart={reportRangeStart}
            reportRangeEnd={reportRangeEnd}
            onSwitchToWater={() => setActiveTab("water")}
          />
          </div>
        )}

        {activeTab === "system" && (
          <div className="reports-grid reports-grid--system">
          <SystemTab
            reportRangeStart={reportRangeStart}
            reportRangeEnd={reportRangeEnd}
            nodes={nodes}
            onSwitchToWater={() => setActiveTab("water")}
          />
          </div>
        )}

        {activeTab === "testing" && (
          <div className="reports-grid reports-grid--testing">
            <TestingTab nodes={nodes} />
          </div>
        )}

      {modalOpen && (
        <WqiDetailModal
          date={selectedDay?.date ?? null}
          wqi={selectedDay?.wqi ?? null}
          params={selectedDay?.params ?? null}
          onClose={() => setModalOpen(false)}
        />
      )}

          {dateRangePickerOpen &&
            createPortal(
              <div
                ref={dateRangeOverlayRef}
                className="reports-chart-date-range-overlay reports-chart-date-range-overlay--portal"
                role="dialog"
                aria-label="Date range picker"
                style={{
                  position: "fixed",
                  top: overlayPosition.top,
                  right: overlayPosition.right,
                  left: "auto",
                }}
              >
                <div className="reports-range-picker-header">
                  <button
                    type="button"
                    className="reports-range-picker-arrow"
                    onClick={() =>
                      setDateRangePickerView((v) => {
                        if (v.month === 0) return { year: v.year - 1, month: 11 };
                        return { year: v.year, month: v.month - 1 };
                      })
                    }
                    aria-label="Previous month"
                  >
                    ‹
                  </button>
                  <select
                    className="reports-range-picker-month"
                    value={dateRangePickerView.month}
                    onChange={(e) =>
                      setDateRangePickerView((v) => ({ ...v, month: Number(e.target.value) }))
                    }
                    aria-label="Month"
                  >
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="reports-range-picker-year"
                    value={dateRangePickerView.year}
                    onChange={(e) =>
                      setDateRangePickerView((v) => ({ ...v, year: Number(e.target.value) }))
                    }
                    aria-label="Year"
                  >
                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="reports-range-picker-arrow"
                    onClick={() =>
                      setDateRangePickerView((v) => {
                        if (v.month === 11) return { year: v.year + 1, month: 0 };
                        return { year: v.year, month: v.month + 1 };
                      })
                    }
                    aria-label="Next month"
                  >
                    ›
                  </button>
                </div>
                <div className="reports-range-picker-weekdays">
                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                    <span key={d} className="reports-range-picker-weekday">
                      {d}
                    </span>
                  ))}
                </div>
                <div className="reports-range-picker-grid">
                  {rangePickerDays.map((day, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`reports-range-picker-day ${!day.isCurrentMonth ? "other-month" : ""} ${isDateInRange(day.date, reportRangeStart, reportRangeEnd) ? "selected" : ""}`}
                      onClick={() => day.isCurrentMonth && handleRangePickerDayClick(day.date)}
                      disabled={!day.isCurrentMonth}
                      aria-label={day.date.toLocaleDateString()}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                <div className="reports-range-picker-actions">
                  <button type="button" className="reports-range-picker-btn" onClick={handleRangePickerToday}>
                    This week
                  </button>
                  <button
                    type="button"
                    className="reports-range-picker-btn"
                    onClick={() => setDateRangePickerOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </div>,
              document.body
      )}
    </div>
  );
}
