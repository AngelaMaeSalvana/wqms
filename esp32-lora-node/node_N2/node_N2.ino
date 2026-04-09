/*
 * WQMS Sensor Node (Sender)
 *
 * Duplicated: node_N2/node_N2.ino (repo) and sender_sensor_node_2/sender_sensor_node_2.ino (Arduino sketch
 * folder name). Same content — edit one and copy over the other, or sync both after changes.
 *
 * Heltec LoRa32 V3 - DS18B20 + turbidity (GPIO5, NTU = -0.3881*raw+822.39 on 12-bit ADC) + DO + pH
 * Sends: dissolvedOxygen, turbidity, pH, flowRate, temperature, plus compact raw fields for backend:
 *   turRawV, doRawV (volts), turRaw, doRaw (ADC). Bridge corrects NTU/DO from turRaw/doRaw; pH/temp offsets in JS.
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
 *   seq_id and t_node continue normally throughout test mode.
 *
 * Normal mode (USE_TWO_MINUTE_MEDIAN): 1 min stabilize -> 1 Hz samples (rolling 60) -> per-channel
 * median -> transmit once per cycle on TDMA slot (or immediately if NTP unsynced).
 * Adaptive acquisition: spacing between median cycles is user-selected or flow-based (LoRa CMD:acq:*).
 */
#include "Arduino.h"
#include "LoRaWan_APP.h"
#include <Wire.h>
#include <math.h>
#include <stdlib.h>
#include "HT_SSD1306Wire.h"
#include <WiFi.h>
#include <time.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Preferences.h>

#define DS18B20_PIN 4

// -------------------- Stringify helper (for OLED slot display) --------------------
#define STRINGIFY_INNER(x) #x
#define STRINGIFY(x)       STRINGIFY_INNER(x)

// -------------------- WiFi (for NTP time sync) --------------------
#define WIFI_SSID     "Chikoy2.4_LongAsHenk"
#define WIFI_PASSWORD "FmAZvn3f"

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
#define NODE_SLOT          1           // THIS node's slot (0-based). N1=0, N2=1, N3=2 ...
#define TDMA_NUM_SLOTS     8           // Fixed capacity — supports up to 8 nodes, never change
#define TDMA_SLOT_MS       6000UL      // Slot width in ms  (cycle = 8 * 6s = 48s)
#define TDMA_TX_WINDOW_MS  3500UL      // TX allowed in first 3500ms of slot (2500ms guard band)
#define TDMA_FALLBACK_MS   48000UL     // Fallback interval when NTP unsynced (= 1 full cycle)

// -------------------- Two-minute median (normal mode only) --------------------
#define USE_TWO_MINUTE_MEDIAN  1
#define CYCLE_MS               120000UL
#define STABILIZATION_MS       (1UL * 60 * 1000)  // 1 min sensor settle before 1 Hz sampling
#define WAKE_EARLY_MS          0UL
#define MEDIAN_WINDOW          60
#define SAMPLE_INTERVAL_MS     1000UL

#if USE_TWO_MINUTE_MEDIAN && (STABILIZATION_MS >= CYCLE_MS)
#error STABILIZATION_MS must be less than CYCLE_MS
#endif

// -------------------- Timing --------------------
#define CMD_LISTEN_INTERVAL_MS  1000  // Listen for commands every 1 sec
#define CMD_LISTEN_WINDOW_MS     600  // RX window for commands (ms)
#define LORA_ACK_WAIT_MS        3500U // Forwarder may MQTT publish after ACK; margin for JSON + HiveMQ

// -------------------- Adaptive Data Acquisition (median cycle spacing) --------------------
// User-Selected Mode: minimum time between completed median cycles (from NV or MQTT acq:user:, no fixed default).
// Auto-Adapt Mode: flow-rate thresholds -> interval; 3 consecutive readings before change.
// Each median acquisition takes CYCLE_MS; effective interval is max(user choice, CYCLE_MS).
#define ACQ_MODE_USER  0
#define ACQ_MODE_AUTO  1
#define ACQ_MODE_DEFAULT  ACQ_MODE_USER

#define FLOW_THRESH_15MIN  0.10f
#define FLOW_THRESH_10MIN  0.40f
#define FLOW_THRESH_5MIN   0.80f
#define HARDCODED_FLOW_MPS  0.25f
#define STABILITY_CONSECUTIVE  3

#define ACQ_INTERVAL_1MIN_MS   (1UL * 60 * 1000)
#define ACQ_INTERVAL_5MIN_MS   (5UL * 60 * 1000)
#define ACQ_INTERVAL_10MIN_MS  (10UL * 60 * 1000)
#define ACQ_INTERVAL_15MIN_MS  (15UL * 60 * 1000)

// -------------------- Battery (single Li-ion: 4.2V=100%, 3.3V=0%) --------------------
// Set to 0 to use ADC on BATTERY_PIN again.
#define HARDCODE_BATTERY_FULL  1
#define BATTERY_PIN 39                       // ADC1 - voltage divider; use -1 to disable
#define BATTERY_VOLTAGE_DIVIDER 2.0f        // V_battery = adc_voltage * DIVIDER
#define ADC_MAX_VALUE 4095
#define ESP32_VOLTAGE_REF 3.3f

// -------------------- Buffers --------------------
#define RX_BUF_SIZE 128  // For ACK (may include CMD:test:start...) and CMD:diag:<node_id>
#define TX_BUF_SIZE 380

static char rxBuf[RX_BUF_SIZE];
static char txBuf[TX_BUF_SIZE];

static int16_t lastRssi = 0;
static int8_t  lastSnr  = 0;
static uint16_t rxSize  = 0;

