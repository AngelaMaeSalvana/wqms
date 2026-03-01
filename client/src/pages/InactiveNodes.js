import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { isSupabaseEnabled } from "../lib/supabaseClient";
import { getNodes, loadNodes, saveNodes } from "../utils/nodesStorage";
import { PageLoader } from "../components/LoadingSkeleton";
import "./InactiveNodes.css";

export default function InactiveNodes() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState([]);
  const [search, setSearch] = useState("");
  const [lastUpdated] = useState(() => new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    loadNodes().then(() => setNodes(getNodes())).finally(() => setIsLoading(false));
  }, []);
  useEffect(() => {
    const onFocus = () => loadNodes().then(() => setNodes(getNodes()));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const inactiveNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inactive = nodes.filter((n) => n.active === false);
    if (!q) return inactive;
    return inactive.filter(
      (n) =>
        (n.id && n.id.toLowerCase().includes(q)) ||
        (n.name && n.name.toLowerCase().includes(q)) ||
        (n.location && n.location.toLowerCase().includes(q))
    );
  }, [nodes, search]);

  const handleActivate = (nodeId) => {
    const next = nodes.map((n) =>
      n.id === nodeId ? { ...n, active: true } : n
    );
    setNodes(next);
    saveNodes(next);
  };

  const handleDelete = (nodeId) => {
    const next = nodes.filter((n) => n.id !== nodeId);
    setNodes(next);
    saveNodes(next);
    setConfirmDelete(null);
  };

  if (isLoading) {
    return (
      <div className="inactive-nodes-page">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="inactive-nodes-page">
      <header className="page-header inactive-nodes-page-header">
        <div className="inactive-nodes-header-left">
          <button
            type="button"
            className="inactive-nodes-back-btn"
            onClick={() => navigate("/nodes")}
            aria-label="Back to Nodes"
          >
            ← Back
          </button>
          <div>
            <h1 className="page-title">Inactive Nodes</h1>
            {isSupabaseEnabled() && (
              <p className="inactive-nodes-supabase-badge">Synced with database</p>
            )}
          </div>
        </div>
        <div className="inactive-nodes-header-actions">
          <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta" showClassification={false} />
        </div>
      </header>

      <section className="card inactive-nodes-card">
        <div className="card__header inactive-nodes-card-header">
          <div>
            <h2 className="card__title">Deactivated nodes</h2>
            <p className="card__desc">
              These nodes are hidden from the Map and Dashboard. Activate them to restore monitoring.
            </p>
          </div>
          <input
            type="search"
            className="inactive-nodes-search"
            placeholder="Search nodes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search inactive nodes"
          />
        </div>
        <div className="card__body">
          {inactiveNodes.length === 0 ? (
            <div className="inactive-nodes-empty">
              {nodes.filter((n) => n.active === false).length === 0
                ? "No inactive nodes. Deactivate a node from the Nodes page to see it here."
                : "No inactive nodes match your search."}
            </div>
          ) : (
            <ul className="inactive-nodes-list">
              {inactiveNodes.map((n) => (
                <li key={n.id} className="inactive-nodes-item">
                  <div className="inactive-nodes-item__info">
                    <div className="inactive-nodes-item__title">
                      <strong>{n.id}</strong>
                      <span className="inactive-nodes-item__name">
                        {n.name && `— ${n.name}`}
                      </span>
                      <span className="inactive-nodes-badge">Inactive</span>
                    </div>
                    <span className="inactive-nodes-item__meta">
                      {n.location && `${n.location}`}
                      {n.lat != null && n.lng != null && ` · ${n.lat}, ${n.lng}`}
                      {(n.lastMaintenance || n.last_maintenance) &&
                        ` · Last maintenance: ${new Date(
                          n.lastMaintenance || n.last_maintenance
                        ).toLocaleDateString()}`}
                    </span>
                  </div>
                  <div className="inactive-nodes-item__actions">
                    <button
                      type="button"
                      className="inactive-nodes-btn inactive-nodes-btn--activate"
                      onClick={() => handleActivate(n.id)}
                      aria-label={`Activate ${n.id}`}
                    >
                      Activate
                    </button>
                    <button
                      type="button"
                      className="inactive-nodes-btn inactive-nodes-btn--danger"
                      onClick={() => setConfirmDelete(n.id)}
                      aria-label={`Delete ${n.id}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {confirmDelete && (
        <div
          className="inactive-nodes-confirm-overlay"
          onClick={() => setConfirmDelete(null)}
          role="presentation"
        >
          <div
            className="inactive-nodes-confirm-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
          >
            <h3 id="confirm-delete-title">Delete node {confirmDelete}?</h3>
            <p>This will permanently remove the node. This action cannot be undone.</p>
            <div className="inactive-nodes-confirm-actions">
              <button
                type="button"
                className="inactive-nodes-btn inactive-nodes-btn--secondary"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inactive-nodes-btn inactive-nodes-btn--danger"
                onClick={() => handleDelete(confirmDelete)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
