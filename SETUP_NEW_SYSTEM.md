# Setup Guide - New System Architecture

This guide explains how to set up and run the new system architecture with Backend and Database integration.

## System Architecture Overview

The new system follows this flow:
1. **Nodes** → Collect water quality data
2. **Microcontroller** → Processes and transmits to MQTT
3. **MQTT Broker** → Streams live data to Web Dashboard and Backend
4. **Backend Server** → Processes requests, filters data, stores to Database
5. **Database** → Stores historical data
6. **Web Dashboard** → Displays real-time (MQTT) and historical (API) data

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn

## Setup Steps

### 1. Install Backend Dependencies

```bash
cd server
npm install
```

This installs:
- Express.js (REST API server)
- SQLite3 (Database)
- MQTT client (for subscribing to broker)
- CORS (for cross-origin requests)

### 2. Install Frontend Dependencies

```bash
cd client
npm install
```

### 3. Configure Environment Variables

#### Backend (server/.env - optional)
```env
PORT=5000
MQTT_URL=mqtt://localhost:1883
MQTT_WS_URL=ws://localhost:9001
```

#### Frontend (client/.env)
```env
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_MQTT_URL=ws://localhost:9001
```

### 4. Start the MQTT Broker

In a separate terminal:
```bash
cd server
npm run mqtt-broker
```

This starts the test MQTT broker on:
- TCP: `localhost:1883`
- WebSocket: `localhost:9001`

### 5. Start the Backend Server

In a separate terminal:
```bash
cd server
npm start
# or for development with auto-reload:
npm run dev
```

The backend will:
- Start on `http://localhost:5000`
- Connect to MQTT broker
- Create SQLite database (`wqms.db`)
- Initialize database tables
- Subscribe to MQTT topics for data storage

### 6. Start the Frontend

In a separate terminal:
```bash
cd client
npm start
```

The frontend will:
- Start on `http://localhost:3000`
- Connect to MQTT for live updates
- Connect to Backend API for historical data

## API Endpoints

### Health Check
- `GET /api/health` - Check server status

### Readings
- `GET /api/readings/latest?nodeId=1` - Get latest reading
- `GET /api/readings?startDate=2025-12-01&endDate=2025-12-13&nodeId=1&limit=100` - Get readings by date range
- `GET /api/readings/date/:date?nodeId=1` - Get reading for specific date
- `POST /api/readings` - Store reading

### Daily Summaries
- `GET /api/summaries/daily?startDate=2025-12-01&endDate=2025-12-13&nodeId=1` - Get daily summaries

### Alerts
- `GET /api/alerts?limit=50&severity=high` - Get alerts
- `POST /api/alerts` - Store alert

## Database Schema

The SQLite database (`wqms.db`) contains three tables:

### water_quality_readings
Stores individual sensor readings:
- `id` (INTEGER PRIMARY KEY)
- `node_id` (TEXT)
- `location` (TEXT)
- `temperature` (REAL)
- `turbidity` (REAL)
- `ph` (REAL)
- `nh3` (REAL)
- `dissolved_oxygen` (REAL)
- `wqi` (INTEGER)
- `timestamp` (DATETIME)
- `created_at` (DATETIME)

### alerts
Stores alert notifications:
- `id` (INTEGER PRIMARY KEY)
- `node_id` (TEXT)
- `title` (TEXT)
- `detail` (TEXT)
- `severity` (TEXT)
- `timestamp` (DATETIME)
- `created_at` (DATETIME)

### daily_summaries
Stores aggregated daily data for faster queries:
- `id` (INTEGER PRIMARY KEY)
- `date` (DATE)
- `node_id` (TEXT)
- `location` (TEXT)
- `avg_temperature` (REAL)
- `avg_turbidity` (REAL)
- `avg_ph` (REAL)
- `avg_nh3` (REAL)
- `avg_dissolved_oxygen` (REAL)
- `avg_wqi` (REAL)
- `min_wqi` (INTEGER)
- `max_wqi` (INTEGER)
- `reading_count` (INTEGER)
- `created_at` (DATETIME)

## Data Flow

### Real-Time Data (MQTT)
```
Nodes → Microcontroller → MQTT Broker → Web Dashboard (Live Updates)
                                    ↓
                                 Backend → Database (Storage)
```

### Historical Data (REST API)
```
Web Dashboard → Backend → Database
Web Dashboard ← Backend ← Database
```

### Data Storage
```
MQTT Broker → Backend → Database (Filters data)
Web Dashboard → Backend → Database (POST)
```

## Features

### Frontend Features
- **Real-time Updates**: Receives live data via MQTT
- **Historical Data**: Fetches historical data from Backend API
- **Fallback Mode**: Uses deterministic data generation if API is unavailable
- **Calendar View**: Displays water quality data by date
- **Report Charts**: Shows weekly/monthly reports with aggregation (lowest/average/highest)
- **Alerts**: Displays alerts from MQTT and API

### Backend Features
- **MQTT Subscription**: Automatically subscribes to MQTT topics
- **Data Storage**: Stores filtered data to SQLite database
- **Daily Summaries**: Automatically aggregates data into daily summaries
- **REST API**: Provides endpoints for historical data queries
- **CORS Support**: Allows cross-origin requests from frontend

## Troubleshooting

### Backend not connecting to MQTT
- Ensure MQTT broker is running
- Check `MQTT_URL` environment variable
- Check broker logs for connection errors

### Frontend not fetching data from API
- Ensure backend server is running on port 5000
- Check `REACT_APP_API_URL` in `.env` file
- Check browser console for API errors
- Frontend will fallback to deterministic data if API fails

### Database not created
- Check file permissions in `server` directory
- Check backend logs for database errors
- Database is created automatically on first run

## Next Steps

1. **Production Deployment**: 
   - Use a production MQTT broker (Mosquitto, HiveMQ)
   - Use PostgreSQL or MySQL instead of SQLite
   - Add authentication to API endpoints
   - Use environment variables for sensitive data

2. **Microcontroller Integration**:
   - Connect ESP32/ESP8266 to MQTT broker
   - Publish sensor data to `water-quality/node1` topic
   - See `MICROCONTROLLER_INTEGRATION.md` for details

3. **Monitoring**:
   - Add logging and monitoring
   - Set up alerts for system health
   - Monitor database size and performance

