import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import api from "../services/api";

const TestRunContext = createContext(null);

export function useTestRun() {
  const ctx = useContext(TestRunContext);
  if (!ctx) throw new Error("useTestRun must be used within TestRunProvider");
  return ctx;
}

function formatCountdown(ms) {
  if (ms == null || ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TestRunProvider({ children }) {
  // Active run: { id, startedAt, endsAt, intervalMs, durationMs, nodeId } | null
  const [testRun, setTestRun] = useState(null);
  const [lastTestRunId, setLastTestRunId] = useState(null);
  const [lastTestRunMeta, setLastTestRunMeta] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [autoStopNote, setAutoStopNote] = useState(null);
  const countdownRef = useRef(null);
  const autoStopTriggeredRef = useRef(false);

  // Restore active run on mount (e.g. page refresh)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const active = await api.getActiveTestRun();
        if (!mounted || !active?.id) return;
        const meta = {
          id: active.id,
          startedAt: active.startedAt ?? null,
          endsAt: active.endsAt ?? null,
          intervalMs: active.intervalMs ?? null,
          durationMs: active.durationMs ?? null,
        };
        setTestRun({
          id: meta.id,
          startedAt: meta.startedAt,
          endsAt: meta.endsAt,
          intervalMs: meta.intervalMs,
          durationMs: meta.durationMs,
          nodeId: active.nodeId ?? "all",
        });
        setLastTestRunId(active.id);
        setLastTestRunMeta(meta);
      } catch (_) {}
    })();
    return () => { mounted = false; };
  }, []);

  // Countdown tick
  useEffect(() => {
    if (!testRun) {
      clearInterval(countdownRef.current);
      setCountdown(null);
      return;
    }
    const tick = () => {
      const rem = testRun.endsAt - Date.now();
      if (rem <= 0) {
        setCountdown(0);
        setTestRun(null);
        clearInterval(countdownRef.current);
      } else {
        setCountdown(rem);
      }
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => clearInterval(countdownRef.current);
  }, [testRun]);

  const stopTest = useCallback(async () => {
    if (!testRun) return;
    try { await api.stopTestRun(testRun.id); } catch (_) {}
    clearInterval(countdownRef.current);
    setTestRun(null);
    setCountdown(null);
  }, [testRun]);

  const startTest = useCallback(async ({ durationMs, intervalMs, nodeId }) => {
    autoStopTriggeredRef.current = false;
    setAutoStopNote(null);
    const result = await api.startTestRun({ durationMs, intervalMs, nodeId: nodeId === "all" ? null : nodeId });
    if (result?.error) throw new Error(result.error);
    const meta = {
      id: result.test_run_id,
      startedAt: result.started_at ?? null,
      endsAt: result.ends_at ?? null,
      intervalMs: result.interval_ms ?? null,
      durationMs: result.duration_ms ?? null,
    };
    setTestRun({
      id: meta.id,
      startedAt: meta.startedAt,
      endsAt: meta.endsAt,
      intervalMs: meta.intervalMs,
      durationMs: meta.durationMs,
      nodeId: nodeId ?? "all",
    });
    setLastTestRunId(result.test_run_id);
    setLastTestRunMeta(meta);
    return meta;
  }, []);

  const markAutoStopped = useCallback((note) => {
    autoStopTriggeredRef.current = true;
    setAutoStopNote(note);
  }, []);

  return (
    <TestRunContext.Provider value={{
      testRun,
      lastTestRunId,
      lastTestRunMeta,
      countdown,
      countdownFormatted: countdown != null ? formatCountdown(countdown) : null,
      autoStopNote,
      isRunning: testRun != null,
      startTest,
      stopTest,
      markAutoStopped,
      setLastTestRunMeta,
    }}>
      {children}
    </TestRunContext.Provider>
  );
}
