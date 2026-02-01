# New System Flow - Water Quality Monitoring System

## Updated Architecture

Based on the new system diagram, the architecture now includes a Backend server and Database for processing requests and storing historical data.

## System Components

### 1. **Nodes (IoT Sensors)**
- **Purpose**: Collect real-time water quality data
- **Location**: Submerged in water bodies (Node 1, Node 2, etc.)
- **Function**: Continuously measure water quality parameters:
  - Temperature
  - Turbidity
  - pH Level
  - NH₃ (Ammonia)
  - Dissolved Oxygen
  - Water Quality Index (WQI)

### 2. **Microcontroller**
- **Purpose**: Process sensor signals and transmit data wirelessly
- **Function**: 
  - Receives analog/digital signals from sensor nodes
  - Processes and formats sensor data
  - Transmits data wirelessly to MQTT broker
- **Data Flow**: `Nodes → Microcontroller → MQTT Broker` (All data)

### 3. **MQTT Broker**
- **Purpose**: Enable live data streaming for instant updates
- **Function**:
  - Receives all sensor data from microcontroller
  - Publishes data to subscribed clients (Web Dashboard, Backend)
  - Manages real-time data distribution
- **Data Flow**: 
  - `Microcontroller → MQTT Broker` (All data)
  - `MQTT Broker → Web Dashboard` (Live Updates)
  - `MQTT Broker → Backend` (Live data for storage)

### 4. **Backend Server**
- **Purpose**: Process requests and filter data
- **Function**:
  - Subscribes to MQTT broker for live data
  - Processes and filters incoming data
  - Stores filtered data to Database
  - Provides REST API endpoints for historical data requests
  - Handles data processing logic
- **Data Flow**: 
  - `MQTT Broker → Backend` (Live data)
  - `Backend → Database` (Filters data)
  - `Database → Backend` (Data retrieval)
  - `Web Dashboard → Backend` (Request)
  - `Backend → Web Dashboard` (Response)

### 5. **Database**
- **Purpose**: Keep periodic records for historical tracking and analysis
- **Function**:
  - Stores filtered sensor data from Backend
  - Maintains historical records
  - Provides data for trend analysis
  - Stores alerts and daily summaries
- **Data Flow**: 
  - `Backend → Database` (Filters data)
  - `Database → Backend` (Data retrieval)
  - `Web Dashboard → Database` (POST)
  - `Database → Web Dashboard` (Request via Backend)

### 6. **Web Dashboard**
- **Purpose**: Display real-time and historical data through an interactive interface
- **Function**:
  - Subscribes to MQTT broker for live updates
  - Requests historical data from Backend API
  - Displays real-time charts, metrics, and alerts
  - Provides calendar view for historical data
  - Can POST data directly to Database (via Backend)
- **Data Flow**: 
  - `MQTT Broker → Web Dashboard` (Live Updates)
  - `Web Dashboard → Backend` (Request)
  - `Backend → Web Dashboard` (Response)
  - `Web Dashboard → Backend → Database` (POST)

## Complete Data Flow Paths

### Real-Time Data Stream (Primary Path)
```
Nodes → Microcontroller → MQTT Broker → Web Dashboard (Live Updates)
                                    ↓
                                 Backend → Database (Storage)
```

**Description**: 
- Sensor nodes continuously collect data
- Microcontroller processes and transmits to MQTT broker
- MQTT broker immediately streams data to Web Dashboard for live updates
- Simultaneously, Backend subscribes to MQTT for data storage

## Adaptive Data Collection and Live Updates

The system uses **adaptive data collection** and **live update frequency** based on flow rate conditions at each sensor node’s location. This balances data quality and responsiveness with power consumption, network usage, and storage.

### Live Updates (No Manual Refresh)

- The **dashboard supports continuous/live updates**. New data is reflected automatically as it becomes available—no manual page refresh is required.
- The dashboard receives live data via MQTT and can also poll the Backend API at a configurable interval to stay in sync with stored readings.

### Default Interval (Normal or Low-Flow)

