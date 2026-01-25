/**
 * ESP32 LoRa Water Quality Monitoring Node
 * 
 * This sketch reads water quality sensors and publishes data to an MQTT broker
 * for the Water Quality Monitoring System (WQMS).
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
#include "config.h"
#include "sensors.h"

// ============================================
// Global Variables
// ============================================

WiFiClient espClient;
PubSubClient mqttClient(espClient);

unsigned long lastPublishTime = 0;
unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL = 5000; // 5 seconds

// MQTT topic strings
String mqttTopic;
String mqttTopicSensor;
String mqttTopicAlert;

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
 * Publish sensor data to MQTT broker
 */
void publishSensorData() {
  if (!mqttClient.connected()) {
    Serial.println("⚠️ MQTT not connected. Cannot publish data.");
    return;
  }
  
  // Read all sensors
  SensorReadings readings = readAllSensors();
  
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
  
  // Add node information
  doc["nodeId"] = NODE_ID;
  doc["location"] = NODE_LOCATION;
  
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
  Serial.print("⏱️  Publish Interval: ");
  Serial.print(PUBLISH_INTERVAL_MS / 1000);
  Serial.println(" seconds");
  Serial.println();
  
  // Setup WiFi
  setupWiFi();
  
  // Setup MQTT
  setupMQTT();
  
  // Initialize ADC (ESP32 uses 12-bit ADC by default)
  // Note: Some pins may need different attenuation settings
  analogSetAttenuation(ADC_11db); // 0-3.3V range
  
  Serial.println();
  Serial.println("🚀 Setup complete. Starting main loop...");
  Serial.println();
}

void loop() {
  // Check WiFi connection
  checkWiFi();
  
  // Check MQTT connection
  checkMQTT();
  
  // Publish data at regular intervals
  unsigned long currentTime = millis();
  if (currentTime - lastPublishTime >= PUBLISH_INTERVAL_MS) {
    lastPublishTime = currentTime;
    
    if (mqttClient.connected()) {
      publishSensorData();
    } else {
      Serial.println("⚠️ MQTT not connected. Skipping publish.");
    }
    
    Serial.println(); // Blank line for readability
  }
  
  // Small delay to prevent watchdog issues
  delay(100);
}

