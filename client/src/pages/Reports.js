import React, { useState, useRef, useEffect, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import "../utils/chartConfig";
import { Line, Bar } from "react-chartjs-2";
import PageDateWithStatus from "../components/PageDateWithStatus";
import CalendarCard from "../components/reports/calendar-card";
import WqiDetailModal from "../components/reports/WqiDetailModal";
import { getWQIClass, calculateWQI } from "../utils/wqiCalculator";
import { getNH3FromReading, calculateNH3FromTAN } from "../utils/nh3Calculator";
import { getNodes, loadNodes } from "../utils/nodesStorage";
import api from "../services/api";
import { applyCalibrationToReadings } from "../utils/calibration";
import { PageLoader } from "../components/LoadingSkeleton";
import "./Reports.css";

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

/** Build report chart from API daily summaries only. No mock data. */
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
      const vals = (byDate[key] || []).map(getVal).filter((v) => v != null);
      if (vals.length === 0) {
        minArr.push(null);
        avgArr.push(null);
        maxArr.push(null);
      } else {
        minArr.push(Math.round(Math.min(...vals) * 10) / 10);
        avgArr.push(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10);
        maxArr.push(Math.round(Math.max(...vals) * 10) / 10);
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
      const vals = list
        .filter((s) => {
          const d = typeof s.date === "string" ? new Date(s.date) : new Date(s.date);
          return d >= weekStart && d <= segEnd;
        })
        .map(getVal)
        .filter((v) => v != null);
      if (vals.length === 0) {
        minArr.push(null);
        avgArr.push(null);
        maxArr.push(null);
      } else {
        minArr.push(Math.round(Math.min(...vals) * 10) / 10);
        avgArr.push(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10);
        maxArr.push(Math.round(Math.max(...vals) * 10) / 10);
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

/** Aggregate sensor_readings by date into daily-summary shape for the chart. */
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
    const n = dayReadings.length;
    const sum = (get) => dayReadings.reduce((a, r) => a + (get(r) ?? 0), 0);
    const avg = (get) => (n ? sum(get) / n : null);
    const num = (get) => dayReadings.map(get).filter((v) => v != null);
    const temps = num((r) => r.temperature);
    const phs = num((r) => r.ph ?? r.pH);
    const turbs = num((r) => r.turbidity);
    const dos = num((r) => r.dissolved_oxygen ?? r.dissolvedOxygen ?? r.do);
    const nh3s = dayReadings.map((r) => getNH3FromReading(r)).filter((v) => v != null);
    const tans = num((r) => r.tan ?? r.TAN);
    const flowRates = num((r) => r.flow_rate ?? r.flowRate);
    const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
    const avgPh = phs.length ? phs.reduce((a, b) => a + b, 0) / phs.length : null;
    const avgTurb = turbs.length ? turbs.reduce((a, b) => a + b, 0) / turbs.length : null;
    const avgDO = dos.length ? dos.reduce((a, b) => a + b, 0) / dos.length : null;
    const avgTan = tans.length ? tans.reduce((a, b) => a + b, 0) / tans.length : null;
    const avgNh3 = nh3s.length ? nh3s.reduce((a, b) => a + b, 0) / nh3s.length : null;
    const avgFlow = flowRates.length ? flowRates.reduce((a, b) => a + b, 0) / flowRates.length : null;
    const wqiFromParams = calculateWQI({ temperature: avgTemp, pH: avgPh, tan: avgTan, turbidity: avgTurb, dissolvedOxygen: avgDO });
    return {
      date,
      node_id: dayReadings[0]?.node_id ?? dayReadings[0]?.nodeId,
      location: dayReadings[0]?.location,
      avg_temperature: avgTemp,
      avg_ph: avgPh,
      avg_turbidity: avgTurb,
      avg_dissolved_oxygen: avgDO,
      avg_tan: avgTan,
      avg_nh3: avgNh3,
      avg_flow_rate: avgFlow,
      avg_wqi: wqiFromParams,
      min_wqi: wqiFromParams,
      max_wqi: wqiFromParams,
      reading_count: n,
    };
  });
}