- Under **normal or low-flow conditions**, the default **data collection and update interval is every 15 minutes** at the sensor node.
- This default optimizes battery life, LoRa bandwidth, and database size while still providing useful trend data.

### Adaptive Frequency (High Flow)

- When **flow rate increases** (indicating higher variability or more dynamic water conditions), the system **automatically increases** data collection and update frequency at the node.
- More frequent samples during high-flow periods improve detection of short-lived pollution or rapid changes in water quality.

### Return to Default (Stable or Decreasing Flow)

- When **flow rate stabilizes or decreases**, the system **returns to the default interval** (e.g. 15 minutes).
- This reduces power consumption, network usage, and data storage while maintaining adequate monitoring under calmer conditions.

### User-Configurable Interval (Dashboard)

- In **Settings**, users can set the **data collection frequency in minutes** (e.g. default 15). This preference is used by the dashboard for how often it refreshes data from the backend when not relying solely on live MQTT updates, and can inform or align with node configuration where supported.

### Historical Data Path
```
Web Dashboard → Backend → Database
Web Dashboard ← Backend ← Database
```

**Description**:
- Web Dashboard requests historical data from Backend
- Backend queries Database for stored records
- Data is filtered and processed by Backend
- Processed data is returned to Web Dashboard for display

### Data Storage Path
```
MQTT Broker → Backend → Database (Filters data)
Web Dashboard → Backend → Database (POST)
```

**Description**:
- Backend receives live data from MQTT and stores filtered data to Database
- Web Dashboard can also POST data directly to Database via Backend API

## Backend API Endpoints

### Health Check
- `GET /api/health` - Check server and database status

### Readings
- `GET /api/readings/latest?nodeId=1` - Get latest reading
- `GET /api/readings?startDate=2025-12-01&endDate=2025-12-13&nodeId=1&limit=100` - Get readings by date range
- `GET /api/readings/date/:date?nodeId=1` - Get reading for specific date
- `POST /api/readings` - Store reading (from web dashboard)

### Daily Summaries
- `GET /api/summaries/daily?startDate=2025-12-01&endDate=2025-12-13&nodeId=1` - Get daily summaries

### Alerts
- `GET /api/alerts?limit=50&severity=high` - Get alerts
- `POST /api/alerts` - Store alert (from web dashboard)

## Database Schema

### water_quality_readings
- Stores individual sensor readings
- Fields: id, node_id, location, temperature, turbidity, ph, nh3, dissolved_oxygen, wqi, timestamp

### alerts
- Stores alert notifications
- Fields: id, node_id, title, detail, severity, timestamp

### daily_summaries
- Stores aggregated daily data for faster queries
- Fields: id, date, node_id, location, avg_temperature, avg_turbidity, avg_ph, avg_nh3, avg_dissolved_oxygen, avg_wqi, min_wqi, max_wqi, reading_count

## Setup Instructions

### Backend Server
1. Install dependencies:
   ```bash
   cd server
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

3. The server will:
   - Start on port 5000 (or PORT environment variable)
   - Connect to MQTT broker
   - Create SQLite database (wqms.db)
   - Initialize database tables

### Frontend Configuration
1. Set API URL in `.env` file:
   ```env
   REACT_APP_API_URL=http://localhost:5000/api
   REACT_APP_MQTT_URL=ws://localhost:9001
   ```

2. The frontend will:
   - Connect to MQTT for live updates
   - Fetch historical data from Backend API
   - Fallback to deterministic data generation if API is unavailable

## Benefits of New Architecture

1. **Separation of Concerns**: 
   - MQTT handles real-time streaming
   - Backend handles data processing and API
   - Database handles data persistence

2. **Scalability**: 
   - Backend can process and filter data before storage
   - Database can be optimized for queries
   - Multiple clients can request data via API

3. **Reliability**: 
   - Data is stored persistently in database
   - Historical data is always available
   - Daily summaries enable fast queries

4. **Flexibility**: 
   - Web Dashboard can request specific date ranges
   - Backend can filter and aggregate data
   - Easy to add new API endpoints

