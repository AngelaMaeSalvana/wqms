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
#define WIFI_SSID "Chikoy2.4_LongAsHenk"      // Your WiFi network name
#define WIFI_PASSWORD "FmAZvn3f"              // Your WiFi password

// ============================================
// MQTT Broker Configuration
// ============================================
// Use the IP address from running: node server/get-ip.js
#define MQTT_BROKER_IP "192.168.1.100"       // Your MQTT broker IP address
#define MQTT_BROKER_PORT 1883                 // Standard MQTT port (TCP, not WebSocket)

// ============================================
// Node Configuration
// ============================================
#define NODE_ID "2"                           // Unique identifier for this node (1, 2, 3, etc.)
#define NODE_LOCATION "Villanueva"            // Location name for this node

// ============================================
// TDMA (Time Division Multiple Access)
// ============================================
// Each node gets an exclusive time slot so transmissions never collide.
// Slot boundaries are derived from NTP epoch ms — all nodes share the same clock.
//
// NODE_SLOT:      This node's slot (0-based). Only this line changes per node.
//                   N1=0, N2=1, N3=2, N4=3, N5=4, N6=5, N7=6, N8=7
// TDMA_NUM_SLOTS: Fixed at 8. Unused slots are idle. NEVER change this —
//                   existing nodes do not need reflashing when adding new nodes.
// TDMA_SLOT_MS:   Slot width in ms. Cycle = 8 * 6000ms = 48s per node.
// TDMA_TX_WINDOW_MS: TX allowed in first 3500ms of slot. Must be > TX+ACK (~2500ms).
//                    Remaining 2500ms is the guard band.
// TDMA_FALLBACK_MS:  Sending interval when NTP is not yet synced (= 1 full cycle).
#define NODE_SLOT          1                  // N2 (N1=0, N2=1, …)
#define TDMA_NUM_SLOTS     8                  // Fixed max capacity (never change)
#define TDMA_SLOT_MS       6000               // Slot width in ms (cycle = 48s)
#define TDMA_TX_WINDOW_MS  3500               // TX allowed within first 3500ms of slot
#define TDMA_FALLBACK_MS   48000              // Fallback interval when NTP unsynced

// ============================================
// Publishing Configuration (esp32_wqms_node.ino — MQTT WiFi node)
// ============================================
// Two-minute cycle: stabilize, then 1 Hz samples (rolling last 60), median, publish.
#define CYCLE_MS                 120000UL    // Full period between publishes (2 minutes)
#define STABILIZATION_MS         45000UL     // 30–60 s typical; sensor settle time before sampling
#define WAKE_EARLY_MS            0UL         // Optional extra wait at boot before first cycle (e.g. 120000)
#define MEDIAN_WINDOW            60          // Keep at most this many 1 Hz samples for median
#define SAMPLE_INTERVAL_MS       1000        // One reading per second during acquisition phase
#define MQTT_TOPIC_PREFIX "water-quality"     // MQTT topic prefix

// ============================================
// Sensor Pin Configuration
// ============================================
// DS18B20: DATA on GPIO with 4.7k pull-up to 3V3 (OneWire)
// Turbidity: analog on GPIO5 (Heltec); NTU = linear fit on raw 12-bit ADC counts
// pH / turbidity pins below match your wiring (GPIO1 pH, GPIO5 turbidity).
#define DS18B20_PIN 4                         // DS18B20 DATA
#define TURBIDITY_SENSOR_PIN 5                // Turbidity ADC (your wiring)
#define PH_SENSOR_PIN 1                       // pH analog (your wiring)
#define NH3_SENSOR_PIN 33                     // ADC1_CH5 (GPIO33) - NH3 sensor
#define DO_SENSOR_PIN 36                      // ADC1_CH0 (GPIO36) - Dissolved Oxygen sensor

// ============================================
// Sensor Calibration Values
// ============================================
// Adjust these based on your sensor specifications and calibration

// Turbidity (NTU): linear map from 12-bit raw ADC counts — result *is* NTU, not “uncalibrated raw”.
// With negative slope + large intercept, *low* raw counts yield *high* NTU; typical clear water often
// sits in a mid/high raw band for your wiring. If NTU looks huge, check raw in Serial (print turRaw)
// and recalibrate K/B for your divider / sensor, or adjust TURBIDITY_RAW_MIN_VALID if needed.
// Lab sketch (Heltec): raw < 1500 → sensor fault/disconnected; else NTU = -0.3881*raw + 822.39 (clamp ≥ 0).
#define TURBIDITY_RAW_MIN_VALID      1500      // Minimum valid 12-bit ADC counts (below = fault / disconnected)
#define TURBIDITY_NTU_K              (-0.3881f)
#define TURBIDITY_NTU_B              (822.39f)
#define TURBIDITY_ADC_SAMPLES        30       // Averaging (20–50 typical)
#define TURBIDITY_SAMPLE_DELAY_MS    5        // Delay between ADC samples
#define TURBIDITY_MAX_VALID_NTU      4000.0f // Upper sanity clamp

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
// Battery Monitoring (single Li-ion cell)
// ============================================
// GPIO pin for battery voltage divider (ADC1). Use -1 to disable.
// Typical: 100k+100k divider -> 4.2V becomes 2.1V at ADC; set DIVIDER to 2.0
#define BATTERY_PIN 39                       // ADC1_CH3 (GPIO39) - Heltec LoRa32 V3 VBAT
#define BATTERY_VOLTAGE_DIVIDER 2.0          // V_battery = adc_voltage * DIVIDER
#define BATTERY_VOLTAGE_FULL 4.2f            // 100% (single Li-ion)
#define BATTERY_VOLTAGE_EMPTY 3.3f           // 0%

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

