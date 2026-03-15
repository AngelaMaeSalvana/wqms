/*
 * WQMS Sensor Node (Sender)
 * Heltec LoRa32 V3 - DS18B20 temperature; SEN0189 turbidity (10k:10k -> GPIO34); others null until hardware added
 * Sends: dissolvedOxygen, turbidity, pH, flowRate, temperature
 * Field names match wqms dashboard - JSON structure constant; null when sensor disconnected
 * Listens for remote diagnostics commands (overrides send interval)
 *
 * Latency instrumentation:
 *   node_id  - fixed identifier for this node
 *   seq_id   - monotonically increasing per-packet counter
 *   t_node   - NTP epoch timestamp (ms) captured at the moment the reading is generated
 *
 * TDMA (Time Division Multiple Access):
 *   Each node is assigned a fixed slot number (NODE_SLOT 0, 1, 2...).
 *   The shared radio channel is divided into repeating cycles of TDMA_NUM_SLOTS slots,
 *   each TDMA_SLOT_MS wide. A node only transmits during the first TDMA_TX_WINDOW_MS
 *   of its assigned slot; the remainder is a guard band.
 *   Slot boundaries are derived from NTP epoch ms so all nodes share the same clock.
 *   NTP must be synced before TDMA is active; falls back to interval-based sending if unsynced.
 *
 * Test Evaluation Mode:
 *   Activated by CMD:test:start:<interval_ms>:<duration_ms>:<test_run_id>
 *   Overrides TDMA for the specified duration; attaches test_run_id to telemetry.
 *   Reverts automatically when duration expires or CMD:test:stop:<test_run_id> is received.
 *
 * Adaptive Sampling:
 *   User-Selected Mode: acquisition at user-defined interval (default 15 min).
 *   Auto-Adapt Mode: flow-rate thresholds (≤0.10→15m, 0.10-0.40→10m, 0.40-0.80→5m, >0.80→1m).
 *   Stability: 3 consecutive flow checks in new threshold before changing interval.
 *   Acquisition runs on its own timer; TDMA transmission uses latest buffered reading.
 */
#include "Arduino.h"
#include "LoRaWan_APP.h"
#include <Wire.h>
#include <math.h>
#include "HT_SSD1306Wire.h"
#include <WiFi.h>
#include <time.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#define DS18B20_PIN 4   // Yellow wire to GPIO4

// -------------------- Battery (single Li-ion: 4.2V=100%, 3.3V=0%) --------------------
#define BATTERY_PIN 39                       // ADC1 - voltage divider; use -1 to disable
#define BATTERY_VOLTAGE_DIVIDER 2.0f          // V_battery = adc_voltage * DIVIDER
#define ADC_MAX_VALUE 4095
#define ESP32_VOLTAGE_REF 3.3f

// -------------------- Stringify helper (for OLED slot display) --------------------
#define STRINGIFY_INNER(x) #x
#define STRINGIFY(x)       STRINGIFY_INNER(x)

// -------------------- WiFi (for NTP time sync) --------------------
#define WIFI_SSID     "GlobeAtHome_ea960_2.4"
#define WIFI_PASSWORD "yXf3bjYZ"

// -------------------- NTP --------------------
#define NTP_SERVER_1      "pool.ntp.org"
#define NTP_SERVER_2      "time.nist.gov"
#define NTP_TIMEZONE_SECS (8 * 3600)   // UTC+8 (Philippines); epoch math uses UTC regardless
#define NTP_RESYNC_MS     (3600000UL)  // Re-sync every 1 hour

// -------------------- LoRa Settings (MUST MATCH RECEIVER) --------------------
#define RF_FREQUENCY               915000000  // Hz (Philippines)
#define TX_OUTPUT_POWER            5          // dBm

#define LORA_BANDWIDTH             0          // 0:125kHz
#define LORA_SPREADING_FACTOR      7
#define LORA_CODINGRATE            1
#define LORA_PREAMBLE_LENGTH       8
#define LORA_SYMBOL_TIMEOUT        0
#define LORA_FIX_LENGTH_PAYLOAD_ON false
#define LORA_IQ_INVERSION_ON       false
#define LORA_CRC_ON                true

// -------------------- TDMA --------------------
// Slot assignment — only NODE_SLOT needs to change per node:
//   N1 -> NODE_SLOT 0
//   N2 -> NODE_SLOT 1
//   N3 -> NODE_SLOT 2
//   N4 -> NODE_SLOT 3  ... up to NODE_SLOT 7
//
// TDMA_NUM_SLOTS is fixed at 8 (max nodes). Unused slots are simply idle.
// Cycle period = TDMA_NUM_SLOTS * TDMA_SLOT_MS = 8 * 6s = 48s
// Slot boundaries: slot_index = (epochMs / TDMA_SLOT_MS) % TDMA_NUM_SLOTS
// TDMA_TX_WINDOW_MS: TX only in first 3500ms of slot (guard band after).
#define NODE_SLOT          0           // THIS node's slot (0-based). N1=0, N2=1, N3=2 ...
#define TDMA_NUM_SLOTS     8           // Fixed capacity — supports up to 8 nodes, never change
#define TDMA_SLOT_MS       6000UL      // Slot width in ms  (cycle = 8 * 6s = 48s)
#define TDMA_TX_WINDOW_MS  3500UL      // TX allowed in first 3500ms of slot (2500ms guard band)
#define TDMA_FALLBACK_MS   48000UL     // Fallback interval when NTP unsynced (= 1 full cycle)

// -------------------- Sample / test data (node sends generated values; set to 0 when sensors are ready) --------------------
#define USE_SAMPLE_SENSOR_DATA  1

// -------------------- Timing --------------------
#define CMD_LISTEN_INTERVAL_MS  1000  // Listen for commands every 1 sec
#define CMD_LISTEN_WINDOW_MS     600  // RX window for commands (ms)

// -------------------- Adaptive Data Acquisition --------------------
// User-Selected Mode: fixed interval (default 15 min).
// Auto-Adapt Mode: flow-rate thresholds -> acquisition interval; 3 consecutive readings before change.
#define ACQ_MODE_USER  0
#define ACQ_MODE_AUTO  1
#define ACQ_MODE_DEFAULT  ACQ_MODE_AUTO   // ACQ_MODE_USER or ACQ_MODE_AUTO

#define USER_ACQ_INTERVAL_MS  (15UL * 60 * 1000)  // 15 min when User-Selected, no user value

