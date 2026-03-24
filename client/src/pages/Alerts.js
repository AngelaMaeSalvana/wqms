import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import PageDateWithStatus from "../components/PageDateWithStatus";
import AlertDetailModal from "../components/AlertDetailModal";
import EmptyState from "../components/EmptyState";
import { buildAlertsForAllNodes } from "../utils/alertsData";
import { useAlertEmailNotifications } from "../hooks/useAlertEmailNotifications";
import { useNodeStatus } from "../hooks/useNodeStatus";
import { getNodes, loadNodes } from "../utils/nodesStorage";
import api from "../services/api";
import { supabase } from "../lib/supabaseClient";
import { displayReadings } from "../utils/calibration";
import { exportToCSV, exportToExcel, formatAlertsForExport } from "../utils/exportData";
import { PageLoader } from "../components/LoadingSkeleton";
import "./Alerts.css";

/** Normalize a DB alert row to the shape the UI expects. */
function normalizeDbAlert(row) {
  return {
    id: row.id,
    nodeId: row.node_id ?? null,
    nodeName: row.node_name ?? null,
    type: row.type ?? null,
    title: row.title || "Alert",
    detail: row.detail || "",
    severity: row.severity || "info",
    parameter: row.parameter ?? null,
    value: row.value != null ? Number(row.value) : null,
    thresholdMin: row.threshold_min ?? null,
    thresholdMax: row.threshold_max ?? null,
    status: row.status ?? "active",
    timestamp: row.timestamp ? new Date(row.timestamp).getTime() : null,
    createdAt: row.created_at ?? row.timestamp ?? null,
  };
}

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
  const lastUpdated = useRef(new Date()).current;
  const [nodes, setNodes] = useState([]);
  const { nodeStatuses } = useNodeStatus(nodes);
  const [readingsByNode, setReadingsByNode] = useState({});
  const [alerts, setAlerts] = useState([]);
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const exportDropdownRef = useRef(null);
  const filtersDropdownRef = useRef(null);

  useEffect(() => {
    loadNodes().then(() => setNodes(getNodes()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    async function loadAlerts() {
      // 1. Load nodes + today's readings in parallel.
      const [loadedNodes] = await Promise.all([
        loadNodes().then(() => getNodes()),
      ]);

      const today = toDateStr(new Date());
      let byNode = {};
      let prevByNode = {};
      try {
        const rows = await api.getReadings({ startDate: today, endDate: today, monitoringOnly: true, limit: 200 });
        const list = displayReadings(Array.isArray(rows) ? rows : []);
        // Sort ascending so we can pick latest and second-latest per node.
        const sorted = [...list].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        sorted.forEach((r) => {
          const nid = r.node_id || r.nodeId || "1";
          const reading = {
            temperature: r.temperature,
            pH: r.ph, ph: r.ph,
            turbidity: r.turbidity,
            dissolvedOxygen: r.dissolved_oxygen,
            dissolved_oxygen: r.dissolved_oxygen,
            do: r.dissolved_oxygen,
            nh3: r.nh3, NH3: r.nh3,
            timestamp: r.timestamp,
          };
          if (byNode[nid]) {
            // byNode already has an earlier reading — push it to prev before replacing
            prevByNode[nid] = byNode[nid];
          }
          byNode[nid] = reading;
        });
      } catch { /* readings unavailable — still show DB alerts */ }

      if (!cancelled) setReadingsByNode(byNode);

      // 2. Detect live threshold/status alerts and upsert them to the DB.
      const liveAlerts = buildAlertsForAllNodes(loadedNodes, byNode, nodeStatuses, prevByNode);
      if (liveAlerts.length > 0) {
        try { await api.upsertAlerts(liveAlerts); } catch { /* non-fatal */ }
      }

      // 3. Fetch the full persisted alerts list from the DB.
      try {
        const dbRows = await api.getAlerts({ limit: 500 });
        if (!cancelled) setAlerts((Array.isArray(dbRows) ? dbRows : []).map(normalizeDbAlert));
      } catch {
        // Fallback: show live-computed alerts if DB fetch fails.
        if (!cancelled) setAlerts(liveAlerts);
      }

      if (!cancelled) setIsLoading(false);
    }

    loadAlerts();
    return () => { cancelled = true; };
  }, [nodeStatuses]);

  useAlertEmailNotifications(alerts, readingsByNode, nodeStatuses);

  // Realtime: prepend newly inserted alert rows without a full page refresh.
  const handleNewAlert = useCallback((payload) => {
    const row = payload.new;
    if (!row) return;
    const normalized = normalizeDbAlert(row);
    setAlerts((prev) => {
      // Deduplicate by id to guard against duplicate events.
      if (prev.some((a) => a.id === normalized.id)) return prev;
      return [normalized, ...prev];
    });
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('alerts_live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts' },
        handleNewAlert
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] alerts_live channel subscribed');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] alerts_live channel error:', status);
        }
      });
    return () => supabase.removeChannel(channel);
  }, [handleNewAlert]);

  const filteredAlerts = useMemo(() => {
    let list = [...alerts];
    // Node Offline: only show while node is offline; hide when it comes back online.
    list = list.filter(
      (a) =>
        (a.type || '').toLowerCase() !== 'node' ||
        nodeStatuses[a.nodeId ?? a.node_id] !== 'online'
    );
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
  }, [alerts, search, severityFilter, dateFrom, dateTo, sortBy, nodeStatuses]);

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

  useEffect(() => {
    if (!filtersOpen) return;
    const handleClickOutside = (e) => {
      if (filtersDropdownRef.current && !filtersDropdownRef.current.contains(e.target)) {
        setFiltersOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filtersOpen]);

  const exportData = useMemo(() => formatAlertsForExport(filteredAlerts), [filteredAlerts]);

  const handleExportExcel = () => {
    if (exportData.length > 0) exportToExcel(exportData, "wqms-alerts");
    setExportOpen(false);
  };

  const handleExportCsv = () => {
    if (exportData.length > 0) exportToCSV(exportData, "wqms-alerts");
    setExportOpen(false);
  };


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

  if (isLoading) {
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
          <p className="page-subtitle">Monitor and manage system alerts</p>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta" showClassification={false} />
      </header>

      <div className="alerts-toolbar">
        <div className="alerts-search-wrap">
          <svg className="alerts-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            className="alerts-search"
            placeholder="Search alerts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search alerts"
          />
        </div>

        <div className="alerts-toolbar-actions">
          {/* Sort & Filter flyout */}
          <div className="alerts-filters-dropdown" ref={filtersDropdownRef}>
            <button
              type="button"
              className={`alerts-toolbar-btn${filtersOpen ? " alerts-toolbar-btn--active" : ""}`}
              onClick={() => setFiltersOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={filtersOpen}
              aria-label="Sort and filter"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              Sort
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="alerts-toolbar-chevron">
                <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {(severityFilter !== "all" || dateFrom || dateTo || sortBy !== "newest") && (
                <span className="alerts-filters-badge" aria-label="Filters active" />
              )}
            </button>

            {filtersOpen && (
              <div className="alerts-filters-panel" role="menu">
                <div className="alerts-filters-panel-section">
                  <span className="alerts-filters-panel-label">Sort by</span>
                  {[
                    { value: "newest", label: "Newest first" },
                    { value: "oldest", label: "Oldest first" },
                    { value: "severity", label: "Severity" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortBy === opt.value}
                      className={`alerts-filters-panel-item${sortBy === opt.value ? " alerts-filters-panel-item--active" : ""}`}
                      onClick={() => setSortBy(opt.value)}
                    >
                      {sortBy === opt.value && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <circle cx="6" cy="6" r="4" fill="currentColor"/>
                        </svg>
                      )}
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="alerts-filters-panel-divider" />

                <div className="alerts-filters-panel-section">
                  <span className="alerts-filters-panel-label">Severity</span>
                  {[
                    { value: "all", label: "All severities" },
                    { value: "high", label: "High" },
                    { value: "medium", label: "Medium" },
                    { value: "low", label: "Low" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={severityFilter === opt.value}
                      className={`alerts-filters-panel-item${severityFilter === opt.value ? " alerts-filters-panel-item--active" : ""}`}
                      onClick={() => setSeverityFilter(opt.value)}
                    >
                      {severityFilter === opt.value && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <circle cx="6" cy="6" r="4" fill="currentColor"/>
                        </svg>
                      )}
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="alerts-filters-panel-divider" />

                <div className="alerts-filters-panel-section alerts-filters-panel-section--dates">
                  <span className="alerts-filters-panel-label">Date range</span>
                  <label className="alerts-filters-date-label">
                    From
                    <input
                      type="date"
                      className="alerts-filters-date-input"
                      aria-label="From date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </label>
                  <label className="alerts-filters-date-label">
                    To
                    <input
                      type="date"
                      className="alerts-filters-date-input"
                      aria-label="To date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </label>
                  {(dateFrom || dateTo) && (
                    <button
                      type="button"
                      className="alerts-filters-clear-dates"
                      onClick={() => { setDateFrom(""); setDateTo(""); }}
                    >
                      Clear dates
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Mark all as read */}
          {filteredAlerts.some((a) => !readIds.has(a.id || a.timestamp)) && (
            <button
              type="button"
              className="alerts-toolbar-btn"
              onClick={() => markAllAsRead(filteredAlerts.map((a) => a.id || a.timestamp))}
              aria-label="Mark all alerts as read"
            >
              Mark all as read
            </button>
          )}

          {/* Export */}
          <div className="alerts-export-dropdown" ref={exportDropdownRef}>
            <button
              type="button"
              className={`alerts-toolbar-btn${exportOpen ? " alerts-toolbar-btn--active" : ""}`}
              onClick={() => setExportOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={exportOpen}
              aria-label="Export filtered alerts"
            >
              Export
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="alerts-toolbar-chevron">
                <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
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

      <section className={`alerts-grid card alerts-notifications-panel ${filteredAlerts.length === 0 ? "alerts-grid--empty" : ""}`}>
        <div className="card__body alerts-notifications-body">
          {filteredAlerts.length === 0 ? (
            <EmptyState
              icon={
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
              }
              title="No alerts"
              message={
                alerts.length === 0
                  ? "No alerts — all systems operating normally."
                  : "No alerts match your filters. Alerts are generated from threshold breaches, node status (offline/testing), and maintenance due."
              }
            />
          ) : (
            <>
              <ul className="alerts-tab-list alerts-notifications-list" aria-label="Alerts list">
                {filteredAlerts.map((a) => {
                  const alertId = a.id || a.timestamp;
                  const isUnread = !readIds.has(alertId);
                  // Maintenance due → blue "Due"; Node offline → magenta "URGENT"; params use severity
                  const alertType = a.type || "";
                  const alertClass = alertType === "maintenance" ? "maintenance" : alertType === "node" ? "urgent" : (a.severity || "info").toLowerCase();
                  const badgeLabel = alertType === "maintenance" ? "Due" : alertType === "node" ? "URGENT" : (a.severity || "info");
                  return (
                    <li key={a.id} className="alerts-tab-list__item alerts-notifications-item">
                      <button
                        type="button"
                        className={`alert alert--${alertClass} alert--clickable alerts-tab-alert alerts-notification-item`}
                        onClick={() => {
                          markAsRead(alertId);
                          setSelectedAlert(a);
                        }}
                        aria-label={`View details: ${a.title || "Alert"}`}
                      >
                        {isUnread && <span className="alerts-notification-dot" aria-hidden />}
                        <span className="alerts-notification-content">
                          <span className="alerts-notification-row">
                            <span className="alert-title">{a.title || "Alert"}</span>
                            <span className={`alerts-severity-badge alerts-severity-badge--${alertClass}`}>
                              {badgeLabel}
                            </span>
                          </span>
                          {a.detail && <span className="alert-detail">{a.detail}</span>}
                          <span className="alerts-notification-meta">
                            {a.nodeName && <span className="alert-node">{a.nodeName}</span>}
                            <span className="alert-date">{getRelativeTime(a.timestamp || a.createdAt)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
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