// -------------------- Sample / test data (set to 1 for random test values; 0 = hardware below) --------------------
#define USE_SAMPLE_SENSOR_DATA  0

// -------------------- Dissolved oxygen (analog module -> ADC) --------------------
#define DO_PIN        2
static const float DO_CALIB_K = 0.00472f;  // mg/L per ADC count (calibrated)

// -------------------- pH (analog module) --------------------
// PH_ADC_PIN = 1 per your wiring (note: GPIO1 is UART0 TX on many ESP32 boards — avoid Serial conflicts).
#define PH_ADC_PIN    1
#define PH_ARRAY_LEN  40
static float PH_SLOPE     = -0.005119f;
static float PH_INTERCEPT = 15.33f;
static int   s_phReadings[PH_ARRAY_LEN];
static int   s_phBufIndex = 0;

// -------------------- Sensor connectivity (false = null in JSON when not USE_SAMPLE) --------------------
static const bool SENSOR_CONNECTED[] = {
  true,   // temperature (DS18B20)
  true,   // turbidity (GPIO5, linear raw ADC NTU)
  true,   // pH
  true,   // dissolvedOxygen
  false   // flowRate
};

// -------------------- Node ID - must match wqms nodes (e.g. node_01, node_02) --------------------
#define NODE_ID       "N2"
#define NODE_LOCATION "Test Location 2"

// Rolling median row — defined here (not inside #if) so Arduino always sees the type before medRingPush().
struct MedianSample {
  float do_val, turbidity, ph, flow, temp;
#if !USE_SAMPLE_SENSOR_DATA
  float turV, doV, turRaw;
  int doRaw;
#endif
};
typedef MedianSample MedeanSample;

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

static bool isAcqCommand(const char* cmd) {
  if (!cmd) return false;
  return (strncmp(cmd, "acq:", 4) == 0);
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

// -------------------- DS18B20 --------------------
OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);

static bool dsConversionInProgress = false;
static unsigned long dsRequestTime  = 0;
static float dsLatestTempC          = NAN;

static void initTempSensor() {
  pinMode(DS18B20_PIN, INPUT_PULLUP);
  ds18b20.begin();
  ds18b20.setWaitForConversion(false);
}

// Non-blocking conversion like standalone DS18B20 test: 800 ms wait, then read.
// Only reject true disconnect / NaN — do not clamp to a narrow °C band (that caused null in JSON).
static float updateTempSensor() {
  unsigned long now = millis();

  if (!dsConversionInProgress) {
    ds18b20.requestTemperatures();
    dsRequestTime          = now;
    dsConversionInProgress = true;
  }

  if (dsConversionInProgress && (now - dsRequestTime >= 800)) {
    float t = ds18b20.getTempCByIndex(0);
    if (t == DEVICE_DISCONNECTED_C || isnan(t)) {
      dsLatestTempC = NAN;
    } else {
      dsLatestTempC = t;
    }
    dsConversionInProgress = false;
  }

  return dsLatestTempC;
}

// -------------------- Turbidity (GPIO5) — same as lab sketch: 12-bit ADC, fault if raw < 1500 --------------------
// NTU = -0.3881*raw + 822.39; NTU < 0 → clamp to 0. Low raw → high NTU (negative slope).
#define TURB_ADC_PIN 5
static const int   TURB_SAMPLES         = 30;
static const int   TURB_SAMPLE_DELAYMS  = 5;
static const int   TURB_RAW_MIN_VALID   = 1500;     // below: disconnected / faulty (matches Serial test sketch)
static const float TURB_NTU_K           = -0.3881f;
static const float TURB_NTU_B           = 822.39f;
static const float TURBIDITY_MAX_VALID_NTU = 4000.0f;

static float readTurbidityRawAvg() {
  uint32_t sum = 0;
  for (int i = 0; i < TURB_SAMPLES; i++) {
    sum += analogRead(TURB_ADC_PIN);
    delay(TURB_SAMPLE_DELAYMS);
  }
  return (float)sum / (float)TURB_SAMPLES;
}

static void initTurbiditySensor() {
  analogSetPinAttenuation(TURB_ADC_PIN, ADC_11db);
}

// Last sample for LoRa JSON: turRaw = ADC counts, turRawV = pin voltage (V)
static float s_lastTurbidityRawAdc        = NAN;
static float s_lastTurbiditySensorVoltage = NAN;

static float readTurbidityNTU() {
  float rawAvg = readTurbidityRawAvg();
  if (rawAvg < (float)TURB_RAW_MIN_VALID) {
    s_lastTurbidityRawAdc        = NAN;
    s_lastTurbiditySensorVoltage = NAN;
    return NAN;
  }
  s_lastTurbidityRawAdc        = rawAvg;
  s_lastTurbiditySensorVoltage = rawAvg * (ESP32_VOLTAGE_REF / (float)ADC_MAX_VALUE);

  float ntu = TURB_NTU_K * rawAvg + TURB_NTU_B;
  if (ntu < 0.0f) ntu = 0.0f;
  if (ntu > TURBIDITY_MAX_VALID_NTU) ntu = TURBIDITY_MAX_VALID_NTU;
  return ntu;
}

// -------------------- Dissolved oxygen & pH --------------------
static double averagePhArray(const int* arr, int n) {
  long sum = 0;
  for (int i = 0; i < n; i++) sum += arr[i];
  return (double)sum / (double)n;
}