// Flow velocity thresholds (m/s). Flow sensor not yet available -> use hard-coded value for testing.
// ≤0.10 -> 15 min | 0.10-0.40 -> 10 min | 0.40-0.80 -> 5 min | >0.80 -> 1 min
#define FLOW_THRESH_15MIN  0.10f
#define FLOW_THRESH_10MIN  0.40f
#define FLOW_THRESH_5MIN   0.80f
#define HARDCODED_FLOW_MPS  0.25f        // For testing (0.25 m/s -> 10 min interval)
#define STABILITY_CONSECUTIVE  3

#define ACQ_INTERVAL_1MIN_MS   (1UL * 60 * 1000)
#define ACQ_INTERVAL_5MIN_MS   (5UL * 60 * 1000)
#define ACQ_INTERVAL_10MIN_MS  (10UL * 60 * 1000)
#define ACQ_INTERVAL_15MIN_MS  (15UL * 60 * 1000)

// -------------------- DS18B20 Temperature Sensor --------------------
OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);

static bool dsConversionInProgress = false;
static unsigned long dsRequestTime  = 0;
static float dsLatestTempC          = NAN;

static void initTempSensor() {
  pinMode(DS18B20_PIN, INPUT_PULLUP);
  ds18b20.begin();
  ds18b20.setWaitForConversion(false);  // Non-blocking mode
}

// Call every loop(); returns latest valid temperature or NAN if offline/invalid.
static float updateTempSensor() {
  unsigned long now = millis();

  if (!dsConversionInProgress) {
    ds18b20.requestTemperatures();
    dsRequestTime         = now;
    dsConversionInProgress = true;
  }

  if (dsConversionInProgress && (now - dsRequestTime >= 800)) {
    float t = ds18b20.getTempCByIndex(0);
    if (t > -100.0f && t < 150.0f) {
      dsLatestTempC = t;
    }
    dsConversionInProgress = false;
  }

  return dsLatestTempC;
}

// Read battery voltage from divider. Returns NAN if BATTERY_PIN < 0.
static float readBatteryVoltage() {
#if BATTERY_PIN >= 0
  long sum = 0;
  for (int i = 0; i < 10; i++) {
    sum += analogRead(BATTERY_PIN);
    delay(10);
  }
  float adcV = (sum / 10.0f) * ESP32_VOLTAGE_REF / ADC_MAX_VALUE;
  return adcV * BATTERY_VOLTAGE_DIVIDER;
#else
  return NAN;
#endif
}

// Convert Li-ion voltage to percentage (4.2V=100%, 3.3V=0%). Returns -1 if invalid.
static int voltageToPercentage(float voltage) {
  if (isnan(voltage) || voltage >= 4.2f) return (isnan(voltage) ? -1 : 100);
  if (voltage <= 3.3f) return 0;
  int pct = (int)(((voltage - 3.3f) / 0.9f) * 100.0f);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

// -------------------- Turbidity (SEN0189 style, 10k:10k divider -> GPIO34) --------------------
//   Module A0 -> 10k -> (MIDPOINT) -> 10k -> GND; MIDPOINT -> GPIO34
#define TURB_ADC_PIN 34
static const float TURB_ADC_VREF       = 3.3f;
static const float TURB_ADC_MAX_COUNTS = 4095.0f;
static const float TURB_DIVIDER_GAIN   = 2.0f;  // 10k:10k
static const int   TURB_SAMPLES        = 30;
static const int   TURB_SAMPLE_DELAYMS = 5;
static float s_turbV_smooth = 0.0f;

static float readTurbidityRawAvg() {
  uint32_t sum = 0;
  for (int i = 0; i < TURB_SAMPLES; i++) {
    sum += analogRead(TURB_ADC_PIN);
    delay(TURB_SAMPLE_DELAYMS);
  }
  return (float)sum / (float)TURB_SAMPLES;
}

static float turbidityAdcToVoltage(float rawAvg) {
  return rawAvg * (TURB_ADC_VREF / TURB_ADC_MAX_COUNTS);
}

static float turbidityDividerToSensorVoltage(float v_mid) {
  return v_mid * TURB_DIVIDER_GAIN;
}

static float turbiditySmoothVoltage(float v_sensor) {
  if (s_turbV_smooth < 0.1f) s_turbV_smooth = v_sensor;
  s_turbV_smooth = 0.85f * s_turbV_smooth + 0.15f * v_sensor;
  return s_turbV_smooth;
}

// Voltage -> NTU; >2.5V treated as clear water (0 NTU)
static float turbidityVoltageToNTU(float v_sensor) {
  if (v_sensor > 2.5f) return 0.0f;
  float ntu = -1120.4f * v_sensor * v_sensor + 5742.3f * v_sensor - 4352.9f;
  if (ntu < 0.0f) ntu = 0.0f;
  return ntu;
}

static void initTurbiditySensor() {
  analogSetPinAttenuation(TURB_ADC_PIN, ADC_11db);
}

static float readTurbidityNTU() {
  float rawAvg   = readTurbidityRawAvg();
  float v_mid    = turbidityAdcToVoltage(rawAvg);
  float v_sensor = turbidityDividerToSensorVoltage(v_mid);
  float v_filt   = turbiditySmoothVoltage(v_sensor);
  return turbidityVoltageToNTU(v_filt);
}

// -------------------- Buffers --------------------
#define RX_BUF_SIZE 128  // For ACK (may include CMD:test:start...) and CMD:diag:<node_id>
#define TX_BUF_SIZE 300

static char rxBuf[RX_BUF_SIZE];
static char txBuf[TX_BUF_SIZE];

static int16_t lastRssi = 0;
static int8_t  lastSnr  = 0;
static uint16_t rxSize  = 0;

// -------------------- Sensor connectivity --------------------
// true = use real reading if valid; false = always null. NaN/invalid readings -> null in JSON (sensor offline).
// Only temperature has real hardware (DS18B20); others emit null until sensors are added.
static const bool SENSOR_CONNECTED[] = {
  true,   // temperature (DS18B20)
  true,   // turbidity  (SEN0189, 10k:10k divider -> GPIO34)
  false,  // pH         - no hardware yet
  false,  // dissolvedOxygen - no hardware yet
  false   // flowRate   - no hardware yet
};

// -------------------- Node ID - must match wqms nodes (e.g. node_01, node_02) --------------------
#define NODE_ID       "N1"
#define NODE_LOCATION "Test Location 1"

// -------------------- OLED --------------------
SSD1306Wire factory_display(0x3c, 500000, SDA_OLED, SCL_OLED, GEOMETRY_128_64, RST_OLED);

static void VextON() {
  pinMode(Vext, OUTPUT);
  digitalWrite(Vext, LOW);
}
static void VextOFF() {
  pinMode(Vext, OUTPUT);
  digitalWrite(Vext, HIGH);
}

static void oledShowLines(const String &l1, const String &l2 = "", const String &l3 = "",
                          const String &l4 = "", const String &l5 = "") {
  factory_display.clear();
  factory_display.setFont(ArialMT_Plain_10);
  factory_display.drawString(0, 0,  l1);
  if (l2.length()) factory_display.drawString(0, 12, l2);
  if (l3.length()) factory_display.drawString(0, 24, l3);
  if (l4.length()) factory_display.drawString(0, 36, l4);
  if (l5.length()) factory_display.drawString(0, 48, l5);
  factory_display.display();
}

// -------------------- Radio events --------------------
static RadioEvents_t RadioEvents;

static volatile bool txDoneFlag    = false;
static volatile bool txTimeoutFlag = false;
static volatile bool rxDoneFlag    = false;

void OnTxDone(void) {
  txDoneFlag = true;
}
void OnTxTimeout(void) {
  txTimeoutFlag = true;
}
void OnRxDone(uint8_t *payload, uint16_t size, int16_t rssi, int8_t snr) {
  lastRssi = rssi;
  lastSnr  = snr;

  rxSize = (size >= (RX_BUF_SIZE - 1)) ? (RX_BUF_SIZE - 1) : size;
  memcpy(rxBuf, payload, rxSize);
  rxBuf[rxSize] = '\0';

  rxDoneFlag = true;
  Radio.Sleep();
}

// -------------------- ACK + Command helpers --------------------
static bool isAckForSeq(const char* s, uint32_t seq) {
  if (strncmp(s, "ACK,", 4) != 0) return false;
  uint32_t got = (uint32_t)strtoul(s + 4, nullptr, 10);
  return got == seq;
}

// Parse optional CMD:xxx from ACK; returns command or NULL. Caller must not free.
static const char* parseCommandFromAck(const char* s) {
  const char* p = strstr(s, ",CMD:");
  if (!p) return nullptr;
  return p + 5;  // points to command string after "CMD:"
}

static bool isReadOrDiagCommand(const char* cmd) {
  if (!cmd) return false;
  if (strstr(cmd, "diag") != nullptr) return true;
  if (strstr(cmd, "read") != nullptr) return true;
  return false;
}

static bool isTestCommand(const char* cmd) {
  if (!cmd) return false;
  return (strncmp(cmd, "test:", 5) == 0);
}

// Parse standalone CMD:diag:node_01 (from proactive TX) - returns true if for us
static bool isCommandForThisNode(const char* s) {
  if (strncmp(s, "CMD:", 4) != 0) return false;
  const char* colon = strrchr(s, ':');
  if (!colon || colon == s || colon[1] == '\0') return false;
  return strcmp(colon + 1, NODE_ID) == 0;
}

// -------------------- Radio config --------------------
static void configureRadio() {
  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);

  RadioEvents.TxDone    = OnTxDone;
  RadioEvents.TxTimeout = OnTxTimeout;
  RadioEvents.RxDone    = OnRxDone;

  Radio.Init(&RadioEvents);
  Radio.SetChannel(RF_FREQUENCY);

  Radio.SetTxConfig(MODEM_LORA, TX_OUTPUT_POWER, 0, LORA_BANDWIDTH,
                    LORA_SPREADING_FACTOR, LORA_CODINGRATE,
                    LORA_PREAMBLE_LENGTH, LORA_FIX_LENGTH_PAYLOAD_ON,
                    LORA_CRC_ON, 0, 0, LORA_IQ_INVERSION_ON, 3000);

  Radio.SetRxConfig(MODEM_LORA, LORA_BANDWIDTH, LORA_SPREADING_FACTOR,
                    LORA_CODINGRATE, 0, LORA_PREAMBLE_LENGTH,
                    LORA_SYMBOL_TIMEOUT, LORA_FIX_LENGTH_PAYLOAD_ON,
                    0, LORA_CRC_ON, 0, 0, LORA_IQ_INVERSION_ON, true);
}

