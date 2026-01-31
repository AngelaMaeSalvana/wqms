import React, { useState, useEffect } from "react";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { getNodes, saveNodes } from "../utils/nodesStorage";
import "./Nodes.css";

const emptyNode = () => ({
  id: "",
  name: "",
  location: "",
  status: "online",
  coords: "",
});

/** Get next node ID from existing nodes (e.g. N-001, N-002 → N-003). */
function getNextNodeId(nodes) {
  const prefix = "N-";
  const numericParts = nodes
    .map((n) => n.id && n.id.startsWith(prefix) ? parseInt(n.id.slice(prefix.length), 10) : 0)
    .filter((num) => !isNaN(num));
  const nextNum = numericParts.length > 0 ? Math.max(...numericParts) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(3, "0")}`;
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

export default function Nodes() {
  const [nodes, setNodes] = useState(getNodes);
  const [newNode, setNewNode] = useState(emptyNode);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyNode);
  const [lastUpdated] = useState(() => new Date());

  useEffect(() => {
    const onFocus = () => setNodes(getNodes());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Auto-fill next node ID for Add form
  const nextNodeId = getNextNodeId(nodes);
  const addFormId = newNode.id.trim() || nextNodeId;

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
      status: newNode.status || "online",
      lat: parsed.lat,
      lng: parsed.lng,
    };
    const next = [...nodes, node];
    setNodes(next);
    saveNodes(next);
    setNewNode({ ...emptyNode(), id: getNextNodeId(next) });
  };

  const handleEdit = (node) => {
    setEditingId(node.id);
    const lat = node.lat != null ? node.lat : "";
    const lng = node.lng != null ? node.lng : "";
    setEditForm({
      id: node.id,
      name: node.name,
      location: node.location,
      status: node.status || "online",
      coords: lat !== "" && lng !== "" ? `${lat}, ${lng}` : "",
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
      status: editForm.status || "online",
      lat: parsed.lat,
      lng: parsed.lng,
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

  return (
    <div className="nodes-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Nodes</h1>
          <p className="page-subtitle">Add, edit, or remove monitoring nodes. They appear on the Map and Dashboard.</p>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta" />
      </header>

      <div className="nodes-content">
        {/* Add node card */}
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
                <label className="nodes-label">
                  <span>Status</span>
                  <select
                    className="nodes-input nodes-select"
                    value={newNode.status}
                    onChange={(e) => setNewNode((n) => ({ ...n, status: e.target.value }))}
                    aria-label="Node status"
                  >
                    <option value="online">Online</option>
                    <option value="testing">Testing</option>
                    <option value="offline">Offline</option>
                  </select>
                </label>
                <label className="nodes-label nodes-label--full">
                  <span>Coordinates</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="nodes-input nodes-input-coords"
                    placeholder="e.g. 8.52, 124.70  (paste from Google Maps: right‑click map → coordinates)"
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
            <h2 className="card__title">All nodes</h2>
            <p className="card__desc">
              Edit or delete any node. Changes appear on the Map and Dashboard.
            </p>
          </div>
          <div className="card__body">
            <ul className="nodes-list">
              {nodes.map((n) =>
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
                        <label className="nodes-label">
                          <span>Status</span>
                          <select
                            className="nodes-input nodes-select"
                            value={editForm.status}
                            onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                            aria-label="Status"
                          >
                            <option value="online">Online</option>
                            <option value="testing">Testing</option>
                            <option value="offline">Offline</option>
                          </select>
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
                  <li key={n.id} className="nodes-list-item">
                    <div className="nodes-list-item__info">
                      <strong>{n.id}</strong> — {n.name} ({n.location})
                      <span className="nodes-list-item__meta">
                        {n.lat}, {n.lng} · {n.status}
                      </span>
                    </div>
                    <div className="nodes-list-item__actions">
                      <button
                        type="button"
                        className="nodes-btn nodes-btn--secondary nodes-btn--small"
                        onClick={() => handleEdit(n)}
                        aria-label={`Edit ${n.id}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="nodes-btn nodes-btn--danger nodes-btn--small"
                        onClick={() => handleDelete(n.id)}
                        aria-label={`Delete ${n.id}`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                )
              )}
            </ul>
            {nodes.length === 0 && (
              <p className="nodes-empty">No nodes yet. Add one above to see it on the Map and Dashboard.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
