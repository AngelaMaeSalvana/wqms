import React, { useMemo, useState, useEffect, useRef } from "react";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import PageDateWithStatus from "../components/PageDateWithStatus";
import AlertDetailModal from "../components/AlertDetailModal";
import { buildAlertsForAllNodes } from "../utils/alertsData";
import { getNodes, loadNodes } from "../utils/nodesStorage";
import api from "../services/api";
import { applyCalibrationToReadings } from "../utils/calibration";
import { exportToCSV, exportToExcel, formatAlertsForExport } from "../utils/exportData";
import { PageLoader } from "../components/LoadingSkeleton";
import "./Alerts.css";

function toDateStr(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateShort(d) {
  if (!d) return "—";
  const date = typeof d === "number" ? new Date(d) : new Date(d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ALERTS_READ_KEY = "wqms_alerts_read_ids";

function loadReadIds() {
  try {
    const s = localStorage.getItem(ALERTS_READ_KEY);
    if (s) {
      const arr = JSON.parse(s);
      return new Set(Array.isArray(arr) ? arr : []);
    }
  } catch (e) {
    console.warn("Could not load read alerts", e);
  }
  return new Set();
}

function saveReadIds(ids) {
  try {
    localStorage.setItem(ALERTS_READ_KEY, JSON.stringify([...ids]));
  } catch (e) {
    console.warn("Could not save read alerts", e);
  }
}

function getRelativeTime(date) {
  if (!date) return "—";
  const d = typeof date === "number" ? new Date(date) : new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "Now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function Alerts() {
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [nodes, setNodes] = useState([]);
  const [readingsByNode, setReadingsByNode] = useState({});
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [readIds, setReadIds] = useState(loadReadIds);

  const markAsRead = (id) => {
    setReadIds((prev) => {
      const next = new Set([...prev, id]);
      saveReadIds(next);
      return next;
    });
  };

  const markAllAsRead = (ids) => {
    const next = new Set(ids);
    saveReadIds(next);
    setReadIds(next);
  };
  const [exportOpen, setExportOpen] = useState(false);
  const [nodesLoaded, setNodesLoaded] = useState(false);
  const [readingsLoaded, setReadingsLoaded] = useState(false);
  const exportDropdownRef = useRef(null);

  useEffect(() => {
    loadNodes().then(() => setNodes(getNodes())).finally(() => setNodesLoaded(true));
  }, []);
  useEffect(() => {
    const onFocus = () => loadNodes().then(() => setNodes(getNodes()));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Fetch today's readings so threshold alerts appear (same pattern as Dashboard).
  useEffect(() => {
    setReadingsLoaded(false);
    const today = toDateStr(new Date());
    api.getReadings({ startDate: today, endDate: today, limit: 200 })
      .then((rows) => {
        const list = applyCalibrationToReadings(Array.isArray(rows) ? rows : []);
        const byNode = {};
        list.forEach((r) => {
          const nid = r.node_id || r.nodeId || "1";
          if (!byNode[nid] || new Date(r.timestamp) > new Date(byNode[nid].timestamp)) {
            byNode[nid] = {
              temperature: r.temperature,
              pH: r.ph,
              ph: r.ph,
              turbidity: r.turbidity,
              dissolvedOxygen: r.dissolved_oxygen,
              dissolved_oxygen: r.dissolved_oxygen,
              do: r.dissolved_oxygen,
              nh3: r.nh3,
              NH3: r.nh3,
            };
          }
        });
        setReadingsByNode(byNode);
      })
      .catch(() => setReadingsByNode({}))
      .finally(() => setReadingsLoaded(true));
  }, [lastUpdated]);

  const allAlerts = useMemo(() => buildAlertsForAllNodes(nodes, readingsByNode), [nodes, readingsByNode]);

  const filteredAlerts = useMemo(() => {
    let list = [...allAlerts];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          (a.title && a.title.toLowerCase().includes(q)) ||
          (a.detail && a.detail.toLowerCase().includes(q)) ||
          (a.nodeName && a.nodeName.toLowerCase().includes(q)) ||
          (a.nodeId && a.nodeId.toLowerCase().includes(q)) ||
          (a.type && a.type.toLowerCase().includes(q))
      );
    }
    if (severityFilter && severityFilter !== "all") {
      list = list.filter((a) => (a.severity || "info").toLowerCase() === severityFilter.toLowerCase());
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      list = list.filter((a) => (a.timestamp ? new Date(a.timestamp) : new Date(a.createdAt)) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter((a) => (a.timestamp ? new Date(a.timestamp) : new Date(a.createdAt)) <= to);
    }
    if (sortBy === "oldest") {
      list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    } else if (sortBy === "severity") {
      const order = { high: 0, medium: 1, low: 2, info: 3 };
      list.sort((a, b) => (order[(a.severity || "info").toLowerCase()] ?? 3) - (order[(b.severity || "info").toLowerCase()] ?? 3));
    } else {
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
    return list;
  }, [allAlerts, search, severityFilter, dateFrom, dateTo, sortBy]);

  useEffect(() => {
    if (!exportOpen) return;
    const handleClickOutside = (e) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [exportOpen]);

  const exportData = useMemo(() => formatAlertsForExport(filteredAlerts), [filteredAlerts]);

  const handleExportExcel = () => {
    if (exportData.length > 0) exportToExcel(exportData, "wqms-alerts");
    setExportOpen(false);
  };

  const handleExportCsv = () => {
    if (exportData.length > 0) exportToCSV(exportData, "wqms-alerts");
    setExportOpen(false);
  };

  const isPageLoading = !nodesLoaded || !readingsLoaded;

  const handleExportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(10);
    doc.text("WQMS Alerts", 14, 12);
    doc.text(`Exported: ${new Date().toLocaleString()}  |  ${filteredAlerts.length} alert(s)`, 14, 18);
    const headers = [["Title", "Detail", "Severity", "Timestamp"]];
    const rows =
      filteredAlerts.length > 0
        ? filteredAlerts.map((a) => [
            (a.title || "—").slice(0, 40),
            (a.detail || "—").slice(0, 50),
            (a.severity || "—").toString(),
            a.timestamp || a.createdAt
              ? new Date(a.timestamp || a.createdAt).toLocaleString()
              : "—",
          ])
        : [["No alerts match current filters."]];
    autoTable(doc, {
      head: headers,
      body: rows,
      startY: 24,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [27, 156, 133] },
    });
    doc.save(`wqms-alerts-${new Date().toISOString().split("T")[0]}.pdf`);
    setExportOpen(false);
  };

  if (isPageLoading) {
    return (
      <div className="alerts-page">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="alerts-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Alerts</h1>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta" />
      </header>

      <div className="alerts-filters">
        <input
          type="search"
          className="alerts-search"
          placeholder="Search alerts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search alerts"
        />
        <select
          className="metric-select"
          aria-label="Severity filter"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="all">All severities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          type="date"
          className="date-input"
          aria-label="From date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />
        <input
          type="date"
          className="date-input"
          aria-label="To date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />
        <select
          className="metric-select alerts-sort"
          aria-label="Sort by"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="severity">Severity</option>
        </select>
        <div className="alerts-export-wrap">
          <div className="alerts-export-dropdown" ref={exportDropdownRef}>
            <button
              type="button"
              className="alerts-export-btn"
              onClick={() => setExportOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={exportOpen}
              aria-label="Export filtered alerts"
            >
              Export <span className="alerts-export-chevron">▼</span>
            </button>
            {exportOpen && (
              <div className="alerts-export-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="alerts-export-menu-item"
                  onClick={handleExportExcel}
                  disabled={filteredAlerts.length === 0}
                >
                  Export as Excel
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="alerts-export-menu-item"
                  onClick={handleExportCsv}
                  disabled={filteredAlerts.length === 0}
                >
                  Export as CSV
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="alerts-export-menu-item"
                  onClick={handleExportPdf}
                >
                  Export as PDF
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="alerts-grid card alerts-notifications-panel">
        <div className="card__body alerts-notifications-body">
          {filteredAlerts.length === 0 ? (
            <div className="alerts-grid-placeholder">
              No alerts match your filters. Alerts are generated from threshold breaches, node status (offline/testing), and maintenance due.
            </div>
          ) : (
            <>
              <ul className="alerts-tab-list alerts-notifications-list" aria-label="Alerts list">
                {filteredAlerts.map((a) => {
                  const alertId = a.id || a.timestamp;
                  const isUnread = !readIds.has(alertId);
                  return (
                    <li key={a.id} className="alerts-tab-list__item alerts-notifications-item">
                      <button
                        type="button"
                        className={`alert alert--${(a.severity || "info").toLowerCase()} alert--clickable alerts-tab-alert alerts-notification-item`}
                        onClick={() => {
                          markAsRead(alertId);
                          setSelectedAlert(a);
                        }}
                        aria-label={`View details: ${a.title || "Alert"}`}
                      >
                        {isUnread && <span className="alerts-notification-dot" aria-hidden />}
                        <span className="alerts-notification-content">
                          <span className="alert-title">{a.title || "Alert"}</span>
                          {a.detail && <span className="alert-detail">{a.detail}</span>}
                          {a.nodeName && <span className="alert-node">Node: {a.nodeName}</span>}
                          <span className="alert-date">{getRelativeTime(a.timestamp || a.createdAt)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {filteredAlerts.some((a) => !readIds.has(a.id || a.timestamp)) && (
                <button
                  type="button"
                  className="alerts-mark-all-read"
                  onClick={() => markAllAsRead(filteredAlerts.map((a) => a.id || a.timestamp))}
                >
                  Mark all as read
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {selectedAlert && (
        <AlertDetailModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      )}
    </div>
  );
}
