import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Layout from "./components/Layout.js";
import { syncSettingsFromSupabase } from "./utils/settingsStorage";
import ErrorBoundary from "./components/ErrorBoundary.js";

import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import SensorLogs from "./pages/SensorLogs";
import Map from "./pages/Map";
import Alerts from "./pages/Alerts";
import Nodes from "./pages/Nodes";
import Settings from "./pages/Settings";

import "./App.css";

export default function App() {
  useEffect(() => {
    syncSettingsFromSupabase();
  }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/sensor-logs" element={<SensorLogs />} />
              <Route path="/map" element={<Map />} />
              <Route path="/nodes" element={<Nodes />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
          <span className="app-dev-notice" aria-hidden="true">
            This app is still in development phase
          </span>
        </>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
