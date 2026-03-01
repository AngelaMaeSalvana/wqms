/**
 * Configuration file for ESP32 LoRa Water Quality Monitoring Node
 * 
 * IMPORTANT: Update these values before uploading to your ESP32!
 */

#ifndef CONFIG_H
#define CONFIG_H

// ============================================
// WiFi Configuration
// ============================================
#define WIFI_SSID "YOUR_WIFI_SSID"           // Your WiFi network name
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"    // Your WiFi password

// ============================================
// MQTT Broker Configuration
// ============================================
// Use the IP address from running: node server/get-ip.js
#define MQTT_BROKER_IP "192.168.1.100"       // Your MQTT broker IP address
#define MQTT_BROKER_PORT 1883                 // Standard MQTT port (TCP, not WebSocket)

// ============================================
// Node Configuration
// ============================================
#define NODE_ID "1"                           // Unique identifier for this node (1, 2, 3, etc.)
#define NODE_LOCATION "Villanueva"            // Location name for this node

// ============================================
// TDMA (Time Division Multiple Access)
// ============================================
// Each node gets an exclusive time slot so transmissions never collide.
// Slot boundaries are derived from NTP epoch ms — all nodes share the same clock.
//
// NODE_SLOT:      This node's slot index (0-based). Must be unique per node.
//                   N1 -> 0, N2 -> 1, N3 -> 2, ...
// TDMA_NUM_SLOTS: Total number of nodes sharing the channel. Must match on all nodes.
// TDMA_SLOT_MS:   Width of each slot in ms. Must match on all nodes.
//                   Cycle period = TDMA_NUM_SLOTS * TDMA_SLOT_MS
//                   e.g. 2 nodes * 6000ms = 12s cycle (each node sends ~every 12s)
// TDMA_TX_WINDOW_MS: How early in the slot TX is allowed. Must be > TX+ACK time (~2500ms).
//                    Remainder is the guard band.
// TDMA_FALLBACK_MS:  Interval used when NTP is not yet synced (node won't be silent).
#define NODE_SLOT          0                  // Change to 1 for N2, 2 for N3, etc.
#define TDMA_NUM_SLOTS     2                  // Total nodes on the channel
#define TDMA_SLOT_MS       6000               // Slot width in ms
#define TDMA_TX_WINDOW_MS  3500               // TX allowed within first 3500ms of slot
#define TDMA_FALLBACK_MS   12000              // Fallback interval when NTP unsynced

// ============================================
// Publishing Configuration (legacy WiFi-direct node only)
// ============================================
#define PUBLISH_INTERVAL_MS 5000              // How often to publish data (milliseconds)
#define MQTT_TOPIC_PREFIX "water-quality"     // MQTT topic prefix

// ============================================
// Sensor Pin Configuration
// ============================================
// Adjust these pin numbers based on your actual hardware connections
#define TEMP_SENSOR_PIN 34                    // ADC1_CH6 (GPIO34) - Temperature sensor
#define TURBIDITY_SENSOR_PIN 35               // ADC1_CH7 (GPIO35) - Turbidity sensor
#define PH_SENSOR_PIN 32                      // ADC1_CH4 (GPIO32) - pH sensor
#define NH3_SENSOR_PIN 33                     // ADC1_CH5 (GPIO33) - NH3 sensor
#define DO_SENSOR_PIN 36                      // ADC1_CH0 (GPIO36) - Dissolved Oxygen sensor

// ============================================
// Sensor Calibration Values
// ============================================
// Adjust these based on your sensor specifications and calibration

// Temperature sensor calibration (adjust based on your sensor)
#define TEMP_MIN_VOLTAGE 0.0                  // Minimum voltage output
#define TEMP_MAX_VOLTAGE 3.3                  // Maximum voltage output
#define TEMP_MIN_VALUE 0.0                    // Minimum temperature (°C)
#define TEMP_MAX_VALUE 50.0                   // Maximum temperature (°C)

// Turbidity sensor calibration (NTU)
#define TURBIDITY_MIN_VOLTAGE 0.0
#define TURBIDITY_MAX_VOLTAGE 3.3
#define TURBIDITY_MIN_VALUE 0.0               // Minimum turbidity (NTU)
#define TURBIDITY_MAX_VALUE 100.0              // Maximum turbidity (NTU)

// pH sensor calibration
#define PH_MIN_VOLTAGE 0.0
#define PH_MAX_VOLTAGE 3.3
#define PH_MIN_VALUE 0.0                      // Minimum pH
#define PH_MAX_VALUE 14.0                     // Maximum pH
#define PH_NEUTRAL_VOLTAGE 2.5                // Voltage at pH 7.0 (adjust based on calibration)

// NH3 sensor calibration (mg/L)
#define NH3_MIN_VOLTAGE 0.0
#define NH3_MAX_VOLTAGE 3.3
#define NH3_MIN_VALUE 0.0                     // Minimum NH3 (mg/L)
#define NH3_MAX_VALUE 5.0                     // Maximum NH3 (mg/L)

// Dissolved Oxygen sensor calibration (mg/L)
#define DO_MIN_VOLTAGE 0.0
#define DO_MAX_VOLTAGE 3.3
#define DO_MIN_VALUE 0.0                      // Minimum DO (mg/L)
#define DO_MAX_VALUE 20.0                     // Maximum DO (mg/L)

// ============================================
// ADC Configuration
// ============================================
#define ADC_RESOLUTION 12                     // ESP32 ADC resolution (12-bit = 0-4095)
#define ADC_MAX_VALUE 4095                    // Maximum ADC reading
#define ESP32_VOLTAGE_REF 3.3                 // ESP32 reference voltage

// ============================================
// WQI Calculation Parameters
// ============================================
// These thresholds are used in the WQI calculation
// Adjust based on your water quality standards
#define PH_OPTIMAL_MIN 6.5
#define PH_OPTIMAL_MAX 8.5
#define TURBIDITY_THRESHOLD 30.0               // NTU
#define NH3_THRESHOLD 0.5                     // mg/L
#define DO_THRESHOLD 6.0                      // mg/L
#define TEMP_THRESHOLD 30.0                   // °C

// ============================================
// Error Handling
// ============================================
#define SENSOR_READ_RETRIES 3                 // Number of retries for sensor reading
#define SENSOR_ERROR_VALUE -999.0             // Value returned on sensor error
#define MIN_VALID_TEMP -10.0                  // Minimum valid temperature
#define MAX_VALID_TEMP 60.0                   // Maximum valid temperature
#define MIN_VALID_PH 0.0                      // Minimum valid pH
#define MAX_VALID_PH 14.0                     // Maximum valid pH

// ============================================
// Serial Debug Configuration
// ============================================
#define SERIAL_BAUD_RATE 115200               // Serial monitor baud rate
#define DEBUG_MODE true                       // Set to false to disable debug messages

#endif // CONFIG_H

