import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { isSupabaseEnabled } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import "./side-nav.css";

const IconDashboard = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>
);

const IconReports = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
);

const IconSensorLogs = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
);

const IconMap = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
    <line x1="9" y1="3" x2="9" y2="18"/>
    <line x1="15" y1="6" x2="15" y2="21"/>
  </svg>
);

const IconNodes = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="2"/>
    <circle cx="5" cy="19" r="2"/>
    <circle cx="19" cy="19" r="2"/>
    <line x1="12" y1="7" x2="5" y2="17"/>
    <line x1="12" y1="7" x2="19" y2="17"/>
    <line x1="5" y1="19" x2="19" y2="19"/>
  </svg>
);

const IconAlerts = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
);

const IconUsers = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="3" />
    <path d="M20 8v6" />
    <path d="M23 11h-6" />
  </svg>
);

const IconSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const navItems = [
  { to: "/dashboard", label: "Dashboard", Icon: IconDashboard },
  { to: "/reports", label: "Reports", Icon: IconReports },
  { to: "/sensor-logs", label: "Sensor Logs", Icon: IconSensorLogs },
  { to: "/map", label: "Map & Locations", Icon: IconMap },
  { to: "/nodes", label: "Nodes", Icon: IconNodes },
  { to: "/users", label: "Users", Icon: IconUsers },
  { to: "/alerts", label: "Alerts", Icon: IconAlerts },
  { to: "/settings", label: "Settings", Icon: IconSettings },
];

const pathToTitle = (pathname) => {
  if (pathname === "/nodes/inactive") return "Inactive Nodes";
  const item = navItems.find((n) => n.to === pathname);
  return item ? item.label : "Dashboard";
};

export default function SideNavigation({ isMobileOpen = false, onToggle, onClose }) {
  const [collapsed, setCollapsed] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { pathname } = useLocation();
  const { signOut, isAdmin, role } = useAuth();
  const pageTitle = pathToTitle(pathname);
  const roleLabel = isAdmin ? "System Admin" : "Guest";

  const handleNavClick = () => {
    if (onClose) onClose();
  };

  const openLogoutModal = () => {
    setSigningOut(false);
    setLogoutModalOpen(true);
  };

  const closeLogoutModal = () => {
    if (signingOut) return;
    setLogoutModalOpen(false);
  };

  /** Log out only after explicit confirm — not on backdrop/cancel/escape. */
  const confirmSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      setLogoutModalOpen(false);
      if (onClose) onClose();
    } finally {
      setSigningOut(false);
    }
  };

  useEffect(() => {
    if (!logoutModalOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || signingOut) return;
      closeLogoutModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [logoutModalOpen, signingOut]);

  const logoutModal =
    isSupabaseEnabled() && logoutModalOpen
      ? createPortal(
          <div
            className={`side-nav__logout-modal-backdrop${signingOut ? " side-nav__logout-modal-backdrop--busy" : ""}`}
            role="presentation"
            onClick={closeLogoutModal}
          >
            <div
              className="side-nav__logout-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="side-nav-logout-title"
              aria-busy={signingOut}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="side-nav-logout-title" className="side-nav__logout-modal-title">
                Log out?
              </h2>
              <p className="side-nav__logout-modal-text">
                You will need to sign in again to access AQUALENS.
              </p>
              <div className="side-nav__logout-modal-actions">
                <button type="button" className="side-nav__logout-btn side-nav__logout-btn--secondary" onClick={closeLogoutModal} disabled={signingOut}>
                  Cancel
                </button>
                <button type="button" className="side-nav__logout-btn side-nav__logout-btn--primary" onClick={confirmSignOut} disabled={signingOut}>
                  {signingOut ? "Signing out…" : "Log out"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <header className="side-nav__mobile-header" aria-label="Mobile header">
        <button
          type="button"
          className="side-nav__hamburger"
          onClick={onToggle}
          aria-label={isMobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={isMobileOpen}
        >
          <span className="side-nav__hamburger-line" />
          <span className="side-nav__hamburger-line" />
          <span className="side-nav__hamburger-line" />
        </button>
        <div className="side-nav__mobile-branding">
          <span className="side-nav__mobile-logo" aria-hidden="true">
            <img src="/logo.png" alt="" className="side-nav__mobile-logo-img" />
          </span>
          <span className="side-nav__mobile-title">AQUALENS</span>
          {isSupabaseEnabled() && (
            <span className={`side-nav__mobile-role side-nav__mobile-role--${role}`}>
              {isAdmin ? "Admin" : "Guest"}
            </span>
          )}
          <span className="side-nav__breadcrumb">
            <span className="side-nav__breadcrumb-sep" aria-hidden="true"> / </span>
            {pageTitle}
          </span>
        </div>
      </header>
    <aside
      className={`side-nav ${collapsed ? "collapsed" : ""} ${
        isMobileOpen ? "mobile-open" : ""
      }`}
    >
      <div className="side-nav__top">
        <div className="side-nav__brand" title="AQUALENS">
          <span className="brand__logo">
            <img src="/logo.png" alt="AQUALENS" className="brand__logo-img" />
          </span>
          {!collapsed && (
            <span className="brand__text-wrap">
              <span className="brand__text">AQUALENS</span>
              {isSupabaseEnabled() && (
                <span className={`side-nav__role-badge side-nav__role-badge--${role}`}>
                  {roleLabel}
                </span>
              )}
            </span>
          )}
        </div>

        <button
          className="side-nav__collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          type="button"
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <nav className="side-nav__menu" aria-label="Main navigation">
        {navItems
          .filter((item) => (item.to === "/nodes" || item.to === "/users" ? isAdmin : true))
          .map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={handleNavClick}
            className={({ isActive }) =>
              `side-nav__item ${isActive ? "active" : ""}`
            }
            title={collapsed ? label : undefined}
          >
            <span className="side-nav__icon" aria-hidden="true">
              <Icon />
            </span>
            {!collapsed && <span className="side-nav__label">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {isSupabaseEnabled() && (
        <div className="side-nav__logout">
          <button type="button" className="side-nav__item" onClick={openLogoutModal} title={collapsed ? "Logout" : undefined}>
            <span className="side-nav__icon" aria-hidden="true">⇦</span>
            {!collapsed && <span className="side-nav__label">Logout</span>}
          </button>
        </div>
      )}
      <div className="side-nav__bottom">
        {!collapsed && (
          <div className="side-nav__version">
            <span className="side-nav__version-dot" />
            <span className="side-nav__version-text">Water Quality Monitor</span>
          </div>
        )}
      </div>
    </aside>
    {logoutModal}
    </>
  );
}
