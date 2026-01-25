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
 * - No dummy/test data - only real sensor readings
 */

const aedes = require('aedes')();
const ws = require('ws');
const http = require('http');t
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

// ============================================================================
// TEST DATA PUBLISHING - ENABLED
// ============================================================================
// Test data is published every minute to simulate sensor readings.
// The dashboard will average readings from the 10 minutes before each
// 30-minute mark (e.g., 11:20-11:30 for the 11:30 data point).
// ============================================================================

// Test data for Node 1
const generateNode1Data = () => {
  const baseTemp = 24.5;
  const baseTurb = 12.0;
  const basePH = 7.2;
  const baseNH3 = 0.3;
  const baseDO = 7.5;
  
  // Add small random variations (±5% for realistic fluctuations)
  const variation = 0.05;
  return {
    nodeId: 'node1',
    temperature: parseFloat((baseTemp + (Math.random() - 0.5) * baseTemp * variation).toFixed(1)),
    turbidity: parseFloat((baseTurb + (Math.random() - 0.5) * baseTurb * variation).toFixed(1)),
    pH: parseFloat((basePH + (Math.random() - 0.5) * basePH * variation).toFixed(2)),
    nh3: parseFloat((baseNH3 + (Math.random() - 0.5) * baseNH3 * variation).toFixed(2)),
    dissolvedOxygen: parseFloat((baseDO + (Math.random() - 0.5) * baseDO * variation).toFixed(1)),
    location: 'Test Location 1',
    timestamp: new Date().toISOString(),
  };
};

// Test data for Node 2
const generateNode2Data = () => {
  const baseTemp = 23.8;
  const baseTurb = 14.5;
  const basePH = 6.9;
  const baseNH3 = 0.4;
  const baseDO = 8.0;
  
  // Add small random variations (±5% for realistic fluctuations)
  const variation = 0.05;
  return {
    nodeId: 'node2',
    temperature: parseFloat((baseTemp + (Math.random() - 0.5) * baseTemp * variation).toFixed(1)),
    turbidity: parseFloat((baseTurb + (Math.random() - 0.5) * baseTurb * variation).toFixed(1)),
    pH: parseFloat((basePH + (Math.random() - 0.5) * basePH * variation).toFixed(2)),
    nh3: parseFloat((baseNH3 + (Math.random() - 0.5) * baseNH3 * variation).toFixed(2)),
    dissolvedOxygen: parseFloat((baseDO + (Math.random() - 0.5) * baseDO * variation).toFixed(1)),
    location: 'Test Location 2',
    timestamp: new Date().toISOString(),
  };
};

// Publish test data every minute (60000ms)
// This ensures we have 10 readings per 30-minute window for averaging
let testDataInterval = null;

const startTestDataPublishing = () => {
  if (testDataInterval) {
    clearInterval(testDataInterval);
  }
  
  console.log('📊 Starting test data publishing (every 1 minute)...');
  console.log('   Data will be published to: water-quality/node1 and water-quality/node2');
  console.log('   Dashboard will average readings from 10 minutes before each 30-minute mark');
  
  // Publish immediately
  const node1Data = generateNode1Data();
  const node2Data = generateNode2Data();
  
  aedes.publish({
    topic: 'water-quality/node1',
    payload: JSON.stringify(node1Data),
    qos: 0,
  }, (err) => {
    if (err) {
      console.error('❌ Error publishing node1 test data:', err);
    } else {
      console.log(`📨 Published test data to water-quality/node1: Temp=${node1Data.temperature}°C, pH=${node1Data.pH}`);
    }
  });
  
  aedes.publish({
    topic: 'water-quality/node2',
    payload: JSON.stringify(node2Data),
    qos: 0,
  }, (err) => {
    if (err) {
      console.error('❌ Error publishing node2 test data:', err);
    } else {
      console.log(`📨 Published test data to water-quality/node2: Temp=${node2Data.temperature}°C, pH=${node2Data.pH}`);
    }
  });
  
  // Then publish every minute
  testDataInterval = setInterval(() => {
    const node1Data = generateNode1Data();
    const node2Data = generateNode2Data();
    
    aedes.publish({
      topic: 'water-quality/node1',
      payload: JSON.stringify(node1Data),
      qos: 0,
    }, (err) => {
      if (err) {
        console.error('❌ Error publishing node1 test data:', err);
      } else {
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        console.log(`📨 [${timeStr}] Published test data to water-quality/node1`);
      }
    });
    
    aedes.publish({
      topic: 'water-quality/node2',
      payload: JSON.stringify(node2Data),
      qos: 0,
    }, (err) => {
      if (err) {
        console.error('❌ Error publishing node2 test data:', err);
      } else {
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        console.log(`📨 [${timeStr}] Published test data to water-quality/node2`);
      }
    });
  }, 60000); // Every 1 minute (60000ms)
};

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
  console.log(`📋 Test Data Publishing:`);
  console.log(`   ✅ Test data published every 1 minute`);
  console.log(`   ✅ Topics: water-quality/node1, water-quality/node2`);
  console.log(`   ✅ Dashboard averages readings from 10 minutes before each 30-minute mark`);
  console.log(``);
  console.log(`📋 Connection Summary:`);
  console.log(`   - Web Dashboard: ws://localhost:${WS_PORT} (WebSocket)`);
  console.log(`   - Microcontrollers: tcp://YOUR_IP:${TCP_PORT} (TCP/MQTT)`);
  console.log(``);
  console.log(`💡 How It Works:`);
  console.log(`   1. Test data is published every minute`);
  console.log(`   2. For each 30-minute mark (e.g., 11:30), the dashboard collects`);
  console.log(`      readings from 10 minutes before (11:20-11:30) and averages them`);
  console.log(`   3. The averaged value is displayed at the 30-minute mark on the chart`);
  console.log(`   4. Use Ctrl+C to stop the broker`);
  console.log(``);
  
  // Start publishing test data
  startTestDataPublishing();
  
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

