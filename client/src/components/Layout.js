import React from "react";
import { Outlet } from "react-router-dom";
import SideNavigation from "./SideNavigation";
import "./layout.css";

const Layout = () => {
  return (
    <div className="layout-container">
      <SideNavigation />

      {/* This is where Dashboard/Reports/Maps/Alerts/Settings will render */}
      <main className="layout-main">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
