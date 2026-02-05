# Dashboard page — contents & logic

This document defines the **logic and content** for each area of the Dashboard, aligned with the existing plan and your specifications.

---

## 1. Today’s overview

**Purpose:** Quick snapshot of the day’s readings for the **selected node**.

**Logic:**

- **Data:** Today’s readings for the selected node from `api.getReadings({ startDate: today, endDate: today, limit: 200 })`, then grouped by node and filtered by `selectedNodeId`. Calibration is applied via `applyCalibrationToReadings()` before use.
- **Derived:** For each parameter (temperature, turbidity, pH, NH₃, flow rate, dissolved O₂), compute for **that day and node**:
  - **Low** = minimum value in the day
  - **Avg** = mean of all values in the day
  - **High** = maximum value in the day
- **Display:** `TodayCard` receives `todayStats` (object with `{ low, avg, high }` per parameter) and `selectedNode`; shows one row per parameter with Low / Avg / High. Empty state when no data.

**Current implementation:** Matches this. `todayStats` is computed in Dashboard from `todayData.datasets` (which come from filtered today’s readings). `TodayCard` already shows Low / Avg / High per parameter.

---

## 2. WQI (Water Quality Index)

**Purpose:** Single index for the **selected node** for **that day**, combining all parameter scores.

**Logic:**

- **Input:** Same day’s readings for the selected node (already used for Today’s overview).
- **Computation:** Use **parameter averages for the day** as input to `calculateWQI()`:
  - Average temperature, pH, turbidity, NH₃, dissolved O₂ over the day.
  - `WQI = calculateWQI({ temperature: avgTemp, pH: avgPh, … })`.
- **Result:** One WQI value and one label (Excellent / Good / Poor / etc.) from `getWQIClass(wqi)` for that day and node.

**Current implementation:** Matches this. Dashboard computes `todayStats`, then `wqiValue` from `calculateWQI(todayStats averages)` and `wqiLabel` from `getWQIClass(wqiValue)`. `WqiCard` displays value and label.

**Alternative (if you later want “average of per-reading WQIs”):** Compute WQI for each reading, then average those WQI values for the day. Current choice (one WQI from daily averages) is the standard approach and is already implemented.

---

## 3. Live chart

**Purpose:** Show water quality parameters over time for the selected node; chart updates as new data arrives. Convey that sampling is **adaptive** (driven by flow rate and configurable intervals).

**Data & display logic:**

- **Data:** Same as Today’s overview — today’s readings for the selected node, time-ordered. One time series per parameter (temperature, turbidity, pH, NH₃, flow rate, dissolved O₂).
- **Refresh:** Dashboard refetches readings on manual refresh and on a 30‑minute auto-refresh. When new data is available, the chart redraws with the updated series.
- **No mock data when empty:** When there are no readings, show an empty chart (or “No data for today”) rather than placeholder curves.

**Core design concept (for UX copy / tooltip / Settings):**

- The **live chart** reflects data collected at a **default sampling interval** (e.g. **15 minutes**) when the measured **flow rate** is within or near a predefined nominal range.
- **Adaptive behavior:**
  - When flow rate **increases** beyond defined thresholds, the system **increases sampling frequency** (shortens the interval).
  - The adjustment is **piecewise threshold-based**: higher flow rate ranges → shorter intervals.
  - When flow stabilizes or returns to normal, the system **reverts to the default interval** to save power, bandwidth, and storage.
- **Rationale:** Higher flow often means more variability in water quality; adaptive sampling helps the live chart capture rapid changes while keeping resource use reasonable.

**Tie-in to Settings:**

- **Data collection & updates** (Settings) should define:
  - **Default interval (minutes):** Used for dashboard refresh and for “normal” flow (e.g. 15). Range e.g. 1–120.
  - **Minimum interval (minutes):** Fastest sampling when flow is high (e.g. 1). Must be ≤ maximum.
  - **Maximum interval (minutes):** Slowest sampling when flow is low (e.g. 15). Must be ≥ minimum.
- Dashboard **refresh interval** can read the “default interval” from Settings (or from a small `wqms_data_collection` localStorage object) so that “live” updates align with the configured nominal interval. If that section is not yet in Settings, add it and use the default interval for the dashboard auto-refresh (e.g. 15 min).

**Implementation notes:**

- The **actual** adaptive sampling (changing interval on the device/edge based on flow) is a firmware/backend concern; the dashboard only **displays** the resulting time series and **explains** the behavior (e.g. short note under the chart or in a tooltip).
- Optional: show current “effective interval” or “Last updated” so users see that data is live.

---

## 4. Mini map

**Purpose:** Show **location** of nodes and quick access to **sensor test**.

**Logic:**

- **Data:** Same `nodes` list as the rest of the Dashboard; `selectedNode` drives map center.
- **Map:** Center on selected node’s coordinates; show markers for all nodes that have `lat`/`lng`. Selected node can be visually emphasized.
- **Sensor test:** Each marker (or a control in the card) can trigger “Test sensor” for that node. Uses `useSensorTest(getReadingsForNode)` with `readingsByNode[nodeId]` so the test is based on **that node’s** current/latest readings (today’s data for the node).

**Current implementation:** `MiniMapCard` receives `nodes`, `selectedNode`, `onTestSensor`, and sensor test state; `MapMarkersOverlay` renders markers with “Test sensor” and centers on selected node. Logic matches.

---

## 5. Alerts summary

**Purpose:** At-a-glance view of issues that need attention. Include **sensor test failures** as alerts that also appear on the Alerts page.

