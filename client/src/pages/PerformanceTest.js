import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Line } from "react-chartjs-2";
import PageDateWithStatus from "../components/PageDateWithStatus";
import { getNodes, loadNodes } from "../utils/nodesStorage";
import { loadFromStorage } from "../utils/settingsStorage";
import api from "../services/api";
import { computeIoTMetrics } from "../utils/iotMetrics";
import { computeAlertMetrics } from "../utils/alertMetrics";
import { useTestRun } from "../contexts/TestRunContext";
import { buildAlertsForAllNodes, resetAlertPersistenceForTests, getThresholds } from "../utils/alertsData";
import { isEmailJsConfigured, sendAlertEmail, shouldSendAlertEmailBySeverity } from "../services/emailService";
import "../utils/chartConfig";
import "./PerformanceTest.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(v) {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtLatMs(ms) {
  if (ms == null) return "—";
  return `${Math.round(ms)} ms`;
}

function todayLocalYMD() {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(Date.now() - tzOffsetMs).toISOString().slice(0, 10);
}

function severityRank(sev) {
  const s = String(sev || "info").toLowerCase();
  if (s === "high") return 3;
  if (s === "medium") return 2;
  if (s === "low") return 1;
  return 0;
}

function describeCause(alert) {
  if (!alert) return "—";
  const type = String(alert.type || "").toLowerCase();
  const param = String(alert.parameter || "").toLowerCase();
  const title = String(alert.title || "").toLowerCase();
  if (type === "node" || title.includes("node offline")) return "Node status offline rule";
  if (type === "battery" || title.includes("low battery")) return "Battery below warning threshold (<15%)";
  if (type === "maintenance" || title.includes("maintenance")) return "Maintenance interval exceeded (due)";
  if (title.includes("wqi rapid drop")) return "WQI drop > 15 points rule";
  if (title.includes("multiple parameters degraded")) return "2+ parameters at MEDIUM/HIGH rule";
  if (title.includes("rapid rise")) return "NH₃ slope (rapid-rise) rule";
  if (param === "ph") return "pH threshold + hysteresis + persistence";
  if (param) return `Threshold deviation + persistence (${param})`;
  return "Threshold / escalation rule";
}

function normSeverityStr(s) {
  return String(s || "info").toLowerCase();
}

function findThresholdAlertForParameter(alerts, parameter) {
  const want = String(parameter || "").toLowerCase();
  return alerts.find(
    (a) => String(a.type || "").toLowerCase() === "threshold" && String(a.parameter || "").toLowerCase() === want
  );
}

/**
 * Alerts scoped to the current scenario only (excludes maintenance, battery, node offline,
 * and threshold alerts for parameters not under test). Used for display, rubric, and upsert.
 */
function filterAlertsForScenarioEval(allAlerts, spec) {
  if (!spec?.mode) return allAlerts;
  const isThreshold = (a) => String(a.type || "").toLowerCase() === "threshold";

  if (spec.mode === "no_threshold") {
    return allAlerts.filter((a) => isThreshold(a));
  }
  if (spec.mode === "threshold_exact") {
    const p = String(spec.parameter || "").toLowerCase();
    return allAlerts.filter(
      (a) => isThreshold(a) && String(a.parameter || "").toLowerCase() === p
    );
  }
  if (spec.mode === "persistence_do") {
    return allAlerts.filter(
      (a) => isThreshold(a) && String(a.parameter || "").toLowerCase() === "dissolvedoxygen"
    );
  }
  if (spec.mode === "multi_param") {
    const allow = new Set(["dissolvedoxygen", "turbidity", "ph", "system"]);
    return allAlerts.filter(
      (a) => isThreshold(a) && allow.has(String(a.parameter || "").toLowerCase())
    );
  }
  if (spec.mode === "title_includes") {
    const needles = Array.isArray(spec.titleIncludes) ? spec.titleIncludes : [spec.titleIncludes];
    const lower = (s) => String(s || "").toLowerCase();
    return allAlerts.filter((a) => needles.some((n) => lower(a.title).includes(lower(n))));
  }
  return allAlerts;
}

/**
 * Scenario rubric: compares computed alerts to expected outcome.
 * @returns {{ label: 'PASS'|'PARTIAL'|'FAIL', score: number, pass: boolean, reasons: string[] }}
 */
function scoreScenarioRun(alerts, spec) {
  const reasons = [];
  if (!spec?.mode) {
    return { label: "—", score: null, pass: true, reasons: ["No rubric defined for this scenario."] };
  }

  const ignTypes = new Set((spec.ignoreTypes || []).map((t) => String(t).toLowerCase()));
  const relevantAlerts = alerts.filter((a) => !ignTypes.has(String(a.type || "").toLowerCase()));

  if (spec.mode === "no_threshold") {
    const bad = relevantAlerts.filter((a) => String(a.type || "").toLowerCase() === "threshold");
    if (bad.length === 0) {
      reasons.push("No threshold alerts after ignoring optional types (maintenance / battery).");
      return { label: "PASS", score: 100, pass: true, reasons };
    }
    reasons.push(`Expected no threshold alerts; found: ${bad.map((a) => a.title || a.type).join("; ")}`);
    return { label: "FAIL", score: 0, pass: false, reasons };
  }

  if (spec.mode === "threshold_exact") {
    const a = findThresholdAlertForParameter(relevantAlerts, spec.parameter);
    if (!a) {
      reasons.push(`No threshold alert for parameter "${spec.parameter}".`);
      return { label: "FAIL", score: 0, pass: false, reasons };
    }
    const got = normSeverityStr(a.severity);
    const want = normSeverityStr(spec.severity);
    if (got === want) {
      reasons.push(`"${spec.parameter}" alert severity is ${a.severity} as expected.`);
      return { label: "PASS", score: 100, pass: true, reasons };
    }
    reasons.push(`Expected severity ${want.toUpperCase()} on "${spec.parameter}"; got ${got.toUpperCase()}.`);
    return { label: "FAIL", score: 40, pass: false, reasons };
  }

  if (spec.mode === "title_includes") {
    const needles = Array.isArray(spec.titleIncludes) ? spec.titleIncludes : [spec.titleIncludes];
    const lower = (s) => String(s || "").toLowerCase();
    const hit = relevantAlerts.some((a) => needles.some((n) => lower(a.title).includes(lower(n))));
    if (hit) {
      reasons.push(`Found alert matching: ${needles.map((n) => `"${n}"`).join(" or ")}.`);
      const sevOk = !spec.severity || relevantAlerts.some(
        (a) => needles.some((n) => lower(a.title).includes(lower(n))) && normSeverityStr(a.severity) === normSeverityStr(spec.severity)
      );
      if (spec.severity && !sevOk) {
        reasons.push(`Expected severity ${String(spec.severity).toUpperCase()} on that alert.`);
        return { label: "PARTIAL", score: 70, pass: false, reasons };
      }
      return { label: "PASS", score: 100, pass: true, reasons };
    }
    reasons.push(`No alert title containing ${needles.map((n) => `"${n}"`).join(" or ")}.`);
    return { label: "FAIL", score: 0, pass: false, reasons };
  }

  if (spec.mode === "multi_param") {
    const lower = (s) => String(s || "").toLowerCase();
    const sys = relevantAlerts.find(
      (a) => lower(a.title).includes("multiple parameters degraded") || (lower(a.parameter) === "system" && lower(a.title).includes("multiple"))
    );
    if (!sys) {
      reasons.push('Expected a "Multiple parameters degraded" system alert.');
      return { label: "FAIL", score: 0, pass: false, reasons };
    }
    if (normSeverityStr(sys.severity) !== "high") {
      reasons.push(`Expected HIGH on multi-parameter alert; got ${normSeverityStr(sys.severity).toUpperCase()}.`);
      return { label: "PARTIAL", score: 75, pass: false, reasons };
    }
    reasons.push("Multi-parameter degraded alert present at HIGH.");
    return { label: "PASS", score: 100, pass: true, reasons };
  }

  if (spec.mode === "persistence_do") {
    const a = findThresholdAlertForParameter(relevantAlerts, "dissolvedOxygen");
    if (!a) {
      reasons.push("No dissolved oxygen threshold alert (persistence needs consecutive low-DO readings in DB).");
      return { label: "FAIL", score: 0, pass: false, reasons };
    }
    const got = normSeverityStr(a.severity);
    if (got === "high") {
      reasons.push("DO alert reached HIGH (3+ consecutive violations in persistence state).");
      return { label: "PASS", score: 100, pass: true, reasons };
    }
    if (got === "medium") {
      reasons.push("DO alert at MEDIUM (2 strikes). Run scenario again to reach HIGH.");
      return { label: "PARTIAL", score: 85, pass: false, reasons };
    }
    reasons.push("DO alert at LOW (1 strike). Run scenario again to escalate persistence.");
    return { label: "PARTIAL", score: 55, pass: false, reasons };
  }

  reasons.push("Unknown rubric mode.");
  return { label: "—", score: null, pass: true, reasons };
}

// ─── Duration / frequency helpers ────────────────────────────────────────────

function toDurationMs(value, unit) {
  const v = Number(value);
  if (!v || v <= 0) return 0;
  if (unit === "seconds") return v * 1000;
  if (unit === "minutes") return v * 60 * 1000;
  if (unit === "hours")   return v * 3600 * 1000;
  return 0;
}

function toFreqMs(value, unit) {
  const v = Number(value);
  if (!v || v <= 0) return 0;
  if (unit === "seconds") return v * 1000;
  if (unit === "minutes") return v * 60 * 1000;
  if (unit === "hours")   return v * 3600 * 1000;
  return 0;
}

/** Convert run meta (duration_ms, interval_ms) to form fields for use as next-test defaults. */
function runMetaToConfigForm(runMeta) {
  if (!runMeta) return {};
  const durationMs = runMeta.durationMs != null ? Number(runMeta.durationMs)
    : (runMeta.startedAt != null && runMeta.endsAt != null ? Math.max(0, Number(runMeta.endsAt) - Number(runMeta.startedAt)) : null);
  const intervalMs = runMeta.intervalMs != null ? Number(runMeta.intervalMs) : null;
  const out = {};
  if (durationMs != null && durationMs > 0) {
    if (durationMs >= 3600000 && durationMs % 3600000 === 0) {
      out.durationValue = String(durationMs / 3600000);
      out.durationUnit = "hours";
    } else if (durationMs >= 60000 && durationMs % 60000 === 0) {
      out.durationValue = String(durationMs / 60000);
      out.durationUnit = "minutes";
    } else {
      out.durationValue = String(Math.round(durationMs / 1000));
      out.durationUnit = "seconds";
    }
  }
  if (intervalMs != null && intervalMs > 0) {
    if (intervalMs >= 60000 && intervalMs % 60000 === 0) {
      out.freqValue = String(intervalMs / 60000);
      out.freqUnit = "minutes";
    } else {
      out.freqValue = String(Math.round(intervalMs / 1000));
      out.freqUnit = "seconds";
    }
  }
  if (runMeta.node_id != null && runMeta.node_id !== "") {
    out.nodeId = runMeta.node_id;
  }
  return out;
}