static void initDoPhAdc() {
  analogSetPinAttenuation(DO_PIN, ADC_11db);
  analogSetPinAttenuation(PH_ADC_PIN, ADC_11db);
  int v = analogRead(PH_ADC_PIN);
  for (int i = 0; i < PH_ARRAY_LEN; i++) s_phReadings[i] = v;
  s_phBufIndex = 0;
}

static int   s_lastDoRawAdc     = -1;
static float s_lastDoPinVoltage = NAN;

static float readDissolvedOxygenMgL() {
  int raw = analogRead(DO_PIN);
  s_lastDoRawAdc     = raw;
  s_lastDoPinVoltage = (float)raw * (ESP32_VOLTAGE_REF / (float)ADC_MAX_VALUE);
  return DO_CALIB_K * (float)raw;
}

static float readPh() {
  s_phReadings[s_phBufIndex++] = analogRead(PH_ADC_PIN);
  if (s_phBufIndex >= PH_ARRAY_LEN) s_phBufIndex = 0;
  double avgRaw = averagePhArray(s_phReadings, PH_ARRAY_LEN);
  return (float)(PH_SLOPE * avgRaw + PH_INTERCEPT);
}

// -------------------- Sensor reading --------------------
// When USE_SAMPLE_SENSOR_DATA is 1, node sends randomized plausible values (no sensors yet).
#if USE_SAMPLE_SENSOR_DATA
static void readSensors(float &do_val, float &turbidity, float &ph,
                        float &flow, float &temp) {
  s_lastTurbidityRawAdc        = NAN;
  s_lastTurbiditySensorVoltage = NAN;
  s_lastDoRawAdc               = -1;
  s_lastDoPinVoltage           = NAN;
  temp      = random(2000, 2801) / 100.0f;   // 20.0–28.0 °C
  turbidity = random(5, 61) / 10.0f;         // 0.5–6.0 NTU
  ph        = random(66, 79) / 10.0f;        // 6.6–7.8
  do_val    = random(500, 901) / 100.0f;     // 5.0–9.0 mg/L
  flow      = random(2, 11) / 10.0f;         // 0.2–1.0 m/s
}
#else
static void readSensors(float &do_val, float &turbidity, float &ph,
                        float &flow, float &temp) {
  temp      = dsLatestTempC;
  turbidity = readTurbidityNTU();
  do_val    = readDissolvedOxygenMgL();
  ph        = readPh();
  flow      = NAN;
}
#endif

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
//   sensor fields (temperature, turbidity, pH, dissolvedOxygen, flowRate)
//   turRawV, doRawV — raw voltages (V); turRaw, doRaw — ADC counts for backend linear correction
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

  char s_rawExtra[192];
#if USE_SAMPLE_SENSOR_DATA
  snprintf(s_rawExtra, sizeof(s_rawExtra),
           "\"turRawV\":null,\"doRawV\":null,\"turRaw\":null,\"doRaw\":null");
#else
  char turV[40], turR[28], doV[40], doR[28];
  if (useNullTurb || isnan(s_lastTurbiditySensorVoltage) || isnan(s_lastTurbidityRawAdc)) {
    snprintf(turV, sizeof(turV), "\"turRawV\":null");
    snprintf(turR, sizeof(turR), "\"turRaw\":null");
  } else {
    snprintf(turV, sizeof(turV), "\"turRawV\":%.2f", s_lastTurbiditySensorVoltage);
    snprintf(turR, sizeof(turR), "\"turRaw\":%d", (int)(s_lastTurbidityRawAdc + 0.5f));
  }
  if (useNullDo || s_lastDoRawAdc < 0) {
    snprintf(doV, sizeof(doV), "\"doRawV\":null");
    snprintf(doR, sizeof(doR), "\"doRaw\":null");
  } else {
    snprintf(doV, sizeof(doV), "\"doRawV\":%.2f", s_lastDoPinVoltage);
    snprintf(doR, sizeof(doR), "\"doRaw\":%d", s_lastDoRawAdc);
  }
  snprintf(s_rawExtra, sizeof(s_rawExtra), "%s,%s,%s,%s", turV, turR, doV, doR);
#endif

  bool hasDiag = diagResult && diagResult[0];
  bool hasTest = testRunId  && testRunId[0];

  if (hasDiag && hasTest) {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,"
             "%s,%s,%s,%s,%s,%s,%s,%s,\"diagResult\":\"%s\",\"test_run_id\":\"%s\"}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node,
             s_temp, s_turb, s_ph, s_do, s_flow, s_battery, s_battery_pct, s_rawExtra, diagResult, testRunId);
  } else if (hasDiag) {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,"
             "%s,%s,%s,%s,%s,%s,%s,%s,\"diagResult\":\"%s\"}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node,
             s_temp, s_turb, s_ph, s_do, s_flow, s_battery, s_battery_pct, s_rawExtra, diagResult);
  } else if (hasTest) {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,"
             "%s,%s,%s,%s,%s,%s,%s,%s,\"test_run_id\":\"%s\"}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node,
             s_temp, s_turb, s_ph, s_do, s_flow, s_battery, s_battery_pct, s_rawExtra, testRunId);
  } else {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,"
             "%s,%s,%s,%s,%s,%s,%s,%s}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node,
             s_temp, s_turb, s_ph, s_do, s_flow, s_battery, s_battery_pct, s_rawExtra);
  }
}

