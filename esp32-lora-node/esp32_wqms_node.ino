/**
 * ESP32 LoRa Water Quality Monitoring Node
 * 
 * This sketch reads water quality sensors and publishes to an MQTT broker (WQMS).
 * Each cycle: stabilize → 1 Hz samples for the remainder of 2 minutes (rolling
 * window of 60) → per-channel median → publish → sleep to complete the 2-minute period.
 * 
 * Hardware Requirements:
 * - ESP32 LoRa module (e.g., Heltec ESP32 LoRa)
 * - Water quality sensors (Temperature, Turbidity, pH, NH3, DO)
 * 
 * Software Requirements:
 * - Arduino IDE with ESP32 board support
 * - Libraries: WiFi, PubSubClient, ArduinoJson
 * 
 * Setup:
 * 1. Install ESP32 board support in Arduino IDE
 * 2. Install required libraries via Library Manager
 * 3. Update config.h with your WiFi and MQTT broker settings
 * 4. Upload this sketch to your ESP32
 * 
 * Author: WQMS Project
 * Version: 1.0
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <stdlib.h>
#include "config.h"
#include "sensors.h"

void checkWiFi();
void checkMQTT();

// ============================================
// Global Variables
// ============================================

WiFiClient espClient;
PubSubClient mqttClient(espClient);

unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL = 5000; // 5 seconds
unsigned long seqCounter = 0; // Monotonically increasing sequence number

// MQTT topic strings
String mqttTopic;
String mqttTopicSensor;
String mqttTopicAlert;

// Two-minute median cycle: rolling buffer of last MEDIAN_WINDOW readings
static SensorReadings s_sampleRing[MEDIAN_WINDOW];
static uint8_t s_ringHead = 0;
static uint8_t s_ringCount = 0;
static float s_sortScratch[MEDIAN_WINDOW];

static int compareFloat(const void* a, const void* b) {
  float fa = *(const float*)a;
  float fb = *(const float*)b;
  if (fa < fb) return -1;
  if (fa > fb) return 1;
  return 0;
}

static float medianOfBuffer(float* buf, uint8_t n) {
  if (n == 0) return SENSOR_ERROR_VALUE;
  qsort(buf, n, sizeof(float), compareFloat);
  if (n % 2 == 1) return buf[n / 2];
  return (buf[n / 2 - 1] + buf[n / 2]) / 2.0f;
}

static float medianChannel(float (SensorReadings::* member)) {
  uint8_t n = 0;
  for (uint8_t i = 0; i < s_ringCount; i++) {
    uint8_t idx = (uint8_t)((s_ringHead + MEDIAN_WINDOW - s_ringCount + i) % MEDIAN_WINDOW);
    float v = s_sampleRing[idx].*member;
    if (v != SENSOR_ERROR_VALUE && !isnan(v) && !isinf(v)) {
      s_sortScratch[n++] = v;
    }
  }
  return medianOfBuffer(s_sortScratch, n);
}

/** Per-channel median of ring; invalid samples excluded per channel. */
static SensorReadings medianFromRing() {
  SensorReadings out;
  out.temperature = medianChannel(&SensorReadings::temperature);
  out.turbidity = medianChannel(&SensorReadings::turbidity);
  out.pH = medianChannel(&SensorReadings::pH);
  out.nh3 = medianChannel(&SensorReadings::nh3);
  out.dissolvedOxygen = medianChannel(&SensorReadings::dissolvedOxygen);
  out.hasErrors = (out.temperature == SENSOR_ERROR_VALUE || out.turbidity == SENSOR_ERROR_VALUE ||
                   out.pH == SENSOR_ERROR_VALUE || out.nh3 == SENSOR_ERROR_VALUE ||
                   out.dissolvedOxygen == SENSOR_ERROR_VALUE);
  return out;
}

static void ringPush(const SensorReadings& r) {
  s_sampleRing[s_ringHead] = r;
  s_ringHead = (uint8_t)((s_ringHead + 1) % MEDIAN_WINDOW);
  if (s_ringCount < MEDIAN_WINDOW) s_ringCount++;
}

static void ringReset() {
  s_ringHead = 0;
  s_ringCount = 0;
}

/** Yields to WiFi/MQTT while delaying (call often during long waits). */
static void delayWithMqtt(unsigned long ms) {
  unsigned long start = millis();
  while (millis() - start < ms) {
    checkWiFi();
    checkMQTT();
    delay(10);
  }
}

