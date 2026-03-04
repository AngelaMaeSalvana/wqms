import React, { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import SideNavigation from "./SideNavigation";
import "./layout.css";

const Layout = () => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="layout-container">
      <div
        role="presentation"
        className={`layout-backdrop ${mobileMenuOpen ? "open" : ""}`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
      />

      <SideNavigation
        isMobileOpen={mobileMenuOpen}
        onToggle={() => setMobileMenuOpen((v) => !v)}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* This is where Dashboard/Reports/Maps/Alerts/Settings will render */}
      <main className={`layout-main${location.pathname === "/map" ? " layout-main--map" : ""}${location.pathname === "/dashboard" ? " layout-main--dashboard" : ""}`}>
        <div key={location.pathname} className="page-enter">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