// -------------------- NTP / time helpers --------------------
static bool     s_timeSynced    = false;
static uint32_t s_lastNtpSyncMs = 0;

// Connect to WiFi (non-blocking with timeout), returns true if connected
static bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  oledShowLines("NTP Sync", "WiFi connecting...", WIFI_SSID);
  Serial.printf("[WiFi] Connecting to %s\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Connected: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }

  Serial.println("[WiFi] Connection failed");
  return false;
}

// Perform NTP sync; WiFi is brought up temporarily if not already connected.
// After sync, WiFi is disconnected to free radio resources for LoRa.
// Retries once if the first attempt fails (DNS can be slow on cold boot).
static void syncNTP() {
  bool wifiWasConnected = (WiFi.status() == WL_CONNECTED);

  if (!connectWiFi()) {
    Serial.println("[NTP] Skipping sync - no WiFi");
    oledShowLines("NTP Sync", "WiFi failed", "Running w/o NTP");
    delay(1200);
    return;
  }

  // Two attempts: first attempt can fail on cold boot due to DNS lag.
  // Each attempt polls for up to 10s (20 x 500ms) with live OLED progress.
  bool synced = false;
  for (int attempt = 1; attempt <= 2 && !synced; attempt++) {
    Serial.printf("[NTP] Attempt %d/2...\n", attempt);
    configTime(NTP_TIMEZONE_SECS, 0, NTP_SERVER_1, NTP_SERVER_2);

    struct tm timeinfo;
    for (int i = 1; i <= 20 && !synced; i++) {
      delay(500);
      // Show live countdown so it's clear the node isn't frozen
      char progressBuf[24];
      snprintf(progressBuf, sizeof(progressBuf), "Try %d/2  [%2d/20]", attempt, i);
      oledShowLines("NTP Sync", "Syncing time...", progressBuf);

      if (getLocalTime(&timeinfo)) {
        synced = true;
      }
    }

    if (!synced && attempt < 2) {
      Serial.println("[NTP] Attempt 1 failed, retrying...");
      oledShowLines("NTP Sync", "Retry...", "");
      delay(500);
    }
  }

  if (synced) {
    s_timeSynced    = true;
    s_lastNtpSyncMs = millis();
    time_t now = time(nullptr);
    Serial.printf("[NTP] Synced: epoch=%lu\n", (unsigned long)now);
    oledShowLines("NTP Sync", "OK", String("epoch=") + (unsigned long)now);
    delay(800);
  } else {
    Serial.println("[NTP] Sync failed after 2 attempts - running w/o NTP");
    oledShowLines("NTP Sync", "FAILED", "TDMA fallback mode", "Will retry in 1hr");
    delay(1500);
  }

  // Disconnect WiFi so LoRa radio can operate without interference
  if (!wifiWasConnected) {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    Serial.println("[WiFi] Disconnected after NTP sync");
  }
}