// ============================================
// WiFi Functions
// ============================================

/**
 * Connect to WiFi network
 */
void setupWiFi() {
  Serial.println();
  Serial.print("📡 Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("✅ WiFi connected!");
    Serial.print("📶 IP address: ");
    Serial.println(WiFi.localIP());
    Serial.print("📶 Signal strength (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println();
    Serial.println("❌ WiFi connection failed!");
    Serial.println("💡 Check your WiFi credentials in config.h");
  }
}

/**
 * Check WiFi connection and reconnect if needed
 */
void checkWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi disconnected. Reconnecting...");
    setupWiFi();
  }
}

// ============================================
// MQTT Functions
// ============================================

/**
 * MQTT callback function (for receiving messages)
 */
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("📨 Message received on topic: ");
  Serial.println(topic);
  
  // Handle incoming messages if needed
  // For now, we only publish data, so this is optional
}

/**
 * Reconnect to MQTT broker
 */
bool reconnectMQTT() {
  // Check WiFi first
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi not connected. Cannot connect to MQTT.");
    return false;
  }
  
  Serial.print("🔌 Attempting MQTT connection to ");
  Serial.print(MQTT_BROKER_IP);
  Serial.print(":");
  Serial.print(MQTT_BROKER_PORT);
  Serial.println("...");
  
  // Create unique client ID
  String clientId = "ESP32-Node" + String(NODE_ID) + "-";
  clientId += String(random(0xffff), HEX);
  
  // Attempt to connect
  if (mqttClient.connect(clientId.c_str())) {
    Serial.println("✅ MQTT connected!");
    Serial.print("🆔 Client ID: ");
    Serial.println(clientId);
    
    // Subscribe to topics if needed (optional)
    // mqttClient.subscribe("commands/node1");
    
    return true;
  } else {
    Serial.print("❌ MQTT connection failed, rc=");
    Serial.print(mqttClient.state());
    Serial.println(" (will retry in 5 seconds)");
    return false;
  }
}

/**
 * Setup MQTT client
 */
void setupMQTT() {
  mqttClient.setServer(MQTT_BROKER_IP, MQTT_BROKER_PORT);
  mqttClient.setCallback(mqttCallback);
  
  // Build topic strings
  mqttTopic = String(MQTT_TOPIC_PREFIX) + "/node" + String(NODE_ID);
  mqttTopicSensor = "sensor-data/node" + String(NODE_ID);
  mqttTopicAlert = "alerts/node" + String(NODE_ID);
  
  Serial.print("📡 MQTT topics configured:");
  Serial.print("\n   - ");
  Serial.println(mqttTopic);
  Serial.print("   - ");
  Serial.println(mqttTopicSensor);
}

/**
 * Check MQTT connection and reconnect if needed
 */
void checkMQTT() {
  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastReconnectAttempt >= RECONNECT_INTERVAL) {
      lastReconnectAttempt = now;
      reconnectMQTT();
    }
  } else {
    // Process MQTT messages
    mqttClient.loop();
  }
}

// ============================================
// WQI Calculation
// ============================================

/**
 * Calculate Water Quality Index (WQI)
 * Based on sensor readings and thresholds
 * 
 * @param temp Temperature in °C
 * @param turb Turbidity in NTU
 * @param ph pH value
 * @param nh3 NH3 in mg/L
 * @param do_val Dissolved Oxygen in mg/L
 * @return WQI value (0-300+)
 */
