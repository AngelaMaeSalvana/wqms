# WQMS Overall Process Flow

> **Tip:** If you get "No diagram type detected", your tool may be parsing the whole file. Use the standalone diagram files in `docs/diagrams/` (e.g. `00-overall-flowchart.mmd`) and paste their contents into [mermaid.live](https://mermaid.live) or a Mermaid renderer that accepts a single diagram.

## Overall Flow

End-to-end view from sensor collection through backend processing and delivery to the UI display.

```mermaid
flowchart LR
    subgraph collection [1. Collection]
        Sensor[Sensor Node]
        Proto[LoRa or MQTT]
    end

    subgraph backend [2. Backend]
        Bridge[MQTT Bridge]
        API[Express REST API]
        DB[(DB)]
    end

    subgraph delivery [3. Delivery]
        HTTP[HTTP Fetch]
        WS[WebSocket]
        Realtime[Supabase Realtime]
    end

    subgraph display [4. Display]
        Dash[Dashboard]
        Reports[Reports]
        Logs[Sensor Logs]
        Map[Map]
        Nodes[Nodes]
        Alerts[Alerts]
    end

    Sensor --> Proto
    Proto --> Bridge
    Bridge --> API
    API --> DB
    DB --> HTTP
    DB --> WS
    DB --> Realtime
    HTTP --> Reports
    HTTP --> Logs
    WS --> Dash
    Realtime --> Dash
    Realtime --> Alerts
    HTTP --> Map
    HTTP --> Nodes
```

---

## System Architecture

```mermaid
flowchart TB
    subgraph client [React Client SPA]
        Layout[Layout + SideNavigation]
        Dashboard[Dashboard]
        Reports[Reports]
        SensorLogs[Sensor Logs]
        Map[Map]
        Nodes[Nodes]
        Alerts[Alerts]
        Settings[Settings]
        PerfTest[Performance Test]
        InactiveNodes[Inactive Nodes]
    end

    subgraph backend [Backend]
        API[Express REST API]
        WS[WebSocket Live]
        MQTT[MQTT Bridge]
        DB[(Supabase or SQLite)]
    end

    subgraph external [External]
        Sensors[IoT Sensors]
        EmailJS[EmailJS]
    end

    Layout --> Dashboard
    Layout --> Reports
    Layout --> SensorLogs
    Layout --> Map
    Layout --> Nodes
    Layout --> Alerts
    Layout --> Settings
    Nodes --> InactiveNodes
    SensorLogs --> PerfTest

    Sensors --> MQTT
    MQTT --> API
    API --> DB
    API --> WS
    WS --> Dashboard
    Dashboard --> API
    Reports --> API
    SensorLogs --> API
    Map --> API
    Nodes --> API
    Alerts --> API
    PerfTest --> API
    API --> EmailJS
```

---

## User Navigation Flow

```mermaid
flowchart LR
    subgraph entry [Entry Point]
        Root[Home] --> Dash[Dashboard]
    end

    subgraph main [Main Pages]
        Dash
        Rep[Reports]
        Logs[Sensor Logs]
        MapPage[Map]
        NodePage[Nodes]
        AlertPage[Alerts]
        Set[Settings]
    end

    subgraph secondary [Secondary]
        Inactive[Inactive Nodes]
        Perf[Performance Test]
    end

    Dash --> Rep
    Rep --> Logs
    Logs --> MapPage
    MapPage --> NodePage
    NodePage --> AlertPage
    AlertPage --> Set
    NodePage --> Inactive
    Logs --> Perf
    Perf --> Logs
    Inactive --> NodePage
```

---

## Data Process Flow

```mermaid
flowchart TB
    subgraph ingestion [Ingestion]
        S[IoT Sensors]
        M[MQTT Broker]
        B[Backend API]
        D[(Database)]
    end

    subgraph processing [Processing]
        R[Readings]
        A[Alerts Engine]
        W[WebSocket]
        Realtime[Supabase Realtime]
    end

    subgraph presentation [Presentation]
        P1[Dashboard]
        P2[Reports]
        P3[Sensor Logs]
        P4[Alerts]
        P5[Map]
    end

    S -->|publish| M
    M -->|receive| B
    B -->|store| D
    B -->|broadcast| W
    D -->|INSERT| Realtime

    D --> R
    R --> A
    A --> D
    Realtime --> P1
    Realtime --> P4
    W --> P1
    R --> P1
    R --> P2
    R --> P3
    A --> P4
    D --> P2
    D --> P3
    D --> P4
    D --> P5
```

---

## Sensor-to-Dashboard Pipeline

```mermaid
flowchart LR
    subgraph step1 [1. Collection]
        Sensor[Sensor Node]
        LoRa[LoRa or MQTT]
    end

    subgraph step2 [2. Backend]
        Bridge[Bridge]
        API2[REST API]
        Store[(DB)]
    end

    subgraph step3 [3. Delivery]
        Fetch[HTTP Fetch]
        WS2[WebSocket]
        RT[Realtime]
    end

    subgraph step4 [4. Display]
        Charts[Charts]
        Cards[Cards]
        Map2[Map]
    end

    Sensor --> LoRa
    LoRa --> Bridge
    Bridge --> API2
    API2 --> Store
    Store --> Fetch
    Store --> WS2
    Store --> RT
    Fetch --> Charts
    Fetch --> Cards
    WS2 --> Charts
    RT --> Cards
    Store --> Map2
```

---

## Test Run Data Flow

Test Run Detail Modal shows IoT Performance and Alert Responsiveness for a given test run. Data is always fetched from Supabase—no generation during tests. Data arrives in Supabase from one of two sources:

1. **Real LoRa path:** Sensor node → LoRa → Forwarder → MQTT (HiveMQ) → Bridge → Supabase  
2. **Test scenarios path:** `test.js` / `run-random-scenarios.js` → MQTT (HiveMQ) → Bridge → Supabase  

**Important:** The Express server does **not** write sensor readings to the database. Only `bridge.js` writes to Supabase. You must run the bridge for data to be stored.

### Required process order

1. **Start the bridge:** `cd server && npm run bridge` (or `node bridge.js`). Wait for "Subscribed to water-quality/#".
2. **Start the server (API):** For the REST API and Performance Test UI: `cd server && npm start`.
3. **Start a test run:** From the Performance Test page, click "Start test run" with desired interval and duration. The server publishes `test_start` to MQTT; the bridge receives it and sets `activeTestRunContext` so incoming packets are tagged with `test_run_id`.
4. **Provide packet data (choose one):**
   - Run test scenarios: `node scripts/run-random-scenarios.js --minutes 5` (or `node scripts/test.js --scenario <name>`).
   - Or have real LoRa nodes transmit during the run window.

Packets published to MQTT during the active test run window will be tagged with `test_run_id` by the bridge and stored in Supabase. The Test Run Detail Modal fetches from Supabase by `test_run_id`—no on-the-fly generation.