// Returns current epoch time in milliseconds.
// Uses NTP-derived time_t (seconds) + millis() sub-second offset since last second boundary.
// Returns 0 if time has never been synced.
static uint64_t epochMillis() {
  if (!s_timeSynced) return 0ULL;
  time_t secs = time(nullptr);
  // millis() rolls over every ~49 days; for sub-second precision within a second this is fine
  uint32_t ms_in_sec = millis() % 1000;
  return (uint64_t)secs * 1000ULL + ms_in_sec;
}

// -------------------- Sample data (when USE_SAMPLE_SENSOR_DATA is 1) --------------------
// Randomized plausible values when no sensors are connected (monitoring + test mode).
// Remove or set USE_SAMPLE_SENSOR_DATA to 0 when sensors are connected.
#if USE_SAMPLE_SENSOR_DATA
static void getSampleSensorValues(float &do_val, float &turbidity, float &ph,
                                  float &flow, float &temp) {
  // Use random() (seeded from esp_random() in setup) so each reading varies per parameter
  temp      = random(2000, 2801) / 100.0f;   // 20.0–28.0 °C
  turbidity = random(5, 61) / 10.0f;         // 0.5–6.0 NTU
  ph        = random(66, 79) / 10.0f;        // 6.6–7.8
  do_val    = random(500, 901) / 100.0f;     // 5.0–9.0 mg/L
  flow      = random(2, 11) / 10.0f;         // 0.2–1.0 m/s
}
#endif

// -------------------- Sensor reading --------------------
// When USE_SAMPLE_SENSOR_DATA is 1, fills with generated test values.
// Otherwise: real sensors only. Invalid or offline -> NAN -> null in JSON.
static void readSensors(float &do_val, float &turbidity, float &ph,
                        float &flow, float &temp) {

#if USE_SAMPLE_SENSOR_DATA
  getSampleSensorValues(do_val, turbidity, ph, flow, temp);
  return;
#endif

  // Temperature - DS18B20 real reading; NAN if offline or invalid
  temp = updateTempSensor();

  // Turbidity - SEN0189 (10k:10k divider -> GPIO34), NTU
  turbidity = readTurbidityNTU();

  // No hardware yet for these - emit null (sensor offline)
  do_val = NAN;
  ph     = NAN;
  flow   = NAN;
}

// Helper: format sensor value or "null" when disconnected or invalid (NaN)
static void fmtOrNull(char *out, size_t outLen, const char *key, float val, bool useNull) {
  if (useNull || isnan(val) || isinf(val)) {
    snprintf(out, outLen, "\"%s\":null", key);
  } else {
    snprintf(out, outLen, "\"%s\":%.2f", key, val);
  }
}
static void fmtOrNullInt(char *out, size_t outLen, const char *key, int val, bool useNull) {
  if (useNull || val < 0) {
    snprintf(out, outLen, "\"%s\":null", key);
  } else {
    snprintf(out, outLen, "\"%s\":%d", key, val);
  }
}

// Build JSON payload.
// Fields:
//   node_id      - fixed node identifier
//   seq_id       - monotonically increasing sequence counter
//   t_node       - NTP epoch timestamp in ms at the moment the reading was generated (0 = unsynced)
//   sensor fields (location is in dashboard nodes table, keyed by node_id) (temperature, turbidity, pH, dissolvedOxygen, flowRate)
//   diagResult   (optional, only when diagnostics were requested)
//   test_run_id  (optional, only when test evaluation mode is active)
//
// t_node is captured by the caller immediately before buildPayload() and must not be modified.
// Use static format buffers to avoid ~140 bytes stack allocation (prevents stack overflow on ESP32)
static char s_do[28], s_turb[28], s_ph[24], s_flow[28], s_temp[28], s_battery[32], s_battery_pct[24];
static void buildPayload(char *buf, size_t bufLen,
                         uint32_t seq_id, uint64_t t_node,
                         float do_val, float turbidity, float ph,
                         float flow, float temp, float battery_voltage,
                         const char *diagResult,
                         const char *testRunId) {

  bool useNullTemp = USE_SAMPLE_SENSOR_DATA ? false : !SENSOR_CONNECTED[0];
  bool useNullTurb = USE_SAMPLE_SENSOR_DATA ? false : !SENSOR_CONNECTED[1];
  bool useNullPh   = USE_SAMPLE_SENSOR_DATA ? false : !SENSOR_CONNECTED[2];
  bool useNullDo   = USE_SAMPLE_SENSOR_DATA ? false : !SENSOR_CONNECTED[3];
  bool useNullFlow = USE_SAMPLE_SENSOR_DATA ? false : !SENSOR_CONNECTED[4];
  fmtOrNull(s_temp, sizeof(s_temp), "temperature",     temp,      useNullTemp);
  fmtOrNull(s_turb, sizeof(s_turb), "turbidity",       turbidity, useNullTurb);
  fmtOrNull(s_ph,   sizeof(s_ph),   "pH",              ph,        useNullPh);
  fmtOrNull(s_do,   sizeof(s_do),   "dissolvedOxygen", do_val,    useNullDo);
  fmtOrNull(s_flow, sizeof(s_flow), "flowRate",        flow,      useNullFlow);
  fmtOrNull(s_battery, sizeof(s_battery), "batteryVoltage", battery_voltage, isnan(battery_voltage));
  int battery_pct = voltageToPercentage(battery_voltage);
  fmtOrNullInt(s_battery_pct, sizeof(s_battery_pct), "batteryPercentage", battery_pct, battery_pct < 0);

  bool hasDiag = diagResult && diagResult[0];
  bool hasTest = testRunId  && testRunId[0];

  if (hasDiag && hasTest) {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,"
             "%s,%s,%s,%s,%s,%s,%s,\"diagResult\":\"%s\",\"test_run_id\":\"%s\"}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node,
             s_temp, s_turb, s_ph, s_do, s_flow, s_battery, s_battery_pct, diagResult, testRunId);
  } else if (hasDiag) {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,"
             "%s,%s,%s,%s,%s,%s,%s,\"diagResult\":\"%s\"}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node,
             s_temp, s_turb, s_ph, s_do, s_flow, s_battery, s_battery_pct, diagResult);
  } else if (hasTest) {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,"
             "%s,%s,%s,%s,%s,%s,%s,\"test_run_id\":\"%s\"}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node,
             s_temp, s_turb, s_ph, s_do, s_flow, s_battery, s_battery_pct, testRunId);
  } else {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,"
             "%s,%s,%s,%s,%s,%s,%s}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node,
             s_temp, s_turb, s_ph, s_do, s_flow, s_battery, s_battery_pct);
  }
}

// -------------------- Remote diagnostics --------------------
static bool runDiagNext       = false;  // Set when receiver sends CMD:diag in ACK
static bool triggerReadingNow = false;  // Set when proactive CMD received (override interval)