int calculateWQI(float temp, float turb, float ph, float nh3, float do_val) {
  // Start with perfect score
  float score = 100.0;
  
  // Deduct points for poor values
  // pH check (optimal range: 6.5-8.5)
  if (ph < PH_OPTIMAL_MIN || ph > PH_OPTIMAL_MAX) {
    float deviation = ph < PH_OPTIMAL_MIN ? 
      (PH_OPTIMAL_MIN - ph) : (ph - PH_OPTIMAL_MAX);
    score -= min(20.0, deviation * 5.0); // Max 20 point deduction
  }
  
  // Turbidity check (threshold: 30 NTU)
  if (turb > TURBIDITY_THRESHOLD) {
    float excess = turb - TURBIDITY_THRESHOLD;
    score -= min(15.0, excess * 0.5); // Max 15 point deduction
  }
  
  // NH3 check (threshold: 0.5 mg/L)
  if (nh3 > NH3_THRESHOLD) {
    float excess = nh3 - NH3_THRESHOLD;
    score -= min(10.0, excess * 10.0); // Max 10 point deduction
  }
  
  // Dissolved Oxygen check (threshold: 6 mg/L)
  if (do_val < DO_THRESHOLD) {
    float deficit = DO_THRESHOLD - do_val;
    score -= min(15.0, deficit * 2.5); // Max 15 point deduction
  }
  
  // Temperature check (threshold: 30°C)
  if (temp > TEMP_THRESHOLD) {
    float excess = temp - TEMP_THRESHOLD;
    score -= min(10.0, excess * 0.5); // Max 10 point deduction
  }
  
  // Ensure score doesn't go below 0
  score = max(0.0, score);
  
  // Convert to WQI scale (0-300+)
  // Lower score = better quality
  int wqi = (int)(100 - score) * 3; // Scale to 0-300 range
  
  return wqi;
}

// ============================================
// Data Publishing
// ============================================

/**
 * Publish sensor data to MQTT broker (median or single capture).
 */
void publishSensorData(const SensorReadings& readings) {
  if (!mqttClient.connected()) {
    Serial.println("⚠️ MQTT not connected. Cannot publish data.");
    return;
  }
  
  // Check if we have valid readings
  if (readings.hasErrors && 
      readings.temperature == SENSOR_ERROR_VALUE &&
      readings.turbidity == SENSOR_ERROR_VALUE &&
      readings.pH == SENSOR_ERROR_VALUE &&
      readings.nh3 == SENSOR_ERROR_VALUE &&
      readings.dissolvedOxygen == SENSOR_ERROR_VALUE) {
    Serial.println("❌ All sensors failed. Skipping publish.");
    return;
  }
  
  // Calculate WQI (use default values for failed sensors)
  float temp = readings.temperature != SENSOR_ERROR_VALUE ? readings.temperature : 25.0;
  float turb = readings.turbidity != SENSOR_ERROR_VALUE ? readings.turbidity : 15.0;
  float ph = readings.pH != SENSOR_ERROR_VALUE ? readings.pH : 7.0;
  float nh3 = readings.nh3 != SENSOR_ERROR_VALUE ? readings.nh3 : 0.5;
  float do_val = readings.dissolvedOxygen != SENSOR_ERROR_VALUE ? readings.dissolvedOxygen : 8.0;
  
  int wqi = calculateWQI(temp, turb, ph, nh3, do_val);
  
  // Create JSON document
  StaticJsonDocument<512> doc;
  
  // Add node information (location is in dashboard nodes table, keyed by node_id)
  doc["nodeId"] = NODE_ID;
  doc["seq"] = ++seqCounter;
  doc["tx_millis"] = millis();
  
  // Add sensor readings (only if valid)
  if (readings.temperature != SENSOR_ERROR_VALUE) {
    doc["temperature"] = roundf(readings.temperature * 10) / 10.0; // Round to 1 decimal
  }
  if (readings.turbidity != SENSOR_ERROR_VALUE) {
    doc["turbidity"] = roundf(readings.turbidity * 10) / 10.0;
  }
  if (readings.pH != SENSOR_ERROR_VALUE) {
    doc["pH"] = roundf(readings.pH * 10) / 10.0;
  }
  if (readings.nh3 != SENSOR_ERROR_VALUE) {
    doc["nh3"] = roundf(readings.nh3 * 10) / 10.0;
  }
  if (readings.dissolvedOxygen != SENSOR_ERROR_VALUE) {
    doc["dissolvedOxygen"] = roundf(readings.dissolvedOxygen * 10) / 10.0;
  }
  
  // Add WQI
  doc["wqi"] = wqi;
  
  // Add timestamp
  doc["timestamp"] = WiFi.getTime() > 0 ? 
    WiFi.getTime() : millis() / 1000; // Use network time if available, else uptime
  
  // Serialize JSON
  char jsonBuffer[512];
  serializeJson(doc, jsonBuffer);
  
  // Publish to primary topic
  bool published = mqttClient.publish(mqttTopic.c_str(), jsonBuffer, true); // retain = true
  
  if (published) {
    Serial.println("✅ Data published successfully");
    Serial.print("📤 Topic: ");
    Serial.println(mqttTopic);
    Serial.print("📦 Payload: ");
    Serial.println(jsonBuffer);
    Serial.print("📊 WQI: ");
    Serial.println(wqi);
  } else {
    Serial.println("❌ Failed to publish data");
  }
  
  // Also publish to sensor-data topic (with nested structure)
  StaticJsonDocument<512> sensorDoc;
  sensorDoc["sensorReading"] = doc;
  sensorDoc["timestamp"] = doc["timestamp"];
  
  char sensorBuffer[512];
  serializeJson(sensorDoc, sensorBuffer);
  mqttClient.publish(mqttTopicSensor.c_str(), sensorBuffer, false);
  
  // Publish alert if sensors have errors
  if (readings.hasErrors) {
    StaticJsonDocument<256> alertDoc;
    alertDoc["alert"]["title"] = "Sensor Error Detected";
    alertDoc["alert"]["detail"] = "One or more sensors returned invalid readings";
    alertDoc["alert"]["severity"] = "warning";
    alertDoc["alert"]["nodeId"] = NODE_ID;
    alertDoc["alert"]["timestamp"] = doc["timestamp"];
    
    char alertBuffer[256];
    serializeJson(alertDoc, alertBuffer);
    mqttClient.publish(mqttTopicAlert.c_str(), alertBuffer, false);
  }
}

