# Quick Start: MQTT Connection

## The Dashboard is Currently Offline

Your dashboard is trying to connect to: **`ws://localhost:9001`**

## Quick Fix: Start the Test MQTT Broker

### Option 1: Use the Test Broker (Easiest)

1. **Open a new terminal/command prompt**

2. **Navigate to the server directory:**
   ```bash
   cd server
   ```

3. **Install dependencies (if not already installed):**
   ```bash
   npm install aedes ws
   ```

4. **Start the MQTT broker:**
   ```bash
   node mqtt-broker-test.js
   ```

5. **You should see:**
   ```
   🚀 MQTT WebSocket broker running on ws://localhost:9001
   📡 Waiting for client connections...
   ```

6. **The dashboard will automatically connect!** ✅

The test broker will:
- Accept connections from your dashboard
- Publish test sensor data every 5 seconds
- Work with real ESP32 devices when they connect

---

### Option 2: Use Mosquitto (Production)

**Windows:**
```bash
# Install via Chocolatey
choco install mosquitto

# Or download from: https://mosquitto.org/download/
```

**macOS:**
```bash
brew install mosquitto
```

**Linux:**
```bash
sudo apt-get install mosquitto mosquitto-clients
```

**Configure Mosquitto** (`mosquitto.conf`):
```conf
listener 9001
protocol websockets
allow_anonymous true
```

**Start Mosquitto:**
```bash
mosquitto -c mosquitto.conf
```

---

### Option 3: Use Public Test Broker (Quick Test)

Create `client/.env`:
```env
REACT_APP_MQTT_URL=wss://broker.hivemq.com:8000/mqtt
```

**⚠️ Note:** This is a public broker - only for testing!

Then restart your React app:
```bash
cd client
npm start
```

---

## Verify Connection

1. **Check the connection status indicator** (top-right corner)
   - 🟢 **Green "Live"** = Connected ✅
   - 🔴 **Red "Offline"** = Not connected ❌

2. **Hover over the status indicator** to see:
   - Current broker URL
   - Error messages (if any)
   - Connection help

3. **Check browser console** (F12) for connection logs:
   - `✅ MQTT Connected to broker: ws://localhost:9001`
   - Or error messages if connection fails

---

## Troubleshooting

### "Connection Refused"
- **Solution:** Make sure the MQTT broker is running
- Check if port 9001 is available
- Try restarting the broker

### "WebSocket Connection Failed"
- **Solution:** Verify the broker supports WebSocket protocol
- Check if using correct URL (`ws://` for local, `wss://` for secure)

### Still Offline?
1. Check browser console (F12) for errors
2. Verify broker is running: `netstat -ano | findstr :9001` (Windows)
3. Try clicking "Reconnect" button in the status indicator
4. Restart both broker and React app

---

## Next Steps

Once connected:
- ✅ Dashboard will show live data updates
- ✅ Test data will appear every 5 seconds (if using test broker)
- ✅ Real ESP32 devices can connect and send data
- ✅ Charts and metrics will update in real-time

For more details, see `MQTT_SETUP.md`

