import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { getNH3FromReading, formatNH3 } from "../utils/nh3Calculator";
import BatteryIndicator from "../components/BatteryIndicator";
import { calculateWQI } from "../utils/wqiCalculator";
import { getNodes, loadNodes } from "../utils/nodesStorage";
import api from "../services/api";
import { applyCalibrationToReadings } from "../utils/calibration";
import { PageLoader } from "../components/LoadingSkeleton";
import "./SensorLogs.css";

const EXPORT_HEADERS = [
  "Date", "Time", "Node", "Temperature (°C)", "pH", "Turbidity (NTU)",
  "Dissolved O₂ (mg/L)", "NH₃ (mg/L)", "Flow rate (L/min)", "WQI",
];

function rowToSearchStrings(row) {
  const nodeLabel = row.nodeName !== row.nodeId ? `${row.nodeId} — ${row.nodeName}` : row.nodeId;
  return [
    row.date.toLocaleDateString(),
    row.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    nodeLabel,
    String(row.temperature),
    String(row.pH),
    String(row.turbidity),
    String(row.dissolvedOxygen),
    String(row.nh3),
    String(row.flowRate),
    row.wqi != null ? String(row.wqi) : "—",
  ];
}

function rowMatchesSearch(row, q) {
  if (!q) return true;
  const lower = q.trim().toLowerCase();
  if (!lower) return true;
  const strings = rowToSearchStrings(row);
  return strings.some((s) => s && String(s).toLowerCase().includes(lower));
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatch(text, query) {
  const str = text == null ? "" : String(text);
  const q = query && query.trim();
  if (!q) return str;
  const escaped = escapeRegex(q);
  const re = new RegExp(`(${escaped})`, "gi");
  const parts = str.split(re);
  if (parts.length === 1) return str;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="sensor-logs-search-highlight">{part}</mark>
    ) : (
      part
    )
  );
}