// -------------------- Test Evaluation Mode --------------------
// Activated by: CMD:test:start:<interval_ms>:<duration_ms>:<test_run_id>
// Stopped by:   CMD:test:stop:<test_run_id>  OR automatic expiry
#define TEST_RUN_ID_MAX_LEN 64

static bool     s_testModeActive      = false;
static uint32_t s_testIntervalMs      = 0;      // Override sampling interval while in test mode
static uint32_t s_testStartMs         = 0;      // millis() when test mode was activated
static uint32_t s_testDurationMs      = 0;      // How long test mode lasts
static char     s_testRunId[TEST_RUN_ID_MAX_LEN] = "";  // Attached to every telemetry packet

// Returns true if test mode is currently active (checks expiry each call)
static bool testModeActive() {
  if (!s_testModeActive) return false;
  if (millis() - s_testStartMs >= s_testDurationMs) {
    s_testModeActive = false;
    s_testRunId[0]   = '\0';
    Serial.println("[TEST] Test mode expired - reverted to default interval");
    return false;
  }
  return true;
}

// Parse CMD:test:start:<interval_ms>:<duration_ms>:<test_run_id>
// Returns true and fills out-params on success.
static bool parseTestStart(const char* cmd,
                           uint32_t &outInterval, uint32_t &outDuration,
                           char* outRunId, size_t runIdLen) {
  // cmd points to the part after "CMD:" (i.e. "test:start:...")
  if (strncmp(cmd, "test:start:", 11) != 0) return false;
  const char* p = cmd + 11;

  char* end;
  uint32_t iv = (uint32_t)strtoul(p, &end, 10);
  if (!end || *end != ':' || iv == 0) return false;
  p = end + 1;

  uint32_t dur = (uint32_t)strtoul(p, &end, 10);
  if (!end || *end != ':' || dur == 0) return false;
  p = end + 1;

  if (*p == '\0') return false;
  strncpy(outRunId, p, runIdLen - 1);
  outRunId[runIdLen - 1] = '\0';

  outInterval = iv;
  outDuration = dur;
  return true;
}

// Parse CMD:test:stop:<test_run_id> - returns true when in test mode and this is a stop command.
// We accept any test:stop (run_id match not required) so the OLED clears reliably when user stops.
static bool parseTestStop(const char* cmd) {
  if (strncmp(cmd, "test:stop:", 10) != 0) return false;
  return s_testModeActive;
}

// Activate test mode from a parsed start command
static void activateTestMode(uint32_t intervalMs, uint32_t durationMs, const char* runId) {
  s_testModeActive = true;
  s_testIntervalMs = intervalMs;
  s_testDurationMs = durationMs;
  s_testStartMs    = millis();
  strncpy(s_testRunId, runId, TEST_RUN_ID_MAX_LEN - 1);
  s_testRunId[TEST_RUN_ID_MAX_LEN - 1] = '\0';
  Serial.printf("[TEST] Test mode ON  run_id=%s interval=%lums duration=%lums\n",
                s_testRunId, (unsigned long)intervalMs, (unsigned long)durationMs);
}

// Idle OLED throttle (declared here so deactivateTestMode can reset it)
static uint32_t s_lastOledActivityMs = 0;

// Deactivate test mode (stop command or expiry)
static void deactivateTestMode() {
  s_testModeActive = false;
  s_testRunId[0]   = '\0';
  s_lastOledActivityMs = 0;  // Force idle OLED to refresh to MONITOR on next loop
  Serial.println("[TEST] Test mode OFF - reverted to default interval");
}

// -------------------- Adaptive Acquisition State --------------------
static uint8_t  s_acqMode         = ACQ_MODE_DEFAULT;
static uint32_t s_acqIntervalMs   = USER_ACQ_INTERVAL_MS;
static uint32_t s_lastAcqMs       = 0;   // millis() of last acquisition
static int8_t   s_flowThresholdIdx = -1; // 0=15m 1=10m 2=5m 3=1m (current)
static int8_t   s_candidateIdx     = -1; // New threshold being considered
static uint8_t  s_candidateCount   = 0;  // Consecutive checks in candidate threshold

// Flow threshold index from flow rate (m/s): 0->15m, 1->10m, 2->5m, 3->1m
static int8_t flowRateToThresholdIdx(float flowMps) {
  if (flowMps <= FLOW_THRESH_15MIN) return 0;
  if (flowMps <= FLOW_THRESH_10MIN) return 1;
  if (flowMps <= FLOW_THRESH_5MIN)  return 2;
  return 3;
}

static uint32_t thresholdIdxToIntervalMs(int8_t idx) {
  switch (idx) {
    case 0: return ACQ_INTERVAL_15MIN_MS;
    case 1: return ACQ_INTERVAL_10MIN_MS;
    case 2: return ACQ_INTERVAL_5MIN_MS;
    case 3: return ACQ_INTERVAL_1MIN_MS;
    default: return ACQ_INTERVAL_15MIN_MS;
  }
}

// Returns acquisition interval in minutes (for OLED display)
static uint32_t getAcqIntervalMinutes() {
  if (s_acqIntervalMs >= ACQ_INTERVAL_15MIN_MS) return 15;
  if (s_acqIntervalMs >= ACQ_INTERVAL_10MIN_MS) return 10;
  if (s_acqIntervalMs >= ACQ_INTERVAL_5MIN_MS)  return 5;
  return 1;
}

// Update acquisition interval (User-Selected: fixed; Auto-Adapt: flow thresholds + stability)
static void updateAcquisitionInterval() {
  if (s_acqMode == ACQ_MODE_USER) {
    s_acqIntervalMs = USER_ACQ_INTERVAL_MS;
    return;
  }
  // Auto-Adapt: use hard-coded flow rate until sensor available
  float flowMps = HARDCODED_FLOW_MPS;
  int8_t newIdx = flowRateToThresholdIdx(flowMps);

  if (s_flowThresholdIdx < 0) {
    s_flowThresholdIdx = newIdx;
    s_acqIntervalMs    = thresholdIdxToIntervalMs(newIdx);
    s_candidateIdx     = -1;
    s_candidateCount   = 0;
    return;
  }
  if (newIdx == s_flowThresholdIdx) {
    s_candidateIdx   = -1;
    s_candidateCount = 0;
    return;
  }
  if (newIdx == s_candidateIdx) {
    s_candidateCount++;
    if (s_candidateCount >= STABILITY_CONSECUTIVE) {
      s_flowThresholdIdx = newIdx;
      s_acqIntervalMs    = thresholdIdxToIntervalMs(newIdx);
      s_candidateIdx     = -1;
      s_candidateCount   = 0;
    }
  } else {
    s_candidateIdx   = newIdx;
    s_candidateCount = 1;
  }
}

