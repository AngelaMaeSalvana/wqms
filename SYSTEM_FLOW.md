# System Flow Documentation

## IoT-Based Water Quality Monitoring System Architecture

This document describes the complete data flow of the Water Quality Monitoring System based on the schematic diagram.

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
- **Data Flow**: `Nodes → Microcontroller`

### 3. **MQTT Broker**
- **Purpose**: Enable live data streaming for instant updates
- **Function**:
  - Receives all sensor data from microcontroller
  - Publishes data to subscribed clients (Web Dashboard, Server)
  - Manages real-time data distribution
- **Data Flow**: 
  - `Microcontroller → MQTT Broker` (All data)
  - `MQTT Broker → Web Dashboard` (Live Updates)

### 4. **Server**
- **Purpose**: Store, analyze, and route data for logging and real-time access
- **Function**:
  - Subscribes to MQTT broker for live data
  - Processes and filters data
  - Stores filtered data to database
  - Provides API endpoints for historical data requests
- **Data Flow**: 
  - `MQTT Broker → Server` (Live data)
  - `Server → Database` (Filtered data)
  - `Web Dashboard ↔ Server` (Request/Response)

### 5. **Database**
- **Purpose**: Keep periodic records for historical tracking and analysis
- **Function**:
  - Stores filtered sensor data from server
  - Maintains historical records
  - Provides data for trend analysis
- **Data Flow**: 
  - `Server → Database` (Filtered data)
  - `Web Dashboard ↔ Database` (POST/Request)

### 6. **Web Dashboard**
- **Purpose**: Display real-time and historical data through an interactive interface
- **Function**:
  - Subscribes to MQTT broker for live updates
  - Requests historical data from Server/Database
  - Displays real-time charts, metrics, and alerts
  - Provides calendar view for historical data
- **Data Flow**: 
  - `MQTT Broker → Web Dashboard` (Live Updates)
  - `Web Dashboard → Server` (Request)
  - `Server → Web Dashboard` (Response)
  - `Web Dashboard → Database` (POST)
  - `Database → Web Dashboard` (Request)

## Complete Data Flow Paths

### Real-Time Data Stream (Primary Path)
```
Nodes → Microcontroller → MQTT Broker → Web Dashboard
                                    ↓
                                 Server → Database
```

**Description**: 
- Sensor nodes continuously collect data
- Microcontroller processes and transmits to MQTT broker
- MQTT broker immediately streams data to Web Dashboard for live updates
- Simultaneously, Server subscribes to MQTT for data storage

### Historical Data Path
```
Web Dashboard → Server → Database
Web Dashboard ← Server ← Database
```

**Description**:
- Web Dashboard requests historical data from Server
- Server queries Database for stored records
- Data is returned to Web Dashboard for display

## MQTT Topics Structure

Based on the system architecture, the following MQTT topics are used:

### Water Quality Data Topics
- `water-quality/node1` - Data from Node 1
- `water-quality/node2` - Data from Node 2
- `water-quality/all` - Aggregated data from all nodes
- `water-quality/+` - Wildcard for all water quality topics

### Sensor Data Topics
- `sensor-data/+` - Individual sensor readings
- `sensor-data/temperature`
- `sensor-data/turbidity`
- `sensor-data/pH`

### Alert Topics
- `alerts/+` - Alert notifications
- `alerts/critical`
- `alerts/warning`

## Expected MQTT Message Format

### Water Quality Data
```json
{
  "nodeId": "1",
  "temperature": 25.5,
  "turbidity": 15.2,
  "pH": 7.0,
  "nh3": 0.5,
  "dissolvedOxygen": 8.2,
  "wqi": 45,
  "location": "Villanueva",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Sensor Reading Format
```json
{
  "sensorReading": {
    "nodeId": "1",
    "temperature": 25.5,
    "turbidity": 15.2,
    "pH": 7.0,
    "nh3": 0.5,
    "dissolvedOxygen": 8.2,
    "wqi": 45
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Alert Format
```json
{
  "alert": {
    "title": "pH spike detected",
    "detail": "Node 3 recorded pH 6.2 at 21:38",
    "severity": "high",
    "nodeId": "3",
    "timestamp": "2024-01-15T21:38:00Z"
  }
}
```

## Implementation Details

### Web Dashboard MQTT Integration

The React application connects to the MQTT broker using:

1. **Connection**: WebSocket transport (ws:// or wss://) for browser compatibility
2. **Subscriptions**: 
   - `water-quality/+` - All water quality data
   - `sensor-data/+` - Individual sensor readings
   - `alerts/+` - Alert notifications
3. **QoS Level**: 1 (At least once delivery)
4. **Reconnection**: Automatic reconnection with exponential backoff

### Connection Configuration

Set the MQTT broker URL via environment variable:
```env
REACT_APP_MQTT_URL=ws://localhost:9001
```

Or for production with SSL:
```env
REACT_APP_MQTT_URL=wss://mqtt.yourdomain.com:9001
```

## Benefits of This Architecture

1. **Real-Time Updates**: MQTT provides instant data streaming to the dashboard
2. **Scalability**: MQTT broker can handle multiple subscribers (dashboard, server, mobile apps)
3. **Reliability**: QoS levels ensure message delivery
4. **Separation of Concerns**: 
   - MQTT handles real-time streaming
   - Server handles data processing and storage
   - Database handles historical data persistence
5. **Flexibility**: Easy to add new nodes or subscribers without changing the core architecture

## System Status Indicators

The Web Dashboard displays:
- **MQTT Connection Status**: Shows if connected to MQTT broker
- **Live Data Indicator**: Visual feedback when receiving real-time updates
- **Node Information**: Displays which node the current data is from
- **Alert Notifications**: Real-time alerts from MQTT alerts topic