**What it shows:**

- **Total alerts count** for the selected period (e.g. today).
- **Severity breakdown:** Info, Warning, Critical (with color-coded badges).
- **Recent alerts list** (e.g. last 5): message/parameter, affected node, timestamp, status (Active / Resolved).
- **Quick actions:** “View details” (open detail modal), “See all alerts” (navigate to Alerts page).

**Severity mapping:**

- Map existing alert `severity` to display levels:
  - **Critical:** `high` (e.g. threshold breaches, node offline).
  - **Warning:** `medium` (e.g. NH₃ above threshold, maintenance due, node testing).
  - **Info:** `low` / `info` (informational).
- Use consistent badges: e.g. Critical, Warning, Info (and optionally color: red / yellow / green or similar).

**Data & sorting:**

- **Source:** `alerts = buildAlertsForAllNodes(nodes, readingsByNode)` so threshold-based alerts are included (readings must be loaded for today; Dashboard already does this).
- **Sensor test failures:** When a sensor test finishes with one or more failed sensors, create an **alert** (e.g. type `sensor_test`, severity Warning or Critical depending on fail count) and store it so it appears in `buildAlertsForAllNodes` or in a combined list. Options:
  - **A)** Append sensor-test alerts to the same `alerts` array (e.g. from `useSensorTest` or a small helper that pushes “Sensor test failed” alerts into a list that is merged with threshold/status alerts).
  - **B)** Persist sensor-test failures (e.g. in localStorage keyed by node + date) and have `buildAlertsForAllNodes` (or a wrapper) include them so Alerts page and Dashboard share one list.
- **Sort:** Severity (Critical first, then Warning, then Info), then **newest first** within each severity.
- **Period:** Dashboard shows “today” by default; count and list are filtered to that period (e.g. by `timestamp` or `createdAt`).

**UX:**

- **Empty state:** “No alerts — all systems operating normally” when count is 0.
- **Compact:** Summary first (count + severity breakdown), then short scrollable list; full details on “View details”.
- **Tabs or pills (optional):** “All | Critical | Warning | Info” to filter the list.
- **Footer:** “See more” linking to the Alerts page.

**Current implementation:**

- `AlertsSummaryCard` gets `alerts` and `recentAlerts={alerts.slice(0, 5)}`; has list, detail modal, and export. It does **not** yet have:
  - Severity breakdown (counts by Critical/Warning/Info).
  - Explicit severity tabs/pills.
  - “See all alerts” link to `/alerts`.
  - Title “Alerts Summary” + count badge.
  - Empty state copy “No alerts — all systems operating normally.”
  - Sensor-test-generated alerts (to be added when test fails).

**Recommended changes:**

1. Rename or subtitle the card to “Alerts Summary” and show total count (e.g. badge).
2. Map `high` → Critical, `medium` → Warning, `low`/`info` → Info for display and filtering.
3. Add severity breakdown (counts) and optional tabs/pills (All | Critical | Warning | Info).
4. Sort `alerts` by severity order then by timestamp descending; pass sorted list into the card.
5. Set empty state message to “No alerts — all systems operating normally.”
6. Add “See more” / “See all alerts” linking to the Alerts route.
7. When sensor test fails, create an alert (and persist if desired) and include it in the alerts list so it shows on Dashboard and on Alerts page.

---

## 6. Data flow summary

```
Nodes (loadNodes / getNodes)
       +
Today’s readings (API, calibrated) → readingsByNode
       ↓
Selected node → today’s readings for node
       ↓
+ todayData (time series for chart)
+ todayStats (low/avg/high per param) → TodayCard, WQI
+ wqiValue, wqiLabel → WqiCard
+ LiveChart (todayData)
+ buildAlertsForAllNodes(nodes, readingsByNode) → alerts → AlertsSummaryCard
+ getReadingsForNode → useSensorTest → MiniMapCard + sensor test modal
```

**Refresh:** Manual button + auto-refresh (e.g. every 30 min or when “default interval” is read from Settings). Each refresh updates `lastUpdated`, which triggers a new `api.getReadings` and recomputes all derived state.

---

## 7. Implementation checklist (Dashboard)

| Item | Status | Notes |
|------|--------|--------|
| Today’s overview: low/avg/high per param, selected node | Done | TodayCard + todayStats |
| WQI: daily average of params → one WQI for selected node | Done | wqiValue from todayStats |
| Live chart: today’s time series, no mock data when empty | Partial | Remove fallback mock data in LiveChart when todayData is empty |
| Live chart: copy for default 15 min + adaptive sampling | To do | Short text/tooltip under chart; optional “Data collection” in Settings |
| Settings: Data collection (default/min/max interval) | To do | Add section; use default for dashboard refresh if desired |
| Mini map: location + sensor test per node | Done | MiniMapCard + useSensorTest |
| Alerts: total count + severity breakdown (Info/Warning/Critical) | To do | Map high/medium/low → Critical/Warning/Info; add counts |
| Alerts: tabs/pills All \| Critical \| Warning \| Info | To do | Optional filter in AlertsSummaryCard |
| Alerts: sort by severity then newest; recent list (e.g. 5) | To do | Sort before slice; already slice(0,5) |
| Alerts: empty state “No alerts — all systems operating normally” | To do | Update EmptyState message |
| Alerts: “See all alerts” link to Alerts page | To do | Add link/button |
| Sensor test failure → create alert, show in summary & Alerts page | To do | After test, if fail: add alert and merge into list |

This gives you a single reference for what each Dashboard block does and what remains to implement.
