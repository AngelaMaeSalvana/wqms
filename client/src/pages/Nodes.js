import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { isSupabaseEnabled } from "../lib/supabaseClient";
import { getNodes, loadNodes, saveNodes } from "../utils/nodesStorage";
import { sendEventNotification } from "../services/emailService";
import { PageLoader } from "../components/LoadingSkeleton";
import { NodeStatus } from "../components/dashboard/NodeStatus";
import { useNodeStatus } from "../hooks/useNodeStatus";
import "./Nodes.css";

const emptyNode = () => ({
  id: "",
  name: "",
  location: "",
  coords: "",
  lastMaintenance: "",
});

/** Get next node ID from existing nodes (e.g. N1, N2 → N3 or N-001 → N3). */
function getNextNodeId(nodes) {
  const numericParts = nodes
    .map((n) => {
      if (!n.id) return 0;
      const m = n.id.match(/^N-?(\d+)$/i);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter((num) => !isNaN(num));
  const nextNum = numericParts.length > 0 ? Math.max(...numericParts) + 1 : 1;
  return "N" + String(nextNum);
}

/** Parse "lat, lng" or "lat lng" (comma or space separated) into { lat, lng } or null. */
function parseCoordinates(str) {
  if (!str || typeof str !== "string") return null;
  const parts = str.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  if (isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

const NODES_PAGE_SIZE = 8;

export default function Nodes() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState([]);
  const [nodesPage, setNodesPage] = useState(1);
  const [newNode, setNewNode] = useState(emptyNode);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyNode);
  const [showAddModal, setShowAddModal] = useState(false);
  const [nodesSearch, setNodesSearch] = useState("");
  const [lastUpdated] = useState(() => new Date());
  const [isLoading, setIsLoading] = useState(true);

  const { nodeStatuses } = useNodeStatus(nodes);

  useEffect(() => {
    loadNodes().then(() => setNodes(getNodes())).finally(() => setIsLoading(false));
  }, []);
  useEffect(() => {
    const onFocus = () => loadNodes().then(() => setNodes(getNodes()));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (!showAddModal) return;
    const onEscape = (e) => {
      if (e.key === "Escape") setShowAddModal(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [showAddModal]);

  // Auto-fill next node ID for Add form
  const nextNodeId = getNextNodeId(nodes);
  const addFormId = newNode.id.trim() || nextNodeId;

  const inactiveCount = useMemo(() => nodes.filter((n) => n.active === false).length, [nodes]);

  const filteredNodes = useMemo(() => {
    const activeNodes = nodes.filter((n) => n.active !== false);
    const q = nodesSearch.trim().toLowerCase();
    if (!q) return activeNodes;
    return activeNodes.filter(
      (n) =>
        (n.id && n.id.toLowerCase().includes(q)) ||
        (n.name && n.name.toLowerCase().includes(q)) ||
        (n.location && n.location.toLowerCase().includes(q))
    );
  }, [nodes, nodesSearch]);

  const nodesTotalPages = Math.max(1, Math.ceil(filteredNodes.length / NODES_PAGE_SIZE));
  const nodesPageClamped = Math.min(nodesPage, nodesTotalPages);
  const paginatedNodes = filteredNodes.slice(
    (nodesPageClamped - 1) * NODES_PAGE_SIZE,
    nodesPageClamped * NODES_PAGE_SIZE
  );

  useEffect(() => {
    if (nodesPage > nodesTotalPages) setNodesPage(Math.max(1, nodesTotalPages));
  }, [nodesTotalPages, nodesPage]);

  useEffect(() => {
    setNodesPage(1);
  }, [nodesSearch]);

  if (isLoading) {
    return (
      <div className="nodes-page">
        <PageLoader />
      </div>
    );
  }

  const handleAdd = (e) => {
    e.preventDefault();
    const id = addFormId;
    const name = newNode.name.trim();
    const location = newNode.location.trim();
    const parsed = parseCoordinates(newNode.coords);
    if (!name || !location || !parsed) return;
    if (nodes.some((n) => n.id === id)) return; // avoid duplicate ID
    const node = {
      id,
      name,
      location,
      lat: parsed.lat,
      lng: parsed.lng,
      lastMaintenance: newNode.lastMaintenance ? new Date(newNode.lastMaintenance).toISOString() : null,
    };
    const next = [...nodes, node];
    setNodes(next);
    saveNodes(next);
    sendEventNotification("node_added", { node });
    setNewNode({ ...emptyNode(), id: getNextNodeId(next) });
    setShowAddModal(false);
  };

  const handleEdit = (node) => {
    setEditingId(node.id);
    const lat = node.lat != null ? node.lat : "";
    const lng = node.lng != null ? node.lng : "";
    const lastM = node.lastMaintenance ?? node.last_maintenance;
    setEditForm({
      id: node.id,
      name: node.name,
      location: node.location,
      coords: lat !== "" && lng !== "" ? `${lat}, ${lng}` : "",
      lastMaintenance: lastM ? (typeof lastM === "string" ? lastM.slice(0, 10) : new Date(lastM).toISOString().slice(0, 10)) : "",
    });
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    const id = editForm.id.trim();
    const name = editForm.name.trim();
    const location = editForm.location.trim();
    const parsed = parseCoordinates(editForm.coords);
    if (!id || !name || !location || !parsed) return;
    const node = {
      id,
      name,
      location,
      lat: parsed.lat,
      lng: parsed.lng,
      lastMaintenance: editForm.lastMaintenance ? new Date(editForm.lastMaintenance + "T00:00:00Z").toISOString() : null,
    };
    const next = nodes.map((n) => (n.id === editingId ? node : n));
    setNodes(next);
    saveNodes(next);
    setEditingId(null);
    setEditForm(emptyNode());
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm(emptyNode());
  };

  const handleDelete = (nodeId) => {
    const next = nodes.filter((n) => n.id !== nodeId);
    setNodes(next);
    saveNodes(next);
    if (editingId === nodeId) {
      setEditingId(null);
      setEditForm(emptyNode());
    }
  };

  const handleToggleActive = (nodeId) => {
    const next = nodes.map((n) =>
      n.id === nodeId ? { ...n, active: n.active === false ? true : false } : n
    );
    setNodes(next);
    saveNodes(next);
  };

  return (
    <div className="nodes-page">
      <header className="page-header nodes-page-header">
        <div>
          <h1 className="page-title">Nodes</h1>
          {isSupabaseEnabled() && (
            <p className="nodes-supabase-badge">Synced with database</p>
          )}
        </div>
        <div className="nodes-header-actions">
          <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta" showClassification={false} />
        </div>
      </header>

      {/* Mobile: Add node button (visible only on small screens) */}
      <button
        type="button"
        className="nodes-add-btn-mobile"
        onClick={() => setShowAddModal(true)}
        aria-label="Add node"
      >
        + Add node
      </button>

      <div className="nodes-content">
        {/* Add node card (hidden on mobile, shown on desktop) */}
        <section className="nodes-section card nodes-add-card">
          <div className="card__header nodes-add-card__header">
            <div>
              <h2 className="card__title">Add node</h2>
              <p className="card__desc">Create a new monitoring node with ID, name, location, and coordinates</p>
            </div>
            <button
              type="submit"
              form="nodes-add-form"
              className="nodes-btn nodes-btn--primary"
              aria-label="Add node"
            >
              Add node
            </button>
          </div>
          <div className="card__body">
            <form id="nodes-add-form" className="nodes-form" onSubmit={handleAdd}>
              <div className="nodes-form-grid">
                <label className="nodes-label">
                  <span>Node ID</span>
                  <input
                    type="text"
                    className="nodes-input nodes-input--readonly"
                    value={addFormId}
                    readOnly
                    aria-label="Node ID (auto-generated)"
                  />
                </label>
                <label className="nodes-label">
                  <span>Name</span>
                  <input
                    type="text"
                    className="nodes-input"
                    placeholder="e.g. River C - Outlet"
                    value={newNode.name}
                    onChange={(e) => setNewNode((n) => ({ ...n, name: e.target.value }))}
                    aria-label="Node name"
                  />
                </label>
                <label className="nodes-label">
                  <span>Location</span>
                  <input
                    type="text"
                    className="nodes-input"
                    placeholder="e.g. City or area"
                    value={newNode.location}
                    onChange={(e) => setNewNode((n) => ({ ...n, location: e.target.value }))}
                    aria-label="Location"
                  />
                </label>
                <label className="nodes-label nodes-label--full">
                  <span>Coordinates</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="nodes-input nodes-input-coords"
                    placeholder="e.g. 8.52, 124.70"
                    value={newNode.coords}
                    onChange={(e) => setNewNode((n) => ({ ...n, coords: e.target.value }))}
                    aria-label="Coordinates"
                  />
                </label>
              </div>
            </form>
          </div>
        </section>

        {/* All nodes list */}
        <section className="nodes-section card nodes-list-card">
          <div className="card__header">
            <div>
              <h2 className="card__title">All nodes</h2>
              <p className="card__desc">
                Edit or deactivate any node. Changes appear on the Map and Dashboard.
              </p>
            </div>
            <div className="nodes-list-header-right">
              <button
                type="button"
                className="nodes-btn nodes-btn--secondary nodes-inactive-link-btn"
                onClick={() => navigate("/nodes/inactive")}
                aria-label={`View inactive nodes${inactiveCount > 0 ? ` (${inactiveCount})` : ""}`}
              >
                Inactive Nodes
                {inactiveCount > 0 && (
                  <span className="nodes-inactive-count">{inactiveCount}</span>
                )}
              </button>
              <input
                type="search"
                className="nodes-search"
                placeholder="Search nodes…"
                value={nodesSearch}
                onChange={(e) => setNodesSearch(e.target.value)}
                aria-label="Search nodes"
              />
            </div>
          </div>
          <div className="card__body">
            <ul className="nodes-list">
              {paginatedNodes.map((n) =>
                editingId === n.id ? (
                  <li key={n.id} className="nodes-list-item nodes-list-item--editing">
                    <form className="nodes-edit-form" onSubmit={handleSaveEdit}>
                      <div className="nodes-edit-form-grid">
                        <label className="nodes-label">
                          <span>Node ID</span>
                          <input
                            type="text"
                            className="nodes-input"
                            value={editForm.id}
                            onChange={(e) => setEditForm((f) => ({ ...f, id: e.target.value }))}
                            aria-label="Node ID"
                          />
                        </label>
                        <label className="nodes-label">
                          <span>Name</span>
                          <input
                            type="text"
                            className="nodes-input"
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            aria-label="Node name"
                          />
                        </label>
                        <label className="nodes-label">
                          <span>Location</span>
                          <input
                            type="text"
                            className="nodes-input"
                            value={editForm.location}
                            onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))}
                            aria-label="Location"
                          />
                        </label>
                        <label className="nodes-label nodes-label--full">
                          <span>Coordinates</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="nodes-input nodes-input-coords"
                            placeholder="e.g. 8.52, 124.70"
                            value={editForm.coords}
                            onChange={(e) => setEditForm((f) => ({ ...f, coords: e.target.value }))}
                            aria-label="Coordinates"
                          />
                        </label>
                        <label className="nodes-label">
                          <span>Last maintenance</span>
                          <input
                            type="date"
                            className="nodes-input"
                            value={editForm.lastMaintenance}
                            onChange={(e) => setEditForm((f) => ({ ...f, lastMaintenance: e.target.value }))}
                            aria-label="Last maintenance date"
                          />
                        </label>
                      </div>
                      <div className="nodes-edit-form-actions">
                        <button type="button" className="nodes-btn nodes-btn--secondary" onClick={handleCancelEdit}>
                          Cancel
                        </button>
                        <button type="submit" className="nodes-btn nodes-btn--primary">
                          Save
                        </button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li key={n.id} className={`nodes-list-item${n.active === false ? " nodes-list-item--inactive" : ""}`}>
                    <div className="nodes-list-item__info">
                      <strong>{n.id}</strong> — {n.name} ({n.location})
                      <span className="nodes-list-item__meta">
                        {n.lat}, {n.lng}
                        {n.lastMaintenance || n.last_maintenance
                          ? ` · Last maintenance: ${new Date(n.lastMaintenance || n.last_maintenance).toLocaleDateString()}`
                          : ""}
                      </span>
                      {n.active === false && (
                        <span className="nodes-list-item__inactive-badge">Inactive</span>
                      )}
                    </div>
                    <NodeStatus status={n.active === false ? 'inactive' : (nodeStatuses[n.id] ?? 'offline')} />
                    <div className="nodes-list-item__actions">
                      <button
                        type="button"
                        className="nodes-btn nodes-btn--secondary nodes-btn--small"
                        onClick={() => handleEdit(n)}
                        aria-label={`Edit ${n.id}`}
                        disabled={n.active === false}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`nodes-btn nodes-btn--small ${n.active === false ? "nodes-btn--activate" : "nodes-btn--danger"}`}
                        onClick={() => handleToggleActive(n.id)}
                        aria-label={n.active === false ? `Activate ${n.id}` : `Deactivate ${n.id}`}
                      >
                        {n.active === false ? "Activate" : "Deactivate"}
                      </button>
                    </div>
                  </li>
                )
              )}
            </ul>
            {filteredNodes.length === 0 && (
              <p className="nodes-empty">{nodes.length === 0 ? "No nodes yet." : "No nodes match your search."}</p>
            )}
            {filteredNodes.length > 0 && nodesTotalPages > 1 && (
              <div className="nodes-pagination">
                <span className="nodes-pagination__info">
                  Page {nodesPageClamped} of {nodesTotalPages}
                  <span className="nodes-pagination__count">
                    {" "}({filteredNodes.length} node{filteredNodes.length !== 1 ? "s" : ""})
                  </span>
                </span>
                <div className="nodes-pagination__btns">
                  <button
                    type="button"
                    className="nodes-pagination__btn"
                    onClick={() => setNodesPage((p) => Math.max(1, p - 1))}
                    disabled={nodesPageClamped <= 1}
                    aria-label="Previous page"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="nodes-pagination__btn"
                    onClick={() => setNodesPage((p) => Math.min(nodesTotalPages, p + 1))}
                    disabled={nodesPageClamped >= nodesTotalPages}
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

      {/* Mobile: Add node modal */}
      {showAddModal && createPortal(
        <div
          className="nodes-add-modal-overlay"
          onClick={() => setShowAddModal(false)}
          role="presentation"
        >
          <div
            className="nodes-add-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="nodes-add-modal-title"
          >
            <div className="nodes-add-modal__header">
              <h2 id="nodes-add-modal-title">Add node</h2>
              <button
                type="button"
                className="nodes-add-modal__close"
                onClick={() => setShowAddModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form className="nodes-add-modal__form" onSubmit={handleAdd}>
              <div className="nodes-form-grid">
                <label className="nodes-label">
                  <span>Node ID</span>
                  <input
                    type="text"
                    className="nodes-input nodes-input--readonly"
                    value={addFormId}
                    readOnly
                    aria-label="Node ID (auto-generated)"
                  />
                </label>
                <label className="nodes-label">
                  <span>Name</span>
                  <input
                    type="text"
                    className="nodes-input"
                    placeholder="e.g. River C - Outlet"
                    value={newNode.name}
                    onChange={(e) => setNewNode((n) => ({ ...n, name: e.target.value }))}
                    aria-label="Node name"
                  />
                </label>
                <label className="nodes-label">
                  <span>Location</span>
                  <input
                    type="text"
                    className="nodes-input"
                    placeholder="e.g. City or area"
                    value={newNode.location}
                    onChange={(e) => setNewNode((n) => ({ ...n, location: e.target.value }))}
                    aria-label="Location"
                  />
                </label>
                <label className="nodes-label nodes-label--full">
                  <span>Coordinates</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="nodes-input nodes-input-coords"
                    placeholder="e.g. 8.52, 124.70"
                    value={newNode.coords}
                    onChange={(e) => setNewNode((n) => ({ ...n, coords: e.target.value }))}
                    aria-label="Coordinates"
                  />
                </label>
              </div>
              <div className="nodes-add-modal__actions">
                <button type="button" className="nodes-btn nodes-btn--secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="nodes-btn nodes-btn--primary">
                  Add node
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