// -------------------- Adaptive acquisition (LoRa CMD:acq:* from dashboard) --------------------
static uint8_t  s_acqMode             = ACQ_MODE_DEFAULT;
/* Bootstrap = CYCLE_MS only (one median window); real choice comes from NV or acq:user: — not a product default. */
static uint32_t s_userAcqIntervalMs   = CYCLE_MS;
static uint32_t s_acqIntervalMs       = CYCLE_MS;
static bool     s_pendingAcqPending   = false;
static uint8_t  s_pendingAcqMode      = ACQ_MODE_USER;
static uint32_t s_pendingUserIntervalMs = CYCLE_MS;
static int8_t   s_flowThresholdIdx    = -1;
static int8_t   s_candidateIdx        = -1;
static uint8_t   s_candidateCount     = 0;

// Idle OLED throttle (must be declared before queueAcquisitionConfig resets it)
static uint32_t s_lastOledActivityMs = 0;

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

/** Rounded minutes for display (1–120) from any ms interval. */
static uint32_t msToDisplayMinutes(uint32_t ms) {
  uint32_t m = (uint32_t)((ms + 30000UL) / 60000UL);
  if (m < 1) m = 1;
  if (m > 120) m = 120;
  return m;
}

static uint32_t getAcqIntervalMinutes(void) {
  return msToDisplayMinutes(s_acqIntervalMs);
}

static void queueAcquisitionConfig(uint8_t mode, uint32_t userIntervalMs) {
  s_pendingAcqPending = true;
  s_pendingAcqMode    = mode;
  /* Only store minutes for user mode. acq:auto used to pass a placeholder ms here and overwrote
     a pending acq:user:N — never touch pending ms for AUTO. */
  if (mode == ACQ_MODE_USER) {
    s_pendingUserIntervalMs = userIntervalMs;
  }
  s_lastOledActivityMs = 0;  // bypass refreshIdleOled throttle so "Next:…" shows this loop
  Serial.printf("[ACQ] Config queued — applies after current spacing elapses (mode=%u userMs=%lu)\n",
                (unsigned)mode, (unsigned long)userIntervalMs);
}

static bool parseAcqCommand(const char* cmd, uint8_t* modeOut, uint32_t* userIntervalMsOut) {
  if (!cmd || !modeOut || !userIntervalMsOut) return false;
  if (strncmp(cmd, "acq:auto", 8) == 0 && (cmd[8] == '\0' || cmd[8] == ':')) {
    *modeOut = ACQ_MODE_AUTO;
    *userIntervalMsOut = 0;  /* unused for AUTO (queue does not overwrite pending user ms) */
    return true;
  }
  if (strncmp(cmd, "acq:user:", 9) == 0) {
    unsigned long m = strtoul(cmd + 9, nullptr, 10);
    if (m >= 1 && m <= 120) {
      *modeOut = ACQ_MODE_USER;
      *userIntervalMsOut = (uint32_t)(m * 60UL * 1000UL);
      return true;
    }
  }
  return false;
}

static bool handleAcqCommand(const char* cmd) {
  uint8_t mode;
  uint32_t userMs;
  if (!parseAcqCommand(cmd, &mode, &userMs)) return false;
  queueAcquisitionConfig(mode, userMs);
  return true;
}

static void updateAcquisitionInterval() {
  if (s_acqMode == ACQ_MODE_USER) {
    s_acqIntervalMs = s_userAcqIntervalMs;
    if (s_acqIntervalMs < CYCLE_MS) s_acqIntervalMs = CYCLE_MS;
    return;
  }
  float flowMps = HARDCODED_FLOW_MPS;
  int8_t newIdx = flowRateToThresholdIdx(flowMps);

  if (s_flowThresholdIdx < 0) {
    s_flowThresholdIdx = newIdx;
    s_acqIntervalMs    = thresholdIdxToIntervalMs(newIdx);
    if (s_acqIntervalMs < CYCLE_MS) s_acqIntervalMs = CYCLE_MS;
    s_candidateIdx     = -1;
    s_candidateCount     = 0;
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
      if (s_acqIntervalMs < CYCLE_MS) s_acqIntervalMs = CYCLE_MS;
      s_candidateIdx     = -1;
      s_candidateCount   = 0;
    }
  } else {
    s_candidateIdx   = newIdx;
    s_candidateCount = 1;
  }
}

// Persist acquisition mode + user interval across reboots (MQTT acq:* may not be heard after power cycle).
#define ACQ_PREFS_NS     "wqms"
#define ACQ_PREFS_MAGIC  0xAC710502u  // bump if layout changes
static void saveAcqPrefs(void) {
  Preferences prefs;
  if (!prefs.begin(ACQ_PREFS_NS, false)) return;
  prefs.putUInt("magic", ACQ_PREFS_MAGIC);
  prefs.putUChar("mode", s_acqMode);
  prefs.putUInt("user_ms", s_userAcqIntervalMs);
  prefs.end();
  Serial.printf("[ACQ] Saved to NV: mode=%u userMs=%lu\n", (unsigned)s_acqMode, (unsigned long)s_userAcqIntervalMs);
}

