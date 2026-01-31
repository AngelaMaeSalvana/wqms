import React from "react";
import { Outlet } from "react-router-dom";
import SideNavigation from "./SideNavigation";
import ConnectionStatus from "./ConnectionStatus";
import DatabaseStatus from "./DatabaseStatus";
import { useMQTTContext } from "../contexts/MQTTContext";
import { config } from "../config/env";
import "./layout.css";

const Layout = () => {
  const { isConnected, isConnecting, error, reconnect } = useMQTTContext();
  const brokerUrl = config.mqtt?.url || "HiveMQ Cloud";

  return (
    <div className="layout-container">
      <SideNavigation />

      <main className="layout-main">
        <div className="layout-main__header">
          <DatabaseStatus />
          <ConnectionStatus
            isConnected={isConnected}
            isConnecting={isConnecting}
            error={error}
            onReconnect={reconnect}
            brokerUrl={brokerUrl}
          />
        </div>
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
