# MQTT Connection Troubleshooting

## If you see "MQTT Disconnected"

### Step 1: Check Browser Console
Open your browser's Developer Tools (F12) and check the Console tab for:
- Connection errors
- MQTT connection attempts
- Any error messages

Look for messages like:
- `🔌 Attempting to connect to MQTT broker: ws://localhost:9001`
- `❌ MQTT Error: ...`
- `⚠️ MQTT Client offline`

### Step 2: Verify Broker is Running
Check if the broker is listening on port 9001:
```powershell
netstat -an | findstr :9001
```

You should see:
```
TCP    0.0.0.0:9001           0.0.0.0:0              LISTENING
```

### Step 3: Restart the Broker
1. Stop the current broker (if running)
2. Navigate to server directory:
   ```bash
   cd server
   ```
3. Start the broker:
   ```bash
   npm start
   ```

You should see:
```
🚀 MQTT WebSocket broker running on ws://localhost:9001
📡 Waiting for client connections...
```

### Step 4: Check React App Console
In your React app's terminal, you should see connection attempts.

### Step 5: Test Connection Manually
You can test the WebSocket connection using browser console:
```javascript
const ws = new WebSocket('ws://localhost:9001');
ws.onopen = () => console.log('✅ WebSocket connected');
ws.onerror = (e) => console.error('❌ WebSocket error:', e);
ws.onclose = () => console.log('🔌 WebSocket closed');
```

### Common Issues:

1. **Port Already in Use**
   - Another application is using port 9001
   - Solution: Change port in broker or kill the process

2. **Firewall Blocking**
   - Windows Firewall might be blocking the connection
   - Solution: Allow Node.js through firewall

3. **CORS Issues**
   - Browser blocking WebSocket connection
   - Solution: Check browser console for CORS errors

4. **Wrong URL**
   - Verify the MQTT URL is correct
   - Check `.env` file if using environment variable

5. **Broker Not Started**
   - Make sure broker is actually running
   - Check for errors in broker console

### Quick Fix:
1. Stop the broker (Ctrl+C in broker terminal)
2. Restart the broker: `cd server && npm start`
3. Refresh your React app
4. Check browser console for connection status

