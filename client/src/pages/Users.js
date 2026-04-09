import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { PageLoader } from "../components/LoadingSkeleton";
import "./Users.css";

function formatDate(value) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ column: "created_at", direction: "desc" });
  const [selectedUser, setSelectedUser] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [roleChanges, setRoleChanges] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.listUsers();
      setUsers(Array.isArray(result?.users) ? result.users : []);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = !q
      ? users
      : users.filter((item) =>
          [item.username, item.email, item.role].some((value) =>
            String(value || "").toLowerCase().includes(q)
          )
        );
    list = [...list].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.column === "username") {
        return String(a.username || "").localeCompare(String(b.username || "")) * dir;
      }
      if (sort.column === "role") {
        return String(a.role || "").localeCompare(String(b.role || "")) * dir;
      }
      const aTs = new Date(a.created_at || 0).getTime();
      const bTs = new Date(b.created_at || 0).getTime();
      return (aTs - bTs) * dir;
    });
    return list;
  }, [users, query, sort]);

  const activityLog = useMemo(() => {
    const loginEvents = sessions
      .filter((s) => s?.login_at)
      .map((s) => ({
        id: `login-${s.id}`,
        ts: new Date(s.login_at).getTime(),
        label: "Login",
        detail: `Signed in at ${formatDate(s.login_at)}`,
        meta: "Session event",
      }));

    const logoutEvents = sessions
      .filter((s) => s?.logout_at)
      .map((s) => ({
        id: `logout-${s.id}`,
        ts: new Date(s.logout_at).getTime(),
        label: "Logout",
        detail: `Signed out at ${formatDate(s.logout_at)}`,
        meta: "Session event",
      }));

    const roleEvents = roleChanges
      .filter((r) => r?.changed_at)
      .map((r) => ({
        id: `role-${r.id}`,
        ts: new Date(r.changed_at).getTime(),
        label: "Role Change",
        detail: `Role changed from ${r.from_role || "guest"} to ${r.to_role || "guest"}`,
        meta: `Changed by user ID: ${r.actor_user_id || "—"}`,
      }));

    const genericAuditEvents = auditEvents
      .filter((e) => e?.created_at)
      .filter((e) => e.action !== "user.role.update")
      .map((e) => {
        const details = e.details || {};
        let detail = e.action;
        if (e.action === "user.profile.update") {
          const fields = Array.isArray(details.changes) ? details.changes.map((c) => c.field).filter(Boolean) : [];
          detail = fields.length > 0 ? `Updated profile (${fields.join(", ")})` : "Updated profile";
        } else if (e.action === "node.create") {
          detail = `Created node ${e.entity_id || ""}`.trim();
        } else if (e.action === "node.update") {
          const fields = Array.isArray(details.changes) ? details.changes.map((c) => c.field).filter(Boolean) : [];
          detail = fields.length > 0 ? `Updated node ${e.entity_id || ""} (${fields.join(", ")})` : `Updated node ${e.entity_id || ""}`.trim();
        } else if (e.action === "node.remove") {
          detail = `Removed node ${e.entity_id || ""}`.trim();
        } else if (e.action === "node.active.toggle") {
          detail = `Changed node ${e.entity_id || ""} status to ${details.to || "updated"}`.trim();
        } else if (e.action === "auth.logout") {
          detail = "Signed out";
        }
        return {
          id: `audit-${e.id}`,
          ts: new Date(e.created_at).getTime(),
          label: "Change",
          detail,
          meta: `${e.entity_type || "entity"}${e.entity_id ? `: ${e.entity_id}` : ""}`,
        };
      });

    return [...loginEvents, ...logoutEvents, ...roleEvents, ...genericAuditEvents].sort((a, b) => b.ts - a.ts);
  }, [sessions, roleChanges, auditEvents]);

  const loadUserActivity = async (userRow) => {
    setSelectedUser(userRow);
    setSessions([]);
    setRoleChanges([]);
    setAuditEvents([]);
    setSessionsError("");
    setSessionsLoading(true);
    try {
      const result = await api.getUserActivity(userRow.id, { limit: 30 });
      setSessions(Array.isArray(result?.sessions) ? result.sessions : []);
      setRoleChanges(Array.isArray(result?.role_changes) ? result.role_changes : []);
      setAuditEvents(Array.isArray(result?.audit_events) ? result.audit_events : []);
    } catch (e) {
      setSessionsError(e?.message || "Failed to load user activity");
    } finally {
      setSessionsLoading(false);
    }
  };

  const onChangeRole = async (userId, nextRole) => {
    setSavingId(userId);
    setError("");
    setFeedback("");
    try {
      const result = await api.updateUserRole(userId, nextRole);
      const updated = result?.user;
      setUsers((prev) =>
        prev.map((item) => (item.id === userId ? { ...item, ...updated } : item))
      );
      setFeedback(`Updated role to ${nextRole}`);
      setTimeout(() => setFeedback(""), 2000);
    } catch (e) {
      setError(e?.message || "Failed to update role");
    } finally {
      setSavingId("");
    }
  };

  const onToggleActive = async (userId, nextActive) => {
    setSavingId(userId);
    setError("");
    setFeedback("");
    try {
      const result = await api.updateUserActive(userId, nextActive);
      const updated = result?.user;
      setUsers((prev) =>
        prev.map((item) => (item.id === userId ? { ...item, ...updated } : item))
      );
      setSelectedUser((prev) => (prev?.id === userId ? { ...prev, ...updated } : prev));
      setFeedback(nextActive ? "Account activated" : "Account deactivated");
      setTimeout(() => setFeedback(""), 2000);
    } catch (e) {
      setError(e?.message || "Failed to update account status");
    } finally {
      setSavingId("");
    }
  };

  if (loading) {
    return (
      <div className="users-page">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="users-page">
      <header className="page-header users-page__header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">Manage system users and access roles</p>
        </div>
        <PageDateWithStatus
          lastUpdated={lastUpdated}
          className="page-meta users-header-meta"
          showClassification={false}
        />
      </header>

      <div className="users-filters">
        <div className="users-search-wrap">
          <svg className="users-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="users-search"
            placeholder="Search..."
            aria-label="Search users"
          />
        </div>
        <button
          type="button"
          className="ghost-btn users-sort-btn"
          onClick={() =>
            setSort((prev) =>
              prev.column === "created_at"
                ? { column: "created_at", direction: prev.direction === "desc" ? "asc" : "desc" }
                : { column: "created_at", direction: "desc" }
            )
          }
        >
          Sort {sort.direction === "asc" ? "↑" : "↓"}
        </button>
        <button type="button" className="ghost-btn users-refresh-btn" onClick={loadUsers}>
          Refresh
        </button>
      </div>

      <section className="users-table-card card">
        <div className="card__header">
          <h2 className="card__title">Manage Users</h2>
        </div>
        <div className="card__body">
          {error ? <p className="users-error">{error}</p> : null}
          {feedback ? <p className="users-feedback">{feedback}</p> : null}

          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="users-empty">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((item) => {
                    const isCurrentUser = currentUser?.id === item.id;
                    const isSaving = savingId === item.id;
                    const isActive = item.is_active !== false && item.is_active !== 0;
                    return (
                      <tr key={item.id} className="users-row" onClick={() => loadUserActivity(item)}>
                        <td>{item.username}</td>
                        <td>{item.email || "—"}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <select
                            value={item.role || "guest"}
                            onChange={(e) => onChangeRole(item.id, e.target.value)}
                            disabled={isSaving || isCurrentUser}
                            className="users-role-select"
                            aria-label={`Role for ${item.username}`}
                            title={isCurrentUser ? "You cannot change your own role here" : undefined}
                          >
                            <option value="guest">Guest</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className={`users-active-btn ${isActive ? "users-active-btn--active" : "users-active-btn--inactive"}`}
                            disabled={isSaving || isCurrentUser}
                            onClick={() => onToggleActive(item.id, !isActive)}
                            aria-label={`${isActive ? "Deactivate" : "Activate"} account for ${item.username}`}
                            title={isCurrentUser ? "You cannot deactivate your own account" : undefined}
                          >
                            {isActive ? "Active" : "Inactive"}
                          </button>
                        </td>
                        <td>{formatDate(item.created_at)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        {filteredUsers.length > 0 && (
          <div className="users-table-footer">
            <span className="users-table-footer-info">{filteredUsers.length} users</span>
          </div>
        )}
      </section>

      {selectedUser &&
        createPortal(
          <div className="users-detail-overlay" onClick={() => setSelectedUser(null)} role="presentation">
            <div className="users-detail-sheet" role="dialog" aria-modal="true" aria-label="User details" onClick={(e) => e.stopPropagation()}>
              <div className="users-detail-handle" />
              <div className="users-detail-header">
                <div>
                  <div className="users-detail-title">{selectedUser.username}</div>
                  <div className="users-detail-subtitle">{selectedUser.email || "No email"}</div>
                </div>
                <button type="button" className="users-detail-close" onClick={() => setSelectedUser(null)} aria-label="Close">×</button>
              </div>
              <div className="users-detail-grid">
                <div className="users-detail-item">
                  <span className="users-detail-item-label">Role</span>
                  <span className="users-detail-item-value">{selectedUser.role || "guest"}</span>
                </div>
                <div className="users-detail-item">
                  <span className="users-detail-item-label">Created</span>
                  <span className="users-detail-item-value">{formatDate(selectedUser.created_at)}</span>
                </div>
                <div className="users-detail-item">
                  <span className="users-detail-item-label">Status</span>
                  <span className="users-detail-item-value">
                    {selectedUser.is_active === false || selectedUser.is_active === 0 ? "Inactive" : "Active"}
                  </span>
                </div>
              </div>
              <div className="users-activity">
                <h3 className="users-activity-title">Activity / Change Log</h3>
                {sessionsLoading ? (
                  <p className="users-activity-empty">Loading activity log...</p>
                ) : sessionsError ? (
                  <p className="users-error">{sessionsError}</p>
                ) : activityLog.length === 0 ? (
                  <p className="users-activity-empty">No activity found.</p>
                ) : (
                  <div className="users-activity-list">
                    {activityLog.map((entry) => (
                      <div className="users-activity-row" key={entry.id}>
                        <div className="users-activity-main">
                          <span>{entry.label}</span>
                          <span>{entry.detail}</span>
                        </div>
                        <div className="users-activity-meta">
                          <span className="users-activity-timestamp">{formatDate(entry.ts)}</span>
                          <span>{entry.meta}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