// Latest-reading buffer (updated on acquisition, used on TDMA transmit)
typedef struct {
  float do_val, turbidity, ph, flow, temp;
  uint64_t t_node;  // Epoch ms at acquisition
  bool valid;
} AcqBuffer_t;
static AcqBuffer_t s_acqBuffer = { NAN, NAN, NAN, NAN, NAN, 0, false };

static void acquireAndBuffer() {
  readSensors(s_acqBuffer.do_val, s_acqBuffer.turbidity, s_acqBuffer.ph,
              s_acqBuffer.flow, s_acqBuffer.temp);
  s_acqBuffer.t_node = epochMillis();
  s_acqBuffer.valid  = true;
}

// Handle a test command string (after "CMD:"); returns true if handled.
static bool handleTestCommand(const char* cmd) {
  uint32_t iv = 0, dur = 0;
  char runId[TEST_RUN_ID_MAX_LEN];

  if (parseTestStart(cmd, iv, dur, runId, sizeof(runId))) {
    // Ignore duplicates so repeated CMD:test:start doesn't keep resetting the timer.
    if (s_testModeActive && strcmp(runId, s_testRunId) == 0) {
      Serial.printf("[TEST] Duplicate start ignored (run_id=%s)\n", runId);
      triggerReadingNow = true;  // still send immediately for responsiveness
      return true;
    }
    activateTestMode(iv, dur, runId);
    triggerReadingNow = true;  // Send first test packet immediately
    return true;
  }
  if (parseTestStop(cmd)) {
    deactivateTestMode();
    return true;
  }
  return false;
}

// Static buffers for OLED text (avoids String concatenation stack usage)
static char oledLineBuf[64], oledLineBuf2[32];

// -------------------- Last TX result (shown on idle monitoring screen) --------------------
static uint32_t s_lastSeq      = 0;
static int16_t  s_lastRssi     = 0;
static int8_t   s_lastSnr      = 0;
static bool     s_lastDelivered = false;  // true = ACK received, false = no ACK

static void recordTxResult(uint32_t seq, int16_t rssi, int8_t snr, bool delivered) {
  s_lastSeq       = seq;
  s_lastRssi      = rssi;
  s_lastSnr       = snr;
  s_lastDelivered = delivered;
}

// -------------------- Idle OLED refresh --------------------
#define OLED_HOLD_MS 1500  // How long TX/ACK screens persist before idle screen takes over

static void oledActivity() {
  s_lastOledActivityMs = millis();
}

// Called every loop() iteration; redraws idle screen once OLED_HOLD_MS has elapsed.
// Three display states:
//   TEST MODE        - test evaluation mode is active (started from dashboard)
//   DIAGNOSTICS MODE - a diag/read command is queued for the next transmission
//   MONITORING MODE  - normal operation; shows last SEQ, delivery status, RSSI
static void refreshIdleOled() {
  if (millis() - s_lastOledActivityMs < OLED_HOLD_MS) return;
  s_lastOledActivityMs = millis();  // Throttle redraws to once per hold period

  char ntpBuf[20];
  snprintf(ntpBuf, sizeof(ntpBuf), "%s", s_timeSynced ? "NTP:OK" : "NTP:unsynced");

  if (testModeActive()) {
    uint32_t elapsed   = millis() - s_testStartMs;
    uint32_t remaining = (elapsed < s_testDurationMs) ? (s_testDurationMs - elapsed) : 0;
    uint32_t remSec    = remaining / 1000;
    const char* baseMode = (s_acqMode == ACQ_MODE_USER) ? "User" : "Auto";

    snprintf(oledLineBuf,  sizeof(oledLineBuf),  "ID: %s", s_testRunId);
    snprintf(oledLineBuf2, sizeof(oledLineBuf2), "Base:%s %lumin Ivl:%lums Rem:%lus",
             baseMode, (unsigned long)getAcqIntervalMinutes(),
             (unsigned long)s_testIntervalMs, (unsigned long)remSec);
    oledShowLines("** TEST MODE **", oledLineBuf, oledLineBuf2, ntpBuf, "");

  } else if (runDiagNext) {
    char modeFreqBuf[32];
    const char* modeStr = (s_acqMode == ACQ_MODE_USER) ? "User" : "Auto";
    snprintf(modeFreqBuf, sizeof(modeFreqBuf), "Mode:%s Acq:%lumin",
             modeStr, (unsigned long)getAcqIntervalMinutes());
    char lastBuf[32];
    if (s_lastSeq > 0) {
      snprintf(lastBuf, sizeof(lastBuf), "SEQ:%lu %s",
               (unsigned long)s_lastSeq, s_lastDelivered ? "OK" : "FAIL");
    } else {
      snprintf(lastBuf, sizeof(lastBuf), "No TX yet");
    }
    char slotBuf[32];
    snprintf(slotBuf, sizeof(slotBuf), "Slot:%d Cyc:%lus %s",
             NODE_SLOT, (unsigned long)((TDMA_SLOT_MS * TDMA_NUM_SLOTS) / 1000), ntpBuf);
    oledShowLines("DIAGNOSTICS MODE", modeFreqBuf, "Diag queued", lastBuf, slotBuf);

  } else {
    // Monitoring idle screen — mode, frequency, last TX result
    char modeFreqBuf[32];
    const char* modeStr = (s_acqMode == ACQ_MODE_USER) ? "User" : "Auto";
    snprintf(modeFreqBuf, sizeof(modeFreqBuf), "Mode:%s Acq:%lumin",
             modeStr, (unsigned long)getAcqIntervalMinutes());

    char seqBuf[32];
    char rssiBuf[32];
    char slotBuf[32];
    if (s_lastSeq > 0) {
      snprintf(seqBuf,  sizeof(seqBuf),  "SEQ:%-5lu %s",
               (unsigned long)s_lastSeq,
               s_lastDelivered ? "DELIVERED" : "NO ACK");
      snprintf(rssiBuf, sizeof(rssiBuf), "RSSI:%d  SNR:%d",
               s_lastRssi, s_lastSnr);
    } else {
      snprintf(seqBuf,  sizeof(seqBuf),  "Waiting for slot...");
      snprintf(rssiBuf, sizeof(rssiBuf), "");
    }
    snprintf(slotBuf, sizeof(slotBuf), "Slot:%d Cyc:%lus %s",
             NODE_SLOT, (unsigned long)((TDMA_SLOT_MS * TDMA_NUM_SLOTS) / 1000), ntpBuf);

    oledShowLines("MONITORING MODE", modeFreqBuf, seqBuf, rssiBuf, slotBuf);
  }
}