function rowToExportCells(row) {
  const nodeLabel = row.nodeName !== row.nodeId ? `${row.nodeId} — ${row.nodeName}` : row.nodeId;
  return [
    row.date.toLocaleDateString(),
    row.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    nodeLabel,
    String(row.temperature),
    String(row.pH),
    String(row.turbidity),
    String(row.dissolvedOxygen),
    String(row.nh3),
    String(row.flowRate),
    row.wqi != null ? String(row.wqi) : "—",
  ];
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const ROW_HEIGHT = 39;       // px per data row (slightly under ~41 to fill space; overflow-y handles any excess)
const THEAD_HEIGHT = 41;     // px for the thead row
const PAGINATION_HEIGHT = 50; // px for pagination bar
const MIN_ROWS = 5;
const MAX_ROWS = 50;         // cap rows on very large screens

export default function SensorLogs() {
  const navigate = useNavigate();
  const lastUpdated = new Date();
  const [search, setSearch] = useState("");
  const [tableDateFrom, setTableDateFrom] = useState("");
  const [tableDateTo, setTableDateTo] = useState("");
  const [tableSort, setTableSort] = useState({ column: "date", direction: "desc" });
  const [tableNodeFilter, setTableNodeFilter] = useState("all");
  const [tablePage, setTablePage] = useState(1);
  const [nodes, setNodes] = useState([]);
  const [nodesLoaded, setNodesLoaded] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sortPanelOpen, setSortPanelOpen] = useState(false);
  const [sensorReadings, setSensorReadings] = useState([]);
  const [pageSize, setPageSize] = useState(15);
  const [selectedRow, setSelectedRow] = useState(null);
  const exportRef = useRef(null);
  const sortPanelRef = useRef(null);
  const tableWrapRef = useRef(null);
  const cardBodyRef = useRef(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const closeDetail = useCallback(() => setSelectedRow(null), []);

  // Auto-adjust page size from available height so table fills space on large
  // screens and doesn't overlap pagination on small screens.
  useEffect(() => {
    const computeRows = () => {
      const cardBody = cardBodyRef.current;
      if (!cardBody) return;
      const rect = cardBody.getBoundingClientRect();
      const vh = window.innerHeight;
      const isCompactLayout = window.matchMedia("(max-width: 1024px), (max-height: 768px)").matches;

      let available;
      if (isCompactLayout) {
        // On mobile/tablet the card body grows with content; use viewport-based calc.
        const bottomGap = vh <= 600 ? 12 : vh <= 768 ? 14 : 24;
        available = vh - rect.top - bottomGap - PAGINATION_HEIGHT - THEAD_HEIGHT;
      } else {
        // On desktop the card body has constrained height (flex: 1); use it.
        if (rect.height > 80) {
          available = rect.height - PAGINATION_HEIGHT - THEAD_HEIGHT - 2;
        } else {
          const bottomGap = 24;
          available = vh - rect.top - bottomGap - PAGINATION_HEIGHT - THEAD_HEIGHT;
        }
      }
      const rows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(available / ROW_HEIGHT)));
      setPageSize(rows);
    };

    const run = () => {
      requestAnimationFrame(computeRows);
    };
    run();
    const t1 = setTimeout(run, 150);
    const t2 = setTimeout(run, 400);
    window.addEventListener("resize", run);
    const el = cardBodyRef.current;
    let ro = null;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(run);
      ro.observe(el);
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", run);
      if (ro && el) ro.unobserve(el);
    };
  }, []);

  const tableDateRange = useMemo(() => {
    if (tableDateFrom && tableDateTo) {
      const start = new Date(tableDateFrom);
      start.setHours(0, 0, 0, 0);
      const end = new Date(tableDateTo);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }, [tableDateFrom, tableDateTo]);

  useEffect(() => {
    loadNodes().then(() => setNodes(getNodes())).finally(() => setNodesLoaded(true));
  }, []);
  useEffect(() => {
    const onFocus = () => loadNodes().then(() => setNodes(getNodes()));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (!tableDateRange?.start || !tableDateRange?.end) return;
    const start = tableDateRange.start.getFullYear() + "-" + String(tableDateRange.start.getMonth() + 1).padStart(2, "0") + "-" + String(tableDateRange.start.getDate()).padStart(2, "0");
    const end = tableDateRange.end.getFullYear() + "-" + String(tableDateRange.end.getMonth() + 1).padStart(2, "0") + "-" + String(tableDateRange.end.getDate()).padStart(2, "0");
    api.getSensorReadings({ startDate: start, endDate: end, limit: 500 })
      .then((rows) => setSensorReadings(applyCalibrationToReadings(Array.isArray(rows) ? rows : [])))
      .catch(() => setSensorReadings([]));
  }, [tableDateRange?.start?.getTime(), tableDateRange?.end?.getTime(), refreshTrigger]);

  const sensorTableRows = useMemo(() => {
    const list = Array.isArray(sensorReadings) ? sensorReadings : [];
    const nodeMap = {};
    nodes.forEach((n) => { nodeMap[n.id] = n.name || n.id; });
    const rows = list.map((r) => {
      const d = typeof r.timestamp === "string" ? new Date(r.timestamp) : new Date(r.timestamp);
      const nodeId = r.node_id || r.nodeId || "1";
      const wqi = calculateWQI({
        temperature: r.temperature,
        turbidity: r.turbidity,
        pH: r.ph ?? r.pH,
        tan: r.tan ?? r.TAN,
        dissolvedOxygen: r.dissolved_oxygen ?? r.dissolvedOxygen ?? r.do,
      });
      return {
        date: d,
        nodeId,
        nodeName: nodeMap[nodeId] || nodeId,
        temperature: r.temperature ?? null,
        pH: r.ph ?? r.pH ?? null,
        turbidity: r.turbidity ?? null,
        dissolvedOxygen: r.dissolved_oxygen ?? r.dissolvedOxygen ?? r.do ?? null,
        nh3: getNH3FromReading(r),
        flowRate: r.flow_rate ?? r.flowRate ?? null,
        wqi: wqi != null ? Math.round(wqi) : null,
        batteryVoltage: r.battery_voltage ?? r.batteryVoltage ?? null,
      };
    });
    let filtered = rows;
    if (search.trim()) {
      filtered = filtered.filter((r) => rowMatchesSearch(r, search));
    }
    if (tableNodeFilter && tableNodeFilter !== "all") {
      filtered = filtered.filter((r) => r.nodeId === tableNodeFilter);
    }
    const { column, direction } = tableSort;
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (column === "date" || column === "time") cmp = a.date.getTime() - b.date.getTime();
      else if (column === "node") cmp = String(a.nodeName || a.nodeId).localeCompare(String(b.nodeName || b.nodeId));
      else if (column === "temperature") cmp = (a.temperature ?? -Infinity) - (b.temperature ?? -Infinity);
      else if (column === "pH") cmp = (a.pH ?? -Infinity) - (b.pH ?? -Infinity);
      else if (column === "turbidity") cmp = (a.turbidity ?? -Infinity) - (b.turbidity ?? -Infinity);
      else if (column === "dissolvedOxygen") cmp = (a.dissolvedOxygen ?? -Infinity) - (b.dissolvedOxygen ?? -Infinity);
      else if (column === "nh3") cmp = (a.nh3 ?? -Infinity) - (b.nh3 ?? -Infinity);
      else if (column === "flowRate") cmp = (a.flowRate ?? -Infinity) - (b.flowRate ?? -Infinity);
      else if (column === "wqi") cmp = (a.wqi ?? -Infinity) - (b.wqi ?? -Infinity);
      return direction === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [sensorReadings, nodes, search, tableNodeFilter, tableSort]);

  const totalRows = sensorTableRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (tablePage - 1) * pageSize;
    return sensorTableRows.slice(start, start + pageSize);
  }, [sensorTableRows, tablePage, pageSize]);

  useEffect(() => {
    setTablePage(1);
  }, [search, tableNodeFilter, tableDateFrom, tableDateTo, tableSort.column, tableSort.direction]);

  useEffect(() => {
    if (tablePage > totalPages) setTablePage(Math.max(1, totalPages));
  }, [tablePage, totalPages]);

  const handleExport = (format) => {
    setExportOpen(false);
    try {
      const rows = sensorTableRows;
      const headerRow = EXPORT_HEADERS;
      const dataRows = rows.map(rowToExportCells);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const baseName = `wqms-sensor-logs-${timestamp}`;

      if (format === "csv") {
        const escape = (v) => {
          const s = String(v);
          if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const line = (arr) => arr.map(escape).join(",");
        const csv = "\uFEFF" + [headerRow, ...dataRows].map(line).join("\r\n");
        downloadBlob(`${baseName}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
      } else if (format === "text") {
        const pad = (v, w) => String(v).slice(0, w).padEnd(w);
        const widths = [12, 10, 20, 8, 6, 10, 10, 8, 12, 6];
        const textLines = [
          "WQMS Sensor Logs Export",
          `Exported: ${new Date().toLocaleString()}`,
          `Rows: ${rows.length}`,
          "",
          headerRow.map((h, i) => pad(h, widths[i])).join(" "),
          ...dataRows.map((r) => r.map((c, i) => pad(c, widths[i])).join(" ")),
        ];
        const text = textLines.join("\r\n");
        downloadBlob(`${baseName}.txt`, new Blob([text], { type: "text/plain;charset=utf-8" }));
      } else if (format === "excel") {
        const escape = (v) => {
          const s = String(v);
          if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const line = (arr) => arr.map(escape).join(",");
        const csv = "\uFEFF" + [headerRow, ...dataRows].map(line).join("\r\n");
        downloadBlob(`${baseName}.xls`, new Blob([csv], { type: "application/vnd.ms-excel;charset=utf-8" }));
      } else if (format === "pdf") {
        const doc = new jsPDF({ orientation: "landscape" });
        doc.setFontSize(10);
        doc.text("WQMS Sensor Logs", 14, 12);
        const y = 18;
        doc.text(`Exported: ${new Date().toLocaleString()}  |  ${rows.length} records`, 14, y);
        autoTable(doc, {
          head: [headerRow],
          body: dataRows.length > 0 ? dataRows : [["No data for current filters."]],
          startY: y + 10,
          styles: { fontSize: 7 },
          headStyles: { fillColor: [27, 156, 133] },
        });
        doc.save(`${baseName}.pdf`);
      }
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed. Please try again.");
    }
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportOpen(false);
      }
      if (sortPanelRef.current && !sortPanelRef.current.contains(e.target)) {
        setSortPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!nodesLoaded) {
    return (
      <div className="sensor-logs-page">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="sensor-logs-page">
      <header className="page-header sensor-logs-page-header">
        <div>
          <h1 className="page-title">Sensor Logs</h1>
          <p className="page-subtitle">Raw sensor readings and historical data</p>
        </div>
        <PageDateWithStatus
          lastUpdated={lastUpdated}
          className="page-meta sensor-logs-header-meta"
          showClassification={false}
        />
      </header>

      <div className="sensor-logs-filters">
        <div className="sensor-logs-search-wrap">
          <svg className="sensor-logs-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            className="sensor-logs-search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search sensor logs"
          />
        </div>

        {/* Sort & Filter flyout */}
        <div className="sl-sort-dropdown" ref={sortPanelRef}>
          <button
            type="button"
            className={`ghost-btn sl-sort-btn${sortPanelOpen ? " sl-sort-btn--active" : ""}`}
            onClick={() => setSortPanelOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={sortPanelOpen}
            aria-label="Sort and filter"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            Sort
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="sl-sort-chevron">
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {(tableSort.column !== "date" || tableSort.direction !== "desc" || tableNodeFilter !== "all" || tableDateFrom || tableDateTo) && (
              <span className="sl-sort-badge" aria-label="Filters active" />
            )}
          </button>

          {sortPanelOpen && (
            <div className="sl-sort-panel" role="menu">
              {/* Sort By */}
              <div className="sl-sort-section">
                <span className="sl-sort-section-label">Sort by</span>
                {[
                  { col: "date", dir: "desc", label: "Newest first" },
                  { col: "date", dir: "asc",  label: "Oldest first" },
                  { col: "wqi",  dir: "desc", label: "WQI (high to low)" },
                  { col: "wqi",  dir: "asc",  label: "WQI (low to high)" },
                ].map((opt) => {
                  const isActive = tableSort.column === opt.col && tableSort.direction === opt.dir;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      className={`sl-sort-item${isActive ? " sl-sort-item--active" : ""}`}
                      onClick={() => setTableSort({ column: opt.col, direction: opt.dir })}
                    >
                      {isActive && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <circle cx="6" cy="6" r="4" fill="currentColor"/>
                        </svg>
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="sl-sort-divider" />

              {/* Node filter */}
              <div className="sl-sort-section">
                <span className="sl-sort-section-label">Node</span>
                {[{ id: "all", label: "All nodes" }, ...nodes.map((n) => ({ id: n.id, label: `${n.id} — ${n.name || n.id}` }))].map((opt) => {
                  const isActive = tableNodeFilter === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      className={`sl-sort-item${isActive ? " sl-sort-item--active" : ""}`}
                      onClick={() => setTableNodeFilter(opt.id)}
                    >
                      {isActive && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <circle cx="6" cy="6" r="4" fill="currentColor"/>
                        </svg>
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="sl-sort-divider" />

              {/* Date range */}
              <div className="sl-sort-section sl-sort-section--dates">
                <span className="sl-sort-section-label">Date range</span>
                <label className="sl-sort-date-label">
                  From
                  <input
                    type="date"
                    className="sl-sort-date-input"
                    aria-label="From date"
                    value={tableDateFrom}
                    onChange={(e) => setTableDateFrom(e.target.value)}
                  />
                </label>
                <label className="sl-sort-date-label">
                  To
                  <input
                    type="date"
                    className="sl-sort-date-input"
                    aria-label="To date"
                    value={tableDateTo}
                    onChange={(e) => setTableDateTo(e.target.value)}
                  />
                </label>
                {(tableDateFrom || tableDateTo) && (
                  <button
                    type="button"
                    className="sl-sort-clear-dates"
                    onClick={() => { setTableDateFrom(""); setTableDateTo(""); }}
                  >
                    Clear dates
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="sensor-logs-export-wrap" ref={exportRef}>
          <button
            type="button"
            className="ghost-btn sensor-logs-export-btn"
            onClick={() => setExportOpen((o) => !o)}
            aria-expanded={exportOpen}
            aria-haspopup="true"
            aria-label="Export options"
          >
            Export <span className="sensor-logs-export-caret" aria-hidden>▼</span>
          </button>
          {exportOpen && (
            <div className="sensor-logs-export-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => handleExport("csv")}>
                Export as CSV
              </button>
              <button type="button" role="menuitem" onClick={() => handleExport("pdf")}>
                Export as PDF
              </button>
              <button type="button" role="menuitem" onClick={() => handleExport("text")}>
                Export as Text
              </button>
              <button type="button" role="menuitem" onClick={() => handleExport("excel")}>
                Export as Excel
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="ghost-btn sensor-logs-perf-btn"
          onClick={() => navigate("/performance-test")}
          aria-label="Performance Test"
        >
          Performance Test
        </button>
      </div>

      <section className="sensor-logs-table-card card">
        <div className="card__header">
          <h2 className="card__title">Sensor Readings</h2>
        </div>
        <div className="card__body" ref={cardBodyRef}>
          <div className="sensor-logs-data-table-wrap" ref={tableWrapRef}>
            <table className="sensor-logs-data-table" role="table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className={`sensor-logs-th-btn ${tableSort.column === "date" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() => setTableSort((s) => ({ column: "date", direction: s.column === "date" && s.direction === "desc" ? "asc" : "desc" }))}>
                      Date {tableSort.column === "date" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`sensor-logs-th-btn ${tableSort.column === "time" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() => setTableSort((s) => ({ column: "time", direction: s.column === "time" && s.direction === "desc" ? "asc" : "desc" }))}>
                      Time {tableSort.column === "time" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`sensor-logs-th-btn ${tableSort.column === "node" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() => setTableSort((s) => ({ column: "node", direction: s.column === "node" && s.direction === "asc" ? "desc" : "asc" }))}>
                      Node {tableSort.column === "node" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  {/* Desktop-only columns */}
                  <th className="sensor-logs-col-desktop">
                    <button type="button" className={`sensor-logs-th-btn ${tableSort.column === "temperature" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() => setTableSort((s) => ({ column: "temperature", direction: s.column === "temperature" && s.direction === "desc" ? "asc" : "desc" }))}>
                      Temp (°C) {tableSort.column === "temperature" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="sensor-logs-col-desktop">
                    <button type="button" className={`sensor-logs-th-btn ${tableSort.column === "pH" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() => setTableSort((s) => ({ column: "pH", direction: s.column === "pH" && s.direction === "desc" ? "asc" : "desc" }))}>
                      pH {tableSort.column === "pH" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="sensor-logs-col-desktop">
                    <button type="button" className={`sensor-logs-th-btn ${tableSort.column === "turbidity" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() => setTableSort((s) => ({ column: "turbidity", direction: s.column === "turbidity" && s.direction === "desc" ? "asc" : "desc" }))}>
                      Turbidity (NTU) {tableSort.column === "turbidity" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="sensor-logs-col-desktop">
                    <button type="button" className={`sensor-logs-th-btn ${tableSort.column === "dissolvedOxygen" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() => setTableSort((s) => ({ column: "dissolvedOxygen", direction: s.column === "dissolvedOxygen" && s.direction === "desc" ? "asc" : "desc" }))}>
                      Dissolved O₂ (mg/L) {tableSort.column === "dissolvedOxygen" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="sensor-logs-col-desktop">
                    <button type="button" className={`sensor-logs-th-btn ${tableSort.column === "nh3" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() => setTableSort((s) => ({ column: "nh3", direction: s.column === "nh3" && s.direction === "desc" ? "asc" : "desc" }))}>
                      NH₃ (mg/L) {tableSort.column === "nh3" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="sensor-logs-col-desktop">
                    <button type="button" className={`sensor-logs-th-btn ${tableSort.column === "flowRate" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() => setTableSort((s) => ({ column: "flowRate", direction: s.column === "flowRate" && s.direction === "desc" ? "asc" : "desc" }))}>
                      Flow (L/min) {tableSort.column === "flowRate" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`sensor-logs-th-btn ${tableSort.column === "wqi" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() => setTableSort((s) => ({ column: "wqi", direction: s.column === "wqi" && s.direction === "desc" ? "asc" : "desc" }))}>
                      WQI Score {tableSort.column === "wqi" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  {/* Mobile chevron column */}
                  <th className="sensor-logs-col-mobile" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {sensorTableRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="sensor-logs-data-table-empty">
                      No readings found. Try selecting a different date range, or check that monitoring nodes are active and sending data.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((row, i) => {
                    const key = `${row.nodeId}-${row.date.getTime()}-${(tablePage - 1) * pageSize + i}`;
                    const dateStr = row.date.toLocaleDateString();
                    const timeStr = row.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    const nodeLabel = row.nodeName !== row.nodeId ? `${row.nodeId} — ${row.nodeName}` : row.nodeId;
                    return (
                      <tr
                        key={key}
                        className={isMobile ? "sensor-logs-row-clickable" : ""}
                        onClick={isMobile ? () => setSelectedRow(row) : undefined}
                        tabIndex={isMobile ? 0 : undefined}
                        onKeyDown={isMobile ? (e) => e.key === "Enter" && setSelectedRow(row) : undefined}
                        aria-label={isMobile ? `View details for ${dateStr} ${timeStr}` : undefined}
                      >
                        <td>{highlightMatch(dateStr, search)}</td>
                        <td>{highlightMatch(timeStr, search)}</td>
                        <td>
                          <span className="sensor-logs-data-table-node-id">{highlightMatch(nodeLabel, search)}</span>
                        </td>
                        <td className="sensor-logs-col-desktop">{highlightMatch(row.temperature != null ? Number(row.temperature).toFixed(2) : "—", search)}</td>
                        <td className="sensor-logs-col-desktop">{highlightMatch(row.pH != null ? Number(row.pH).toFixed(2) : "—", search)}</td>
                        <td className="sensor-logs-col-desktop">{highlightMatch(row.turbidity != null ? Number(row.turbidity).toFixed(1) : "—", search)}</td>
                        <td className="sensor-logs-col-desktop">{highlightMatch(row.dissolvedOxygen != null ? Number(row.dissolvedOxygen).toFixed(2) : "—", search)}</td>
                        <td className="sensor-logs-col-desktop">{highlightMatch(row.nh3 != null ? formatNH3(row.nh3) : "—", search)}</td>
                        <td className="sensor-logs-col-desktop">{highlightMatch(row.flowRate != null ? Number(row.flowRate).toFixed(2) : "—", search)}</td>
                        <td>{highlightMatch(row.wqi != null ? row.wqi : "—", search)}</td>
                        <td className="sensor-logs-col-mobile sensor-logs-row-chevron" aria-hidden="true">›</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {totalRows > 0 && (
            <div className="sensor-logs-table-pagination">
              <span className="sensor-logs-table-pagination-info">
                Showing {(tablePage - 1) * pageSize + 1}–{Math.min(tablePage * pageSize, totalRows)} of {totalRows}
              </span>
              <div className="sensor-logs-table-pagination-btns">
                <button
                  type="button"
                  className="sensor-logs-table-pagination-btn"
                  onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                  disabled={tablePage <= 1}
                  aria-label="Previous page"
                >
                  <span className="sensor-logs-pagination-label">Previous</span>
                  <span className="sensor-logs-pagination-icon" aria-hidden="true">‹</span>
                </button>
                <span className="sensor-logs-table-pagination-page">
                  Page {tablePage} of {totalPages}
                </span>
                <button
                  type="button"
                  className="sensor-logs-table-pagination-btn"
                  onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
                  disabled={tablePage >= totalPages}
                  aria-label="Next page"
                >
                  <span className="sensor-logs-pagination-label">Next</span>
                  <span className="sensor-logs-pagination-icon" aria-hidden="true">›</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Mobile row detail bottom sheet */}
      {selectedRow && createPortal(
        <div className="sl-detail-overlay" onClick={closeDetail} role="presentation">
          <div
            className="sl-detail-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Reading details"
          >
            <div className="sl-detail-handle" />
            <div className="sl-detail-header">
              <div className="sl-detail-header-info">
                <span className="sl-detail-date">
                  {selectedRow.date.toLocaleDateString()} · {selectedRow.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <div className="sl-detail-node-row">
                  <span className="sl-detail-node">
                    {selectedRow.nodeName !== selectedRow.nodeId
                      ? `${selectedRow.nodeId} — ${selectedRow.nodeName}`
                      : selectedRow.nodeId}
                  </span>
                  {selectedRow.batteryVoltage != null && (
                    <span className="sl-detail-battery">
                      <BatteryIndicator voltage={selectedRow.batteryVoltage} showPercentage size="small" />
                    </span>
                  )}
                </div>
              </div>
              <button type="button" className="sl-detail-close" onClick={closeDetail} aria-label="Close">×</button>
            </div>
            <div className="sl-detail-grid">
              {[
                { label: "Temperature", value: selectedRow.temperature, unit: "°C" },
                { label: "pH", value: selectedRow.pH, unit: "" },
                { label: "Turbidity", value: selectedRow.turbidity, unit: "NTU" },
                { label: "Dissolved O₂", value: selectedRow.dissolvedOxygen, unit: "mg/L" },
                { label: "NH₃", value: selectedRow.nh3 != null ? formatNH3(selectedRow.nh3) : null, unit: "mg/L", preformatted: true },
                { label: "Flow Rate", value: selectedRow.flowRate, unit: "L/min" },
                { label: "WQI", value: selectedRow.wqi, unit: "", highlight: true },
              ].map(({ label, value, unit, highlight }) => (
                <div key={label} className={`sl-detail-item${highlight ? " sl-detail-item--highlight" : ""}`}>
                  <span className="sl-detail-item-label">{label}</span>
                  <span className="sl-detail-item-value">
                    {value != null ? `${value}${unit ? " " + unit : ""}` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
