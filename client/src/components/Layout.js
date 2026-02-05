import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import SideNavigation from "./SideNavigation";
import "./layout.css";

const Layout = () => {
  const location = useLocation();
  return (
    <div className="layout-container">
      <SideNavigation />

      {/* This is where Dashboard/Reports/Maps/Alerts/Settings will render */}
      <main className="layout-main">
        <div key={location.pathname} className="page-enter">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
