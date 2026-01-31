import React, { useMemo, useState, useEffect } from "react";
import PageDateWithStatus from "../components/PageDateWithStatus";
import AlertDetailModal from "../components/AlertDetailModal";
import { buildAlertsForAllNodes } from "../utils/alertsData";
import { getNodes } from "../utils/nodesStorage";
import "./Alerts.css";

function formatDateShort(d) {
  if (!d) return "—";
  const date = typeof d === "number" ? new Date(d) : new Date(d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Alerts() {
  const lastUpdated = new Date();
  const [nodes, setNodes] = useState(getNodes);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedAlert, setSelectedAlert] = useState(null);

  useEffect(() => {
    const onFocus = () => setNodes(getNodes());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const allAlerts = useMemo(() => buildAlertsForAllNodes(nodes), [nodes]);

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

  return (
    <div className="alerts-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-subtitle">All alerts and notifications for all nodes — thresholds, node status, maintenance</p>
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
      </div>

      <section className="alerts-grid card">
        <div className="card__header">
          <h2 className="card__title">Alerts</h2>
          <p className="card__desc">
            {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? "s" : ""} from all nodes. Click an alert for details.
          </p>
        </div>
        <div className="card__body">
          {filteredAlerts.length === 0 ? (
            <div className="alerts-grid-placeholder">
              No alerts match your filters. Alerts are generated from threshold breaches, node status (offline/testing), and maintenance due.
            </div>
          ) : (
            <ul className="alerts-tab-list" aria-label="Alerts list">
              {filteredAlerts.map((a) => (
                <li key={a.id} className="alerts-tab-list__item">
                  <button
                    type="button"
                    className={`alert alert--${(a.severity || "info").toLowerCase()} alert--clickable alerts-tab-alert`}
                    onClick={() => setSelectedAlert(a)}
                    aria-label={`View details: ${a.title || "Alert"}`}
                  >
                    <span className="alert-title">{a.title || "Alert"}</span>
                    <span className="alert-detail">{a.detail || a.message || ""}</span>
                    {a.nodeName && <span className="alert-node">Node: {a.nodeName}</span>}
                    <span className="alert-date">{formatDateShort(a.timestamp || a.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {selectedAlert && (
        <AlertDetailModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      )}
    </div>
  );
}
