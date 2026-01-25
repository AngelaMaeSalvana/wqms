# MQTT Broker Setup Guide

## Current Status
Your dashboard is trying to connect to: `ws://localhost:9001`

## Option 1: Quick Test with Mosquitto (Recommended for Development)

### Install Mosquitto MQTT Broker

**Windows:**
1. Download from: https://mosquitto.org/download/
2. Or use Chocolatey: `choco install mosquitto`
3. Or use WSL: `sudo apt-get install mosquitto mosquitto-clients`

**macOS:**
```bash
brew install mosquitto
```

**Linux:**
```bash
sudo apt-get install mosquitto mosquitto-clients
```

### Configure Mosquitto for WebSocket

Edit `mosquitto.conf` (usually in `/etc/mosquitto/` or `C:\Program Files\mosquitto\`):

```conf
# WebSocket listener on port 9001
listener 9001
protocol websockets

# TCP listener on port 1883 (optional, for non-browser clients)
listener 1883
protocol mqtt

# Allow anonymous connections (for testing only)
allow_anonymous true
```

### Start Mosquitto
```bash
mosquitto -c mosquitto.conf
```

## Option 2: Use HiveMQ Public Broker (Testing Only)

For quick testing, you can use HiveMQ's public broker:

1. Create `client/.env`:
```
REACT_APP_MQTT_URL=wss://broker.hivemq.com:8000/mqtt
```

**Note**: This is a public broker - don't use for production!

## Option 3: Simple Node.js MQTT Broker (For Testing)

I've created a simple test broker in `server/mqtt-broker-test.js` that you can run locally.

## Option 4: Cloud MQTT Services

### HiveMQ Cloud
- Free tier available
- WebSocket support
- URL format: `wss://your-instance.hivemq.cloud:8884`

### AWS IoT Core
- Requires AWS account
- WebSocket support via MQTT over WebSockets

### Eclipse Mosquitto Cloud
- Free tier available
- Easy setup

## Configuration

### Set MQTT Broker URL

Create `client/.env` file:
```env
REACT_APP_MQTT_URL=ws://localhost:9001
```

For SSL/secure connection:
```env
REACT_APP_MQTT_URL=wss://your-broker:9001
```

### Restart React App

After setting the environment variable, restart your React app:
```bash
npm start
```

## Testing Connection

1. Start your MQTT broker
2. The dashboard will automatically try to connect
3. Check the connection status indicator (top-right corner)
4. If connected, it will show "MQTT Live" in green

## Publishing Test Data

Once your broker is running, you can publish test data using `mosquitto_pub`:

```bash
mosquitto_pub -h localhost -p 1883 -t "water-quality/node1" -m '{"temperature":25.5,"turbidity":15.2,"pH":7.0,"nh3":0.5,"dissolvedOxygen":8.2,"wqi":45,"location":"Villanueva","nodeId":"1"}'
```

Or using the test broker script (see `server/mqtt-broker-test.js`).

## Troubleshooting

### Connection Refused
- Check if MQTT broker is running
- Verify the port (9001 for WebSocket)
- Check firewall settings

### WebSocket Connection Failed
- Ensure broker supports WebSocket protocol
- Check if using correct protocol (ws:// or wss://)
- Verify CORS settings if using remote broker

### Still Disconnected
- Check browser console for errors
- Verify environment variable is set correctly
- Restart React development server after changing .env

