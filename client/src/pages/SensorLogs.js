import React, { useState, useRef, useEffect, useMemo } from "react";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { getNH3FromReading } from "../utils/nh3Calculator";
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

const TABLE_PAGE_SIZE = 9;

export default function SensorLogs() {
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
  const [sensorReadings, setSensorReadings] = useState([]);
  const exportRef = useRef(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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
    const id = setInterval(() => setRefreshTrigger((t) => t + 1), 30 * 1000);
    return () => clearInterval(id);
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
  const totalPages = Math.max(1, Math.ceil(totalRows / TABLE_PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (tablePage - 1) * TABLE_PAGE_SIZE;
    return sensorTableRows.slice(start, start + TABLE_PAGE_SIZE);
  }, [sensorTableRows, tablePage]);

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
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
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
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta sensor-logs-header-meta" />
      </header>

      <div className="sensor-logs-filters">
        <input
          type="search"
          className="sensor-logs-search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search sensor logs"
        />
        <select
          className="sensor-logs-node-select"
          aria-label="Node filter"
          value={tableNodeFilter}
          onChange={(e) => setTableNodeFilter(e.target.value)}
        >
          <option value="all">All nodes</option>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.id} — {node.name || node.id}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="sensor-logs-date-input"
          aria-label="From date"
          value={tableDateFrom}
          onChange={(e) => setTableDateFrom(e.target.value)}
        />
        <input
          type="date"
          className="sensor-logs-date-input"
          aria-label="To date"
          value={tableDateTo}
          onChange={(e) => setTableDateTo(e.target.value)}
        />
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
      </div>

      <section className="sensor-logs-table-card card">
        <div className="card__header">
          <h2 className="card__title">Sensor data</h2>
          <p className="card__desc">All nodes and parameters, saved every hour. Use filters above to narrow results.</p>
        </div>
        <div className="card__body">
          <div className="sensor-logs-data-table-wrap">
            <table className="sensor-logs-data-table" role="table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className={`sensor-logs-th-btn ${tableSort.column === "date" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() =>
                        setTableSort((s) => ({
                          column: "date",
                          direction: s.column === "date" && s.direction === "desc" ? "asc" : "desc",
                        }))
                      }
                    >
                      Date {tableSort.column === "date" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sensor-logs-th-btn ${tableSort.column === "time" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() =>
                        setTableSort((s) => ({
                          column: "time",
                          direction: s.column === "time" && s.direction === "desc" ? "asc" : "desc",
                        }))
                      }
                    >
                      Time {tableSort.column === "time" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sensor-logs-th-btn ${tableSort.column === "node" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() =>
                        setTableSort((s) => ({
                          column: "node",
                          direction: s.column === "node" && s.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Node {tableSort.column === "node" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sensor-logs-th-btn ${tableSort.column === "temperature" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() =>
                        setTableSort((s) => ({
                          column: "temperature",
                          direction: s.column === "temperature" && s.direction === "desc" ? "asc" : "desc",
                        }))
                      }
                    >
                      Temp {tableSort.column === "temperature" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sensor-logs-th-btn ${tableSort.column === "pH" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() =>
                        setTableSort((s) => ({
                          column: "pH",
                          direction: s.column === "pH" && s.direction === "desc" ? "asc" : "desc",
                        }))
                      }
                    >
                      pH {tableSort.column === "pH" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sensor-logs-th-btn ${tableSort.column === "turbidity" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() =>
                        setTableSort((s) => ({
                          column: "turbidity",
                          direction: s.column === "turbidity" && s.direction === "desc" ? "asc" : "desc",
                        }))
                      }
                    >
                      Turb {tableSort.column === "turbidity" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sensor-logs-th-btn ${tableSort.column === "dissolvedOxygen" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() =>
                        setTableSort((s) => ({
                          column: "dissolvedOxygen",
                          direction: s.column === "dissolvedOxygen" && s.direction === "desc" ? "asc" : "desc",
                        }))
                      }
                    >
                      DO {tableSort.column === "dissolvedOxygen" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sensor-logs-th-btn ${tableSort.column === "nh3" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() =>
                        setTableSort((s) => ({
                          column: "nh3",
                          direction: s.column === "nh3" && s.direction === "desc" ? "asc" : "desc",
                        }))
                      }
                    >
                      NH₃ {tableSort.column === "nh3" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sensor-logs-th-btn ${tableSort.column === "flowRate" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() =>
                        setTableSort((s) => ({
                          column: "flowRate",
                          direction: s.column === "flowRate" && s.direction === "desc" ? "asc" : "desc",
                        }))
                      }
                    >
                      Flow {tableSort.column === "flowRate" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sensor-logs-th-btn ${tableSort.column === "wqi" ? "sensor-logs-th-btn--active" : ""}`}
                      onClick={() =>
                        setTableSort((s) => ({
                          column: "wqi",
                          direction: s.column === "wqi" && s.direction === "desc" ? "asc" : "desc",
                        }))
                      }
                    >
                      WQI {tableSort.column === "wqi" && (tableSort.direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sensorTableRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="sensor-logs-data-table-empty">
                      No data. Select a date range (or use From/To above) and ensure nodes exist.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((row, i) => {
                    const key = `${row.nodeId}-${row.date.getTime()}-${(tablePage - 1) * TABLE_PAGE_SIZE + i}`;
                    const dateStr = row.date.toLocaleDateString();
                    const timeStr = row.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    const nodeLabel = row.nodeName !== row.nodeId ? `${row.nodeId} — ${row.nodeName}` : row.nodeId;
                    return (
                      <tr key={key}>
                        <td>{highlightMatch(dateStr, search)}</td>
                        <td>{highlightMatch(timeStr, search)}</td>
                        <td>
                          <span className="sensor-logs-data-table-node-id">{highlightMatch(nodeLabel, search)}</span>
                        </td>
                        <td>{highlightMatch(row.temperature, search)}</td>
                        <td>{highlightMatch(row.pH, search)}</td>
                        <td>{highlightMatch(row.turbidity, search)}</td>
                        <td>{highlightMatch(row.dissolvedOxygen, search)}</td>
                        <td>{highlightMatch(row.nh3, search)}</td>
                        <td>{highlightMatch(row.flowRate, search)}</td>
                        <td>{highlightMatch(row.wqi != null ? row.wqi : "—", search)}</td>
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
                Showing {(tablePage - 1) * TABLE_PAGE_SIZE + 1}–{Math.min(tablePage * TABLE_PAGE_SIZE, totalRows)} of {totalRows}
              </span>
              <div className="sensor-logs-table-pagination-btns">
                <button
                  type="button"
                  className="sensor-logs-table-pagination-btn"
                  onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                  disabled={tablePage <= 1}
                  aria-label="Previous page"
                >
                  Previous
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
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