#if STABILIZATION_MS >= CYCLE_MS
#error STABILIZATION_MS must be less than CYCLE_MS
#endif

/**
 * One full period: stabilize → 1 Hz samples (rolling last MEDIAN_WINDOW) → median → MQTT → pad to CYCLE_MS.
 */
static void runTwoMinuteCycle() {
  unsigned long t0 = millis();
  uint32_t sampleSeconds = (uint32_t)((CYCLE_MS - STABILIZATION_MS) / SAMPLE_INTERVAL_MS);

  Serial.println("⏳ Stabilization (sensor settle)...");
  delayWithMqtt(STABILIZATION_MS);

  ringReset();
  Serial.print("📊 Acquiring ");
  Serial.print(sampleSeconds);
  Serial.println(" s @ 1 Hz (median of last ≤60 valid samples per channel)...");

  for (uint32_t i = 0; i < sampleSeconds; i++) {
    ringPush(readAllSensors());
    delayWithMqtt(SAMPLE_INTERVAL_MS);
  }

  SensorReadings median = medianFromRing();

  if (mqttClient.connected()) {
    publishSensorData(median);
  } else {
    Serial.println("⚠️ MQTT not connected. Skipping publish.");
  }

  unsigned long elapsed = millis() - t0;
  if (elapsed < CYCLE_MS) {
    delayWithMqtt(CYCLE_MS - elapsed);
  }
}

// ============================================
// Setup and Loop
// ============================================

void setup() {
  // Initialize serial communication
  Serial.begin(SERIAL_BAUD_RATE);
  delay(1000);
  
  Serial.println("\n");
  Serial.println("╔════════════════════════════════════════╗");
  Serial.println("║  ESP32 LoRa Water Quality Monitor Node ║");
  Serial.println("╚════════════════════════════════════════╝");
  Serial.println();
  Serial.print("📋 Node ID: ");
  Serial.println(NODE_ID);
  Serial.print("📍 Location: ");
  Serial.println(NODE_LOCATION);
  Serial.print("⏱️  Cycle: ");
  Serial.print(CYCLE_MS / 1000);
  Serial.print(" s | Stabilization: ");
  Serial.print(STABILIZATION_MS / 1000);
  Serial.println(" s");
  Serial.println();
  
  // Setup WiFi
  setupWiFi();
  
  // Setup MQTT
  setupMQTT();
  
  // Initialize ADC (ESP32 uses 12-bit ADC by default)
  analogSetAttenuation(ADC_11db); // default 0–3.3 V range
  initSensors();                  // DS18B20 + turbidity ADC pin attenuation

  Serial.println();
  Serial.println("🚀 Setup complete. Starting main loop...");
  Serial.println();
}

void loop() {
  static bool first = true;
  if (first) {
    first = false;
    if (WAKE_EARLY_MS > 0) {
      Serial.println("⏳ Wake early before first cycle...");
      delayWithMqtt(WAKE_EARLY_MS);
    }
  }

  checkWiFi();
  checkMQTT();
  runTwoMinuteCycle();
  Serial.println();
}

