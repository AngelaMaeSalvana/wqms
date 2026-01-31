/**
 * Simple MQTT Broker Test Server
 * 
 * This script creates a simple MQTT-over-WebSocket broker for testing
 * the Water Quality Monitoring System dashboard.
 * 
 * Install dependencies:
 *   npm install aedes ws http
 * 
 * Run:
 *   node mqtt-broker-test.js
 * 
 * The broker will:
 * - Listen on WebSocket port 9001 (ws://localhost:9001)
 * - Relay real sensor data from ESP32 devices
 * - No dummy/test data - only real sensor readings from devices
 */

const aedes = require('aedes')();
const ws = require('ws');
const http = require('http');
const net = require('net');
const { Duplex } = require('stream');

// Create HTTP server with CORS support
const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }
  
  // For other requests, just return 200
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('MQTT WebSocket Broker');
});

// Create WebSocket server for MQTT
// mqtt.js uses WebSocket without subprotocol, so we accept all connections
const wsServer = new ws.Server({ 
  server, 
  path: '/',
  perMessageDeflate: false,
  clientTracking: true,
  verifyClient: (info) => {
    // Accept all WebSocket connections
    console.log('🔍 WebSocket connection attempt from:', info.origin || info.req.headers.origin || 'unknown');
    return true;
  }
});

// Handle WebSocket connections
wsServer.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  console.log('🔌 New WebSocket connection from:', clientIP);
  console.log('📋 Request URL:', req.url);
  console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));
  
  const stream = new Duplex({
    write(chunk, encoding, callback) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(chunk);
          callback();
        } catch (err) {
          console.error('❌ Error sending WebSocket message:', err);
          callback(err);
        }
      } else {
        callback(new Error('WebSocket not open'));
      }
    },
    read() {
      // No-op - data comes from WebSocket messages
    }
  });

  ws.on('message', (msg) => {
    try {
      if (Buffer.isBuffer(msg)) {
        stream.push(msg);
      } else if (typeof msg === 'string') {
        stream.push(Buffer.from(msg, 'utf8'));
      } else {
        stream.push(Buffer.from(msg));
      }
    } catch (err) {
      console.error('❌ Error processing WebSocket message:', err);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
    try {
      stream.destroy(error);
    } catch (e) {
      // Ignore destroy errors
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 WebSocket connection closed: code=${code}, reason=${reason || 'none'}`);
    try {
      stream.push(null);
      stream.destroy();
    } catch (e) {
      // Ignore destroy errors
    }
  });

  // Handle the stream with Aedes
  try {
    aedes.handle(stream);
  } catch (err) {
    console.error('❌ Error handling stream with Aedes:', err);
    ws.close();
  }
});

// Track connected clients
const connectedClients = new Map();

// MQTT broker event handlers
aedes.on('client', (client) => {
  const clientInfo = {
    id: client.id,
    ip: client.conn.remoteAddress || 'unknown',
    connectedAt: new Date().toISOString(),
    isRealDevice: client.id.includes('ESP32') || client.id.includes('Node')
  };
  
  connectedClients.set(client.id, clientInfo);
  
  console.log(`✅ Client connected: ${client.id}`);
  console.log(`   📍 IP Address: ${clientInfo.ip}`);
  console.log(`   🕐 Connected at: ${clientInfo.connectedAt}`);
  console.log(`   🔌 Type: ${clientInfo.isRealDevice ? 'Real Device (ESP32)' : 'Test/Web Client'}`);
  console.log(`   📊 Total connected clients: ${connectedClients.size}`);
});

aedes.on('clientDisconnect', (client) => {
  const clientInfo = connectedClients.get(client.id);
  const duration = clientInfo ? 
    Math.round((Date.now() - new Date(clientInfo.connectedAt).getTime()) / 1000) : 0;
  
  console.log(`❌ Client disconnected: ${client.id}`);
  if (clientInfo) {
    console.log(`   📍 IP Address: ${clientInfo.ip}`);
    console.log(`   ⏱️  Connection duration: ${duration} seconds`);
  }
  
  connectedClients.delete(client.id);
  console.log(`   📊 Remaining connected clients: ${connectedClients.size}`);
});

aedes.on('subscribe', (subscriptions, client) => {
  const topics = subscriptions.map(s => s.topic).join(', ');
  console.log(`📡 Client ${client.id} subscribed to: ${topics}`);
  
  const clientInfo = connectedClients.get(client.id);
  if (clientInfo) {
    console.log(`   📍 IP Address: ${clientInfo.ip}`);
  }
});

aedes.on('publish', (packet, client) => {
  if (client) {
    const clientInfo = connectedClients.get(client.id);
    const isRealDevice = clientInfo?.isRealDevice || false;
    
    // Try to parse payload for better logging
    let payloadInfo = '';
    try {
      const payloadStr = packet.payload.toString();
      if (payloadStr.startsWith('{')) {
        const data = JSON.parse(payloadStr);
        if (data.nodeId) {
          payloadInfo = ` | Node: ${data.nodeId}`;
          if (data.wqi !== undefined) {
            payloadInfo += `, WQI: ${data.wqi}`;
          }
          if (data.temperature !== undefined) {
            payloadInfo += `, Temp: ${data.temperature.toFixed(1)}°C`;
          }
        }
      }
    } catch (e) {
      // Not JSON, ignore
    }
    
    const deviceType = isRealDevice ? '🔌 [ESP32 Device]' : '💻 [Web/Test Client]';
    console.log(`📨 ${deviceType} Client ${client.id} published to: ${packet.topic}${payloadInfo}`);
    
    if (clientInfo) {
      console.log(`   📍 IP Address: ${clientInfo.ip}`);
    }
  }
});

// Start TCP server for microcontrollers (standard MQTT protocol)
const TCP_PORT = 1883;
const tcpServer = net.createServer((socket) => {
  const clientIP = socket.remoteAddress || 'unknown';
  const clientPort = socket.remotePort || 'unknown';
  
  console.log(`🔌 New TCP connection from: ${clientIP}:${clientPort}`);
  console.log(`   📍 This is likely an ESP32 or other microcontroller`);
  
  socket.on('error', (err) => {
    console.error(`❌ TCP socket error from ${clientIP}:`, err.message);
  });
  
  socket.on('close', () => {
    console.log(`🔌 TCP connection closed: ${clientIP}:${clientPort}`);
  });
  
  // Handle the connection with Aedes
  aedes.handle(socket);
});

tcpServer.listen(TCP_PORT, () => {
  console.log(`📡 MQTT TCP server listening on port ${TCP_PORT} (for microcontrollers)`);
  console.log(`💡 Microcontrollers should connect to: tcp://YOUR_IP:${TCP_PORT}`);
  
  // Get and display server IP addresses
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  console.log(`\n📋 Available IP addresses for ESP32 connection:`);
  for (const interfaceName of Object.keys(networkInterfaces)) {
    for (const iface of networkInterfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`   ${interfaceName}: ${iface.address} → Use: ${iface.address}:${TCP_PORT}`);
      }
    }
  }
  console.log('');
});

tcpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`⚠️  Port ${TCP_PORT} already in use. TCP server not started.`);
    console.log(`💡 You may need to stop other MQTT brokers or change the port.`);
    console.log(`💡 Try: netstat -ano | findstr :${TCP_PORT} (Windows) or lsof -i :${TCP_PORT} (Mac/Linux)`);
  } else {
    console.error('❌ TCP server error:', err);
  }
});

// Start WebSocket server for web dashboard
const WS_PORT = 9001;
server.listen(WS_PORT, () => {
  console.log(`🚀 MQTT WebSocket broker running on ws://localhost:${WS_PORT}`);
  console.log(`📡 Waiting for client connections...`);
  console.log(`💡 Your React app should connect to: ws://localhost:${WS_PORT}`);
  console.log(``);
  console.log(`📋 Connection Summary:`);
  console.log(`   - Web Dashboard: ws://localhost:${WS_PORT} (WebSocket)`);
  console.log(`   - Microcontrollers: tcp://YOUR_IP:${TCP_PORT} (TCP/MQTT)`);
  console.log(`   - No test data: only real sensor readings from devices`);
  console.log(``);
  
  // Periodic status update
  setInterval(() => {
    const realDevices = Array.from(connectedClients.values()).filter(c => c.isRealDevice);
    const webClients = Array.from(connectedClients.values()).filter(c => !c.isRealDevice);
    
    if (connectedClients.size > 0) {
      console.log(`\n📊 Connection Status:`);
      console.log(`   🔌 Real Devices (ESP32): ${realDevices.length}`);
      realDevices.forEach(client => {
        console.log(`      - ${client.id} (${client.ip})`);
      });
      console.log(`   💻 Web/Test Clients: ${webClients.length}`);
      webClients.forEach(client => {
        console.log(`      - ${client.id} (${client.ip})`);
      });
      console.log(`   📈 Total: ${connectedClients.size} clients\n`);
    }
  }, 30000); // Every 30 seconds
});

