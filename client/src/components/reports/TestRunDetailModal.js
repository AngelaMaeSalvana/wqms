import React, { useEffect, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Line } from "react-chartjs-2";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import * as XLSX from "xlsx";
import api from "../../services/api";
import { computeIoTMetrics } from "../../utils/iotMetrics";
import { computeAlertMetrics } from "../../utils/alertMetrics";
import "../../utils/chartConfig";
import "./TestRunDetailModal.css";

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

function rssiHighlight(v) {
  if (v == null) return null;
  if (v > -70) return "ok";
  if (v > -90) return "warn";
  return "bad";
}

function snrHighlight(v) {
  if (v == null) return null;
  if (v > 5) return "ok";
  if (v >= 0) return "warn";
  return "bad";
}

function rssiCls(v) {
  const h = rssiHighlight(v);
  return h ? ` testrun-packets-sig--${h}` : "";
}

function snrCls(v) {
  const h = snrHighlight(v);
  return h ? ` testrun-packets-sig--${h}` : "";
}

function formatTs(v) {
  if (v == null) return "—";
  const d = typeof v === "number" ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function fmtPct(v) {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtLatMs(ms) {
  if (ms == null) return "—";
  return `${Math.round(ms)} ms`;
}

function MetricValue({ value, highlight }) {
  const cls = highlight ? ` testrun-eval-metric-value--${highlight}` : "";
  return <span className={`testrun-eval-metric-value${cls}`}>{value ?? "—"}</span>;
}

export default function TestRunDetailModal({ runId, nodes, onClose }) {
  const [run, setRun] = useState(null);
  const [perfRows, setPerfRows] = useState([]);
  const [alertRows, setAlertRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeView, setActiveView] = useState("metrics"); // "metrics" | "packets"
  const [packetSort, setPacketSort] = useState({ col: "seq", dir: "asc" });
  const [packetNodeFilter, setPacketNodeFilter] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [rangeTestDistance, setRangeTestDistance] = useState("");

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getTestRun(runId).catch((e) => {
        setError(e?.message || "Failed to load test run");
        return null;
      }),
      api.getPerformanceReadings({ testRunId: runId, limit: 5000 }).catch(() => []),
    ]).then(async ([r, rows]) => {
      setRun(r);
      setPerfRows(Array.isArray(rows) ? rows : []);
      let alerts = [];
      if (r?.started_at) {
        const startDate = new Date(r.started_at).toISOString().slice(0, 10);
        const endDate = (r.stopped_at ? new Date(r.stopped_at) : new Date()).toISOString().slice(0, 10);
        try {
          alerts = await api.getPerformanceAlerts({ startDate, endDate, nodeId: r.node_id || undefined, limit: 500 });
        } catch (_) {}
      }
      setAlertRows(Array.isArray(alerts) ? alerts : []);
    }).finally(() => setLoading(false));
  }, [runId]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const expectedPackets = useMemo(() => {
    if (!run?.duration_ms || !run?.interval_ms || run.interval_ms <= 0) return null;
    return Math.floor(run.duration_ms / run.interval_ms);
  }, [run]);

  const nodeMetrics = useMemo(
    () => computeIoTMetrics(perfRows, null, expectedPackets),
    [perfRows, expectedPackets]
  );

  const alertMetrics = useMemo(
    () => computeAlertMetrics(alertRows, perfRows),
    [alertRows, perfRows]
  );

  const packetUniqueNodes = useMemo(
    () => [...new Set(perfRows.map((r) => r.node_id).filter(Boolean))].sort(),
    [perfRows]
  );

  const rangeTestChartDataByNode = useMemo(() => {
    const raw = perfRows;
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
  }, [perfRows]);

  const sortedPackets = useMemo(() => {
    const filtered = packetNodeFilter === "all" ? perfRows : perfRows.filter((r) => r.node_id === packetNodeFilter);
    const { col, dir } = packetSort;
    return [...filtered].sort((a, b) => {
      let av = a[col], bv = b[col];
      if (av == null) av = dir === "asc" ? Infinity : -Infinity;
      if (bv == null) bv = dir === "asc" ? Infinity : -Infinity;
      if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return dir === "asc" ? av - bv : bv - av;
    });
  }, [perfRows, packetSort, packetNodeFilter]);

  const handlePacketSort = (col) => {
    setPacketSort((prev) => prev.col === col
      ? { col, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { col, dir: "asc" }
    );
  };

  const e2eMs = useCallback((r) => {
    if (r.t_fwd_rx == null || r.t_be_rx == null) return null;
    return Number(r.t_be_rx) - Number(r.t_fwd_rx);
  }, []);

  const exportPDF = useCallback(() => {
    if (!run) return;
    setExporting(true);

    const ACCENT = [27, 156, 133];
    const HEADER_BG = [22, 30, 40];
    const MUTED = [120, 130, 145];
    const DARK = [30, 40, 55];

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;

    // ── Header bar ──────────────────────────────────────────────────────────
    doc.setFillColor(...HEADER_BG);
    doc.rect(0, 0, pageW, 22, "F");

    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("WQMS — Test Run Report", margin, 14);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageW - margin, 14, { align: "right" });

    // ── Run metadata block ───────────────────────────────────────────────────
    let y = 30;
    const col2 = pageW / 2 + 4;

    const metaLeft = [
      ["Run ID", run.id],
      ["Started", formatTs(run.started_at)],
      ["Status", run.status || "—"],
    ];
    const metaRight = [
      ["Duration", run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)} s` : "—"],
      ["Interval", run.interval_ms != null ? `${run.interval_ms} ms` : "—"],
      ["Node", run.node_id ? (nodes?.find((n) => n.id === run.node_id)?.name || run.node_id) : "All nodes"],
    ];

    doc.setFontSize(7.5);
    metaLeft.forEach(([label, value], i) => {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...MUTED);
      doc.text(label.toUpperCase(), margin, y + i * 6);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 30, 30);
      doc.text(String(value ?? "—"), margin + 28, y + i * 6);
    });
    metaRight.forEach(([label, value], i) => {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...MUTED);
      doc.text(label.toUpperCase(), col2, y + i * 6);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 30, 30);
      doc.text(String(value ?? "—"), col2 + 24, y + i * 6);
    });

    y += metaLeft.length * 6 + 8;

    // ── Section: IoT Metrics ─────────────────────────────────────────────────
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ACCENT);
    doc.text("IoT Performance Metrics", margin, y);
    y += 5;

    const nodeIds = Object.keys(nodeMetrics);
    if (nodeIds.length === 0) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(...MUTED);
      doc.text("No timestamp chain data available for this test run.", margin, y + 4);
      y += 12;
    } else {
      const metricsHead = [
        ["Node", "Expected", "Sent", "Received", "Lost", "PDR", "PLR", "Availability",
          "E2E Mean", "E2E p95", "E2E Max", "Fwd Internal", "MQTT/BE", "Node→Fwd",
          "RSSI Mean", "RSSI Min", "SNR Mean", "SNR Min"],
      ];
      const metricsBody = nodeIds.map((nid) => {
        const m = nodeMetrics[nid];
        const nName = nodes?.find((x) => x.id === nid)?.name;
        return [
          nName ? `${nid} — ${nName}` : nid,
          expectedPackets ?? "—",
          m.totalSent ?? "—",
          m.totalReceived ?? "—",
          m.missingSeqs ?? "—",
          m.pdr != null ? `${m.pdr.toFixed(1)}%` : "—",
          m.plr != null ? `${m.plr.toFixed(1)}%` : "—",
          m.availability != null ? `${m.availability.toFixed(1)}%` : "—",
          m.e2eMean != null ? `${Math.round(m.e2eMean)} ms` : "—",
          m.e2eP95 != null ? `${Math.round(m.e2eP95)} ms` : "—",
          m.e2eMax != null ? `${Math.round(m.e2eMax)} ms` : "—",
          m.fwdProcMean != null ? `${Math.round(m.fwdProcMean)} ms` : "—",
          m.mqttBackendMean != null ? `${Math.round(m.mqttBackendMean)} ms` : "—",
          m.nodeToFwdMean != null ? `${Math.round(m.nodeToFwdMean)} ms` : "—",
          m.rssiMean != null ? `${Math.round(m.rssiMean)} dBm` : "—",
          m.rssiMin != null ? `${m.rssiMin} dBm` : "—",
          m.snrMean != null ? `${m.snrMean.toFixed(1)} dB` : "—",
          m.snrMin != null ? `${m.snrMin} dB` : "—",
        ];
      });

      autoTable(doc, {
        head: metricsHead,
        body: metricsBody,
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 7, cellPadding: 2.5, overflow: "linebreak" },
        headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold", fontSize: 6.5 },
        alternateRowStyles: { fillColor: [245, 248, 250] },
        columnStyles: { 0: { cellWidth: 36 } },
        didDrawPage: (data) => {
          // Re-draw header on continuation pages
          doc.setFillColor(...HEADER_BG);
          doc.rect(0, 0, pageW, 10, "F");
          doc.setFontSize(7);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(255, 255, 255);
          doc.text("WQMS — Test Run Report (continued)", margin, 7);
        },
      });

      y = doc.lastAutoTable.finalY + 10;
    }

    // ── Section: Alert Responsiveness ───────────────────────────────────────
    if (alertMetrics.count > 0) {
      if (y > pageH - 45) { doc.addPage(); y = 18; }
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...ACCENT);
      doc.text("Alert Responsiveness", margin, y);
      y += 5;
      const alertHead = [["Alerts", "Mean response (ms)", "Max response (ms)", "Trigger latency mean (ms)", "Trigger latency max (ms)", "Samples", "Emails sent", "Email delay mean (ms)", "Email delay max (ms)"]];
      const alertBody = [[
        alertMetrics.count,
        alertMetrics.meanMs != null ? Math.round(alertMetrics.meanMs) : "—",
        alertMetrics.maxMs != null ? Math.round(alertMetrics.maxMs) : "—",
        alertMetrics.triggerLatencyMeanMs != null ? Math.round(alertMetrics.triggerLatencyMeanMs) : "—",
        alertMetrics.triggerLatencyMaxMs != null ? Math.round(alertMetrics.triggerLatencyMaxMs) : "—",
        alertMetrics.triggerLatencySamples ?? 0,
        alertMetrics.emailSentCount ?? 0,
        alertMetrics.emailDelayMeanMs != null ? Math.round(alertMetrics.emailDelayMeanMs) : "—",
        alertMetrics.emailDelayMaxMs != null ? Math.round(alertMetrics.emailDelayMaxMs) : "—",
      ]];
      autoTable(doc, {
        head: alertHead,
        body: alertBody,
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 7, cellPadding: 2.5 },
        headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold", fontSize: 6 },
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ── Section: Latency Chart ───────────────────────────────────────────────
    // Sort by arrival time so each node's line progresses chronologically.
    const latencyRows = [...perfRows]
      .filter((r) => r.t_fwd_rx != null && r.t_be_rx != null && Number(r.t_fwd_rx) > 0)
      .sort((a, b) => Number(a.t_fwd_rx) - Number(b.t_fwd_rx));

    if (latencyRows.length >= 2) {
      // Need ~72mm for chart title + chart + gap + packet log title; start new page if tight
      if (y > pageH - 80) { doc.addPage(); y = 18; }

      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...ACCENT);
      doc.text("E2E Latency per Packet  (Fwd → Backend)", margin, y);
      y += 4;

      const chartX = margin;
      const chartY = y;
      const chartW = pageW - margin * 2;
      const chartH = 52;
      const padL = 22, padR = 6, padT = 4, padB = 14;
      const plotX = chartX + padL;
      const plotY = chartY + padT;
      const plotW = chartW - padL - padR;
      const plotH = chartH - padT - padB;

      const latencies = latencyRows.map((r) => Number(r.t_be_rx) - Number(r.t_fwd_rx));
      const minLat = Math.min(...latencies);
      const maxLat = Math.max(...latencies);
      const latRange = maxLat - minLat || 1;
      const meanLat = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      // Chart background
      doc.setFillColor(245, 248, 250);
      doc.rect(chartX, chartY, chartW, chartH, "F");
      doc.setDrawColor(210, 215, 220);
      doc.setLineWidth(0.2);
      doc.rect(chartX, chartY, chartW, chartH, "S");

      // Y-axis grid lines & labels (4 ticks)
      const yTicks = 4;
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      for (let t = 0; t <= yTicks; t++) {
        const val = minLat + (latRange * t) / yTicks;
        const py = plotY + plotH - (plotH * t) / yTicks;
        doc.setDrawColor(220, 225, 230);
        doc.setLineWidth(0.15);
        doc.line(plotX, py, plotX + plotW, py);
        doc.text(`${Math.round(val)}`, chartX + padL - 2, py + 1.5, { align: "right" });
      }

      // Mean line
      const meanPy = plotY + plotH - (plotH * (meanLat - minLat)) / latRange;
      doc.setDrawColor(240, 165, 0);
      doc.setLineWidth(0.4);
      doc.setLineDashPattern([2, 1.5], 0);
      doc.line(plotX, meanPy, plotX + plotW, meanPy);
      doc.setLineDashPattern([], 0);
      doc.setFontSize(5);
      doc.setTextColor(200, 130, 0);
      doc.text(`mean ${Math.round(meanLat)} ms`, plotX + plotW - 1, meanPy - 1, { align: "right" });

      // X-axis labels: 1-based packet index, up to 8 evenly spaced ticks
      // Find the longest node series to determine the x-axis range
      const nodeIds2 = [...new Set(latencyRows.map((r) => r.node_id))];
      const maxNodeLen = Math.max(...nodeIds2.map((nid) => latencyRows.filter((r) => r.node_id === nid).length));
      const xLabelCount = Math.min(8, maxNodeLen);
      doc.setFontSize(5.5);
      doc.setTextColor(...MUTED);
      for (let i = 0; i < xLabelCount; i++) {
        const idx = Math.round((i / Math.max(xLabelCount - 1, 1)) * (maxNodeLen - 1));
        const px = plotX + (plotW * idx) / Math.max(maxNodeLen - 1, 1);
        doc.text(String(idx + 1), px, plotY + plotH + 5, { align: "center" });
      }

      // Y-axis label
      doc.setFontSize(5.5);
      doc.setTextColor(...MUTED);
      doc.text("ms", chartX + 2, plotY + plotH / 2, { angle: 90, align: "center" });

      // X-axis label
      doc.text("Packet #", plotX + plotW / 2, plotY + plotH + 10, { align: "center" });

      // Line chart — draw per-node with different colors
      // Each node's line spans the full plot width using its own 0-based packet index,
      // so a delayed node still starts at x=1 rather than appearing shifted right.
      const nodeColors = [
        [27, 156, 133],
        [108, 92, 231],
        [225, 112, 85],
        [0, 184, 148],
        [253, 121, 168],
      ];
      nodeIds2.forEach((nid, ni) => {
        const nodeRows2 = latencyRows
          .filter((r) => r.node_id === nid)
          .sort((a, b) => Number(a.t_fwd_rx) - Number(b.t_fwd_rx));
        if (nodeRows2.length < 1) return;
        const color = nodeColors[ni % nodeColors.length];
        doc.setDrawColor(...color);
        doc.setLineWidth(0.6);

        // Use per-node packet index (0-based) for x, so all nodes start at the left edge
        const points = nodeRows2.map((r, pktIdx) => {
          const lat2 = Number(r.t_be_rx) - Number(r.t_fwd_rx);
          const px = plotX + (plotW * pktIdx) / Math.max(maxNodeLen - 1, 1);
          const py2 = plotY + plotH - (plotH * (lat2 - minLat)) / latRange;
          return [px, Math.max(plotY, Math.min(plotY + plotH, py2))];
        });

        for (let i = 1; i < points.length; i++) {
          doc.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
        }

        // Dot at each point (skip if too many)
        if (nodeRows2.length <= 60) {
          doc.setFillColor(...color);
          points.forEach(([px, py2]) => {
            doc.circle(px, py2, 0.6, "F");
          });
        }
      });

      // Legend
      if (nodeIds2.length > 1) {
        let lx = plotX;
        nodeIds2.forEach((nid, ni) => {
          const color = nodeColors[ni % nodeColors.length];
          const nName = nodes?.find((x) => x.id === nid)?.name;
          const label = nName ? `${nid} — ${nName}` : nid;
          doc.setFillColor(...color);
          doc.rect(lx, plotY + plotH + 7, 4, 2.5, "F");
          doc.setFontSize(5.5);
          doc.setTextColor(50, 50, 50);
          doc.text(label, lx + 5.5, plotY + plotH + 9);
          lx += doc.getTextWidth(label) + 12;
        });
      }

      y += chartH + 5;
    }

    // ── Section: Packet Log (per node) ──────────────────────────────────────
    if (y > pageH - 25) {
      doc.addPage();
      y = 18;
    }

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ACCENT);
    doc.text(`Packet Log  (${perfRows.length} packet${perfRows.length !== 1 ? "s" : ""})`, margin, y);
    y += 5;

    if (perfRows.length === 0) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(...MUTED);
      doc.text("No packets recorded for this test run.", margin, y + 4);
    } else {
      const pdfNodeIds = [...new Set(perfRows.map((r) => r.node_id).filter(Boolean))].sort();
      const packetsHead = [["#", "Received at", "Fwd RX", "BE RX", "E2E Latency", "Fwd PUB", "RSSI", "SNR"]];

      pdfNodeIds.forEach((nid) => {
        const nName = nodes?.find((x) => x.id === nid)?.name;
        const nLabel = nName ? `${nid} — ${nName}` : nid;
        const nodeRows = [...perfRows]
          .filter((r) => r.node_id === nid)
          .sort((a, b) => Number(a.t_fwd_rx ?? a.seq ?? 0) - Number(b.t_fwd_rx ?? b.seq ?? 0));

        // Node sub-heading
        if (y > pageH - 20) { doc.addPage(); y = 18; }
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...DARK);
        doc.text(`${nLabel}  (${nodeRows.length} packet${nodeRows.length !== 1 ? "s" : ""})`, margin, y);
        y += 4;

        const packetsBody = nodeRows.map((r) => {
          const lat = e2eMs(r);
          return [
            r.seq ?? "—",
            formatTsShort(r.timestamp),
            formatTsShort(r.t_fwd_rx != null ? Number(r.t_fwd_rx) : null),
            formatTsShort(r.t_be_rx != null ? Number(r.t_be_rx) : null),
            lat != null ? `${Math.round(lat)} ms` : "—",
            formatTsShort(r.t_fwd_pub != null ? Number(r.t_fwd_pub) : null),
            r.rssi != null ? `${r.rssi} dBm` : "—",
            r.snr  != null ? `${r.snr} dB`   : "—",
          ];
        });

        autoTable(doc, {
          head: packetsHead,
          body: packetsBody,
          startY: y,
          margin: { left: margin, right: margin },
          styles: { fontSize: 6.5, cellPadding: 2, overflow: "linebreak", font: "courier" },
          headStyles: { fillColor: [45, 55, 72], textColor: 255, fontStyle: "bold", fontSize: 6.5, font: "helvetica" },
          alternateRowStyles: { fillColor: [245, 248, 250] },
          columnStyles: {
            0: { cellWidth: 12, halign: "center" },
            4: { cellWidth: 24 },
          },
          didDrawPage: () => {
            doc.setFillColor(...HEADER_BG);
            doc.rect(0, 0, pageW, 10, "F");
            doc.setFontSize(7);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(255, 255, 255);
            doc.text("WQMS — Test Run Report (continued)", margin, 7);
          },
        });

        y = doc.lastAutoTable.finalY + 8;
      });
    }

    // ── Footer on every page ─────────────────────────────────────────────────
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 6, { align: "right" });
      doc.text("WQMS IoT Performance Report", margin, pageH - 6);
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    doc.save(`wqms-testrun-${String(run.id).slice(0, 8)}-${ts}.pdf`);
    setExporting(false);
  }, [run, nodes, nodeMetrics, expectedPackets, perfRows, e2eMs, alertMetrics]);

  const exportExcel = useCallback(() => {
    if (!run) return;
    setExporting(true);

    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Run Info ────────────────────────────────────────────────────
    const nodeName = run.node_id
      ? (nodes?.find((n) => n.id === run.node_id)?.name || run.node_id)
      : "All nodes";
    const infoRows = [
      ["WQMS — Test Run Report"],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      ["Field", "Value"],
      ["Run ID", run.id],
      ["Started", formatTs(run.started_at)],
      ["Stopped", run.stopped_at != null ? formatTs(run.stopped_at) : "—"],
      ["Status", run.status || "—"],
      ["Duration (s)", run.duration_ms != null ? (run.duration_ms / 1000).toFixed(1) : "—"],
      ["Interval (ms)", run.interval_ms ?? "—"],
      ["Node", nodeName],
      ["Total packets", perfRows.length],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
    wsInfo["!cols"] = [{ wch: 20 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, "Run Info");

    // ── Sheet 2: IoT Metrics ─────────────────────────────────────────────────
    const metricsHeader = [
      "Node", "Expected", "Sent (inferred)", "Received", "Lost",
      "PDR (%)", "PLR (%)", "Availability (%)",
      "E2E Mean (ms)", "E2E p95 (ms)", "E2E Max (ms)",
      "Fwd Internal (ms)", "MQTT/BE (ms)", "Node→Fwd (ms)",
    ];
    const metricsData = Object.entries(nodeMetrics).map(([nid, m]) => {
      const nName = nodes?.find((x) => x.id === nid)?.name;
      return [
        nName ? `${nid} — ${nName}` : nid,
        expectedPackets ?? "",
        m.totalSent ?? "",
        m.totalReceived ?? "",
        m.missingSeqs ?? "",
        m.pdr != null ? parseFloat(m.pdr.toFixed(2)) : "",
        m.plr != null ? parseFloat(m.plr.toFixed(2)) : "",
        m.availability != null ? parseFloat(m.availability.toFixed(2)) : "",
        m.e2eMean != null ? Math.round(m.e2eMean) : "",
        m.e2eP95 != null ? Math.round(m.e2eP95) : "",
        m.e2eMax != null ? Math.round(m.e2eMax) : "",
        m.fwdProcMean != null ? Math.round(m.fwdProcMean) : "",
        m.mqttBackendMean != null ? Math.round(m.mqttBackendMean) : "",
        m.nodeToFwdMean != null ? Math.round(m.nodeToFwdMean) : "",
      ];
    });
    const wsMetrics = XLSX.utils.aoa_to_sheet([metricsHeader, ...metricsData]);
    wsMetrics["!cols"] = [{ wch: 28 }, ...Array(13).fill({ wch: 16 })];
    XLSX.utils.book_append_sheet(wb, wsMetrics, "IoT Metrics");

    // ── Sheet: Alert Responsiveness ──────────────────────────────────────────
    const alertHeader = [
      "Alerts triggered", "Mean response (ms)", "Max response (ms)",
      "Trigger latency mean (ms)", "Trigger latency max (ms)", "Trigger latency samples",
      "Emails sent", "Email delay mean (ms)", "Email delay max (ms)",
    ];
    const alertData = [[
      alertMetrics.count,
      alertMetrics.meanMs != null ? Math.round(alertMetrics.meanMs) : "",
      alertMetrics.maxMs != null ? Math.round(alertMetrics.maxMs) : "",
      alertMetrics.triggerLatencyMeanMs != null ? Math.round(alertMetrics.triggerLatencyMeanMs) : "",
      alertMetrics.triggerLatencyMaxMs != null ? Math.round(alertMetrics.triggerLatencyMaxMs) : "",
      alertMetrics.triggerLatencySamples ?? 0,
      alertMetrics.emailSentCount ?? 0,
      alertMetrics.emailDelayMeanMs != null ? Math.round(alertMetrics.emailDelayMeanMs) : "",
      alertMetrics.emailDelayMaxMs != null ? Math.round(alertMetrics.emailDelayMaxMs) : "",
    ]];
    const wsAlerts = XLSX.utils.aoa_to_sheet([alertHeader, ...alertData]);
    wsAlerts["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsAlerts, "Alert Responsiveness");

    // ── Sheet 3: Packet Log ──────────────────────────────────────────────────
    const packetHeader = [
      "#", "Node", "Received at", "Fwd RX (ms epoch)", "BE RX (ms epoch)",
      "Fwd PUB (ms epoch)", "E2E Latency (ms)", "Fwd Internal (ms)", "MQTT/BE (ms)",
    ];
    const sortedForExcel = [...perfRows].sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
    const packetData = sortedForExcel.map((r) => {
      const lat = r.t_fwd_rx != null && r.t_be_rx != null
        ? Number(r.t_be_rx) - Number(r.t_fwd_rx)
        : null;
      const fwdInternal = r.t_fwd_rx != null && r.t_fwd_pub != null
        ? Number(r.t_fwd_pub) - Number(r.t_fwd_rx)
        : null;
      const mqttBe = r.t_fwd_pub != null && r.t_be_rx != null
        ? Number(r.t_be_rx) - Number(r.t_fwd_pub)
        : null;
      const nName = nodes?.find((x) => x.id === r.node_id)?.name;
      return [
        r.seq ?? "",
        nName ? `${r.node_id} — ${nName}` : (r.node_id ?? ""),
        r.timestamp ? new Date(r.timestamp).toLocaleString() : "",
        r.t_fwd_rx != null ? Number(r.t_fwd_rx) : "",
        r.t_be_rx != null ? Number(r.t_be_rx) : "",
        r.t_fwd_pub != null ? Number(r.t_fwd_pub) : "",
        lat != null ? lat : "",
        fwdInternal != null ? fwdInternal : "",
        mqttBe != null ? mqttBe : "",
      ];
    });
    const wsPackets = XLSX.utils.aoa_to_sheet([packetHeader, ...packetData]);
    wsPackets["!cols"] = [
      { wch: 6 }, { wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 18 },
      { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, wsPackets, "Packet Log");

    // ── Sheet 4: Latency Chart Data ──────────────────────────────────────────
    const latencyRows = [...perfRows]
      .filter((r) => r.t_fwd_rx != null && r.t_be_rx != null && Number(r.t_fwd_rx) > 0)
      .sort((a, b) => Number(a.t_fwd_rx) - Number(b.t_fwd_rx));

    if (latencyRows.length > 0) {
      const latencies = latencyRows.map((r) => Number(r.t_be_rx) - Number(r.t_fwd_rx));
      const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const sorted = [...latencies].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];

      // Build per-node packet index so each node's rows are numbered 1, 2, 3…
      const perNodeIdx = {};
      const chartHeader = ["Packet # (per node)", "Node", "E2E Latency (ms)", "Mean (ms)", "p95 (ms)"];
      const chartData = latencyRows.map((r, i) => {
        const nid = r.node_id ?? "";
        perNodeIdx[nid] = (perNodeIdx[nid] ?? 0) + 1;
        return [
          perNodeIdx[nid],
          nid,
          latencies[i],
          i === 0 ? Math.round(mean) : "",
          i === 0 ? Math.round(p95) : "",
        ];
      });
      const wsChart = XLSX.utils.aoa_to_sheet([chartHeader, ...chartData]);
      wsChart["!cols"] = [{ wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 12 }];

      // Embed a line chart using XLSX chart data range
      XLSX.utils.book_append_sheet(wb, wsChart, "Latency Chart Data");
    }

    const ts2 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    XLSX.writeFile(wb, `wqms-testrun-${String(run.id).slice(0, 8)}-${ts2}.xlsx`);
    setExporting(false);
  }, [run, nodes, nodeMetrics, expectedPackets, perfRows, alertMetrics]);

  if (!runId) return null;

  const nodeLabel = (nid) => {
    if (!nid) return "All nodes";
    const n = nodes?.find((x) => x.id === nid);
    return n?.name || nid;
  };

  return createPortal(
    <div className="testrun-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="testrun-modal-title">
      <div className="testrun-modal" onClick={(e) => e.stopPropagation()}>
        <div className="testrun-modal-header">
          <h2 id="testrun-modal-title">Test run results</h2>
          <div className="testrun-modal-header-actions">
            {!loading && !error && run && (
              <>
                <div className="testrun-modal-view-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeView === "metrics"}
                    className={`testrun-modal-view-tab${activeView === "metrics" ? " testrun-modal-view-tab--active" : ""}`}
                    onClick={() => setActiveView("metrics")}
                  >
                    Metrics
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeView === "packets"}
                    className={`testrun-modal-view-tab${activeView === "packets" ? " testrun-modal-view-tab--active" : ""}`}
                    onClick={() => setActiveView("packets")}
                  >
                    Packets {perfRows.length > 0 && <span className="testrun-modal-view-tab-badge">{perfRows.length}</span>}
                  </button>
                </div>
                <button
                  type="button"
                  className="testrun-modal-export-btn"
                  onClick={exportPDF}
                  disabled={exporting}
                  title="Export full report as PDF"
                >
                  {exporting ? "Generating…" : "↓ Export PDF"}
                </button>
                <button
                  type="button"
                  className="testrun-modal-export-btn testrun-modal-export-btn--excel"
                  onClick={exportExcel}
                  disabled={exporting}
                  title="Export data + chart as Excel (.xlsx)"
                >
                  {exporting ? "Generating…" : "↓ Export Excel"}
                </button>
              </>
            )}
            <button type="button" className="testrun-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>
        <div className="testrun-modal-body">
          {loading ? (
            <p className="testrun-modal-loading">Loading…</p>
          ) : error ? (
            <p className="testrun-modal-error">{error}</p>
          ) : run ? (
            <>
              {/* ── Summary (always visible) ── */}
              <div className="testrun-modal-summary">
                <dl className="testrun-modal-dl">
                  <dt>ID</dt>
                  <dd className="testrun-modal-id">{run.id}</dd>
                  <dt>Started</dt>
                  <dd>{formatTs(run.started_at)}</dd>
                  <dt>Duration</dt>
                  <dd>{run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)} s` : "—"}</dd>
                  <dt>Interval</dt>
                  <dd>{run.interval_ms != null ? `${run.interval_ms} ms` : "—"}</dd>
                  <dt>Node</dt>
                  <dd>{nodeLabel(run.node_id)}</dd>
                  <dt>Status</dt>
                  <dd>{run.status || "—"}</dd>
                  {run.stopped_at != null && (
                    <>
                      <dt>Stopped</dt>
                      <dd>{formatTs(run.stopped_at)}</dd>
                    </>
                  )}
                </dl>
              </div>

              {/* ── Metrics view ── */}
              {activeView === "metrics" && (
                <div className="testrun-eval-section">
                  <h3 className="testrun-eval-section-title">
                    IoT performance ({perfRows.length} packet{perfRows.length !== 1 ? "s" : ""})
                  </h3>
                  {Object.keys(nodeMetrics).length === 0 ? (
                    <p className="testrun-eval-no-chain">
                      No timestamp chain data (t_fwd_rx / t_be_rx) available for this test run.
                      {perfRows.length === 0 && " Ensure the bridge is running and you started a test run before running scenarios or having nodes transmit."}
                    </p>
                  ) : (
                    Object.entries(nodeMetrics).map(([nid, m]) => (
                      <div key={nid} className="testrun-eval-node-card">
                        <div className="testrun-eval-node-title">{nodeLabel(nid)}</div>
                        <div className="testrun-eval-node-body">
                          <div className="testrun-eval-col">
                            <div className="testrun-eval-metric-group">
                              <div className="testrun-eval-metric-group-label">Packet statistics</div>
                              <div className="testrun-eval-metric-row">
                                {expectedPackets != null && (
                                  <div className="testrun-eval-metric">
                                    <span className="testrun-eval-metric-label">Expected</span>
                                    <MetricValue value={expectedPackets} />
                                  </div>
                                )}
                                <div className="testrun-eval-metric">
                                  <span className="testrun-eval-metric-label">Sent (inferred)</span>
                                  <MetricValue value={m.totalSent} />
                                </div>
                                <div className="testrun-eval-metric">
                                  <span className="testrun-eval-metric-label">Received</span>
                                  <MetricValue value={m.totalReceived} />
                                </div>
                                <div className="testrun-eval-metric">
                                  <span className="testrun-eval-metric-label">Lost</span>
                                  <MetricValue
                                    value={m.missingSeqs}
                                    highlight={m.missingSeqs > 0 ? "warn" : "ok"}
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="testrun-eval-metric-group">
                              <div className="testrun-eval-metric-group-label">Reliability</div>
                              <div className="testrun-eval-metric-row">
                                <div className="testrun-eval-metric">
                                  <span className="testrun-eval-metric-label">PDR</span>
                                  <MetricValue
                                    value={fmtPct(m.pdr)}
                                    highlight={m.pdr != null ? (m.pdr >= 90 ? "ok" : m.pdr >= 70 ? "warn" : "bad") : null}
                                  />
                                </div>
                                <div className="testrun-eval-metric">
                                  <span className="testrun-eval-metric-label">PLR</span>
                                  <MetricValue
                                    value={fmtPct(m.plr)}
                                    highlight={m.plr != null ? (m.plr <= 10 ? "ok" : m.plr <= 30 ? "warn" : "bad") : null}
                                  />
                                </div>
                                <div className="testrun-eval-metric">
                                  <span className="testrun-eval-metric-label">Availability</span>
                                  <MetricValue
                                    value={fmtPct(m.availability)}
                                    highlight={m.availability != null ? (m.availability >= 90 ? "ok" : m.availability >= 70 ? "warn" : "bad") : null}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="testrun-eval-col testrun-eval-col--right">
                            <div className="testrun-eval-metric-group">
                              <div className="testrun-eval-metric-group-label">
                                Latency (Fwd &#8594; Backend)
                                {m.e2eSampleCount > 0 && (
                                  <span className="testrun-eval-metric-group-sub"> ({m.e2eSampleCount} samples)</span>
                                )}
                              </div>
                              {m.e2eSampleCount === 0 ? (
                                <p className="testrun-eval-no-chain">
                                  No timestamp chain data for this node.
                                </p>
                              ) : (
                                <>
                                  <div className="testrun-eval-metric-row">
                                    <div className="testrun-eval-metric">
                                      <span className="testrun-eval-metric-label">Mean</span>
                                      <MetricValue value={fmtLatMs(m.e2eMean)} />
                                    </div>
                                    <div className="testrun-eval-metric">
                                      <span className="testrun-eval-metric-label">p95</span>
                                      <MetricValue value={fmtLatMs(m.e2eP95)} />
                                    </div>
                                    <div className="testrun-eval-metric">
                                      <span className="testrun-eval-metric-label">Max</span>
                                      <MetricValue value={fmtLatMs(m.e2eMax)} />
                                    </div>
                                  </div>
                                  {(m.fwdProcMean != null || m.mqttBackendMean != null || m.nodeToFwdMean != null) && (
                                    <div className="testrun-eval-metric-group" style={{ marginTop: "10px" }}>
                                      <div className="testrun-eval-metric-group-label">Component delays (mean)</div>
                                      <div className="testrun-eval-metric-row">
                                        {m.fwdProcMean != null && (
                                          <div className="testrun-eval-metric">
                                            <span className="testrun-eval-metric-label">Fwd internal</span>
                                            <MetricValue value={fmtLatMs(m.fwdProcMean)} />
                                          </div>
                                        )}
                                        {m.mqttBackendMean != null && (
                                          <div className="testrun-eval-metric">
                                            <span className="testrun-eval-metric-label">MQTT / BE</span>
                                            <MetricValue value={fmtLatMs(m.mqttBackendMean)} />
                                          </div>
                                        )}
                                        {m.nodeToFwdMean != null && (
                                          <div className="testrun-eval-metric">
                                            <span className="testrun-eval-metric-label">Node &#8594; Fwd</span>
                                            <MetricValue value={fmtLatMs(m.nodeToFwdMean)} />
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {/* ── Link Quality ── */}
                          {m.linkSampleCount > 0 && (
                            <div className="testrun-eval-metric-group" style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
                              <div className="testrun-eval-metric-group-label">
                                Link Quality
                                <span className="testrun-eval-metric-group-sub"> ({m.linkSampleCount} samples)</span>
                              </div>
                              <div className="testrun-eval-metric-row">
                                <div className="testrun-eval-metric">
                                  <span className="testrun-eval-metric-label">RSSI mean</span>
                                  <MetricValue
                                    value={m.rssiMean != null ? `${Math.round(m.rssiMean)} dBm` : "—"}
                                    highlight={rssiHighlight(m.rssiMean)}
                                  />
                                </div>
                                <div className="testrun-eval-metric">
                                  <span className="testrun-eval-metric-label">RSSI min</span>
                                  <MetricValue
                                    value={m.rssiMin != null ? `${m.rssiMin} dBm` : "—"}
                                    highlight={rssiHighlight(m.rssiMin)}
                                  />
                                </div>
                                <div className="testrun-eval-metric">
                                  <span className="testrun-eval-metric-label">SNR mean</span>
                                  <MetricValue
                                    value={m.snrMean != null ? `${m.snrMean.toFixed(1)} dB` : "—"}
                                    highlight={snrHighlight(m.snrMean)}
                                  />
                                </div>
                                <div className="testrun-eval-metric">
                                  <span className="testrun-eval-metric-label">SNR min</span>
                                  <MetricValue
                                    value={m.snrMin != null ? `${m.snrMin} dB` : "—"}
                                    highlight={snrHighlight(m.snrMin)}
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}

                  {/* ── Alert responsiveness ── */}
                  <div className="testrun-eval-alerts-section">
                    <h3 className="testrun-eval-section-title">
                      Alert responsiveness ({alertMetrics.count} alert{alertMetrics.count !== 1 ? "s" : ""})
                    </h3>
                    {alertMetrics.count === 0 ? (
                      <p className="testrun-eval-no-chain">
                        No alerts with t_alert_trigger in this test run window.
                      </p>
                    ) : (
                      <div className="testrun-eval-alerts-body">
                        <div className="testrun-eval-metric-row">
                          <div className="testrun-eval-metric">
                            <span className="testrun-eval-metric-label">Alerts triggered</span>
                            <MetricValue value={alertMetrics.count} />
                          </div>
                          <div className="testrun-eval-metric">
                            <span className="testrun-eval-metric-label">Mean response</span>
                            <MetricValue value={fmtLatMs(alertMetrics.meanMs)} />
                          </div>
                          <div className="testrun-eval-metric">
                            <span className="testrun-eval-metric-label">Max response</span>
                            <MetricValue value={fmtLatMs(alertMetrics.maxMs)} />
                          </div>
                        </div>
                        {alertMetrics.triggerLatencySamples > 0 && (
                          <div className="testrun-eval-metric-row" style={{ marginTop: "8px" }}>
                            <div className="testrun-eval-metric">
                              <span className="testrun-eval-metric-label">Trigger latency (mean)</span>
                              <MetricValue
                                value={fmtLatMs(alertMetrics.triggerLatencyMeanMs)}
                                highlight={
                                  alertMetrics.triggerLatencyMeanMs != null
                                    ? alertMetrics.triggerLatencyMeanMs < 30000 ? "ok" : alertMetrics.triggerLatencyMeanMs < 120000 ? "warn" : "bad"
                                    : null
                                }
                              />
                            </div>
                            <div className="testrun-eval-metric">
                              <span className="testrun-eval-metric-label">Trigger latency (max)</span>
                              <MetricValue value={fmtLatMs(alertMetrics.triggerLatencyMaxMs)} />
                            </div>
                            <div className="testrun-eval-metric">
                              <span className="testrun-eval-metric-label">Samples</span>
                              <MetricValue value={alertMetrics.triggerLatencySamples} />
                            </div>
                          </div>
                        )}
                        {alertMetrics.emailSentCount > 0 && (
                          <div className="testrun-eval-metric-row" style={{ marginTop: "8px" }}>
                            <div className="testrun-eval-metric">
                              <span className="testrun-eval-metric-label">Emails sent</span>
                              <MetricValue value={alertMetrics.emailSentCount} />
                            </div>
                            <div className="testrun-eval-metric">
                              <span className="testrun-eval-metric-label">Email delay (mean)</span>
                              <MetricValue
                                value={fmtLatMs(alertMetrics.emailDelayMeanMs)}
                                highlight={
                                  alertMetrics.emailDelayMeanMs != null
                                    ? alertMetrics.emailDelayMeanMs < 10000 ? "ok" : alertMetrics.emailDelayMeanMs < 60000 ? "warn" : "bad"
                                    : null
                                }
                              />
                            </div>
                            <div className="testrun-eval-metric">
                              <span className="testrun-eval-metric-label">Email delay (max)</span>
                              <MetricValue value={fmtLatMs(alertMetrics.emailDelayMaxMs)} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Range Test (RSSI/SNR vs packet) ── */}
                  {perfRows.length > 0 && Object.keys(rangeTestChartDataByNode).length > 0 && (
                    <div className="testrun-eval-alerts-section" style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
                      <h3 className="testrun-eval-section-title">Range Test</h3>
                      <p className="testrun-eval-no-chain" style={{ marginBottom: "12px", color: "var(--text-muted)" }}>
                        Signal strength (RSSI) and SNR over the run. Stronger signal (RSSI &gt; −70 dBm, SNR &gt; 5 dB) indicates better range.
                      </p>
                      <div className="range-test-distance-wrap" style={{ marginBottom: "12px" }}>
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
                      <div className="range-test-charts" style={{ display: "grid", gap: "16px" }}>
                        {Object.entries(rangeTestChartDataByNode).map(([nid, chartData]) => {
                          const name = nodes?.find((n) => n.id === nid)?.name ? `${nid} — ${nodes.find((n) => n.id === nid).name}` : nid;
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
                            <div key={nid} className="range-test-chart-wrap" style={{ minHeight: "200px" }}>
                              <h4 className="range-test-chart-title" style={{ margin: "0 0 8px 0", fontSize: "0.95rem" }}>{name}</h4>
                              <div className="range-test-chart-inner" style={{ height: "180px" }}>
                                <Line data={chartData} options={options} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {rangeTestDistance.trim() && (
                        <p className="range-test-distance-note" style={{ marginTop: "8px", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                          This run tagged with distance: <strong>{rangeTestDistance.trim()} m</strong> (for your records; not stored on server).
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Packets view ── */}
              {activeView === "packets" && (
                <div className="testrun-packets-section">
                  <div className="testrun-packets-toolbar">
                    <span className="testrun-packets-count">
                      {perfRows.length} packet{perfRows.length !== 1 ? "s" : ""}
                      {packetNodeFilter !== "all" ? ` · ${nodeLabel(packetNodeFilter)}` : ""}
                    </span>
                    {packetUniqueNodes.length > 1 && (
                      <select
                        className="testrun-packets-node-filter"
                        value={packetNodeFilter}
                        onChange={(e) => setPacketNodeFilter(e.target.value)}
                      >
                        <option value="all">All nodes</option>
                        {packetUniqueNodes.map((nid) => {
                          const n = nodes?.find((x) => x.id === nid);
                          return (
                            <option key={nid} value={nid}>
                              {n?.name ? `${nid} — ${n.name}` : nid}
                            </option>
                          );
                        })}
                      </select>
                    )}
                  </div>

                  {(() => {
                    // Determine which nodes to render tables for
                    const nodesToShow = packetNodeFilter === "all"
                      ? packetUniqueNodes
                      : [packetNodeFilter];

                    const cols = [
                      { col: "seq",       label: "#" },
                      { col: "timestamp", label: "Received at" },
                      { col: "t_fwd_rx",  label: "Fwd RX" },
                      { col: "t_be_rx",   label: "BE RX" },
                      { col: null,        label: "E2E Latency" },
                      { col: "t_fwd_pub", label: "Fwd PUB" },
                      { col: "rssi",      label: "RSSI" },
                      { col: "snr",       label: "SNR" },
                    ];

                    if (perfRows.length === 0) {
                      return <p className="testrun-eval-no-chain">No packets found for this test run.</p>;
                    }

                    return nodesToShow.map((nid) => {
                      const nodeRows = perfRows.filter((r) => r.node_id === nid);
                      const { col, dir } = packetSort;
                      const nodePackets = [...nodeRows].sort((a, b) => {
                        let av = a[col], bv = b[col];
                        if (av == null) av = dir === "asc" ? Infinity : -Infinity;
                        if (bv == null) bv = dir === "asc" ? Infinity : -Infinity;
                        if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
                        return dir === "asc" ? av - bv : bv - av;
                      });
                      const n = nodes?.find((x) => x.id === nid);
                      const nLabel = n?.name ? `${nid} — ${n.name}` : nid;

                      return (
                        <div key={nid} className="testrun-packets-node-block">
                          {packetNodeFilter === "all" && (
                            <div className="testrun-packets-node-heading">
                              <span className="testrun-packets-node-heading-id">{nLabel}</span>
                              <span className="testrun-packets-node-heading-count">
                                {nodePackets.length} packet{nodePackets.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          )}
                          <div className="testrun-packets-table-wrap">
                            <table className="testrun-packets-table">
                              <thead>
                                <tr>
                                  {cols.map(({ col: c, label }) => (
                                    <th
                                      key={label}
                                      className={`testrun-packets-th${c ? " testrun-packets-th--sortable" : ""}${packetSort.col === c ? " testrun-packets-th--active" : ""}`}
                                      onClick={c ? () => handlePacketSort(c) : undefined}
                                    >
                                      {label}
                                      {c && (
                                        <span className="testrun-packets-sort-icon">
                                          {packetSort.col === c ? (packetSort.dir === "asc" ? " ▲" : " ▼") : " ⇅"}
                                        </span>
                                      )}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {nodePackets.map((r, i) => {
                                  const lat = e2eMs(r);
                                  const latClass = lat == null ? "" : lat < 500 ? " testrun-packets-lat--ok" : lat < 2000 ? " testrun-packets-lat--warn" : " testrun-packets-lat--bad";
                                  return (
                                    <tr key={r.id ?? i} className="testrun-packets-row">
                                      <td className="testrun-packets-td testrun-packets-td--seq">{r.seq ?? "—"}</td>
                                      <td className="testrun-packets-td testrun-packets-td--ts">{formatTsShort(r.timestamp)}</td>
                                      <td className="testrun-packets-td testrun-packets-td--ts">{formatTsShort(r.t_fwd_rx != null ? Number(r.t_fwd_rx) : null)}</td>
                                      <td className="testrun-packets-td testrun-packets-td--ts">{formatTsShort(r.t_be_rx != null ? Number(r.t_be_rx) : null)}</td>
                                      <td className={`testrun-packets-td testrun-packets-td--lat${latClass}`}>{fmtLatCell(lat)}</td>
                                      <td className="testrun-packets-td testrun-packets-td--ts">{formatTsShort(r.t_fwd_pub != null ? Number(r.t_fwd_pub) : null)}</td>
                                      <td className={`testrun-packets-td testrun-packets-td--sig${rssiCls(r.rssi)}`}>{r.rssi != null ? `${r.rssi} dBm` : "—"}</td>
                                      <td className={`testrun-packets-td testrun-packets-td--sig${snrCls(r.snr)}`}>{r.snr != null ? `${r.snr} dB` : "—"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </>
          ) : (
            <p className="testrun-modal-error">Test run not found.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
