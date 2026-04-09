import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Layout from "./components/Layout.js";
import { syncSettingsFromSupabase } from "./utils/settingsStorage";
import { isSupabaseEnabled } from "./services/supabaseService";
import { PageLoader } from "./components/LoadingSkeleton";
import ErrorBoundary from "./components/ErrorBoundary.js";
import { TestRunProvider } from "./contexts/TestRunContext";
import { AuthProvider } from "./contexts/AuthContext";
import TestRunToast from "./components/TestRunToast";
import RequireAuth from "./components/RequireAuth";
import RequireAdmin from "./components/RequireAdmin";

import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import SensorLogs from "./pages/SensorLogs";
import Map from "./pages/Map";
import Alerts from "./pages/Alerts";
import Nodes from "./pages/Nodes";
import InactiveNodes from "./pages/InactiveNodes";
import Settings from "./pages/Settings";
import PerformanceTest from "./pages/PerformanceTest";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import CompleteProfile from "./pages/CompleteProfile";

import "./App.css";
import { sendEventNotification } from "./services/emailService";

const APP_VERSION_KEY = "wqms_last_notified_version";

export default function App() {
  const [settingsReady, setSettingsReady] = useState(() => !isSupabaseEnabled());

  useEffect(() => {
    if (!isSupabaseEnabled()) return undefined;
    let cancelled = false;
    syncSettingsFromSupabase().then(() => {
      if (!cancelled) setSettingsReady(true);
    });
    return () => {
      cancelled = true;
    };
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

  if (!settingsReady) {
    return (
      <div className="app-settings-loading" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <PageLoader />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <TestRunProvider>
            <>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/complete-profile" element={<CompleteProfile />} />

                <Route
                  element={(
                    <RequireAuth>
                      <Layout />
                    </RequireAuth>
                  )}
                >
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/sensor-logs" element={<SensorLogs />} />
                  <Route path="/map" element={<Map />} />
                  <Route
                    path="/nodes"
                    element={(
                      <RequireAdmin>
                        <Nodes />
                      </RequireAdmin>
                    )}
                  />
                  <Route
                    path="/nodes/inactive"
                    element={(
                      <RequireAdmin>
                        <InactiveNodes />
                      </RequireAdmin>
                    )}
                  />
                  <Route path="/alerts" element={<Alerts />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/performance-test" element={<PerformanceTest />} />
                </Route>
              </Routes>
              <TestRunToast />
            </>
          </TestRunProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
