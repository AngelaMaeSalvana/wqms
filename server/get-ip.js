/**
 * Quick script to get your local IP address for ESP32 LoRa configuration
 * Run: node get-ip.js
 * 
 * This script displays your server's IP addresses that ESP32 devices
 * should use to connect to the MQTT broker.
 */

const os = require('os');
const networkInterfaces = os.networkInterfaces();

console.log('');
console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║     MQTT Broker IP Address Configuration for ESP32        ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');

const ipAddresses = [];

// Collect all IPv4 addresses
for (const interfaceName of Object.keys(networkInterfaces)) {
  for (const iface of networkInterfaces[interfaceName]) {
    // Skip internal (loopback) and non-IPv4 addresses
    if (iface.family === 'IPv4' && !iface.internal) {
      ipAddresses.push({
        interface: interfaceName,
        address: iface.address,
        mac: iface.mac || 'N/A'
      });
    }
  }
}

if (ipAddresses.length === 0) {
  console.log('⚠️  No network interfaces found!');
  console.log('💡 Make sure your computer is connected to a network.');
  console.log('');
  process.exit(1);
}

// Display primary IP (usually WiFi or Ethernet)
const primaryIP = ipAddresses[0];
console.log('📡 Primary IP Address (use this for ESP32):');
console.log('');
console.log(`   Interface: ${primaryIP.interface}`);
console.log(`   IP Address: ${primaryIP.address}`);
console.log(`   MAC Address: ${primaryIP.mac}`);
console.log('');

console.log('📋 ESP32 Configuration:');
console.log('');
console.log('   In config.h, set:');
console.log(`   #define MQTT_BROKER_IP "${primaryIP.address}"`);
console.log(`   #define MQTT_BROKER_PORT 1883`);
console.log('');

console.log('🔌 Connection Details:');
console.log('');
console.log(`   Protocol: TCP (MQTT)`);
console.log(`   Host: ${primaryIP.address}`);
console.log(`   Port: 1883`);
console.log(`   Full URL: tcp://${primaryIP.address}:1883`);
console.log('');

// Show all available IPs
if (ipAddresses.length > 1) {
  console.log('📡 All Available IP Addresses:');
  console.log('');
  ipAddresses.forEach((ip, index) => {
    const isPrimary = index === 0 ? ' (PRIMARY - Use this)' : '';
    console.log(`   ${index + 1}. ${ip.interface}: ${ip.address}${isPrimary}`);
  });
  console.log('');
}

console.log('💡 Instructions:');
console.log('');
console.log('   1. Copy the IP address above');
console.log('   2. Open esp32-lora-node/config.h');
console.log('   3. Replace MQTT_BROKER_IP with the IP address');
console.log('   4. Upload the code to your ESP32');
console.log('   5. Ensure ESP32 is on the same WiFi network');
console.log('');

console.log('🔍 Testing Connection:');
console.log('');
console.log('   To test if your ESP32 can reach the broker:');
console.log('   1. Start MQTT broker: node server/mqtt-broker-test.js');
console.log('   2. Check ESP32 Serial Monitor for connection status');
console.log('   3. Look for "✅ MQTT connected!" message');
console.log('');

console.log('⚠️  Important Notes:');
console.log('');
console.log('   • ESP32 and server must be on the same WiFi network');
console.log('   • Firewall may block port 1883 - allow it if needed');
console.log('   • If connection fails, check WiFi credentials in config.h');
console.log('   • Use this IP, NOT localhost or 127.0.0.1');
console.log('');

// Create easy copy format
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📋 Quick Copy (for config.h):');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`#define MQTT_BROKER_IP "${primaryIP.address}"`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

