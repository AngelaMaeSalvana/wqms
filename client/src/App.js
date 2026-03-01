import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Layout from "./components/Layout.js";
import { syncSettingsFromSupabase } from "./utils/settingsStorage";
import ErrorBoundary from "./components/ErrorBoundary.js";
import { TestRunProvider } from "./contexts/TestRunContext";
import TestRunToast from "./components/TestRunToast";

import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import SensorLogs from "./pages/SensorLogs";
import Map from "./pages/Map";
import Alerts from "./pages/Alerts";
import Nodes from "./pages/Nodes";
import InactiveNodes from "./pages/InactiveNodes";
import Settings from "./pages/Settings";
import PerformanceTest from "./pages/PerformanceTest";

import "./App.css";
import { sendEventNotification } from "./services/emailService";

const APP_VERSION_KEY = "wqms_last_notified_version";

export default function App() {
  useEffect(() => {
    syncSettingsFromSupabase();
  }, []);

  useEffect(() => {
    const version = process.env.REACT_APP_VERSION;
    if (!version) return;
    const last = localStorage.getItem(APP_VERSION_KEY);
    if (last !== version) {
      sendEventNotification("system_update", { version });
      localStorage.setItem(APP_VERSION_KEY, version);
    }
  }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <TestRunProvider>
          <>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/sensor-logs" element={<SensorLogs />} />
                <Route path="/map" element={<Map />} />
                <Route path="/nodes" element={<Nodes />} />
                <Route path="/nodes/inactive" element={<InactiveNodes />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/performance-test" element={<PerformanceTest />} />
              </Route>
            </Routes>
            <TestRunToast />
            <span className="app-dev-notice" aria-hidden="true">
              This app is still in development phase
            </span>
          </>
        </TestRunProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
