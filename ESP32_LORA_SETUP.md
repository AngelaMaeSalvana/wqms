# ESP32 LoRa Setup Guide

Complete guide for setting up ESP32 LoRa modules with the Water Quality Monitoring System (WQMS).

## Table of Contents

1. [Hardware Requirements](#hardware-requirements)
2. [Software Setup](#software-setup)
3. [Hardware Connections](#hardware-connections)
4. [Configuration](#configuration)
5. [Uploading Code](#uploading-code)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)

## Hardware Requirements

### Required Components

1. **ESP32 LoRa Module**
   - Recommended: Heltec ESP32 LoRa (ESP32 + LoRa SX1276/8)
   - Alternative: TTGO ESP32 LoRa
   - Must have WiFi capability (most ESP32 LoRa modules include WiFi)

2. **Water Quality Sensors**
   - Temperature sensor (DS18B20, LM35, or analog temperature sensor)
   - Turbidity sensor (analog output)
   - pH sensor (analog output, e.g., pH-4502C)
   - NH3 (Ammonia) sensor (analog output)
   - Dissolved Oxygen sensor (analog output)

3. **Additional Components**
   - USB cable for programming and power
   - Jumper wires for sensor connections
   - Resistors (if needed for sensor circuits)
   - Power supply (5V via USB or external supply)

### Pin Compatibility

ESP32 LoRa modules typically have:
- Multiple ADC pins (GPIO32-39)
- Digital I/O pins
- Built-in LoRa radio (for future expansion)

## Software Setup

### 1. Install Arduino IDE

1. Download Arduino IDE from: https://www.arduino.cc/en/software
2. Install the IDE (version 1.8.19 or later recommended)

### 2. Add ESP32 Board Support

1. Open Arduino IDE
2. Go to **File → Preferences**
3. In "Additional Board Manager URLs", add:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
4. Click **OK**
5. Go to **Tools → Board → Boards Manager**
6. Search for "ESP32"
7. Install "esp32" by Espressif Systems
8. Wait for installation to complete

### 3. Install Required Libraries

Install these libraries via **Tools → Manage Libraries**:

1. **PubSubClient** by Nick O'Leary
   - Search: "PubSubClient"
   - Install version 2.8.0 or later

2. **ArduinoJson** by Benoit Blanchon
   - Search: "ArduinoJson"
   - Install version 6.x (recommended)

### 4. Select Board and Port

1. Go to **Tools → Board → ESP32 Arduino**
2. Select your specific board:
   - **Heltec WiFi LoRa 32 (V2)** (for Heltec modules)
   - **TTGO LoRa32-OLED** (for TTGO modules)
   - Or **ESP32 Dev Module** (generic)

3. Go to **Tools → Port**
4. Select the COM port where your ESP32 is connected
   - Windows: Usually `COM3`, `COM4`, etc.
   - Mac/Linux: Usually `/dev/ttyUSB0` or `/dev/cu.usbserial-*`

### 5. Configure Upload Settings

In **Tools** menu, set:
- **Upload Speed**: 115200 (or 921600 for faster uploads)
- **CPU Frequency**: 240MHz (or 160MHz)
- **Flash Frequency**: 80MHz
- **Flash Size**: 4MB (or match your board)
- **Partition Scheme**: Default 4MB with spiffs (or as needed)

## Hardware Connections

### Sensor Pin Connections

Connect your sensors to the ESP32 according to the pin configuration in `config.h`:

| Sensor | Default Pin | ESP32 Pin | Notes |
|--------|-------------|-----------|-------|
| Temperature | GPIO34 | ADC1_CH6 | Input only, no pull-up |
| Turbidity | GPIO35 | ADC1_CH7 | Input only, no pull-up |
| pH | GPIO32 | ADC1_CH4 | Can use pull-up if needed |
| NH3 | GPIO33 | ADC1_CH5 | Can use pull-up if needed |
| Dissolved Oxygen | GPIO36 | ADC1_CH0 | Input only, no pull-up |

**Important Notes:**
- GPIO34, 35, and 36 are **input-only** pins (cannot be used as outputs)
- These pins are perfect for analog sensors
- Use GPIO32 and GPIO33 if you need pull-up resistors
- All ADC pins support 0-3.3V input range

### Example Sensor Connections

#### Temperature Sensor (DS18B20)
```
DS18B20 VCC → 3.3V
DS18B20 GND → GND
DS18B20 DATA → GPIO34 (with 4.7kΩ pull-up to 3.3V)
```

#### Analog pH Sensor (pH-4502C)
```
pH Sensor VCC → 5V (or 3.3V if sensor supports it)
pH Sensor GND → GND
pH Sensor OUT → GPIO32 (via voltage divider if needed)
```

#### Turbidity Sensor
```
Turbidity Sensor VCC → 5V
Turbidity Sensor GND → GND
Turbidity Sensor OUT → GPIO35
```

### Power Considerations

- Most ESP32 LoRa modules can be powered via USB (5V)
- For field deployment, consider:
  - Battery pack (3.7V LiPo with charging circuit)
  - Solar panel with battery backup
  - External 5V power supply

## Configuration

### 1. Update WiFi Credentials

Edit `esp32-lora-node/config.h`:

```cpp
#define WIFI_SSID "YourWiFiNetwork"
#define WIFI_PASSWORD "YourWiFiPassword"
```

### 2. Set MQTT Broker IP Address

1. On your server computer, run:
   ```bash
   cd server
   node get-ip.js
   ```

2. Copy the IP address shown (e.g., `192.168.1.100`)

3. Update `config.h`:
   ```cpp
   #define MQTT_BROKER_IP "192.168.1.100"
   ```

### 3. Configure Node Settings

Edit `config.h`:

```cpp
#define NODE_ID "1"              // Unique ID for this node
#define NODE_LOCATION "Villanueva"  // Location name
#define PUBLISH_INTERVAL_MS 5000    // How often to publish (milliseconds)
```

### 4. Adjust Sensor Calibration

If your sensors have different voltage ranges or calibration curves, update the calibration values in `config.h`:

```cpp
// Example: pH sensor calibration
#define PH_MIN_VOLTAGE 0.0
#define PH_MAX_VOLTAGE 3.3
#define PH_MIN_VALUE 0.0
#define PH_MAX_VALUE 14.0
```

**Calibration Tips:**
- Test each sensor individually
- Use known reference values (e.g., pH buffer solutions)
- Adjust min/max values based on your sensor's datasheet
- Some sensors may need non-linear calibration (requires code modification)

### 5. Configure Sensor Pins

If your sensors are connected to different pins, update in `config.h`:

```cpp
#define TEMP_SENSOR_PIN 34
#define TURBIDITY_SENSOR_PIN 35
// ... etc
```

## Uploading Code

### 1. Open the Sketch

1. Open Arduino IDE
2. Go to **File → Open**
3. Navigate to `esp32-lora-node/esp32_wqms_node.ino`
4. The IDE will automatically load `config.h` and `sensors.h`

### 2. Verify Configuration

Before uploading:
- ✅ WiFi credentials are set
- ✅ MQTT broker IP is correct
- ✅ Node ID and location are set
- ✅ Sensor pins match your connections

### 3. Compile and Upload

1. Click the **Verify** button (checkmark) to compile
2. Fix any compilation errors
3. Click the **Upload** button (arrow)
4. Wait for upload to complete
5. You may need to press the **BOOT** button on your ESP32 during upload

### 4. Open Serial Monitor

1. Go to **Tools → Serial Monitor**
2. Set baud rate to **115200**
3. You should see connection messages

## Testing

### 1. Verify WiFi Connection

In Serial Monitor, you should see:
```
📡 Connecting to WiFi: YourNetwork
✅ WiFi connected!
📶 IP address: 192.168.1.xxx
```

If connection fails:
- Check WiFi credentials
- Ensure ESP32 is within range
- Verify network allows new devices

### 2. Verify MQTT Connection

You should see:
```
🔌 Attempting MQTT connection to 192.168.1.100:1883...
✅ MQTT connected!
```

If connection fails:
- Verify MQTT broker is running
- Check broker IP address
- Ensure firewall allows port 1883
- Test broker with: `node server/mqtt-broker-test.js`

### 3. Verify Sensor Readings

You should see periodic sensor readings:
```
📊 Reading all sensors...
🌡️ Temperature: 25.3 °C
💧 Turbidity: 15.2 NTU
🧪 pH: 7.0
☁️ NH3: 0.5 mg/L
💨 Dissolved Oxygen: 8.2 mg/L
✅ Sensor reading complete
```

### 4. Verify Data Publishing

You should see:
```
✅ Data published successfully
📤 Topic: water-quality/node1
📦 Payload: {"nodeId":"1","temperature":25.3,...}
📊 WQI: 45
```

### 5. Check Backend Server

1. Ensure backend server is running:
   ```bash
   cd server
   node server.js
   ```

2. Check server logs for incoming data:
   ```
   💾 Stored reading from Node 1 (ID: xxx)
   ```

3. Verify data in database or check API:
   ```bash
   curl http://localhost:5000/api/readings/latest?nodeId=1
   ```

### 6. Check Web Dashboard

1. Open web dashboard: http://localhost:3000
2. Verify MQTT connection status shows "Connected"
3. Check if real-time data appears
4. Verify node information matches your configuration

## Troubleshooting

### WiFi Connection Issues

**Problem**: WiFi connection fails
- **Solution**: 
  - Double-check SSID and password (case-sensitive)
  - Ensure 2.4GHz network (ESP32 doesn't support 5GHz)
  - Move ESP32 closer to router
  - Check router settings (MAC filtering, etc.)

### MQTT Connection Issues

**Problem**: MQTT connection fails
- **Solution**:
  - Verify broker is running: `node server/mqtt-broker-test.js`
  - Check broker IP address matches your server
  - Ensure firewall allows port 1883
  - Test with MQTT client tool (MQTT.fx, mosquitto_pub)

**Problem**: "Connection refused" error
- **Solution**:
  - Broker may not be listening on TCP port 1883
  - Check `mqtt-broker-test.js` has TCP server enabled
  - Verify no other MQTT broker is using port 1883

### Sensor Reading Issues

**Problem**: All sensors return error values
- **Solution**:
  - Check sensor power connections (VCC and GND)
  - Verify sensor output pins are connected correctly
  - Test sensors individually with multimeter
  - Check ADC pin configuration

**Problem**: Sensor values are incorrect
- **Solution**:
  - Calibrate sensors with known reference values
  - Adjust calibration constants in `config.h`
  - Check sensor voltage ranges match ESP32 (0-3.3V)
  - Use voltage dividers if sensors output 5V

**Problem**: Sensor readings are unstable
- **Solution**:
  - Add capacitors to sensor power lines (100µF)
  - Increase averaging samples in `sensors.h`
  - Check for loose connections
  - Ensure stable power supply

### Upload Issues

**Problem**: Upload fails or board not found
- **Solution**:
  - Install USB-to-Serial drivers (CH340, CP2102, etc.)
  - Try different USB cable (data cable, not charge-only)
  - Press BOOT button during upload
  - Lower upload speed to 115200
  - Try different USB port

**Problem**: "A fatal error occurred" during upload
- **Solution**:
  - Hold BOOT button, press RESET, release RESET, release BOOT
  - Try different upload speed
  - Check board selection matches your hardware
  - Update ESP32 board package

### Data Not Appearing in Dashboard

**Problem**: Data published but not visible
- **Solution**:
  - Verify MQTT topic matches: `water-quality/node1`
  - Check JSON format matches expected structure
  - Verify backend server is subscribed to correct topics
  - Check backend server logs for errors
  - Restart backend server

## Advanced Configuration

### Deep Sleep Mode (Battery Operation)

To enable power-saving deep sleep:

1. Add deep sleep code in `loop()`:
   ```cpp
   // After publishing
   esp_sleep_enable_timer_wakeup(PUBLISH_INTERVAL_MS * 1000);
   esp_deep_sleep_start();
   ```

2. Note: Deep sleep requires external wake-up source or timer

### OTA (Over-the-Air) Updates

For remote firmware updates:

1. Install ArduinoOTA library
2. Add OTA code in `setup()` and `loop()`
3. Configure OTA password and port
4. Upload initial firmware via USB
5. Future updates can be done wirelessly

### Multiple Nodes

To deploy multiple nodes:

1. Set unique `NODE_ID` for each node (1, 2, 3, etc.)
2. Use different `NODE_LOCATION` if nodes are in different places
3. Ensure all nodes can reach the same MQTT broker
4. Backend will automatically handle multiple nodes

## Network Setup

### Local Network (Recommended for Development)

1. ESP32 and server on same WiFi network
2. No internet required
3. Low latency
4. Secure (local only)

### Internet/Cloud Setup

For remote deployment:

1. Use cloud MQTT broker (HiveMQ Cloud, AWS IoT, etc.)
2. Update `MQTT_BROKER_IP` to cloud broker URL
3. May require authentication (update MQTT connection code)
4. Consider using TLS/SSL for security

## Next Steps

1. ✅ Flash ESP32 with provided code
2. ✅ Configure WiFi and MQTT broker IP
3. ✅ Connect sensors to specified pins
4. ✅ Start MQTT broker on server
5. ✅ Monitor serial output for connection status
6. ✅ Verify data in backend database
7. ✅ Check real-time updates in web dashboard

## Support

For issues or questions:
- Check Serial Monitor output for error messages
- Review backend server logs
- Verify MQTT broker is running and accessible
- Test network connectivity (ping broker IP)
- Review sensor datasheets for calibration

## References

- [ESP32 Arduino Core Documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/)
- [PubSubClient Library](https://github.com/knolleary/pubsubclient)
- [ArduinoJson Documentation](https://arduinojson.org/)
- [MQTT Protocol Specification](https://mqtt.org/)

