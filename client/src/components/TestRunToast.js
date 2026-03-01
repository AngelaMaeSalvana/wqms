import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTestRun } from "../contexts/TestRunContext";
import "./TestRunToast.css";

export default function TestRunToast() {
  const { testRun, countdownFormatted, stopTest, countdown } = useTestRun();
  const [stopping, setStopping] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  if (!testRun) return null;

  const isOnPerfPage = location.pathname === "/performance-test";
  const shortId = String(testRun.id).slice(0, 8);

  const handleStop = async (e) => {
    e.stopPropagation();
    setStopping(true);
    await stopTest();
    setStopping(false);
  };

  const handleGoToTest = () => {
    if (!isOnPerfPage) navigate("/performance-test");
  };

  if (collapsed) {
    return (
      <button
        className="testrun-toast testrun-toast--collapsed"
        onClick={() => setCollapsed(false)}
        title="Test run active — click to expand"
        aria-label="Test run active"
      >
        <span className="testrun-toast__pulse" />
        <span className="testrun-toast__countdown-mini">{countdownFormatted}</span>
      </button>
    );
  }

  return (
    <div className="testrun-toast" role="status" aria-live="polite">
      <div className="testrun-toast__indicator">
        <span className="testrun-toast__pulse" />
      </div>

      <div
        className="testrun-toast__body"
        onClick={handleGoToTest}
        style={{ cursor: isOnPerfPage ? "default" : "pointer" }}
        title={isOnPerfPage ? undefined : "Go to Performance Test"}
      >
        <span className="testrun-toast__label">Test run active</span>
        <span className="testrun-toast__id">ID: {shortId}…</span>
      </div>

      <div className="testrun-toast__countdown">
        <span className="testrun-toast__countdown-value">{countdownFormatted}</span>
        <span className="testrun-toast__countdown-label">remaining</span>
      </div>

      <div className="testrun-toast__actions">
        <button
          className="testrun-toast__stop"
          onClick={handleStop}
          disabled={stopping || countdown <= 0}
          title="Stop test run"
          aria-label="Stop test run"
        >
          {stopping ? "…" : "■ Stop"}
        </button>
        <button
          className="testrun-toast__collapse"
          onClick={() => setCollapsed(true)}
          title="Collapse"
          aria-label="Collapse test run banner"
        >
          ×
        </button>
      </div>
    </div>
  );
}