static void loadAcqPrefs(void) {
  Preferences prefs;
  if (!prefs.begin(ACQ_PREFS_NS, true)) {
    updateAcquisitionInterval();
    return;
  }
  uint32_t magic = prefs.getUInt("magic", 0);
  if (magic != ACQ_PREFS_MAGIC) {
    prefs.end();
    Serial.println("[ACQ] No valid NV config — spacing = CYCLE_MS until acq:* applies");
    updateAcquisitionInterval();
    return;
  }
  uint8_t mode = prefs.getUChar("mode", ACQ_MODE_USER);
  uint32_t ums = prefs.getUInt("user_ms", CYCLE_MS);
  prefs.end();
  if (mode != ACQ_MODE_USER && mode != ACQ_MODE_AUTO) mode = ACQ_MODE_USER;
  if (ums < CYCLE_MS || ums > 7200000UL) ums = CYCLE_MS;  // clamp to valid range; min = CYCLE_MS
  s_acqMode           = mode;
  s_userAcqIntervalMs = ums;
  updateAcquisitionInterval();
  Serial.printf("[ACQ] Loaded from NV: mode=%u userMs=%lu (spacing=%lu ms)\n",
                (unsigned)s_acqMode, (unsigned long)s_userAcqIntervalMs, (unsigned long)s_acqIntervalMs);
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

// Deactivate test mode (stop command or expiry)
static void deactivateTestMode() {
  s_testModeActive = false;
  s_testRunId[0]   = '\0';
  s_lastOledActivityMs = 0;  // Force idle OLED to refresh to MONITOR on next loop
  Serial.println("[TEST] Test mode OFF - reverted to default interval");
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

static void oledActivity(void);
static void refreshIdleOled(void);

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
    snprintf(oledLineBuf2, sizeof(oledLineBuf2), "ACK wait %ums", (unsigned)ackTimeoutMs);
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
            } else if (isAcqCommand(cmd)) {
              handleAcqCommand(cmd);
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

static const char* runDiagnostics() {
  return "OK";
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

// -------------------- Arduino (timestamps shared by median + legacy TX) --------------------
static uint32_t seq_id            = 0;
static uint32_t lastSendTime      = 0;  // Used for NTP-fallback + legacy interval
static uint32_t lastCommandListen = 0;

#if USE_TWO_MINUTE_MEDIAN
static MedianSample s_medRing[MEDIAN_WINDOW];
static uint8_t      s_medHead = 0;
static uint8_t      s_medCount = 0;
static float        s_medSort[MEDIAN_WINDOW];

enum { MV_STAB = 0, MV_SAMPLE = 1, MV_WAIT_TX = 2, MV_IDLE = 3 };
static uint8_t  s_mvPhase = MV_STAB;
static uint32_t s_mvPhaseStartMs = 0;
static uint32_t s_mvSampleIdx = 0;
static uint32_t s_mvSampleTarget = 0;
static uint32_t s_mvLastSampleMs = 0;
static uint32_t s_lastMedianTxMs = 0;  // millis when last median packet was sent; MV_IDLE spacing
static float    s_mvTxDo = NAN, s_mvTxTurb = NAN, s_mvTxPh = NAN, s_mvTxFlow = NAN, s_mvTxTemp = NAN;

static int compareFloat(const void* a, const void* b) {
  float fa = *(const float*)a;
  float fb = *(const float*)b;
  if (fa < fb) return -1;
  if (fa > fb) return 1;
  return 0;
}

static float medianOfBuffer(float* buf, uint8_t n) {
  if (n == 0) return NAN;
  qsort(buf, n, sizeof(float), compareFloat);
  if (n % 2 == 1) return buf[n / 2];
  return (buf[n / 2 - 1] + buf[n / 2]) / 2.0f;
}

// Per-channel medians (avoid C++ pointer-to-member — some ESP32 toolchains misparse MedianSample::*).
static float medianRingFieldDo(void) {
  uint8_t n = 0;
  for (uint8_t i = 0; i < s_medCount; i++) {
    uint8_t idx = (uint8_t)((s_medHead + MEDIAN_WINDOW - s_medCount + i) % MEDIAN_WINDOW);
    float v = s_medRing[idx].do_val;
    if (!isnan(v) && !isinf(v)) s_medSort[n++] = v;
  }
  return medianOfBuffer(s_medSort, n);
}
static float medianRingFieldTurbidity(void) {
  uint8_t n = 0;
  for (uint8_t i = 0; i < s_medCount; i++) {
    uint8_t idx = (uint8_t)((s_medHead + MEDIAN_WINDOW - s_medCount + i) % MEDIAN_WINDOW);
    float v = s_medRing[idx].turbidity;
    if (!isnan(v) && !isinf(v)) s_medSort[n++] = v;
  }
  return medianOfBuffer(s_medSort, n);
}
static float medianRingFieldPh(void) {
  uint8_t n = 0;
  for (uint8_t i = 0; i < s_medCount; i++) {
    uint8_t idx = (uint8_t)((s_medHead + MEDIAN_WINDOW - s_medCount + i) % MEDIAN_WINDOW);
    float v = s_medRing[idx].ph;
    if (!isnan(v) && !isinf(v)) s_medSort[n++] = v;
  }
  return medianOfBuffer(s_medSort, n);
}
static float medianRingFieldFlow(void) {
  uint8_t n = 0;
  for (uint8_t i = 0; i < s_medCount; i++) {
    uint8_t idx = (uint8_t)((s_medHead + MEDIAN_WINDOW - s_medCount + i) % MEDIAN_WINDOW);
    float v = s_medRing[idx].flow;
    if (!isnan(v) && !isinf(v)) s_medSort[n++] = v;
  }
  return medianOfBuffer(s_medSort, n);
}
static float medianRingFieldTemp(void) {
  uint8_t n = 0;
  for (uint8_t i = 0; i < s_medCount; i++) {
    uint8_t idx = (uint8_t)((s_medHead + MEDIAN_WINDOW - s_medCount + i) % MEDIAN_WINDOW);
    float v = s_medRing[idx].temp;
    if (!isnan(v) && !isinf(v)) s_medSort[n++] = v;
  }
  return medianOfBuffer(s_medSort, n);
}

static void medRingReset() {
  s_medHead = 0;
  s_medCount = 0;
}

static void medRingPush(const struct MedianSample& r) {
  s_medRing[s_medHead] = r;
  s_medHead = (uint8_t)((s_medHead + 1) % MEDIAN_WINDOW);
  if (s_medCount < MEDIAN_WINDOW) s_medCount++;
}

#if !USE_SAMPLE_SENSOR_DATA
static void medRestoreRawFromNewest() {
  if (s_medCount == 0) return;
  uint8_t newest = (uint8_t)((s_medHead + MEDIAN_WINDOW - 1) % MEDIAN_WINDOW);
  s_lastTurbiditySensorVoltage = s_medRing[newest].turV;
  s_lastTurbidityRawAdc        = s_medRing[newest].turRaw;
  s_lastDoPinVoltage           = s_medRing[newest].doV;
  s_lastDoRawAdc               = s_medRing[newest].doRaw;
}
#endif

static void resetMedianFsm() {
  s_mvPhase = MV_STAB;
  s_mvPhaseStartMs = millis();
  s_mvSampleIdx    = 0;
  medRingReset();
}

static void runMedianFsm(uint32_t now) {
  switch (s_mvPhase) {
    case MV_STAB:
      if (now - s_mvPhaseStartMs >= STABILIZATION_MS) {
        s_mvPhase = MV_SAMPLE;
        medRingReset();
        s_mvSampleTarget = (uint32_t)((CYCLE_MS - STABILIZATION_MS) / SAMPLE_INTERVAL_MS);
        if (s_mvSampleTarget == 0) s_mvSampleTarget = 1;
        s_mvSampleIdx     = 0;
        s_mvLastSampleMs  = now - SAMPLE_INTERVAL_MS;
      }
      break;

    case MV_SAMPLE: {
      if (s_mvSampleIdx < s_mvSampleTarget) {
        bool take = (s_mvSampleIdx == 0) || (now - s_mvLastSampleMs >= SAMPLE_INTERVAL_MS);
        if (take) {
          MedianSample row;
          readSensors(row.do_val, row.turbidity, row.ph, row.flow, row.temp);
#if !USE_SAMPLE_SENSOR_DATA
          row.turV   = s_lastTurbiditySensorVoltage;
          row.turRaw = s_lastTurbidityRawAdc;
          row.doV    = s_lastDoPinVoltage;
          row.doRaw  = s_lastDoRawAdc;
#endif
          medRingPush(row);
          s_mvSampleIdx++;
          s_mvLastSampleMs = now;
        }
      }
      if (s_mvSampleIdx >= s_mvSampleTarget) {
        if (s_medCount == 0) {
          resetMedianFsm();
          break;
        }
        s_mvTxDo    = medianRingFieldDo();
        s_mvTxTurb  = medianRingFieldTurbidity();
        s_mvTxPh    = medianRingFieldPh();
        s_mvTxFlow  = medianRingFieldFlow();
        s_mvTxTemp  = medianRingFieldTemp();
        s_mvPhase   = MV_WAIT_TX;
      }
      break;
    }

    case MV_IDLE:
      updateAcquisitionInterval();
      if (now - s_lastMedianTxMs >= s_acqIntervalMs) {
        if (s_pendingAcqPending) {
          s_pendingAcqPending = false;
          s_acqMode = s_pendingAcqMode;
          if (s_acqMode == ACQ_MODE_USER) {
            s_userAcqIntervalMs = s_pendingUserIntervalMs;
          }
          s_lastOledActivityMs = 0;  // show applied Mode:User / Auto line without throttle delay
          Serial.printf("[ACQ] Pending settings applied (mode=%u)\n", (unsigned)s_acqMode);
          saveAcqPrefs();
        }
        updateAcquisitionInterval();
        if (s_acqIntervalMs < CYCLE_MS) s_acqIntervalMs = CYCLE_MS;
        resetMedianFsm();
      }
      break;

    default:
      break;
  }
}
#endif  // USE_TWO_MINUTE_MEDIAN

// Idle OLED must be after median FSM statics (s_mvPhase, s_lastMedianTxMs, …) so names are in scope.
// -------------------- Idle OLED refresh --------------------
#define OLED_HOLD_MS 1500  // How long TX/ACK screens persist before idle screen takes over
#if USE_TWO_MINUTE_MEDIAN
#define OLED_ACQ_COUNTDOWN_MS 500  // Faster refresh while median acquisition countdown is shown
#endif

#if USE_TWO_MINUTE_MEDIAN
static void formatDurationSec(uint32_t totalSec, char* buf, size_t len) {
  uint32_t m = totalSec / 60;
  uint32_t s = totalSec % 60;
  if (m > 999u) m = 999u;
  snprintf(buf, len, "%lum%02lus", (unsigned long)m, (unsigned long)s);
}
#endif

static void oledActivity() {
  s_lastOledActivityMs = millis();
}

// Called every loop(); redraws idle screen (throttled). Median path: acquisition countdown.
static void refreshIdleOled() {
  uint32_t now = millis();
#if USE_TWO_MINUTE_MEDIAN
  const bool medianUi = !testModeActive() && !triggerReadingNow && !runDiagNext;
  uint32_t idleThrottle = (medianUi ? OLED_ACQ_COUNTDOWN_MS : OLED_HOLD_MS);
#else
  uint32_t idleThrottle = OLED_HOLD_MS;
#endif
  if (now - s_lastOledActivityMs < idleThrottle) return;
  s_lastOledActivityMs = now;

  char ntpBuf[20];
  snprintf(ntpBuf, sizeof(ntpBuf), "%s", s_timeSynced ? "NTP:OK" : "NTP:unsynced");

  if (testModeActive()) {
    uint32_t elapsed   = millis() - s_testStartMs;
    uint32_t remaining = (elapsed < s_testDurationMs) ? (s_testDurationMs - elapsed) : 0;
    uint32_t remSec    = remaining / 1000;

    snprintf(oledLineBuf,  sizeof(oledLineBuf),  "ID: %s", s_testRunId);
    snprintf(oledLineBuf2, sizeof(oledLineBuf2), "Ivl:%lums Rem:%lus",
             (unsigned long)s_testIntervalMs, (unsigned long)remSec);
    oledShowLines("** TEST MODE **", oledLineBuf, oledLineBuf2, ntpBuf, "");

  } else if (runDiagNext) {
    char lastBuf[32];
    if (s_lastSeq > 0) {
      snprintf(lastBuf, sizeof(lastBuf), "SEQ:%lu %s",
               (unsigned long)s_lastSeq, s_lastDelivered ? "OK" : "FAIL");
    } else {
      snprintf(lastBuf, sizeof(lastBuf), "No TX yet");
    }
    char slotBuf[32];
    snprintf(slotBuf, sizeof(slotBuf), "Slot:%d  Cyc:%lus",
             NODE_SLOT, (unsigned long)((TDMA_SLOT_MS * TDMA_NUM_SLOTS) / 1000));
    oledShowLines("DIAGNOSTICS MODE", "Diag queued", lastBuf, slotBuf, ntpBuf);

  } else {
    /* Dashboard acq config is queued until the current spacing completes; countdown still uses the
       active interval — show "Next:…" so the new setting is visible immediately. */
    char modeFreqBuf[32];
    if (s_pendingAcqPending) {
      if (s_pendingAcqMode == ACQ_MODE_USER) {
        uint32_t pm = msToDisplayMinutes(s_pendingUserIntervalMs);
        snprintf(modeFreqBuf, sizeof(modeFreqBuf), "Next:User %lumin", (unsigned long)pm);
      } else {
        snprintf(modeFreqBuf, sizeof(modeFreqBuf), "Next:Auto mode");
      }
    } else if (s_acqMode == ACQ_MODE_USER) {
      /* Dashboard "minutes" are s_userAcqIntervalMs; spacing is max(that, CYCLE_MS). */
      uint32_t setM = msToDisplayMinutes(s_userAcqIntervalMs);
      uint32_t spM  = msToDisplayMinutes(s_acqIntervalMs);
      if (setM != spM) {
        snprintf(modeFreqBuf, sizeof(modeFreqBuf), "Mode:User %lum sp%lum", (unsigned long)setM, (unsigned long)spM);
      } else {
        snprintf(modeFreqBuf, sizeof(modeFreqBuf), "Mode:User Acq:%lumin", (unsigned long)setM);
      }
    } else {
      snprintf(modeFreqBuf, sizeof(modeFreqBuf), "Mode:Auto Acq:%lumin",
               (unsigned long)getAcqIntervalMinutes());
    }

#if USE_TWO_MINUTE_MEDIAN
    char countLine[32];
    if (s_mvPhase == MV_IDLE) {
      uint32_t elapsed = now - s_lastMedianTxMs;
      uint32_t remMs   = (s_lastMedianTxMs == 0 || elapsed >= s_acqIntervalMs)
                           ? 0
                           : (s_acqIntervalMs - elapsed);
      formatDurationSec(remMs / 1000, oledLineBuf2, sizeof(oledLineBuf2));
      snprintf(countLine, sizeof(countLine), "Next acq: %s", oledLineBuf2);
    } else if (s_mvPhase == MV_WAIT_TX) {
      snprintf(countLine, sizeof(countLine), "Ready TX wait slot");
    } else {
      /* Remaining time in this 2 min median *run* (CYCLE_MS), not the saved spacing (e.g. 5 min). */
      uint32_t elapsed = now - s_mvPhaseStartMs;
      uint32_t remMs   = (elapsed >= CYCLE_MS) ? 0 : (CYCLE_MS - elapsed);
      formatDurationSec(remMs / 1000, oledLineBuf2, sizeof(oledLineBuf2));
      const char* lab = (s_mvPhase == MV_STAB) ? "Stabilize" : "2m run";
      snprintf(countLine, sizeof(countLine), "%s: %s", lab, oledLineBuf2);
    }
#endif

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

#if USE_TWO_MINUTE_MEDIAN
    char line5[64];
    if (s_lastSeq > 0) {
      snprintf(line5, sizeof(line5), "R:%d SNR:%d | %s", s_lastRssi, s_lastSnr, slotBuf);
    } else {
      snprintf(line5, sizeof(line5), "%s", slotBuf);
    }
    oledShowLines("MONITORING MODE", countLine, modeFreqBuf, seqBuf, line5);
#else
    oledShowLines("MONITORING MODE", modeFreqBuf, seqBuf, rssiBuf, slotBuf);
#endif
  }
}

static void sendTelemetryCore(uint32_t now, float do_val, float turbidity, float ph, float flow, float temp,
                              bool inTestBefore, bool isMedianPacket) {
  lastSendTime = now;
  triggerReadingNow = false;
  if (!inTestBefore && s_timeSynced) s_lastTxSlot = tdmaAbsoluteSlot();

  bool inTest = testModeActive();

#if HARDCODE_BATTERY_FULL
  float battery_voltage = 4.2f;  // full cell -> 100% until divider is reliable
#else
  float battery_voltage = readBatteryVoltage();
#endif

  seq_id++;

  uint64_t t_node = epochMillis();

  const char* diagResult = nullptr;
  if (runDiagNext) {
    diagResult = runDiagnostics();
    runDiagNext = false;
  }

  const char* testRunId = (inTest && s_testRunId[0]) ? s_testRunId : nullptr;

  buildPayload(txBuf, TX_BUF_SIZE, seq_id, t_node,
               do_val, turbidity, ph, flow, temp, battery_voltage, diagResult, testRunId);

  if (isMedianPacket) {
    Serial.printf("[NODE] node_id=%s seq_id=%lu t_node=%llu [MEDIAN window=%d]\n",
                  NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node, MEDIAN_WINDOW);
  } else if (inTest) {
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

  bool ok = sendWithAck(seq_id, txBuf, 3, LORA_ACK_WAIT_MS);
  (void)ok;
}

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

#if !USE_SAMPLE_SENSOR_DATA
  analogReadResolution(12);
  initTempSensor();
  initTurbiditySensor();
  initDoPhAdc();
  Serial.printf("[DS18B20] Devices found: %d\n", ds18b20.getDeviceCount());
  Serial.printf("[Sensors] Turbidity GPIO%d (10k:10k) | DO GPIO%d | pH GPIO%d\n",
                TURB_ADC_PIN, DO_PIN, PH_ADC_PIN);
#endif

  oledShowLines("MONITORING MODE", "Sender " NODE_ID,
                s_timeSynced ? "NTP: synced" : "NTP: unsynced",
                "TDMA slot " STRINGIFY(NODE_SLOT), "");
  delay(600);

#if USE_TWO_MINUTE_MEDIAN
  if (WAKE_EARLY_MS > 0) {
    delay(WAKE_EARLY_MS);
  }
  loadAcqPrefs();
  resetMedianFsm();
#endif
}

void loop() {
  Radio.IrqProcess();

#if !USE_SAMPLE_SENSOR_DATA
  updateTempSensor();
#endif

  uint32_t now = millis();

  // Periodic NTP re-sync (WiFi brought up briefly, then disconnected)
  if (s_timeSynced && (now - s_lastNtpSyncMs >= NTP_RESYNC_MS)) {
    syncNTP();
  }

  bool inTest = testModeActive();

#if USE_TWO_MINUTE_MEDIAN
  static bool s_prevMedianPath = false;
  bool medianPath = !inTest && !triggerReadingNow;
  if (medianPath && !s_prevMedianPath) {
    resetMedianFsm();
  }
  s_prevMedianPath = medianPath;

  if (medianPath) {
    runMedianFsm(now);
  }
#endif

  // Priority: triggerReadingNow (remote command) > test mode interval > TDMA slot.
  // When USE_TWO_MINUTE_MEDIAN and medianPath, legacy TDMA interval is disabled (median FSM handles TX).
  bool shouldTx = false;
#if USE_TWO_MINUTE_MEDIAN
  if (!medianPath)
#endif
  {
    if (triggerReadingNow) {
      shouldTx = true;
    } else if (inTest) {
      shouldTx = (now - lastSendTime >= s_testIntervalMs);
    } else if (s_timeSynced) {
      shouldTx = tdmaShouldTx();
    } else {
      shouldTx = (now - lastSendTime >= TDMA_FALLBACK_MS);
    }
  }

  bool didTx = false;
#if USE_TWO_MINUTE_MEDIAN
  if (medianPath && s_mvPhase == MV_WAIT_TX) {
    bool gate = s_timeSynced ? tdmaShouldTx() : true;
    if (gate) {
#if !USE_SAMPLE_SENSOR_DATA
      medRestoreRawFromNewest();
#endif
      sendTelemetryCore(now, s_mvTxDo, s_mvTxTurb, s_mvTxPh, s_mvTxFlow, s_mvTxTemp, inTest, true);
      s_mvPhase        = MV_IDLE;
      s_lastMedianTxMs = now;
      didTx            = true;
    }
  }
#endif
  if (!didTx && shouldTx) {
    inTest = testModeActive();

    float do_val, turbidity, ph, flow, temp;
    readSensors(do_val, turbidity, ph, flow, temp);
    sendTelemetryCore(now, do_val, turbidity, ph, flow, temp, inTest, false);
#if USE_TWO_MINUTE_MEDIAN
    resetMedianFsm();
#endif
    didTx = true;
  }
  // Proactive CMD:acq / CMD:test from forwarder — must run while MV_WAIT_TX & waiting for slot
  // (previously chained as else-if, so listen was skipped for the whole WAIT_TX phase).
  if (!didTx && (now - lastCommandListen >= CMD_LISTEN_INTERVAL_MS)) {
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

          if (strncmp(cmd, "acq:", 4) == 0) {
            const char* last = strrchr(cmd, ':');
            if (last && last > cmd + 4) {
              if (strcmp(last + 1, NODE_ID) == 0) {
                size_t n = (size_t)(last - cmd);
                if (n >= sizeof(s_cmdTrim)) n = sizeof(s_cmdTrim) - 1;
                memcpy(s_cmdTrim, cmd, n);
                s_cmdTrim[n] = '\0';
                cmdToHandle = s_cmdTrim;
              } else {
                bool minutesOnly = true;
                for (const char* p = last + 1; *p; p++) {
                  if (*p < '0' || *p > '9') { minutesOnly = false; break; }
                }
                if (!minutesOnly) {
                  if (strncmp(last + 1, "node_", 5) == 0 ||
                      (last[1] == 'N' && (last[2] >= '0' && last[2] <= '9'))) {
                    cmdToHandle = nullptr;
                  }
                }
              }
            }
          }

          if (cmdToHandle && isAcqCommand(cmdToHandle) && handleAcqCommand(cmdToHandle)) {
            Serial.println("[CMD] Proactive acq cmd handled");
            break;
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
