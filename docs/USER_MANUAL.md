# AQUALENS — Quick Start Guide for Beginner Users

A short manual to get you started with the **AQUALENS** Water Quality Monitoring System.

---

## What is AQUALENS?

AQUALENS displays real-time water quality data from sensor nodes placed at different locations. You can view live readings, generate reports, manage nodes, and get alerts when water quality goes out of range.

---

## Getting Started

1. **Log in** (or open the app if no login is required).
2. **Dashboard** is your home screen — you land here by default.
3. Use the **sidebar** (or hamburger menu on mobile) to move between pages.

---

## Main Sections

### Dashboard

- **Node dropdown** — Choose which sensor node to view (or "All nodes").
- **Today's stats** — Temperature, pH, Turbidity, NH₃, Flow Rate, Dissolved O₂ (Min / Avg / Max).
- **Live chart** — Recent readings over time.
- **WQI card** — Water Quality Index and classification.
- **Mini map** — Node locations at a glance.
- **Alerts summary** — Count of active alerts.

**Tip:** Data updates automatically; no need to refresh.

---

### Reports

- **Tabs:** Water Quality | Alerts & Compliance | System | Testing
- **Date picker** — Choose the period for your report.
- **Parameter** — Pick what to show (e.g. Temperature, pH, WQI).
- **Chart type** — Line or bar chart.
- **Export** — Save as CSV or Excel for analysis or sharing.

---

### Sensor Logs

- **Table** of past readings: date, time, node, temperature, pH, turbidity, dissolved O₂, NH₃, flow rate, WQI.
- **Search** — Filter by date, node, or value.
- **Date filter** — Limit logs to a date range.
- **Export** — Download logs as CSV or Excel.
- **Manual input** — Enter a reading by hand when a sensor reading needs to be added manually.

---

### Map & Locations

- **Map view** — See all sensor nodes on the map.
- **Click a marker** — View node details (including last readings).
- **Recenters** — Use the button to center the map on your nodes.

---

### Nodes

Manage your sensor nodes:

- **Add node** — Create a new node (ID, name, location, coordinates).
- **Edit** — Change name, location, or coordinates.
- **Location picker** — Click to set coordinates on a map.
- **Inactive nodes** — List nodes that have not sent data recently.
- **Battery** — Shows battery level where available.

---

### Alerts

- **List of alerts** — Sorted by time; shows severity (High, Medium, Low).
- **Click an alert** — See full details.
- **Mark as read** — Keeps track of what you’ve seen.
- **Export** — Save alerts to CSV or Excel.
- **Email alerts** — Enable in Settings if available, to get notifications by email.

---

## Understanding Alert Logic

Alerts are generated automatically. Here's how the system decides when and how severe an alert is.

### Types of Alerts

| Type | When it triggers |
|------|------------------|
| **Threshold** | A water parameter (temperature, pH, turbidity, dissolved O₂, NH₃) goes outside the safe range. |
| **Node offline** | A sensor node has not sent data (connectivity or power issue). |
| **Low battery** | Node battery is below 15% (warning) or 10% (critical). |
| **Maintenance due** | A node has not been serviced within the maintenance interval set in Settings. |
| **WQI rapid drop** | Water Quality Index drops by more than 15 points between readings. |
| **Multiple parameters degraded** | Two or more parameters are at Medium or High severity at once. |

### How Severity is Set

Severity (Low → Medium → High) is based on three layers:

**1. Deviation from threshold**

How far the value is beyond the limit:

- **Low** — Within about 5% of the limit (early warning).
- **Medium** — 5–10% beyond the limit.
- **High** — More than 10% beyond the limit.

**2. Persistence**

How long the problem continues:

- **1 reading** → Low.
- **2 consecutive readings** → Medium.
- **3 or more consecutive readings** → High.

The counter resets when the value returns to the safe range.

**3. WQI (Water Quality Index)**

Overall water quality can raise severity:

- **WQI ≥ 80** — No extra escalation.
- **WQI 70–79** — All threshold alerts raised to at least Low.
- **WQI 50–69** — All threshold alerts raised to at least Medium.
- **WQI < 50** — All threshold alerts raised to at least High.
- **WQI < 60** — Any Medium alert is upgraded to High.
- **2+ Medium/High parameters** → Extra system-level High alert.
- **WQI drops > 15 points** in one interval → High "rapid drop" alert.

### Special Rules

- **pH hysteresis** — pH must recover by a small buffer (default 0.2) before the alert clears. Prevents repeated on/off near the threshold.
- **NH₃ rapid rise** — If ammonia rises by more than 0.15 mg/L between readings, a High alert is generated even if the value is still within limits (possible spill).
- **Turbidity** — Uses a 2-sample average to reduce noise before checking the threshold.

### Thresholds

Configure min/max values in **Settings → Thresholds**. You can use presets (AA, A, B, C, D for Philippine standards) or set custom values. These limits are used for all threshold-based alerts.

---

### Settings

Configure how the system behaves:

- **WQI weights** — How each parameter contributes to the Water Quality Index.
- **Thresholds** — Min/max values that trigger alerts (e.g. pH, temperature).
- **Water classification** — Presets like AA, A, B, C, D (for Philippine standards).
- **Maintenance** — Default maintenance interval for nodes.
- **Alert logic** — When alerts are raised.
- **Theme** — Light or dark mode.

---

## Common Tasks

| Task | Where |
|------|--------|
| View live data | Dashboard |
| Change which node to focus on | Dashboard → Node dropdown |
| Enter a manual reading | Sensor Logs → Manual input |
| Export data | Reports or Sensor Logs → Export button |
| Add a new sensor node | Nodes → Add node |
| Check for problems | Alerts page |
| Change alert rules | Settings |

---

## Tips for Beginners

1. **Start with Dashboard** — See one node at a time to get familiar with the values.
2. **Use Reports** — Great for trends over days or weeks.
3. **Set up nodes first** — Add and configure nodes in **Nodes** before relying on data.
4. **Check Alerts** — Use this page to spot issues quickly.
5. **Theme** — Switch to dark/light mode in **Settings** for comfort.

---

## If Something Goes Wrong

- **No data showing** — Confirm the node is added and online; check connection status on the page.
- **Wrong values** — Check calibration and thresholds in **Settings**.
- **Map not loading** — Ensure location access is allowed and nodes have valid coordinates.
- **Page slow or stuck** — Refresh; if it continues, check your internet connection or contact support.

---

## Sidebar Menu Summary

| Icon | Page |
|------|------|
| Dashboard | Overview and live data |
| Reports | Charts and exports |
| Sensor Logs | Raw readings table |
| Map & Locations | Node map |
| Nodes | Node management |
| Alerts | Active alerts list |
| Settings | Configuration |

---

*Version: Water Quality Monitor — AQUALENS*