// -------------------- TX + wait ACK --------------------
static bool sendWithAck(uint32_t seq_id, const char* payload, uint8_t retries, uint32_t ackTimeoutMs) {
  for (uint8_t attempt = 1; attempt <= retries; attempt++) {

    txDoneFlag    = false;
    txTimeoutFlag = false;

    const char* hdr = s_testModeActive ? "TEST 915MHz"
                    : runDiagNext      ? "DIAG 915MHz"
                                       : "MONITOR 915MHz";
    snprintf(oledLineBuf, sizeof(oledLineBuf), "SEQ: %lu Try:%u", (unsigned long)seq_id, attempt);
    oledShowLines(hdr, oledLineBuf, "TX payload...", "", "");
    oledActivity();

    Serial.printf("[TX] seq_id=%lu attempt=%u payload=%s\n",
                  (unsigned long)seq_id, attempt, payload);

    size_t plen = strlen(payload);
    if (plen > 255) {
      Serial.printf("[TX] WARN payload len=%u > 255, truncating - only first 255 bytes sent\n", (unsigned)plen);
      plen = 255;
    }
    Radio.Send((uint8_t*)payload, (uint8_t)plen);

    // Wait TX done
    uint32_t t0 = millis();
    while (!txDoneFlag && !txTimeoutFlag && (millis() - t0) < 4000) {
      Radio.IrqProcess();
      delay(1);
    }

    if (txTimeoutFlag) {
      Serial.println("[TX] TX timeout");
      continue;
    }

    // RX for ACK
    rxDoneFlag = false;
    Radio.Rx(0);

    snprintf(oledLineBuf, sizeof(oledLineBuf), "SEQ: %lu Try:%u", (unsigned long)seq_id, attempt);
    snprintf(oledLineBuf2, sizeof(oledLineBuf2), "timeout %ums", (unsigned)ackTimeoutMs);
    oledShowLines(hdr, oledLineBuf, "WAIT ACK...", oledLineBuf2, "");
    oledActivity();

    uint32_t start = millis();
    while ((millis() - start) < ackTimeoutMs) {
      Radio.IrqProcess();

      if (rxDoneFlag) {
        rxDoneFlag = false;
        Serial.printf("[RX] got=%s RSSI=%d SNR=%d\n", rxBuf, lastRssi, lastSnr);

        if (isAckForSeq(rxBuf, seq_id)) {
          const char* cmd = parseCommandFromAck(rxBuf);
          if (cmd) {
            if (isReadOrDiagCommand(cmd)) {
              runDiagNext = true;
              Serial.println("[CMD] Read/diag requested for next TX");
            } else if (isTestCommand(cmd)) {
              handleTestCommand(cmd);
            }
          }
          recordTxResult(seq_id, lastRssi, lastSnr, true);
          snprintf(oledLineBuf, sizeof(oledLineBuf), "SEQ: %lu", (unsigned long)seq_id);
          snprintf(oledLineBuf2, sizeof(oledLineBuf2), "RSSI:%d SNR:%d", lastRssi, lastSnr);
          const char* statusLine = runDiagNext        ? "DELIVERED + DIAG queued"
                                 : s_testModeActive   ? "DELIVERED + TEST MODE"
                                                      : "DELIVERED OK";
          // Use current mode for header so after test:stop we show MONITOR immediately
          const char* ackHdr = s_testModeActive ? "TEST 915MHz"
                                : runDiagNext   ? "DIAG 915MHz"
                                                : "MONITOR 915MHz";
          oledShowLines(ackHdr, oledLineBuf, statusLine, oledLineBuf2, "");
          oledActivity();
          delay(700);
          return true;
        } else {
          Radio.Rx(0);  // keep listening
        }
      }
      delay(1);
    }

    Serial.println("[ACK] timeout, retry...");
    Radio.Sleep();
    delay(50);
  }

  recordTxResult(seq_id, lastRssi, lastSnr, false);
  snprintf(oledLineBuf, sizeof(oledLineBuf), "SEQ: %lu", (unsigned long)seq_id);
  oledShowLines(s_testModeActive ? "TEST 915MHz"
              : runDiagNext      ? "DIAG 915MHz"
                                 : "MONITOR 915MHz",
                oledLineBuf, "FAILED", "No ACK", "");
  oledActivity();
  delay(900);
  return false;
}

// Simple self-check for diagnostics (DS18B20 present/absent reported via null in JSON)
static const char* runDiagnostics() {
  return "OK";  // In real sensors: validate readings, return "OK" or error string
}

// -------------------- TDMA state --------------------
static uint64_t s_lastTxSlot = UINT64_MAX;

static uint64_t tdmaAbsoluteSlot() {
  if (!s_timeSynced) return UINT64_MAX;
  uint64_t now = epochMillis();
  if (now == 0) return UINT64_MAX;
  return now / TDMA_SLOT_MS;
}

static uint8_t tdmaSlotIndex() {
  uint64_t abs = tdmaAbsoluteSlot();
  if (abs == UINT64_MAX) return 0xFF;
  return (uint8_t)(abs % TDMA_NUM_SLOTS);
}

static uint32_t tdmaSlotOffset() {
  if (!s_timeSynced) return 0;
  uint64_t now = epochMillis();
  if (now == 0) return 0;
  return (uint32_t)(now % TDMA_SLOT_MS);
}

static bool tdmaShouldTx() {
  uint64_t absSlot = tdmaAbsoluteSlot();
  if (absSlot == UINT64_MAX) return false;
  if ((absSlot % TDMA_NUM_SLOTS) != (uint64_t)NODE_SLOT) return false;
  if (absSlot == s_lastTxSlot) return false;
  if (tdmaSlotOffset() >= TDMA_TX_WINDOW_MS) return false;
  return true;
}

// -------------------- Arduino --------------------
static uint32_t seq_id            = 0;
static uint32_t lastSendTime      = 0;  // Used only for NTP-fallback sending
static uint32_t lastCommandListen = 0;

void setup() {
  Serial.begin(115200);

  VextON();
  delay(100);
  factory_display.init();
  factory_display.clear();
  factory_display.display();

  randomSeed(esp_random());

  // NTP sync before LoRa init (WiFi and LoRa share the radio; WiFi is disconnected after sync)
  oledShowLines("BOOT", "NTP time sync...");
  syncNTP();

  oledShowLines("BOOT", "Init radio 915...");
  configureRadio();

  initTempSensor();
  initTurbiditySensor();
  Serial.printf("[DS18B20] Devices found: %d\n", ds18b20.getDeviceCount());
  Serial.println("[Turbidity] SEN0189 init on GPIO34 (10k:10k divider)");

  // Initialize adaptive acquisition (mode, interval, initial buffer)
  updateAcquisitionInterval();
  acquireAndBuffer();
  s_lastAcqMs = millis();

    oledShowLines("MONITORING MODE", "Sender " NODE_ID,
                s_timeSynced ? "NTP: synced" : "NTP: unsynced",
                "TDMA slot " STRINGIFY(NODE_SLOT), "");
  delay(600);
}

