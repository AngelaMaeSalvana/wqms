import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import "./side-nav.css";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: "📊" },
  { to: "/reports", label: "Reports", icon: "🗂️" },
  { to: "/map", label: "Map & Locations", icon: "📍" },
  { to: "/nodes", label: "Nodes", icon: "🔌" },
  { to: "/alerts", label: "Alerts", icon: "🔔" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

export default function SideNavigation() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`side-nav ${collapsed ? "collapsed" : ""}`}>
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
  );
}