export default function Reports() {
  const lastUpdated = new Date();
  const [nodes, setNodes] = useState([]);
  const [nodesLoaded, setNodesLoaded] = useState(false);
  const [reportReadingsForChart, setReportReadingsForChart] = useState([]);
  const [calendarSummaries, setCalendarSummaries] = useState([]);
  /** Daily summaries derived from sensor_readings for the chart. */
  const reportSummaries = useMemo(() => aggregateReadingsToDailySummaries(reportReadingsForChart), [reportReadingsForChart]);
  const [reportParameter, setReportParameter] = useState(PARAMETER_OPTIONS[0].id);
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
    api.getSensorReadings({ startDate: start, endDate: end, limit: 500 }).then((rows) => setReportReadingsForChart(applyCalibrationToReadings(Array.isArray(rows) ? rows : []))).catch(() => setReportReadingsForChart([]));
  }, [reportRangeStart, reportRangeEnd, refreshTrigger]);

  useEffect(() => {
    const start = new Date(calendarView.year, calendarView.month, 1);
    const end = new Date(calendarView.year, calendarView.month + 1, 0);
    const startStr = start.getFullYear() + "-" + String(start.getMonth() + 1).padStart(2, "0") + "-" + String(start.getDate()).padStart(2, "0");
    const endStr = end.getFullYear() + "-" + String(end.getMonth() + 1).padStart(2, "0") + "-" + String(end.getDate()).padStart(2, "0");
    api.getDailySummaries({ startDate: startStr, endDate: endStr }).then(setCalendarSummaries).catch(() => setCalendarSummaries([]));
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

  const handleExportReports = () => {
    const param = PARAMETER_OPTIONS.find((p) => p.id === reportParameter);
    const paramLabel = param?.label ?? reportParameter;
    const unit = param?.unit ?? "";
    const { labels, datasets } = reportChartData;
    const minData = datasets.find((d) => d.label.startsWith("Min"))?.data ?? [];
    const avgData = datasets.find((d) => d.label.startsWith("Avg"))?.data ?? [];
    const maxData = datasets.find((d) => d.label.startsWith("Max"))?.data ?? [];
    const rangeStr = reportPeriod === "week" ? formatDateRange(reportRangeStart, reportRangeEnd) : `${MONTH_NAMES[reportMonth]} ${reportYear}`;
    const baseName = `wqms-report-${paramLabel.toLowerCase().replace(/\s+/g, "-")}-${rangeStr}`.replace(/[\/\s,]/g, "-");

    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(12);
    doc.text("WQMS Report", 14, 12);
    doc.setFontSize(9);
    doc.text(`${paramLabel} — ${rangeStr}  |  Exported: ${new Date().toLocaleString()}`, 14, 18);
    const header = ["Period", `Min${unit}`, `Avg${unit}`, `Max${unit}`];
    const body = labels.map((label, i) => [
      label,
      minData[i] != null ? String(minData[i]) : "—",
      avgData[i] != null ? String(avgData[i]) : "—",
      maxData[i] != null ? String(maxData[i]) : "—",
    ]);
    autoTable(doc, {
      head: [header],
      body: body.length ? body : [["No data", "—", "—", "—"]],
      startY: 24,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [27, 156, 133] },
    });
    doc.save(`${baseName}.pdf`);
  };

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
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta reports-header-meta" />
      </header>

      <div className="reports-grid">
        <section className="reports-grid__chart card">
          <div className="card__header reports-chart-header">
            <div>
              <h2 className="card__title">Report chart</h2>
            </div>
            <div className="reports-chart-header-chart-type">
              <select
                className="reports-chart-select reports-chart-select--header"
                value={reportChartType}
                onChange={(e) => setReportChartType(e.target.value)}
                aria-label="Chart type"
              >
                {CHART_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="reports-chart-layout">
            <div className="reports-chart-content">
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
            <aside className="reports-chart-selectors" ref={dateRangePickerRef} aria-label="Chart filters">
              <label className="reports-chart-selector-group">
                <span className="reports-chart-selector-label">Period</span>
                <select
                  className="reports-chart-select"
                  value={reportPeriod}
                  onChange={handleReportPeriodChange}
                  aria-label="Period"
                >
                  {PERIOD_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              {reportPeriod === "month" ? (
                <>
                  <label className="reports-chart-selector-group">
                    <span className="reports-chart-selector-label">Month</span>
                    <select
                      className="reports-chart-select"
                      value={reportMonth}
                      onChange={handleReportMonthChange}
                      aria-label="Month"
                    >
                      {MONTH_NAMES.map((name, i) => (
                        <option key={i} value={i}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="reports-chart-selector-group">
                    <span className="reports-chart-selector-label">Year</span>
                    <select
                      className="reports-chart-select"
                      value={reportYear}
                      onChange={handleReportYearChange}
                      aria-label="Year"
                    >
                      {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <label className="reports-chart-selector-group">
                  <span className="reports-chart-selector-label">Date range</span>
                  <div className="reports-chart-date-range-wrap">
                    <button
                      ref={dateRangeButtonRef}
                      type="button"
                      className="reports-chart-date-range-btn"
                      onClick={() => setDateRangePickerOpen((o) => !o)}
                      aria-expanded={dateRangePickerOpen}
                      aria-label="Select date range"
                    >
                      <span className="reports-chart-date-range-text">
                        {formatDateRange(reportRangeStart, reportRangeEnd) || "Select range"}
                      </span>
                      <span className="reports-chart-date-range-icon" aria-hidden>📅</span>
                    </button>
                  </div>
                </label>
              )}
              <label className="reports-chart-selector-group">
                <span className="reports-chart-selector-label">Parameter</span>
                <select
                  className="reports-chart-select"
                  value={reportParameter}
                  onChange={(e) => setReportParameter(e.target.value)}
                  aria-label="Parameter"
                >
                  {PARAMETER_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </aside>
          </div>

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
        </section>

        <section className="reports-grid__placeholder-left card reports-placeholder-card" aria-label="Reserved for future content">
          <div className="card__body">
            <div className="reports-placeholder-content" />
          </div>
        </section>

        <aside className="reports-grid__calendar card" aria-label="Calendar (clickable)">
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
            />
          </div>
        </aside>

        <section className="reports-grid__placeholder card reports-placeholder-card" aria-label="Reserved for future content">
          <div className="card__body">
            <div className="reports-placeholder-content" />
          </div>
        </section>

        <section className="reports-grid__placeholder-bottom card reports-placeholder-card" aria-label="Reserved for future content">
          <div className="card__body">
            <div className="reports-placeholder-content" />
          </div>
        </section>

        <section className="reports-grid__export-upper card reports-placeholder-card" aria-label="Reserved for future content">
          <div className="card__body">
            <div className="reports-placeholder-content" />
          </div>
        </section>

        <section className="reports-grid__export card reports-export-card">
          <div className="card__body">
            <button
              type="button"
              className="reports-export-btn"
              onClick={handleExportReports}
              aria-label="Export report as PDF"
            >
              <span className="reports-export-btn-icon" aria-hidden>↑</span>
              Export statistics
            </button>
          </div>
        </section>
      </div>

      {modalOpen && (
        <WqiDetailModal
          date={selectedDay?.date ?? null}
          wqi={selectedDay?.wqi ?? null}
          params={selectedDay?.params ?? null}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
