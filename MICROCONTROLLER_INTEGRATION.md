# Microcontroller Integration Guide

## System Architecture

Based on your system flow diagram:
```
Nodes (Sensors) → Microcontroller → MQTT Broker → Web Dashboard
```

## Connection Options

### Option 1: Local Network (Recommended for Development)
- **Requirement**: Microcontroller and MQTT broker on the same WiFi network
- **Advantages**: 
  - No internet required
  - Low latency
  - Secure (local network)
  - Free
- **Limitations**: 
  - Both devices must be on same network
  - Can't access from outside network

### Option 2: Internet/Cloud (Production)
- **Requirement**: Internet connection for both microcontroller and broker
- **Advantages**:
  - Access from anywhere
  - Can use cloud MQTT services
  - Scalable
- **Limitations**:
  - Requires internet connection
  - May have data costs
  - Higher latency
  - Security considerations

## Microcontroller Requirements

### Hardware Requirements:
1. **WiFi-enabled microcontroller** (ESP32, ESP8266, Raspberry Pi, etc.)
2. **Sensors** connected to microcontroller:
   - Temperature sensor
   - Turbidity sensor
   - pH sensor
   - NH₃ sensor
   - Dissolved Oxygen sensor

### Software Requirements:
- MQTT client library for your microcontroller
- WiFi connection capability
- JSON encoding for data

## ESP32/ESP8266 Example Code

### Basic Setup

```cpp
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// WiFi credentials
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// MQTT Broker settings
const char* mqtt_server = "192.168.1.100";  // Your broker IP (local network)
// OR for internet: "your-broker.com" or "mqtt.yourdomain.com"
const int mqtt_port = 1883;  // Standard MQTT port (not WebSocket)

// MQTT topics
const char* topic_node1 = "water-quality/node1";
const char* topic_sensor = "sensor-data/node1";

WiFiClient espClient;
PubSubClient client(espClient);

// Sensor pins (adjust based on your setup)
#define TEMP_SENSOR_PIN A0
#define TURBIDITY_SENSOR_PIN A1
#define PH_SENSOR_PIN A2
#define NH3_SENSOR_PIN A3
#define DO_SENSOR_PIN A4

void setup() {
  Serial.begin(115200);
  
  // Connect to WiFi
  setup_wifi();
  
  // Setup MQTT
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  
  // Initialize sensors
  pinMode(TEMP_SENSOR_PIN, INPUT);
  pinMode(TURBIDITY_SENSOR_PIN, INPUT);
  pinMode(PH_SENSOR_PIN, INPUT);
  pinMode(NH3_SENSOR_PIN, INPUT);
  pinMode(DO_SENSOR_PIN, INPUT);
}

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.println("WiFi connected");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());
}

void callback(char* topic, byte* payload, unsigned int length) {
  // Handle incoming MQTT messages if needed
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("] ");
  for (int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }
  Serial.println();
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    String clientId = "ESP32-Node1-";
    clientId += String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str())) {
      Serial.println("connected");
      // Subscribe to topics if needed
      // client.subscribe("commands/node1");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // Read sensors every 5 seconds
  static unsigned long lastRead = 0;
  unsigned long currentMillis = millis();
  
  if (currentMillis - lastRead >= 5000) {
    lastRead = currentMillis;
    
    // Read sensor values (adjust based on your sensor calibration)
    float temperature = readTemperature();
    float turbidity = readTurbidity();
    float pH = readPH();
    float nh3 = readNH3();
    float dissolvedOxygen = readDissolvedOxygen();
    float wqi = calculateWQI(temperature, turbidity, pH, nh3, dissolvedOxygen);
    
    // Create JSON payload
    StaticJsonDocument<256> doc;
    doc["nodeId"] = "1";
    doc["temperature"] = temperature;
    doc["turbidity"] = turbidity;
    doc["pH"] = pH;
    doc["nh3"] = nh3;
    doc["dissolvedOxygen"] = dissolvedOxygen;
    doc["wqi"] = wqi;
    doc["location"] = "Villanueva";
    doc["timestamp"] = millis(); // Or use RTC time if available
    
    char buffer[256];
    serializeJson(doc, buffer);
    
    // Publish to MQTT
    if (client.publish(topic_node1, buffer)) {
      Serial.println("Data published successfully");
    } else {
      Serial.println("Failed to publish data");
    }
    
    Serial.print("Published: ");
    Serial.println(buffer);
  }
}

// Sensor reading functions (implement based on your sensors)
float readTemperature() {
  // Read analog value and convert to temperature
  int raw = analogRead(TEMP_SENSOR_PIN);
  // Calibrate based on your sensor
  return 20.0 + (raw / 1024.0) * 30.0; // Example conversion
}

float readTurbidity() {
  int raw = analogRead(TURBIDITY_SENSOR_PIN);
  return (raw / 1024.0) * 50.0; // Example conversion
}

float readPH() {
  int raw = analogRead(PH_SENSOR_PIN);
  return 6.0 + (raw / 1024.0) * 2.0; // Example: 6.0 to 8.0
}

float readNH3() {
  int raw = analogRead(NH3_SENSOR_PIN);
  return (raw / 1024.0) * 1.0; // Example: 0 to 1.0 mg/L
}

float readDissolvedOxygen() {
  int raw = analogRead(DO_SENSOR_PIN);
  return 5.0 + (raw / 1024.0) * 5.0; // Example: 5 to 10 mg/L
}

float calculateWQI(float temp, float turb, float ph, float nh3, float do_val) {
  // Simplified WQI calculation
  // Adjust based on your WQI formula
  float score = 100;
  
  // Deduct points for poor values
  if (ph < 6.5 || ph > 8.5) score -= 20;
  if (turb > 30) score -= 15;
  if (nh3 > 0.5) score -= 10;
  if (do_val < 6) score -= 15;
  if (temp > 30) score -= 10;
  
  return max(0, score);
}
```