function formatDuration(value, unit) {
  const v = Number(value);
  if (!v) return "—";
  return `${v} ${unit}`;
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

function computeExpectedFromRunMeta(runMeta) {
  if (!runMeta) return { expected: null, formula: null };
  const startedAt = runMeta.startedAt != null ? Number(runMeta.startedAt) : null;
  const endsAt = runMeta.endsAt != null ? Number(runMeta.endsAt) : null;
  const intervalMs = runMeta.intervalMs != null ? Number(runMeta.intervalMs) : null;
  const durationMs =
    startedAt != null && endsAt != null
      ? Math.max(0, endsAt - startedAt)
      : (runMeta.durationMs != null ? Math.max(0, Number(runMeta.durationMs)) : null);

  if (!Number.isFinite(durationMs) || durationMs <= 0) return { expected: null, formula: null };
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return { expected: null, formula: null };

  const expected = Math.ceil(durationMs / intervalMs);
  const seconds = Math.round(durationMs / 1000);
  const intervalSec = intervalMs / 1000;
  const intervalLabel = intervalMs % 1000 === 0 ? String(intervalSec.toFixed(0)) : String(intervalSec.toFixed(1));
  return {
    expected,
    formula: `${seconds} seconds ÷ ${intervalLabel} seconds`,
  };
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportEvalCSV(evalResult, config, nodeNames, rangeTestDistance = "") {
  if (!evalResult) return;
  const durationMs = toDurationMs(config.durationValue, config.durationUnit);
  const freqMs = toFreqMs(config.freqValue, config.freqUnit);
  const expectedFromConfig = durationMs > 0 && freqMs > 0 ? Math.floor(durationMs / freqMs) : null;
  const expectedPackets = evalResult.expectedUsed != null ? evalResult.expectedUsed : expectedFromConfig;
  const lines = [
    ["WQMS IoT Performance Evaluation Report"],
    [`Generated: ${new Date().toLocaleString()}`],
    [`Date range: ${config.dateFrom} to ${config.dateTo}`],
    [`Target nodes: ${config.nodeId === "all" ? "All" : config.nodeId}`],
    [`Test duration: ${config.durationValue} ${config.durationUnit}`],
    [`Transmission frequency: every ${config.freqValue} ${config.freqUnit}`],
    [`Expected packets (duration ÷ interval): ${expectedPackets ?? "—"}${evalResult.expectedFormulaUsed ? ` (${evalResult.expectedFormulaUsed})` : ""}`],
    ...(rangeTestDistance.trim() ? [[`Range test distance (m): ${rangeTestDistance.trim()}`]] : []),
    [],
    ["Node", "Packets Sent (inferred)", "Packets Received", "Packets Lost",
      "PLR (%)", "PDR (%)", "Availability (%)",
      "E2E Mean (ms) [Fwd→BE]", "E2E p95 (ms)", "E2E Max (ms)",
      "Fwd→Dashboard Mean (ms)", "Fwd Internal Mean (ms)", "MQTT/BE Mean (ms)",
      "Node→Fwd Mean (ms) [NTP req'd]",
      "RSSI Mean (dBm)", "RSSI Min (dBm)", "RSSI Max (dBm)",
      "SNR Mean (dB)", "SNR Min (dB)", "SNR Max (dB)", "Link Samples"],
  ];

  Object.entries(evalResult.nodeMetrics || {}).forEach(([nid, m]) => {
    const name = nodeNames[nid] ? `${nid} — ${nodeNames[nid]}` : nid;
    lines.push([
      name,
      m.totalSent,
      m.totalReceived,
      m.missingSeqs,
      m.plr != null ? m.plr.toFixed(2) : "—",
      m.pdr != null ? m.pdr.toFixed(2) : "—",
      m.availability != null ? m.availability.toFixed(2) : "—",
      m.e2eMean != null ? Math.round(m.e2eMean) : "—",
      m.e2eP95 != null ? Math.round(m.e2eP95) : "—",
      m.e2eMax != null ? Math.round(m.e2eMax) : "—",
      m.fwdToDashMean != null ? Math.round(m.fwdToDashMean) : "—",
      m.fwdProcMean != null ? Math.round(m.fwdProcMean) : "—",
      m.mqttBackendMean != null ? Math.round(m.mqttBackendMean) : "—",
      m.nodeToFwdMean != null ? Math.round(m.nodeToFwdMean) : "—",
      m.rssiMean != null ? Math.round(m.rssiMean) : "—",
      m.rssiMin != null ? m.rssiMin : "—",
      m.rssiMax != null ? m.rssiMax : "—",
      m.snrMean != null ? m.snrMean.toFixed(1) : "—",
      m.snrMin != null ? m.snrMin : "—",
      m.snrMax != null ? m.snrMax : "—",
      m.linkSampleCount ?? 0,
    ]);
  });

  if (evalResult.alertMetrics) {
    const a = evalResult.alertMetrics;
    lines.push([]);
    lines.push(["Alert Responsiveness"]);
    lines.push(["Alerts Triggered", "Mean Response (ms)", "Max Response (ms)", "Trigger Latency Mean (ms)", "Trigger Latency Max (ms)", "Trigger Latency Samples", "Emails Sent", "Email Delay Mean (ms)", "Email Delay Max (ms)"]);
    lines.push([
      a.count,
      a.meanMs != null ? Math.round(a.meanMs) : "—",
      a.maxMs != null ? Math.round(a.maxMs) : "—",
      a.triggerLatencyMeanMs != null ? Math.round(a.triggerLatencyMeanMs) : "—",
      a.triggerLatencyMaxMs != null ? Math.round(a.triggerLatencyMaxMs) : "—",
      a.triggerLatencySamples ?? 0,
      a.emailSentCount ?? 0,
      a.emailDelayMeanMs != null ? Math.round(a.emailDelayMeanMs) : "—",
      a.emailDelayMaxMs != null ? Math.round(a.emailDelayMaxMs) : "—",
    ]);
  }

  const escape = (v) => {
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = "\uFEFF" + lines.map((row) => row.map(escape).join(",")).join("\r\n");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wqms-perf-eval-${ts}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PerformanceTest() {
  const navigate = useNavigate();
  const lastUpdated = new Date();
  const todayYMD = todayLocalYMD();

  // Global test run state from context (survives page navigation)
  const {
    testRun,
    lastTestRunId,
    lastTestRunMeta,
    countdown,
    countdownFormatted,
    autoStopNote,
    isRunning,
    startTest: ctxStartTest,
    stopTest,
    markAutoStopped,
    setLastTestRunMeta,
  } = useTestRun();

  // UI collapse state (Bootstrap-like collapse)
  const [evalResultsOpen, setEvalResultsOpen] = useState(true);

  // IoT evaluation state
  const [nodes, setNodes] = useState([]);
  const [evalConfig, setEvalConfig] = useState({
    dateFrom: todayLocalYMD(),
    dateTo: todayLocalYMD(),
    nodeId: "all",
    onlyTestRun: false,
    metrics: { e2e: true, pdr: true, availability: true, alerts: true },
    // Test window duration
    durationValue: 9,
    durationUnit: "minutes",
    // Transmission frequency — TDMA cycle is 8 slots × 6 s = 48 s per node
    freqValue: 48,
    freqUnit: "seconds",
  });
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalResult, setEvalResult] = useState(null);
  const [evalError, setEvalError] = useState(null);
  const evalAbortRef = useRef(false);

  const [testRunError, setTestRunError] = useState(null);
  const [packetsModalOpen, setPacketsModalOpen] = useState(false);
  const [rangeTestDistance, setRangeTestDistance] = useState("");
  const [liveRangeRows, setLiveRangeRows] = useState([]);
  const autoStopTriggeredRef = useRef(false);

  // Scenario Evaluator (preset scenarios, end-to-end via MQTT→Bridge→Supabase)
  const SCENARIOS = useMemo(() => ([
    { id: "normal", label: "Normal (within limits)", expected: "No threshold alerts", spec: { mode: "no_threshold", ignoreTypes: ["maintenance", "battery"] } },
    { id: "all-clear", label: "All-clear (reset/clear)", expected: "No threshold alerts", spec: { mode: "no_threshold", ignoreTypes: ["maintenance", "battery"] } },
    { id: "low-do", label: "DO low (LOW)", expected: "LOW dissolved oxygen", spec: { mode: "threshold_exact", parameter: "dissolvedOxygen", severity: "low" } },
    { id: "medium-do", label: "DO low (MEDIUM)", expected: "MEDIUM dissolved oxygen", spec: { mode: "threshold_exact", parameter: "dissolvedOxygen", severity: "medium" } },
    { id: "high-do", label: "DO low (HIGH)", expected: "HIGH dissolved oxygen", spec: { mode: "threshold_exact", parameter: "dissolvedOxygen", severity: "high" } },
    { id: "low-ph", label: "pH high (LOW)", expected: "LOW pH too high", spec: { mode: "threshold_exact", parameter: "pH", severity: "low" } },
    { id: "medium-ph", label: "pH high (MEDIUM)", expected: "MEDIUM pH too high", spec: { mode: "threshold_exact", parameter: "pH", severity: "medium" } },
    { id: "high-ph", label: "pH high (HIGH)", expected: "HIGH pH too high", spec: { mode: "threshold_exact", parameter: "pH", severity: "high" } },
    { id: "low-turbidity", label: "Turbidity high (LOW)", expected: "LOW high turbidity", spec: { mode: "threshold_exact", parameter: "turbidity", severity: "low" } },
    { id: "medium-turbidity", label: "Turbidity high (MEDIUM)", expected: "MEDIUM high turbidity", spec: { mode: "threshold_exact", parameter: "turbidity", severity: "medium" } },
    { id: "high-turbidity", label: "Turbidity high (HIGH)", expected: "HIGH high turbidity", spec: { mode: "threshold_exact", parameter: "turbidity", severity: "high" } },
    { id: "low-temp", label: "Temperature below min (LOW)", expected: "LOW temperature below minimum", spec: { mode: "threshold_exact", parameter: "temperature", severity: "low" } },
    { id: "high-temp", label: "Temperature above max (HIGH)", expected: "HIGH temperature above maximum", spec: { mode: "threshold_exact", parameter: "temperature", severity: "high" } },
    { id: "multi-param", label: "Multi-parameter degraded", expected: "HIGH Multiple parameters degraded", spec: { mode: "multi_param" } },
    { id: "wqi-drop", label: "WQI rapid drop", expected: "HIGH WQI rapid drop alert", spec: { mode: "title_includes", titleIncludes: "wqi rapid drop", severity: "high" } },
    { id: "persistence", label: "Persistence escalation", expected: "HIGH DO after 3× low DO", spec: { mode: "persistence_do" } },
    { id: "low-battery", label: "Low battery (test)", expected: "HIGH Low battery", spec: { mode: "title_includes", titleIncludes: "low battery", severity: "high" } },
    { id: "offline", label: "Node offline (test)", expected: "HIGH Node offline", spec: { mode: "title_includes", titleIncludes: "node offline", severity: "high" }, simulated: true },
    { id: "maintenance", label: "Maintenance due (test)", expected: "MEDIUM Maintenance due", spec: { mode: "title_includes", titleIncludes: "maintenance", severity: "medium" }, simulated: true },
  ]), []);
  const [scenarioId, setScenarioId] = useState("low-do");
  const [scenarioNodeId, setScenarioNodeId] = useState("all");
  const [scenarioRunning, setScenarioRunning] = useState(false);
  const [scenarioError, setScenarioError] = useState(null);
  const [scenarioOutput, setScenarioOutput] = useState(null);
  const [persistenceResetNote, setPersistenceResetNote] = useState(null);

  useEffect(() => {
    if (!persistenceResetNote) return undefined;
    const t = setTimeout(() => setPersistenceResetNote(null), 6000);
    return () => clearTimeout(t);
  }, [persistenceResetNote]);

  useEffect(() => {
    loadNodes().then(() => setNodes(getNodes()));
  }, []);

  // Live range test: poll packets while a test run is active
  const LIVE_RANGE_POLL_MS = 4000;
  useEffect(() => {
    if (!testRun?.id) {
      setLiveRangeRows([]);
      return;
    }
    const nodeArg = evalConfig.nodeId === "all" ? undefined : evalConfig.nodeId;
    const fetchLive = () => {
      api
        .getPerformanceReadings({ testRunId: testRun.id, nodeId: nodeArg, limit: 2000 })
        .then((data) => setLiveRangeRows(Array.isArray(data) ? data : []))
        .catch(() => setLiveRangeRows((prev) => prev));
    };
    fetchLive();
    const id = setInterval(fetchLive, LIVE_RANGE_POLL_MS);
    return () => clearInterval(id);
  }, [testRun?.id, evalConfig.nodeId]);

  // (no auto-lock to test run on mount — user controls onlyTestRun manually)

  // Keep the evaluation date locked to today's local date.
  useEffect(() => {
    const sync = () => {
      const t = todayLocalYMD();
      setEvalConfig((c) => (c.dateFrom === t && c.dateTo === t ? c : { ...c, dateFrom: t, dateTo: t }));
    };
    sync();
    const id = setInterval(sync, 60 * 1000);
    return () => clearInterval(id);
  }, []);


  const nodeNames = {};
  nodes.forEach((n) => { nodeNames[n.id] = n.name || n.id; });

  const runScenario = useCallback(async () => {
    setScenarioError(null);
    setScenarioOutput(null);
    const chosenNode =
      (scenarioNodeId && scenarioNodeId !== "all"
        ? scenarioNodeId
        : (evalConfig.nodeId !== "all" ? evalConfig.nodeId : (nodes[0]?.id ?? null)));
    if (!chosenNode) {
      setScenarioError("No node available. Add/select a node first.");
      return;
    }
    const scenario = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
    const isSimulated = !!scenario.simulated;
    setScenarioRunning(true);
    try {
      let latest = null;
      let prev = null;
      let publishedSeqs = new Set();
      let expectedMatches = 1;

      let nodeObj = nodes.find((n) => n.id === chosenNode) || { id: chosenNode, name: chosenNode, active: true };
      let computed;

      if (isSimulated) {
        // Offline / maintenance: no MQTT publish; run alert logic with synthetic state
        if (scenarioId === "offline") {
          computed = buildAlertsForAllNodes(
            [nodeObj],
            {},
            { [chosenNode]: "offline" },
            {}
          );
        } else if (scenarioId === "maintenance") {
          const lastMaintenanceOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
          const nodeWithOldMaintenance = { ...nodeObj, lastMaintenance: lastMaintenanceOld };
          latest = { temperature: 27, turbidity: 3, ph: 7.2, dissolved_oxygen: 8, timestamp: new Date().toISOString() };
          computed = buildAlertsForAllNodes(
            [nodeWithOldMaintenance],
            { [chosenNode]: latest },
            { [chosenNode]: "online" },
            {}
          );
        } else {
          computed = [];
        }
      } else {
        const thresholds = getThresholds();
        const publishResult = await api.publishTestScenario({ scenario: scenarioId, nodeId: chosenNode, thresholds });
        publishedSeqs = new Set(
          (publishResult?.seqs || [])
            .map((v) => Number(v))
            .filter((v) => Number.isFinite(v))
        );
        expectedMatches = Math.max(1, Number(publishResult?.published) || 1);

        let rows = [];
        let matched = [];
        for (let i = 0; i < 15; i++) {
          rows = await api.getReadings({ nodeId: chosenNode, limit: 200 });
          matched = rows.filter((r) => publishedSeqs.has(Number(r.seq)));
          const uniqueMatchedSeqCount = new Set(matched.map((r) => Number(r.seq))).size;
          if (uniqueMatchedSeqCount >= expectedMatches) break;
          await new Promise((r) => setTimeout(r, 800));
        }
        if (!rows || rows.length === 0 || matched.length === 0) {
          throw new Error("No scenario packets found yet. Ensure bridge is running and MQTT is connected.");
        }

        latest = [...matched].sort(
          (a, b) => (new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
        )[0];
        prev = rows.find((r) => Number(r.seq) !== Number(latest.seq)) || null;

        computed = buildAlertsForAllNodes(
          [nodeObj],
          { [chosenNode]: latest },
          { [chosenNode]: "online" },
          prev ? { [chosenNode]: prev } : {}
        );
      }

      const filtered = filterAlertsForScenarioEval(computed, scenario.spec || {});

      // Only persist scenario-scoped alerts (not maintenance, battery, or off-target thresholds).
      try { await api.upsertAlerts(filtered); } catch (_) {}

      const notifications = loadFromStorage("wqms_notifications", {});
      const emailEnabledInSettings = !!notifications?.emailEnabled;
      const notificationEmail = (notifications?.notificationEmail || "").trim();
      const emailConfigured = isEmailJsConfigured();
      const emailEligible = filtered.filter(shouldSendAlertEmailBySeverity);
      const shouldSendEmail =
        emailEligible.length > 0 && emailEnabledInSettings && !!notificationEmail && emailConfigured;

      let emailAttempted = 0;
      let emailSent = 0;
      let emailStatusMessage = "";
      if (filtered.length === 0) {
        emailStatusMessage = "No scenario alerts to email.";
      } else if (!emailEnabledInSettings) {
        emailStatusMessage = "Email disabled in Settings.";
      } else if (!notificationEmail) {
        emailStatusMessage = "Notification email is empty in Settings.";
      } else if (!emailConfigured) {
        emailStatusMessage = "EmailJS env vars are missing (PUBLIC_KEY / SERVICE_ID / TEMPLATE_ID).";
      } else if (emailEligible.length === 0) {
        emailStatusMessage = "No LOW/HIGH alerts — emails are only sent for warning (LOW) and critical (HIGH), not MEDIUM.";
      } else {
        const readingsForEmail = latest != null ? { [chosenNode]: latest } : {};
        for (const a of emailEligible) {
          emailAttempted += 1;
          try {
            const res = await sendAlertEmail(a, notificationEmail, readingsForEmail);
            if (res?.success) emailSent += 1;
          } catch (_) {}
        }
        emailStatusMessage = emailSent === emailAttempted
          ? `Sent ${emailSent}/${emailAttempted} email notification(s).`
          : `Sent ${emailSent}/${emailAttempted} email notification(s); check EmailJS configuration/logs.`;
      }

      const sorted = [...filtered].sort(
        (a, b) => severityRank(b.severity) - severityRank(a.severity) || (b.timestamp || 0) - (a.timestamp || 0)
      );
      const primaryHighest = sorted[0] || null;
      const focusParam =
        scenario.spec?.mode === "threshold_exact"
          ? scenario.spec.parameter
          : scenario.spec?.mode === "persistence_do"
            ? "dissolvedOxygen"
            : null;
      const focusAlert = focusParam ? findThresholdAlertForParameter(sorted, focusParam) : null;
      const primary = focusAlert || primaryHighest;
      const evaluation = scoreScenarioRun(sorted, scenario.spec || {});
      const omittedAlertCount = Math.max(0, computed.length - filtered.length);
      setScenarioOutput({
        expected: scenario.expected,
        nodeId: chosenNode,
        readingTs: latest?.timestamp ?? null,
        alerts: sorted,
        primary,
        omittedAlertCount,
        email: {
          expected: shouldSendEmail,
          attempted: emailAttempted,
          sent: emailSent,
          status: emailStatusMessage,
          target: notificationEmail || null,
        },
        evaluation,
      });
    } catch (e) {
      setScenarioError(e?.message || "Scenario failed");
    } finally {
      setScenarioRunning(false);
    }
  }, [SCENARIOS, scenarioId, scenarioNodeId, evalConfig.nodeId, nodes]);

  // Derived: expected packet count
  // - The CONFIG panel "Expected packets" should always reflect the current inputs.
  // - The RESULTS "Expected" metric may use the actual test run window when analysing a test run.
  const configDurationMs = toDurationMs(evalConfig.durationValue, evalConfig.durationUnit);
  const configIntervalMs = toFreqMs(evalConfig.freqValue, evalConfig.freqUnit);
  const expectedFromConfig =
    configDurationMs > 0 && configIntervalMs > 0 ? Math.ceil(configDurationMs / configIntervalMs) : null;
  const expectedSubLabelConfig =
    `${formatDuration(evalConfig.durationValue, evalConfig.durationUnit)} ÷ ${evalConfig.freqValue} ${evalConfig.freqUnit}`;

  const effectiveRunMeta =
    testRun?.id && (evalConfig.onlyTestRun || testRun?.id === lastTestRunId)
      ? {
          id: testRun.id,
          startedAt: testRun.startedAt ?? null,
          endsAt: testRun.endsAt ?? null,
          intervalMs: testRun.intervalMs ?? null,
          durationMs: testRun.durationMs ?? null,
        }
      : lastTestRunMeta;

  const runDurationMs =
    effectiveRunMeta?.endsAt != null && effectiveRunMeta?.startedAt != null
      ? Math.max(0, Number(effectiveRunMeta.endsAt) - Number(effectiveRunMeta.startedAt))
      : (effectiveRunMeta?.durationMs != null ? Number(effectiveRunMeta.durationMs) : null);

  const runIntervalMs = effectiveRunMeta?.intervalMs != null ? Number(effectiveRunMeta.intervalMs) : null;
  const expectedFromRun =
    runDurationMs != null && runDurationMs > 0 && runIntervalMs != null && runIntervalMs > 0
      ? Math.ceil(runDurationMs / runIntervalMs)
      : null;

  const expectedSubLabelRun =
    runDurationMs != null && runIntervalMs != null
      ? `${Math.round(runDurationMs / 1000)} seconds ÷ ${(runIntervalMs / 1000).toFixed(runIntervalMs % 1000 === 0 ? 0 : 1)} seconds`
      : null;

  // Top panel always shows config-based expected
  const expectedPackets = expectedFromConfig;

  // Range Test: chart data per node (RSSI / SNR vs packet index) from raw rows
  const rangeTestChartDataByNode = useMemo(() => {
    const raw = evalResult?.rawRows;
    if (!raw || !Array.isArray(raw) || raw.length === 0) return {};
    const byNode = {};
    raw.forEach((r) => {
      const nid = r.node_id || "?";
      if (!byNode[nid]) byNode[nid] = [];
      byNode[nid].push(r);
    });
    const out = {};
    Object.entries(byNode).forEach(([nid, rows]) => {
      const withSeq = rows
        .filter((r) => r.seq != null && Number.isFinite(Number(r.seq)))
        .map((r) => ({ ...r, seq: Number(r.seq) }));
      withSeq.sort((a, b) => a.seq - b.seq);
      const hasRssi = withSeq.some((r) => r.rssi != null && Number.isFinite(Number(r.rssi)));
      const hasSnr = withSeq.some((r) => r.snr != null && Number.isFinite(Number(r.snr)));
      if (!hasRssi && !hasSnr) return;
      const labels = withSeq.map((r) => String(r.seq));
      out[nid] = {
        labels,
        datasets: [
          ...(hasRssi
            ? [{
                label: "RSSI (dBm)",
                data: withSeq.map((r) => (r.rssi != null && Number.isFinite(Number(r.rssi)) ? Number(r.rssi) : null)),
                borderColor: "rgb(75, 192, 192)",
                backgroundColor: "rgba(75, 192, 192, 0.1)",
                yAxisID: "y",
                spanGaps: true,
              }]
            : []),
          ...(hasSnr
            ? [{
                label: "SNR (dB)",
                data: withSeq.map((r) => (r.snr != null && Number.isFinite(Number(r.snr)) ? Number(r.snr) : null)),
                borderColor: "rgb(255, 159, 64)",
                backgroundColor: "rgba(255, 159, 64, 0.1)",
                yAxisID: "y1",
                spanGaps: true,
              }]
            : []),
        ],
      };
    });
    return out;
  }, [evalResult?.rawRows]);

  // Live range: same chart data shape from polled packets during active test
  const liveRangeChartDataByNode = useMemo(() => {
    const raw = liveRangeRows;
    if (!raw || !Array.isArray(raw) || raw.length === 0) return {};
    const byNode = {};
    raw.forEach((r) => {
      const nid = r.node_id || "?";
      if (!byNode[nid]) byNode[nid] = [];
      byNode[nid].push(r);
    });
    const out = {};
    Object.entries(byNode).forEach(([nid, rows]) => {
      const withSeq = rows
        .filter((r) => r.seq != null && Number.isFinite(Number(r.seq)))
        .map((r) => ({ ...r, seq: Number(r.seq) }));
      withSeq.sort((a, b) => a.seq - b.seq);
      const hasRssi = withSeq.some((r) => r.rssi != null && Number.isFinite(Number(r.rssi)));
      const hasSnr = withSeq.some((r) => r.snr != null && Number.isFinite(Number(r.snr)));
      if (!hasRssi && !hasSnr) return;
      const labels = withSeq.map((r) => String(r.seq));
      out[nid] = {
        labels,
        datasets: [
          ...(hasRssi
            ? [{
                label: "RSSI (dBm)",
                data: withSeq.map((r) => (r.rssi != null && Number.isFinite(Number(r.rssi)) ? Number(r.rssi) : null)),
                borderColor: "rgb(75, 192, 192)",
                backgroundColor: "rgba(75, 192, 192, 0.1)",
                yAxisID: "y",
                spanGaps: true,
              }]
            : []),
          ...(hasSnr
            ? [{
                label: "SNR (dB)",
                data: withSeq.map((r) => (r.snr != null && Number.isFinite(Number(r.snr)) ? Number(r.snr) : null)),
                borderColor: "rgb(255, 159, 64)",
                backgroundColor: "rgba(255, 159, 64, 0.1)",
                yAxisID: "y1",
                spanGaps: true,
              }]
            : []),
        ],
      };
    });
    return out;
  }, [liveRangeRows]);

  // ── IoT Evaluation ───────────────────────────────────────────────────────

  const runEvaluation = useCallback(async () => {
    evalAbortRef.current = false;
    setEvalRunning(true);
    setEvalResult(null);
    setEvalError(null);

    try {
      const { dateFrom, dateTo, nodeId, metrics, onlyTestRun } = evalConfig;
      const nodeArg = nodeId === "all" ? undefined : nodeId;
      const useRun = Boolean(onlyTestRun && lastTestRunId);

      if (onlyTestRun && !lastTestRunId) {
        setEvalError('Enable "Only test-run packets" requires starting a test run first.');
        setEvalRunning(false);
        return;
      }

      const [perfRows, alertRows] = await Promise.all([
        metrics.e2e || metrics.pdr || metrics.availability
          ? api.getPerformanceReadings({ startDate: dateFrom, endDate: dateTo, nodeId: nodeArg, limit: 2000 })
          : Promise.resolve([]),
        metrics.alerts
          ? api.getPerformanceAlerts({ startDate: dateFrom, endDate: dateTo, nodeId: nodeArg, limit: 500 })
          : Promise.resolve([]),
      ]);

      let runMeta = null;
      if (useRun) {
        try {
          const run = await api.getTestRun(lastTestRunId);
          if (run?.id) {
            runMeta = {
              id: run.id,
              startedAt: run.started_at ?? null,
              endsAt: run.ends_at ?? null,
              intervalMs: run.interval_ms ?? null,
              durationMs: run.duration_ms ?? null,
            };
            setLastTestRunMeta(runMeta);
          }
        } catch (_) {
          // Best effort; analysis can still proceed with just test_run_id filtering.
        }
      }

      let perfRowsFiltered = perfRows;
      let usedTestRunFilter = false;
      if ((metrics.e2e || metrics.pdr || metrics.availability) && useRun) {
        const runRows = await api.getPerformanceReadings({ testRunId: lastTestRunId, nodeId: nodeArg, limit: 5000 });
        if (runRows.length > 0) {
          perfRowsFiltered = runRows;
          usedTestRunFilter = true;
        } else {
          // Bridge may have missed the test_start command — fall back to date-range query
          perfRowsFiltered = perfRows;
          usedTestRunFilter = false;
        }
      }

      if (evalAbortRef.current) { setEvalRunning(false); return; }

      // Derive expected-per-node from the actual run meta when available, else fall back to config.
      const evalExpected = (() => {
        const durMs = runMeta?.durationMs != null ? Number(runMeta.durationMs)
          : (runMeta?.endsAt != null && runMeta?.startedAt != null
              ? Math.max(0, Number(runMeta.endsAt) - Number(runMeta.startedAt))
              : null);
        const ivMs = runMeta?.intervalMs != null ? Number(runMeta.intervalMs) : null;
        if (durMs != null && durMs > 0 && ivMs != null && ivMs > 0) return Math.ceil(durMs / ivMs);
        return expectedPackets ?? null;
      })();

      // Store the formula used for expected (so results stay fixed when user changes config later)
      const expectedFormulaUsed = (() => {
        if (usedTestRunFilter && runMeta) {
          const fromRun = computeExpectedFromRunMeta(runMeta);
          if (fromRun.formula) return fromRun.formula;
        }
        return expectedSubLabelConfig;
      })();

      const nodeMetrics = computeIoTMetrics(perfRowsFiltered, nodeId, evalExpected);
      const alertMetrics = metrics.alerts ? computeAlertMetrics(alertRows, perfRowsFiltered) : null;

      setEvalResult({
        nodeMetrics,
        alertMetrics,
        rowCount: perfRowsFiltered.length,
        rawRows: perfRowsFiltered,
        testRunId: usedTestRunFilter ? lastTestRunId : null,
        testRunMeta: usedTestRunFilter ? runMeta : null,
        testRunFallback: useRun && !usedTestRunFilter,
        expectedUsed: evalExpected,
        expectedFormulaUsed,
      });

      // Use this run's params as default for the next test (date stays current)
      if (runMeta) {
        const today = todayLocalYMD();
        setEvalConfig((c) => ({
          ...c,
          ...runMetaToConfigForm(runMeta),
          dateFrom: today,
          dateTo: today,
        }));
      }
    } catch (err) {
      setEvalError(String(err.message || err));
    }

    setEvalRunning(false);
  }, [evalConfig, lastTestRunId]);

  // ── Live Test Run ─────────────────────────────────────────────────────────

  const startTest = useCallback(async () => {
    setTestRunError(null);
    const durationMs = toDurationMs(evalConfig.durationValue, evalConfig.durationUnit);
    const intervalMs = toFreqMs(evalConfig.freqValue, evalConfig.freqUnit);
    if (!durationMs || !intervalMs) {
      setTestRunError("Set a valid duration and transmission frequency before starting.");
      return;
    }
    try {
      await ctxStartTest({ durationMs, intervalMs, nodeId: evalConfig.nodeId });
      setEvalConfig((c) => ({ ...c, onlyTestRun: true }));
    } catch (err) {
      const msg = String(err.message || err);
      const isNetworkErr = msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("networkerror");
      setTestRunError(
        isNetworkErr
          ? "Cannot reach the local backend server. Make sure it is running (cd server && npm start) and that REACT_APP_API_URL is set to http://localhost:5000/api in client/.env, then restart the dev server."
          : msg
      );
    }
  }, [evalConfig, ctxStartTest]);

  // Auto-stop: if received packets reach Expected, stop early and note remaining time.
  useEffect(() => {
    if (!testRun?.id) return;
    if (!expectedPackets || expectedPackets <= 0) return;

    autoStopTriggeredRef.current = false;

    let cancelled = false;
    const poll = async () => {
      if (cancelled || autoStopTriggeredRef.current || !testRun?.id) return;
      try {
        const nodeArg = evalConfig.nodeId === "all" ? undefined : evalConfig.nodeId;
        const rows = await api.getPerformanceReadings({ testRunId: testRun.id, nodeId: nodeArg, limit: 5000 });
        if (cancelled || autoStopTriggeredRef.current) return;

        // Count unique seq per node (handles duplicates due to retries / double-ingest)
        const perNode = {};
        for (const r of rows || []) {
          const nid = r.node_id;
          const s = r.seq;
          if (!nid || s == null) continue;
          if (!perNode[nid]) perNode[nid] = new Set();
          perNode[nid].add(Number(s));
        }

        const nodeIds = Object.keys(perNode);
        if (nodeArg) {
          const received = perNode[nodeArg]?.size ?? 0;
          if (received >= expectedPackets) {
            autoStopTriggeredRef.current = true;
            const remainingMs = Math.max(0, (testRun.endsAt ?? Date.now()) - Date.now());
            markAutoStopped(`Auto-stopped after reaching expected packets. Remaining time: ${formatCountdown(remainingMs)}.`);
            await stopTest();
          }
        } else {
          // All nodes: stop once every node that has started sending has reached expectedPackets.
          if (nodeIds.length > 0 && nodeIds.every((nid) => (perNode[nid]?.size ?? 0) >= expectedPackets)) {
            autoStopTriggeredRef.current = true;
            const remainingMs = Math.max(0, (testRun.endsAt ?? Date.now()) - Date.now());
            markAutoStopped(`Auto-stopped after all nodes reached expected packets. Remaining time: ${formatCountdown(remainingMs)}.`);
            await stopTest();
          }
        }
      } catch (_) {
        // ignore transient errors; poll continues
      }
    };

    const id = setInterval(poll, 2000);
    poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [testRun?.id, testRun?.endsAt, expectedPackets, evalConfig.nodeId, stopTest, markAutoStopped]);

  // ── Render helpers ───────────────────────────────────────────────────────

  const evalNodeIds = evalResult ? Object.keys(evalResult.nodeMetrics) : [];
  const expectedFromEvalRun = evalResult?.testRunMeta ? computeExpectedFromRunMeta(evalResult.testRunMeta) : { expected: null, formula: null };

  // Auto-open results when a new analysis completes
  useEffect(() => {
    if (evalResult) setEvalResultsOpen(true);
  }, [evalResult]);

  // If the user changes the "Only test-run packets" filter, invalidate any existing results.
  // This prevents confusion where results were computed from a different filter setting.
  useEffect(() => {
    if (evalResult) setEvalResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalConfig.onlyTestRun]);

  return (
    <div className="perf-test-page">
      <header className="page-header perf-test-page-header">
        <div className="perf-test-header-left">
          <button
            type="button"
            className="ghost-btn perf-test-back-btn"
            onClick={() => navigate("/sensor-logs")}
            aria-label="Back to Sensor Logs"
          >
            ← Back
          </button>
          <div>
            <h1 className="page-title">Performance Test</h1>
            <p className="page-subtitle">Benchmark IoT system performance metrics</p>
          </div>
        </div>
        <PageDateWithStatus lastUpdated={lastUpdated} className="page-meta" showClassification={false} />
      </header>

      {/* ── IoT Performance Evaluation ── */}
      <section className="perf-section card">
        <div className="perf-section-header">
          <div>
            <h2 className="perf-section-title">IoT Performance Evaluation</h2>
            <p className="perf-section-desc">
              Computes E2E latency, PDR, PLR, Availability, alert trigger latency (cause→backend), and email sending from real LoRa packet timestamps
            </p>
          </div>
        </div>

        {/* Config panel + Alert Responsiveness side by side */}
        <div className="eval-top-row">
        <div className="eval-config">
          <div className="eval-config-row">
            <label className="eval-config-label">
              Date from
              <input
                type="date"
                className="eval-config-input"
                value={evalConfig.dateFrom}
                min={todayYMD}
                max={todayYMD}
                onChange={() => setEvalConfig((c) => ({ ...c, dateFrom: todayYMD }))}
              />
            </label>
            <label className="eval-config-label">
              Date to
              <input
                type="date"
                className="eval-config-input"
                value={evalConfig.dateTo}
                min={todayYMD}
                max={todayYMD}
                onChange={() => setEvalConfig((c) => ({ ...c, dateTo: todayYMD }))}
              />
            </label>
            <label className="eval-config-label">
              Target node
              <select
                className="eval-config-input"
                value={evalConfig.nodeId}
                onChange={(e) => setEvalConfig((c) => ({ ...c, nodeId: e.target.value }))}
              >
                <option value="all">All nodes</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.id} — {n.name || n.id}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="eval-config-row">
            <label className="eval-config-label">
              Test duration
              <div className="eval-config-compound">
                <input
                  type="number"
                  className="eval-config-input eval-config-input--num"
                  min="1"
                  value={evalConfig.durationValue}
                  onChange={(e) => setEvalConfig((c) => ({ ...c, durationValue: e.target.value }))}
                  aria-label="Duration value"
                />
                <select
                  className="eval-config-input eval-config-input--unit"
                  value={evalConfig.durationUnit}
                  onChange={(e) => setEvalConfig((c) => ({ ...c, durationUnit: e.target.value }))}
                  aria-label="Duration unit"
                >
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              </div>
            </label>
            <label className="eval-config-label">
              Transmission frequency
              <div className="eval-config-compound">
                <input
                  type="number"
                  className="eval-config-input eval-config-input--num"
                  min="1"
                  value={evalConfig.freqValue}
                  onChange={(e) => setEvalConfig((c) => ({ ...c, freqValue: e.target.value }))}
                  aria-label="Frequency value"
                />
                <select
                  className="eval-config-input eval-config-input--unit"
                  value={evalConfig.freqUnit}
                  onChange={(e) => setEvalConfig((c) => ({ ...c, freqUnit: e.target.value }))}
                  aria-label="Frequency unit"
                >
                  <option value="seconds">sec interval</option>
                  <option value="minutes">min interval</option>
                  <option value="hours">hr interval</option>
                </select>
              </div>
            </label>
            {expectedPackets != null && (
              <div className="eval-expected-packets">
                <span className="eval-expected-packets-label">Expected packets</span>
                <span className="eval-expected-packets-value">{expectedPackets}</span>
                <span className="eval-expected-packets-sub">
                  {expectedSubLabelConfig}
                </span>
              </div>
            )}
          </div>
          <div className="eval-config-row eval-config-metrics-row">
            <span className="eval-config-label-text">Include metrics:</span>
            {[
              { key: "e2e", label: "E2E Latency" },
              { key: "pdr", label: "PDR / PLR" },
              { key: "availability", label: "Availability" },
              { key: "alerts", label: "Alert Responsiveness" },
            ].map(({ key, label }) => (
              <label key={key} className="eval-config-checkbox">
                <input
                  type="checkbox"
                  checked={evalConfig.metrics[key]}
                  onChange={(e) =>
                    setEvalConfig((c) => ({ ...c, metrics: { ...c.metrics, [key]: e.target.checked } }))
                  }
                />
                {label}
              </label>
            ))}
            <label className="eval-config-checkbox" title={lastTestRunId ? `Test run ID: ${lastTestRunId}` : "Start a test run to enable this filter."}>
              <input
                type="checkbox"
                checked={evalConfig.onlyTestRun}
                onChange={(e) => setEvalConfig((c) => ({ ...c, onlyTestRun: e.target.checked }))}
              />
              Only test-run packets
            </label>
          </div>
          <div className="eval-config-actions">
            {/* ── Live Test Run buttons ── */}
            {!testRun ? (
              <button
                type="button"
                className="perf-test-run-btn eval-start-test-btn"
                onClick={startTest}
                title="Start a timed test run — the backend will tag all incoming packets with this run's ID"
              >
                ▶ Start Test
              </button>
            ) : (
              <button
                type="button"
                className="perf-test-stop-btn"
                onClick={stopTest}
              >
                ■ Stop Test
              </button>
            )}

            {/* ── Evaluate (post-run analysis) ── */}
            <div className="eval-actions-divider" aria-hidden />
            {!evalRunning ? (
              <button type="button" className="ghost-btn eval-analyse-btn" onClick={runEvaluation}>
                {evalResult ? "Re-analyse" : "Analyse"}
              </button>
            ) : (
              <button type="button" className="perf-test-stop-btn" onClick={() => { evalAbortRef.current = true; setEvalRunning(false); }}>
                Stop
              </button>
            )}
            {evalResult && !evalRunning && (
              <button
                type="button"
                className="ghost-btn eval-export-btn"
                onClick={() => exportEvalCSV(evalResult, evalConfig, nodeNames, rangeTestDistance)}
              >
                Export CSV
              </button>
            )}
            {lastTestRunId && !evalRunning && (
              <button
                type="button"
                className="ghost-btn eval-packets-btn"
                onClick={() => setPacketsModalOpen(true)}
                title={`View raw packets for test run ${lastTestRunId}`}
              >
                View Packets
              </button>
            )}
          </div>
        </div>{/* end eval-config */}

        {/* ── Alert Responsiveness — right panel (same row as config) ── */}
        <div className="eval-alert-panel">
          <div className="eval-alert-panel-title">Alert Responsiveness</div>
          {evalResult && evalConfig.metrics.alerts && evalResult.alertMetrics ? (
            <div className="eval-metric-group">
              <div className="eval-metric-row">
                <EvalMetric label="Alerts triggered" value={evalResult.alertMetrics.count} />
                <EvalMetric
                  label="Mean response"
                  value={fmtLatMs(evalResult.alertMetrics.meanMs)}
                  highlight={
                    evalResult.alertMetrics.meanMs != null
                      ? evalResult.alertMetrics.meanMs < 5000 ? "ok" : evalResult.alertMetrics.meanMs < 15000 ? "warn" : "bad"
                      : null
                  }
                />
                <EvalMetric label="Max response" value={fmtLatMs(evalResult.alertMetrics.maxMs)} />
              </div>
              {(evalResult.alertMetrics.triggerLatencySamples > 0) && (
                <div className="eval-metric-row" style={{ marginTop: "6px" }}>
                  <EvalMetric
                    label="Trigger latency (mean)"
                    value={fmtLatMs(evalResult.alertMetrics.triggerLatencyMeanMs)}
                    formula="Cause reading → backend receive"
                    highlight={
                      evalResult.alertMetrics.triggerLatencyMeanMs != null
                        ? evalResult.alertMetrics.triggerLatencyMeanMs < 30000 ? "ok" : evalResult.alertMetrics.triggerLatencyMeanMs < 120000 ? "warn" : "bad"
                        : null
                    }
                  />
                  <EvalMetric label="Trigger latency (max)" value={fmtLatMs(evalResult.alertMetrics.triggerLatencyMaxMs)} />
                  <EvalMetric label="Samples" value={evalResult.alertMetrics.triggerLatencySamples} />
                </div>
              )}
              {(evalResult.alertMetrics.emailSentCount > 0) && (
                <div className="eval-metric-row" style={{ marginTop: "6px" }}>
                  <EvalMetric label="Emails sent" value={evalResult.alertMetrics.emailSentCount} />
                  <EvalMetric
                    label="Email delay (mean)"
                    value={fmtLatMs(evalResult.alertMetrics.emailDelayMeanMs)}
                    formula="Backend receive → email sent"
                    highlight={
                      evalResult.alertMetrics.emailDelayMeanMs != null
                        ? evalResult.alertMetrics.emailDelayMeanMs < 10000 ? "ok" : evalResult.alertMetrics.emailDelayMeanMs < 60000 ? "warn" : "bad"
                        : null
                    }
                  />
                  <EvalMetric label="Email delay (max)" value={fmtLatMs(evalResult.alertMetrics.emailDelayMaxMs)} />
                </div>
              )}
              {evalResult.alertMetrics.meanMs == null && (
                <p className="eval-no-chain-data">
                  No t_alert_trigger timestamps found. Ensure the backend is writing this field to the alerts table.
                </p>
              )}
            </div>
          ) : (
            <p className="eval-alert-panel-idle">
              {!evalResult
                ? "Run analysis to see alert responsiveness results."
                : !evalConfig.metrics.alerts
                  ? `Enable "Alert Responsiveness" in the metrics checkboxes.`
                  : "No alert data found for this date range."}
            </p>
          )}

          {/* Live countdown sits here too */}
          {testRun && (
            <div className="eval-testrun-banner" style={{marginTop: "auto"}}>
              <span className="perf-test-spinner" />
              <div className="eval-testrun-banner-text">
                <span className="eval-testrun-label">Test run active</span>
                <span className="eval-testrun-id">ID: {testRun.id}</span>
              </div>
              <div className="eval-testrun-countdown">
                <span className="eval-testrun-countdown-value">{countdownFormatted ?? formatCountdown(countdown)}</span>
                <span className="eval-testrun-countdown-label">remaining</span>
              </div>
            </div>
          )}
        </div>

        </div>{/* end eval-top-row */}

        {/* ── Range Test (Live): updates every 4 s while test runs ── */}
        {testRun && (
          <div className="range-test-live">
            <div className="range-test-live-header">
              <h3 className="range-test-live-title">Range Test (Live)</h3>
              <p className="range-test-live-desc">
                RSSI and SNR update every {LIVE_RANGE_POLL_MS / 1000} s. Move the node to see signal strength change in real time.
              </p>
            </div>
            {Object.keys(liveRangeChartDataByNode).length === 0 ? (
              <p className="range-test-live-empty">Waiting for packets… Send a test packet from the node to see the chart.</p>
            ) : (
              <div className="range-test-charts">
                {Object.entries(liveRangeChartDataByNode).map(([nid, chartData]) => {
                  const name = nodeNames[nid] ? `${nid} — ${nodeNames[nid]}` : nid;
                  const options = {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: { legend: { position: "top" } },
                    scales: {
                      x: { title: { display: true, text: "Packet (seq)" }, grid: { display: true } },
                      y: {
                        type: "linear",
                        position: "left",
                        title: { display: true, text: "RSSI (dBm)" },
                        min: -120,
                        max: -30,
                      },
                      y1: {
                        type: "linear",
                        position: "right",
                        title: { display: true, text: "SNR (dB)" },
                        grid: { drawOnChartArea: false },
                      },
                    },
                  };
                  return (
                    <div key={nid} className="range-test-chart-wrap">
                      <h4 className="range-test-chart-title">{name}</h4>
                      <div className="range-test-chart-inner">
                        <Line data={chartData} options={options} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Test run error ── */}
        {testRunError && (
          <div className="eval-error-banner">{testRunError}</div>
        )}

        {autoStopNote && (
          <div className="eval-info-banner">{autoStopNote}</div>
        )}

        {/* ── Evaluation running indicator ── */}
        {evalRunning && (
          <div className="eval-running-banner">
            <span className="perf-test-spinner" />
            Fetching and computing metrics…
          </div>
        )}

        {/* Error */}
        {evalError && !evalRunning && (
          <div className="eval-error-banner">
            Evaluation failed: {evalError}
          </div>
        )}

        {/* Results */}
        {evalResult && !evalRunning && (
          <div className="eval-results">
            <div className="eval-results-header">
              <p className="eval-results-meta">
                Analysed <strong>{evalResult.rowCount}</strong> packets across{" "}
                <strong>{evalNodeIds.length}</strong> node{evalNodeIds.length !== 1 ? "s" : ""}
                {" "}
                {evalResult.testRunId
                  ? `(test run ${String(evalResult.testRunId).slice(0, 8)}…)`
                  : `(${evalConfig.dateFrom} → ${evalConfig.dateTo})`}
                {evalResult.testRunFallback && (
                  <span className="eval-results-meta-warn" title="No packets were tagged with this test run ID — the bridge may have missed the test_start command. Showing all packets for today instead.">
                    {" "}⚠ test-run filter returned 0 packets; showing all today's packets
                  </span>
                )}
              </p>
              <button
                type="button"
                className="ghost-btn perf-collapse-toggle"
                onClick={() => setEvalResultsOpen((v) => !v)}
                aria-expanded={evalResultsOpen}
              >
                {evalResultsOpen ? "Collapse" : "Expand"}
                <span className={`perf-collapse-chevron${evalResultsOpen ? " is-open" : ""}`} aria-hidden="true">▾</span>
              </button>
            </div>

            <div className={`perf-collapse${evalResultsOpen ? " is-open" : ""}`}>
              <div className="perf-collapse-inner">
                {/* Per-node metric cards */}
                {evalNodeIds.length === 0 ? (
                  <div className="eval-no-data">
                    <p>No packets found{evalResult.testRunId ? " for this test run" : " in this date range"}.</p>
                    {evalResult.testRunId ? (
                      <p style={{marginTop: "6px", fontSize: "0.85em", opacity: 0.8}}>
                        Packets are tagged with a test run ID only when the bridge receives the <code>test_start</code> command before they arrive.
                        Uncheck <strong>"Only test-run packets"</strong> and click <strong>Re-analyse</strong> to see all packets for today regardless of test run.
                      </p>
                    ) : (
                      <p style={{marginTop: "6px", fontSize: "0.85em", opacity: 0.8}}>
                        Ensure the firmware is transmitting <code>seq</code> and timestamp chain fields (<code>t_fwd_rx</code>, <code>t_be_rx</code>).
                      </p>
                    )}
                  </div>
                ) : (
                  evalNodeIds.map((nid) => {
                    const m = evalResult.nodeMetrics[nid];
                    const nodeName = nodeNames[nid] ? `${nid} — ${nodeNames[nid]}` : nid;
                    return (
                      <div key={nid} className="eval-node-card">
                        <div className="eval-node-card-title">{nodeName}</div>

                        <div className="eval-node-card-body">
                          {/* ── Left column: counts + reliability ── */}
                          <div className="eval-node-col">
                            {/* Packet counts */}
                            <div className="eval-metric-group">
                              <div className="eval-metric-group-label">Packet Statistics</div>
                              <div className="eval-metric-row">
                                {(() => {
                                  // Use the expected value stored at analysis time so results stay fixed when user changes config
                                  const expectedValue = evalResult.expectedUsed != null
                                    ? evalResult.expectedUsed
                                    : (expectedFromEvalRun.expected != null ? expectedFromEvalRun.expected : expectedPackets);
                                  const expectedFormula = evalResult.expectedFormulaUsed
                                    ? evalResult.expectedFormulaUsed
                                    : (expectedFromEvalRun.formula || expectedSubLabelConfig);
                                  return expectedValue != null ? (
                                    <EvalMetric label="Expected" value={expectedValue} formula={expectedFormula} />
                                  ) : null;
                                })()}
                                <EvalMetric label="Sent (inferred)" value={m.totalSent} />
                                <EvalMetric label="Received" value={m.totalReceived} />
                                <EvalMetric
                                  label="Lost"
                                  value={m.missingSeqs}
                                  highlight={m.missingSeqs > 0 ? "warn" : "ok"}
                                />
                              </div>
                            </div>

                            {/* PDR / PLR / Availability */}
                            {(evalConfig.metrics.pdr || evalConfig.metrics.availability) && (
                              <div className="eval-metric-group">
                                <div className="eval-metric-group-label">Reliability</div>
                                <div className="eval-metric-row">
                                  {evalConfig.metrics.pdr && (
                                    <>
                                      <EvalMetric
                                        label="PDR"
                                        value={fmtPct(m.pdr)}
                                        highlight={m.pdr != null ? (m.pdr >= 90 ? "ok" : m.pdr >= 70 ? "warn" : "bad") : null}
                                        formula="received / sent × 100"
                                      />
                                      <EvalMetric
                                        label="PLR"
                                        value={fmtPct(m.plr)}
                                        highlight={m.plr != null ? (m.plr <= 10 ? "ok" : m.plr <= 30 ? "warn" : "bad") : null}
                                        formula="(sent − received) / sent × 100"
                                      />
                                    </>
                                  )}
                                  {evalConfig.metrics.availability && (
                                    <EvalMetric
                                      label="Availability"
                                      value={fmtPct(m.availability)}
                                      highlight={m.availability != null ? (m.availability >= 90 ? "ok" : m.availability >= 70 ? "warn" : "bad") : null}
                                      formula="received / (received + lost) × 100"
                                    />
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* ── Right column: E2E Latency ── */}
                          {evalConfig.metrics.e2e && (
                            <div className="eval-node-col eval-node-col--right">
                              <div className="eval-metric-group">
                                <div className="eval-metric-group-label">
                                  Latency (Fwd &#8594; Backend)
                                  {m.e2eSampleCount > 0 && (
                                    <span className="eval-metric-group-sub"> ({m.e2eSampleCount} samples)</span>
                                  )}
                                </div>
                                {m.e2eSampleCount === 0 ? (
                                  <p className="eval-no-chain-data">
                                    No timestamp chain data (t_fwd_rx / t_be_rx) available for this node yet.
                                  </p>
                                ) : (
                                  <>
                                    <div className="eval-metric-row">
                                      <EvalMetric label="Mean" value={fmtLatMs(m.e2eMean)} />
                                      <EvalMetric label="p95" value={fmtLatMs(m.e2eP95)} />
                                      <EvalMetric label="Max" value={fmtLatMs(m.e2eMax)} />
                                    </div>
                                    {m.fwdToDashMean != null && (
                                      <div className="eval-metric-group" style={{marginTop: "10px"}}>
                                        <div className="eval-metric-group-label">Fwd &#8594; Dashboard (live)</div>
                                        <div className="eval-metric-row">
                                          <EvalMetric label="Mean" value={fmtLatMs(m.fwdToDashMean)} />
                                        </div>
                                      </div>
                                    )}
                                    {(m.fwdProcMean != null || m.mqttBackendMean != null || m.nodeToFwdMean != null) && (
                                      <div className="eval-metric-group" style={{marginTop: "10px"}}>
                                        <div className="eval-metric-group-label">Component Delays (mean)</div>
                                        <div className="eval-metric-row">
                                          {m.fwdProcMean != null && (
                                            <EvalMetric label="Fwd internal" value={fmtLatMs(m.fwdProcMean)} formula="t_fwd_pub − t_fwd_rx" />
                                          )}
                                          {m.mqttBackendMean != null && (
                                            <EvalMetric label="MQTT / BE" value={fmtLatMs(m.mqttBackendMean)} formula="t_be_rx − t_fwd_pub" />
                                          )}
                                          {m.nodeToFwdMean != null && (
                                            <EvalMetric label="Node &#8594; Fwd" value={fmtLatMs(m.nodeToFwdMean)} formula="t_fwd_rx − t_node (NTP req'd)" />
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          )}

                          {/* ── Link Quality (RSSI / SNR) ── */}
                          {m.linkSampleCount > 0 && (
                            <div className="eval-node-col eval-node-col--link">
                              <div className="eval-metric-group">
                                <div className="eval-metric-group-label">
                                  Link Quality
                                  <span className="eval-metric-group-sub"> ({m.linkSampleCount} samples)</span>
                                </div>
                                <div className="eval-metric-row">
                                  <EvalMetric
                                    label="RSSI mean"
                                    value={m.rssiMean != null ? `${Math.round(m.rssiMean)} dBm` : "—"}
                                    highlight={m.rssiMean != null ? (m.rssiMean > -70 ? "ok" : m.rssiMean > -90 ? "warn" : "bad") : null}
                                    formula="Signal strength (dBm); > −70 good, −70–−90 fair, < −90 weak"
                                  />
                                  <EvalMetric
                                    label="RSSI min"
                                    value={m.rssiMin != null ? `${m.rssiMin} dBm` : "—"}
                                    highlight={m.rssiMin != null ? (m.rssiMin > -70 ? "ok" : m.rssiMin > -90 ? "warn" : "bad") : null}
                                  />
                                  <EvalMetric
                                    label="SNR mean"
                                    value={m.snrMean != null ? `${m.snrMean.toFixed(1)} dB` : "—"}
                                    highlight={m.snrMean != null ? (m.snrMean > 5 ? "ok" : m.snrMean >= 0 ? "warn" : "bad") : null}
                                    formula="Signal-to-noise ratio (dB); > 5 good, 0–5 fair, < 0 poor"
                                  />
                                  <EvalMetric
                                    label="SNR min"
                                    value={m.snrMin != null ? `${m.snrMin} dB` : "—"}
                                    highlight={m.snrMin != null ? (m.snrMin > 5 ? "ok" : m.snrMin >= 0 ? "warn" : "bad") : null}
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        )}
      </section>

      {/* ── Range Test (RSSI/SNR vs packet for distance testing) ── */}
      {evalResult?.rawRows?.length > 0 && Object.keys(rangeTestChartDataByNode).length > 0 && (
        <section className="perf-section range-test-section" aria-labelledby="range-test-title">
          <div className="perf-section-header">
            <div>
              <h2 id="range-test-title" className="perf-section-title">Range Test</h2>
              <p className="perf-section-desc">
                Signal strength (RSSI) and signal-to-noise (SNR) over the run. Use to test node–forwarder distance: start a test, move the node, then Analyse. Stronger signal (RSSI &gt; −70 dBm, SNR &gt; 5 dB) indicates better range.
              </p>
            </div>
            <div className="range-test-distance-wrap">
              <label className="range-test-distance-label">
                Distance (m)
                <input
                  type="text"
                  className="range-test-distance-input"
                  placeholder="e.g. 50"
                  value={rangeTestDistance}
                  onChange={(e) => setRangeTestDistance(e.target.value)}
                  title="Optional: label this run with approximate distance for your records"
                />
              </label>
            </div>
          </div>
          <div className="range-test-charts">
            {Object.entries(rangeTestChartDataByNode).map(([nid, chartData]) => {
              const name = nodeNames[nid] ? `${nid} — ${nodeNames[nid]}` : nid;
              const options = {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: { legend: { position: "top" } },
                scales: {
                  x: {
                    title: { display: true, text: "Packet (seq)" },
                    grid: { display: true },
                  },
                  y: {
                    type: "linear",
                    position: "left",
                    title: { display: true, text: "RSSI (dBm)" },
                    min: (ctx) => (ctx.chart?.data?.datasets?.some((d) => d.yAxisID === "y") ? -120 : undefined),
                    max: -30,
                  },
                  y1: {
                    type: "linear",
                    position: "right",
                    title: { display: true, text: "SNR (dB)" },
                    grid: { drawOnChartArea: false },
                  },
                },
              };
              return (
                <div key={nid} className="range-test-chart-wrap">
                  <h3 className="range-test-chart-title">{name}</h3>
                  <div className="range-test-chart-inner">
                    <Line data={chartData} options={options} />
                  </div>
                </div>
              );
            })}
          </div>
          {rangeTestDistance.trim() && (
            <p className="range-test-distance-note">
              This run tagged with distance: <strong>{rangeTestDistance.trim()} m</strong> (for your records; not stored on server).
            </p>
          )}
        </section>
      )}

      {/* ── Scenario Evaluator (preset → MQTT → Supabase → output) ── */}
      <section className="perf-section card" aria-labelledby="scenario-eval-title">
        <div className="perf-section-header">
          <div>
            <h2 id="scenario-eval-title" className="perf-section-title">Scenario Evaluator</h2>
            <p className="perf-section-desc">
              Publish a preset scenario reading directly to MQTT (independent of test runs). Non-tested parameters use safe fixed values. Only alerts that belong to this scenario are shown, scored, and saved; maintenance, battery, and other parameters are excluded (with a count if anything was omitted).
            </p>
          </div>
        </div>

        <div className="eval-config" style={{ marginTop: 0 }}>
          <div className="eval-config-row" style={{ gap: "10px", flexWrap: "wrap" }}>
            <label className="eval-config-label" style={{ minWidth: 260 }}>
              Scenario
              <select className="eval-config-input" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                {SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>

            <label className="eval-config-label" style={{ minWidth: 220 }}>
              Node
              <select className="eval-config-input" value={scenarioNodeId} onChange={(e) => setScenarioNodeId(e.target.value)}>
                <option value="all">Auto (use selected)</option>
                {nodes.filter((n) => n.active !== false).map((n) => (
                  <option key={n.id} value={n.id}>{n.name ? `${n.id} — ${n.name}` : n.id}</option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" className="ghost-btn eval-analyse-btn" onClick={runScenario} disabled={scenarioRunning}>
                {scenarioRunning ? "Running…" : "Run scenario"}
              </button>
              <button
                type="button"
                className="ghost-btn scenario-eval-reset-btn"
                onClick={() => {
                  resetAlertPersistenceForTests();
                  setPersistenceResetNote(
                    "Cleared browser alert state: persistence counters, previous WQI memory, and pH hysteresis. Thresholds and database alerts are unchanged. Run your scenario again."
                  );
                }}
                title="Clears localStorage keys used for Layer 2 persistence, WQI rapid-drop previous values, and pH latch — not your Settings thresholds or Supabase."
              >
                Reset alert persistence for tests
              </button>
            </div>
          </div>

          {persistenceResetNote && (
            <p className="scenario-eval-reset-note" role="status">
              {persistenceResetNote}
            </p>
          )}

          {scenarioError && (
            <p className="eval-no-chain-data" role="alert" style={{ marginTop: "10px" }}>
              {scenarioError}
            </p>
          )}

          {scenarioOutput && (
            <div style={{ marginTop: "12px" }}>
              <div className="eval-metric-group">
                <div className="eval-metric-row">
                  <EvalMetric label="Expected" value={scenarioOutput.expected} />
                  <EvalMetric label="Node" value={scenarioOutput.nodeId} />
                  <EvalMetric label="Alerts" value={scenarioOutput.alerts.length} />
                  <EvalMetric label="Expected email" value={scenarioOutput.email?.expected ? "Yes" : "No"} />
                  <EvalMetric
                    label="Email sent"
                    value={
                      scenarioOutput.email
                        ? `${scenarioOutput.email.sent}/${scenarioOutput.email.attempted}`
                        : "—"
                    }
                  />
                </div>
              </div>
              {scenarioOutput.email?.status && (
                <p className="eval-no-chain-data" style={{ marginTop: "8px" }}>
                  <strong>Email status:</strong> {scenarioOutput.email.status}
                  {scenarioOutput.email.target ? ` (to: ${scenarioOutput.email.target})` : ""}
                </p>
              )}

              {scenarioOutput.evaluation && (
                <div className="scenario-eval-result" role="status">
                  <div className="scenario-eval-result-row">
                    <span
                      className={
                        "scenario-eval-badge" +
                        (scenarioOutput.evaluation.label === "PASS"
                          ? " scenario-eval-badge--pass"
                          : scenarioOutput.evaluation.label === "PARTIAL"
                            ? " scenario-eval-badge--partial"
                            : scenarioOutput.evaluation.label === "FAIL"
                              ? " scenario-eval-badge--fail"
                              : " scenario-eval-badge--neutral")
                      }
                    >
                      {scenarioOutput.evaluation.label}
                    </span>
                    {scenarioOutput.evaluation.score != null && (
                      <span className="scenario-eval-score">{scenarioOutput.evaluation.score}/100</span>
                    )}
                  </div>
                  {scenarioOutput.evaluation.reasons?.length > 0 && (
                    <ul className="scenario-eval-reasons">
                      {scenarioOutput.evaluation.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {scenarioOutput.primary ? (
                <div className="eval-metric-group" style={{ marginTop: "10px" }}>
                  <p className="scenario-eval-output-label">Scenario target (this run)</p>
                  <div className="eval-metric-row">
                    <EvalMetric
                      label="Actual severity"
                      value={String(scenarioOutput.primary.severity || "info").toUpperCase()}
                    />
                    <EvalMetric label="Output (title)" value={scenarioOutput.primary.title || "Alert"} />
                  </div>
                  <div className="eval-no-chain-data" style={{ marginTop: "6px" }}>
                    <strong>Detail:</strong> {scenarioOutput.primary.detail || "—"}
                  </div>
                  <div className="eval-no-chain-data" style={{ marginTop: "6px" }}>
                    <strong>Cause:</strong> {describeCause(scenarioOutput.primary)}
                  </div>
                </div>
              ) : (
                <p className="eval-no-chain-data" style={{ marginTop: "10px" }}>
                  No alerts generated for this scenario under current thresholds/settings.
                </p>
              )}

              {scenarioOutput.omittedAlertCount > 0 && (
                <p className="scenario-eval-focus-note" role="note">
                  <strong>{scenarioOutput.omittedAlertCount}</strong> other alert(s) were computed from this reading but{" "}
                  <strong>excluded from this test</strong> (not shown, not scored, not saved): e.g. maintenance, battery,
                  or parameters outside this scenario.
                </p>
              )}

              {scenarioOutput.alerts.length > 1 && (
                <details style={{ marginTop: "10px" }}>
                  <summary className="ghost-btn" style={{ display: "inline-flex" }}>Show all alerts</summary>
                  <div style={{ marginTop: "10px" }}>
                    {scenarioOutput.alerts.map((a) => (
                      <div key={a.id} style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "10px", marginBottom: "8px" }}>
                        <div style={{ fontWeight: 700 }}>
                          {a.title} <span style={{ marginLeft: 8, color: "var(--text-muted)", fontWeight: 600 }}>{String(a.severity || "info").toUpperCase()}</span>
                        </div>
                        <div style={{ color: "var(--text-muted)", marginTop: 4 }}>{a.detail}</div>
                        <div style={{ color: "var(--text-muted)", marginTop: 4 }}><strong>Cause:</strong> {describeCause(a)}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <p className="eval-no-chain-data" style={{ marginTop: "10px" }}>
                Note: NH₃ scenarios are limited because the Supabase schema does not store NH₃/TAN in `sensor_readings` (NH₃ is derived).
              </p>
            </div>
          )}
        </div>
      </section>

      {/* River baseline: normal MQTT feed, not a test run (no test_run_id) */}
      <section className="perf-section card" aria-labelledby="river-baseline-title">
        <div className="perf-section-header">
          <div>
            <h2 id="river-baseline-title" className="perf-section-title">River baseline feed</h2>
            <p className="perf-section-desc">
              Optional long-running publisher for <strong>normal</strong>, in-range river-like readings. This is{" "}
              <strong>not</strong> test-run mode: messages do not carry <code>test_run_id</code> and are not tied to Reports → Test Runs.
              Use the Scenario Evaluator above for preset alert tests.
            </p>
          </div>
        </div>
        <pre
          className="eval-no-chain-data"
          style={{
            margin: 0,
            padding: "12px 14px",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            whiteSpace: "pre-wrap",
            fontFamily: "ui-monospace, monospace",
            fontSize: "0.88rem",
            background: "var(--card-inner-bg, rgba(127, 127, 127, 0.06))",
          }}
        >
          {`cd server
npm run river-normal-24h

# defaults: 24 h, every 5 min (~288 points), day/night variation, all within thresholds
# options: --hours 24 --interval-seconds 300 --interval-minutes 5 --node node1
# quick check: npm run river-normal-24h:dry`}
        </pre>
      </section>

      {packetsModalOpen && lastTestRunId && (
        <PacketsTableModal
          testRunId={lastTestRunId}
          nodeNames={nodeNames}
          onClose={() => setPacketsModalOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Packets Table Modal ──────────────────────────────────────────────────────

function formatTsShort(v) {
  if (v == null) return "—";
  const d = typeof v === "number" ? new Date(v) : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
}

function fmtLatCell(ms) {
  if (ms == null) return "—";
  return `${Math.round(ms)} ms`;
}

function PacketsTableModal({ testRunId, nodeNames, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortCol, setSortCol] = useState("seq");
  const [sortDir, setSortDir] = useState("asc");
  const [nodeFilter, setNodeFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getPerformanceReadings({ testRunId, limit: 5000 })
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((e) => setError(e?.message || "Failed to load packets"))
      .finally(() => setLoading(false));
  }, [testRunId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const uniqueNodes = useMemo(() => [...new Set(rows.map((r) => r.node_id).filter(Boolean))].sort(), [rows]);

  const sorted = useMemo(() => {
    const filtered = nodeFilter === "all" ? rows : rows.filter((r) => r.node_id === nodeFilter);
    return [...filtered].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (av == null) av = sortDir === "asc" ? Infinity : -Infinity;
      if (bv == null) bv = sortDir === "asc" ? Infinity : -Infinity;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [rows, sortCol, sortDir, nodeFilter]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const SortTh = ({ col, children }) => (
    <th
      className={`pt-packets-th pt-packets-th--sortable${sortCol === col ? " pt-packets-th--active" : ""}`}
      onClick={() => handleSort(col)}
    >
      {children}
      <span className="pt-packets-sort-icon">{sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : " ⇅"}</span>
    </th>
  );

  const e2eMs = (r) => {
    if (r.t_fwd_rx == null || r.t_be_rx == null) return null;
    return Number(r.t_be_rx) - Number(r.t_fwd_rx);
  };

  const rssiClass = (v) => {
    if (v == null) return "";
    if (v > -70) return " pt-packets-sig--ok";
    if (v > -90) return " pt-packets-sig--warn";
    return " pt-packets-sig--bad";
  };

  const snrClass = (v) => {
    if (v == null) return "";
    if (v > 5) return " pt-packets-sig--ok";
    if (v >= 0) return " pt-packets-sig--warn";
    return " pt-packets-sig--bad";
  };

  return createPortal(
    <div className="pt-packets-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Test run packets">
      <div className="pt-packets-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pt-packets-modal-header">
          <div className="pt-packets-modal-title-row">
            <h2 className="pt-packets-modal-title">Test Run Packets</h2>
            <span className="pt-packets-modal-id">{testRunId}</span>
          </div>
          <div className="pt-packets-modal-controls">
            {uniqueNodes.length > 1 && (
              <select
                className="pt-packets-node-filter"
                value={nodeFilter}
                onChange={(e) => setNodeFilter(e.target.value)}
              >
                <option value="all">All nodes</option>
                {uniqueNodes.map((nid) => (
                  <option key={nid} value={nid}>{nodeNames[nid] ? `${nid} — ${nodeNames[nid]}` : nid}</option>
                ))}
              </select>
            )}
            <button type="button" className="pt-packets-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className="pt-packets-modal-body">
          {loading ? (
            <div className="pt-packets-loading"><span className="perf-test-spinner" /> Loading packets…</div>
          ) : error ? (
            <div className="pt-packets-error">{error}</div>
          ) : sorted.length === 0 ? (
            <div className="pt-packets-empty">No packets found for this test run.</div>
          ) : (
            <>
              <div className="pt-packets-count">{sorted.length} packet{sorted.length !== 1 ? "s" : ""}{nodeFilter !== "all" ? ` for node ${nodeFilter}` : ""}</div>
              <div className="pt-packets-table-wrap">
                <table className="pt-packets-table">
                  <thead>
                    <tr>
                      <SortTh col="seq">#</SortTh>
                      <SortTh col="node_id">Node</SortTh>
                      <SortTh col="timestamp">Received at</SortTh>
                      <SortTh col="t_fwd_rx">Fwd RX</SortTh>
                      <SortTh col="t_be_rx">BE RX</SortTh>
                      <th className="pt-packets-th">E2E Latency</th>
                      <SortTh col="t_fwd_pub">Fwd PUB</SortTh>
                      <SortTh col="rssi">RSSI</SortTh>
                      <SortTh col="snr">SNR</SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r, i) => {
                      const lat = e2eMs(r);
                      const latClass = lat == null ? "" : lat < 500 ? " pt-packets-lat--ok" : lat < 2000 ? " pt-packets-lat--warn" : " pt-packets-lat--bad";
                      return (
                        <tr key={r.id ?? i} className="pt-packets-row">
                          <td className="pt-packets-td pt-packets-td--seq">{r.seq ?? "—"}</td>
                          <td className="pt-packets-td">{nodeNames[r.node_id] ? `${r.node_id} — ${nodeNames[r.node_id]}` : (r.node_id ?? "—")}</td>
                          <td className="pt-packets-td pt-packets-td--ts">{formatTsShort(r.timestamp)}</td>
                          <td className="pt-packets-td pt-packets-td--ts">{formatTsShort(r.t_fwd_rx != null ? Number(r.t_fwd_rx) : null)}</td>
                          <td className="pt-packets-td pt-packets-td--ts">{formatTsShort(r.t_be_rx != null ? Number(r.t_be_rx) : null)}</td>
                          <td className={`pt-packets-td pt-packets-td--lat${latClass}`}>{fmtLatCell(lat)}</td>
                          <td className="pt-packets-td pt-packets-td--ts">{formatTsShort(r.t_fwd_pub != null ? Number(r.t_fwd_pub) : null)}</td>
                          <td className={`pt-packets-td pt-packets-td--sig${rssiClass(r.rssi)}`}>{r.rssi != null ? `${r.rssi} dBm` : "—"}</td>
                          <td className={`pt-packets-td pt-packets-td--sig${snrClass(r.snr)}`}>{r.snr != null ? `${r.snr} dB` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function EvalMetric({ label, value, highlight, formula }) {
  return (
    <div className="eval-metric" title={formula || ""}>
      <span className="eval-metric-label">{label}</span>
      <span className={`eval-metric-value${highlight ? ` eval-metric-value--${highlight}` : ""}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}