void loop() {
  Radio.IrqProcess();

  // Non-blocking DS18B20 update (must be called every loop)
  updateTempSensor();

  uint32_t now = millis();

  // Periodic NTP re-sync (WiFi brought up briefly, then disconnected)
  if (s_timeSynced && (now - s_lastNtpSyncMs >= NTP_RESYNC_MS)) {
    syncNTP();
  }

  bool inTest = testModeActive();

  // Adaptive acquisition: run on timer when NOT in test mode
  if (!inTest) {
    if (now - s_lastAcqMs >= s_acqIntervalMs) {
      updateAcquisitionInterval();
      acquireAndBuffer();
      s_lastAcqMs = now;
    }
  }

  bool shouldTx = false;

  if (triggerReadingNow) {
    shouldTx = true;
  } else if (inTest) {
    shouldTx = (now - lastSendTime >= s_testIntervalMs);
  } else if (s_timeSynced) {
    shouldTx = tdmaShouldTx();
  } else {
    shouldTx = (now - lastSendTime >= TDMA_FALLBACK_MS);
  }

  if (shouldTx) {
    bool needFreshReading = triggerReadingNow || inTest;
    lastSendTime      = now;
    triggerReadingNow = false;
    if (!inTest && s_timeSynced) s_lastTxSlot = tdmaAbsoluteSlot();
    inTest = testModeActive();

    float do_val, turbidity, ph, flow, temp;
    uint64_t t_node;
    if (needFreshReading) {
      readSensors(do_val, turbidity, ph, flow, temp);
      t_node = epochMillis();
      s_acqBuffer.do_val = do_val;
      s_acqBuffer.turbidity = turbidity;
      s_acqBuffer.ph = ph;
      s_acqBuffer.flow = flow;
      s_acqBuffer.temp = temp;
      s_acqBuffer.t_node = t_node;
      s_acqBuffer.valid = true;
    } else {
      if (!s_acqBuffer.valid) {
        updateAcquisitionInterval();
        acquireAndBuffer();
        s_lastAcqMs = now;
      }
      do_val    = s_acqBuffer.do_val;
      turbidity = s_acqBuffer.turbidity;
      ph        = s_acqBuffer.ph;
      flow      = s_acqBuffer.flow;
      temp      = s_acqBuffer.temp;
      t_node    = s_acqBuffer.t_node;
    }

    float battery_voltage = readBatteryVoltage();
    seq_id++;

    const char* diagResult = nullptr;
    if (runDiagNext) {
      diagResult = runDiagnostics();
      runDiagNext = false;
    }

    const char* testRunId = (inTest && s_testRunId[0]) ? s_testRunId : nullptr;

    buildPayload(txBuf, TX_BUF_SIZE, seq_id, t_node,
                 do_val, turbidity, ph, flow, temp, battery_voltage, diagResult, testRunId);

    if (inTest) {
      uint32_t elapsed  = millis() - s_testStartMs;
      uint32_t remaining = (elapsed < s_testDurationMs) ? (s_testDurationMs - elapsed) : 0;
      Serial.printf("[NODE] node_id=%s seq_id=%lu t_node=%llu [TEST run_id=%s remaining=%lums]\n",
                    NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node,
                    s_testRunId, (unsigned long)remaining);
    } else if (s_timeSynced) {
      Serial.printf("[NODE] node_id=%s seq_id=%lu t_node=%llu [TDMA slot=%d abs=%llu offset=%lums]\n",
                    NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node,
                    NODE_SLOT, (unsigned long long)tdmaAbsoluteSlot(), (unsigned long)tdmaSlotOffset());
    } else {
      Serial.printf("[NODE] node_id=%s seq_id=%lu t_node=%llu [TDMA fallback - NTP unsynced]\n",
                    NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node);
    }

    bool ok = sendWithAck(seq_id, txBuf, 3, 1200);
    (void)ok;
  }
  // Periodic listen for proactive commands outside of our TX slot
  else if (now - lastCommandListen >= CMD_LISTEN_INTERVAL_MS) {
    lastCommandListen = now;
    rxDoneFlag = false;
    Radio.Rx(0);

    uint32_t start = millis();
    while (millis() - start < CMD_LISTEN_WINDOW_MS) {
      Radio.IrqProcess();
      if (rxDoneFlag) {
        rxDoneFlag = false;
        Serial.printf("[RX] cmd listen got=%s\n", rxBuf);
        if (isCommandForThisNode(rxBuf)) {
          // Legacy diag/read proactive command
          triggerReadingNow = true;
          runDiagNext       = true;
          Serial.println("[CMD] Proactive cmd - reading now");
          break;
        }
        // Proactive test command: CMD:test:start/stop (may be suffixed with ":<node_id>" by forwarder)
        if (strncmp(rxBuf, "CMD:", 4) == 0) {
          const char* cmd = rxBuf + 4;
          const char* cmdToHandle = cmd;
          static char s_cmdTrim[RX_BUF_SIZE];

          if (strncmp(cmd, "test:start:", 11) == 0 || strncmp(cmd, "test:stop:", 10) == 0) {
            int colons = 0;
            for (const char* p = cmd; *p; p++) if (*p == ':') colons++;

            // Expected:
            //   test:start:<iv>:<dur>:<run_id>   -> 4 colons
            //   test:stop:<run_id>              -> 2 colons
            // If forwarder appends ":<node_id>", colons increments by 1.
            int expected = (strncmp(cmd, "test:start:", 11) == 0) ? 4 : 2;
            if (colons == expected + 1) {
              const char* last = strrchr(cmd, ':');
              if (last && strcmp(last + 1, NODE_ID) == 0) {
                size_t n = (size_t)(last - cmd);
                if (n >= sizeof(s_cmdTrim)) n = sizeof(s_cmdTrim) - 1;
                memcpy(s_cmdTrim, cmd, n);
                s_cmdTrim[n] = '\0';
                cmdToHandle = s_cmdTrim;
              } else {
                // Targeted to a different node; ignore.
                cmdToHandle = nullptr;
              }
            }
          }

          if (cmdToHandle && isTestCommand(cmdToHandle) && handleTestCommand(cmdToHandle)) {
            Serial.println("[CMD] Proactive test cmd handled");
            break;
          }
        }
        Radio.Rx(0);
      }
      delay(1);
    }
    Radio.Sleep();
  }

  refreshIdleOled();
}
