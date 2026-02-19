import React, { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import "./side-nav.css";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: "📊" },
  { to: "/reports", label: "Reports", icon: "🗂️" },
  { to: "/map", label: "Map & Locations", icon: "📍" },
  { to: "/nodes", label: "Nodes", icon: "🔌" },
  { to: "/alerts", label: "Alerts", icon: "🔔" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

const pathToTitle = (pathname) => {
  const item = navItems.find((n) => n.to === pathname);
  return item ? item.label : "Dashboard";
};

export default function SideNavigation({ isMobileOpen = false, onToggle, onClose }) {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();
  const pageTitle = pathToTitle(pathname);

  const handleNavClick = () => {
    if (onClose) onClose();
  };

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
          <span className="side-nav__mobile-title">AQUALENS</span>
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
          {!collapsed && <span className="brand__text">AQUALENS</span>}
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
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={handleNavClick}
            className={({ isActive }) =>
              `side-nav__item ${isActive ? "active" : ""}`
            }
            title={collapsed ? item.label : undefined}
          >
            <span className="side-nav__icon" aria-hidden="true">
              {item.icon}
            </span>
            {!collapsed && <span className="side-nav__label">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="side-nav__bottom">
        {!collapsed && (
          <div className="side-nav__hint">
            <div className="hint__title">Shortcuts</div>
            <div className="hint__text">Ctrl/Cmd + R — refresh</div>
            <div className="hint__text">Esc — close modals</div>
          </div>
        )}
      </div>
    </aside>
    </>
  );
}