## Raspberry Pi Example (Python)

```python
import paho.mqtt.client as mqtt
import json
import time
from datetime import datetime

# MQTT Broker settings
MQTT_BROKER = "192.168.1.100"  # Your broker IP
MQTT_PORT = 1883
MQTT_TOPIC = "water-quality/node1"

# Sensor reading functions (implement based on your hardware)
def read_sensors():
    # Replace with actual sensor readings
    return {
        "nodeId": "1",
        "temperature": 25.5,
        "turbidity": 15.2,
        "pH": 7.0,
        "nh3": 0.5,
        "dissolvedOxygen": 8.2,
        "wqi": 45,
        "location": "Villanueva",
        "timestamp": datetime.now().isoformat()
    }

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("Connected to MQTT broker")
    else:
        print(f"Failed to connect, return code {rc}")

def on_publish(client, userdata, mid):
    print(f"Message published: {mid}")

# Create MQTT client
client = mqtt.Client()
client.on_connect = on_connect
client.on_publish = on_publish

# Connect to broker
client.connect(MQTT_BROKER, MQTT_PORT, 60)
client.loop_start()

# Publish sensor data every 5 seconds
try:
    while True:
        sensor_data = read_sensors()
        payload = json.dumps(sensor_data)
        result = client.publish(MQTT_TOPIC, payload, qos=1)
        
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            print(f"Published: {payload}")
        else:
            print(f"Failed to publish: {result.rc}")
        
        time.sleep(5)
except KeyboardInterrupt:
    client.loop_stop()
    client.disconnect()
```

## Configuring Your MQTT Broker

### For Local Network Connection:

1. **Find your broker's IP address:**
   ```bash
   # On Windows
   ipconfig
   
   # On Linux/Mac
   ifconfig
   ```

2. **Update broker to accept TCP connections** (not just WebSocket):

Edit `server/mqtt-broker-test.js` to add TCP listener:

```javascript
const net = require('net');
const tcpServer = net.createServer(aedes.handle);

// TCP listener on port 1883 (standard MQTT port)
tcpServer.listen(1883, () => {
  console.log('📡 MQTT TCP server listening on port 1883');
});
```

3. **Firewall Configuration:**
   - Allow port 1883 (TCP) for MQTT
   - Allow port 9001 (WebSocket) for browser connections

### For Internet Connection:

1. **Option A: Use Cloud MQTT Service**
   - HiveMQ Cloud (free tier available)
   - AWS IoT Core
   - Eclipse Mosquitto Cloud
   - Update microcontroller code with cloud broker URL

2. **Option B: Expose Your Broker**
   - Use port forwarding on your router
   - Use dynamic DNS service
   - Configure firewall rules
   - **Security Warning**: Use authentication and encryption (TLS/SSL)

## Network Limitations & Considerations

### Local Network:
- ✅ **No Internet Required**: Works offline
- ✅ **Low Latency**: Fast data transmission
- ✅ **Secure**: Data stays on local network
- ❌ **Range Limited**: Must be on same WiFi/LAN
- ❌ **No Remote Access**: Can't access from outside

### Internet Connection:
- ✅ **Remote Access**: Access from anywhere
- ✅ **Scalable**: Multiple locations
- ❌ **Requires Internet**: Both devices need connection
- ❌ **Data Costs**: May have bandwidth costs
- ❌ **Latency**: Higher delay
- ❌ **Security**: Need proper authentication/encryption

## Recommended Setup

### Development/Testing:
- Use **local network** connection
- Microcontroller and broker on same WiFi
- No internet required

### Production:
- Use **cloud MQTT service** (HiveMQ, AWS IoT, etc.)
- Or set up **VPN** for secure remote access
- Implement **authentication** and **encryption**

## Troubleshooting

### Microcontroller Can't Connect:
1. Check WiFi connection
2. Verify broker IP address
3. Check firewall settings
4. Ensure broker is running
5. Test with MQTT client tool (MQTT.fx, mosquitto_pub)

### Data Not Appearing:
1. Check topic names match
2. Verify JSON format
3. Check broker logs
4. Test with `mosquitto_sub` to see if data arrives

### Connection Drops:
1. Add reconnection logic
2. Use QoS 1 for reliable delivery
3. Implement keep-alive/ping
4. Check network stability

## Next Steps

1. **Choose your microcontroller** (ESP32 recommended)
2. **Set up WiFi connection** on microcontroller
3. **Install MQTT library** for your platform
4. **Configure broker IP** in microcontroller code
5. **Test connection** with simple publish
6. **Integrate sensors** and read values
7. **Publish data** to MQTT topics

