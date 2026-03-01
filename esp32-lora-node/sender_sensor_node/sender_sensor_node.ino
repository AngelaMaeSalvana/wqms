/*
 * WQMS Sensor Node — TEMPLATE FILE (do not flash directly)
 * Copy this folder to node_N3/, node_N4/, etc. and set NODE_SLOT, NODE_ID,
 * NODE_LOCATION, WIFI_SSID, and WIFI_PASSWORD before flashing.
 * Ready-to-flash nodes: see node_N1/ and node_N2/.
 *
 * Heltec LoRa32 V3 - Simulates water quality sensors for testing
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
 *   seq_id and t_node continue normally throughout test mode.
 */
#include "Arduino.h"
#include "LoRaWan_APP.h"
#include <Wire.h>
#include <math.h>
#include "HT_SSD1306Wire.h"
#include <WiFi.h>
#include <time.h>

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
// Adding a new node only requires flashing it with the next available slot
// number — existing nodes never need to be reflashed.
//
// Cycle period = TDMA_NUM_SLOTS * TDMA_SLOT_MS = 8 * 6s = 48s
// Each node transmits once per 48s cycle in its exclusive 6s window.
//
// Slot boundaries are computed from NTP epoch ms (shared clock):
//   slot_index = (epochMs / TDMA_SLOT_MS) % TDMA_NUM_SLOTS
//
// TDMA_TX_WINDOW_MS: TX is only allowed in the first 3500ms of the slot.
//   Must be > (TX airtime + ACK wait + retries) = ~2500ms at SF7.
//   Remaining 2500ms is the guard band against clock drift.
#define NODE_SLOT          0           // CHANGE THIS: N1=0, N2=1, N3=2, N4=3 ...
#define TDMA_NUM_SLOTS     8           // Fixed capacity — supports up to 8 nodes, never change
#define TDMA_SLOT_MS       6000UL      // Slot width in ms  (cycle = 8 * 6s = 48s)
#define TDMA_TX_WINDOW_MS  3500UL      // TX allowed in first 3500ms of slot (2500ms guard band)
#define TDMA_FALLBACK_MS   48000UL     // Fallback interval when NTP unsynced (= 1 full cycle)

// -------------------- Timing --------------------
#define CMD_LISTEN_INTERVAL_MS  2000  // Listen for commands every 2 sec
#define CMD_LISTEN_WINDOW_MS     400  // RX window for commands (ms)

// -------------------- Buffers --------------------
#define RX_BUF_SIZE 128  // For ACK (may include CMD:test:start...) and CMD:diag:<node_id>
#define TX_BUF_SIZE 300

static char rxBuf[RX_BUF_SIZE];
static char txBuf[TX_BUF_SIZE];

static int16_t lastRssi = 0;
static int8_t  lastSnr  = 0;
static uint16_t rxSize  = 0;

// -------------------- Sensor connectivity (for testing: set false = null in JSON) --------------------
// Real sensors: set true when connected; read failure -> use null. Structure always constant.
static const bool SENSOR_CONNECTED[] = {
  true,   // temperature
  true,   // turbidity
  true,   // pH
  true,   // dissolvedOxygen
  false   // flowRate - disconnected for dashboard testing
};

// -------------------- Node ID - must match wqms nodes (e.g. N1, N2, N3) --------------------
// CHANGE THESE before flashing. NODE_ID must match the id registered in the dashboard.
#define NODE_ID       "N?"           // CHANGE: "N1", "N2", "N3" ...
#define NODE_LOCATION "Location ?"   // CHANGE: actual physical location name

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

// -------------------- Random sensor generator --------------------
// Realistic ranges for water quality monitoring
static void readSensors(float &do_val, float &turbidity, float &ph,
                        float &flow, float &temp) {

  // DO (Dissolved Oxygen) - mg/L, typical 0-15, healthy water ~5-12
  do_val    = random(400, 1200) / 100.0f;   // 4.00 - 12.00

  // Turbidity - NTU, 0-100+ (clear < 5, cloudy 5-50, very turbid > 50)
  turbidity = random(0, 800) / 10.0f;       // 0.0 - 80.0

  // pH - 6.0-9.0 typical for surface water
  ph        = random(600, 900) / 100.0f;    // 6.00 - 9.00

  // Flow - L/min
  flow      = random(50, 500) / 10.0f;      // 5.0 - 50.0

  // Temperature - degC, typical water 20-35
  temp      = random(2200, 3600) / 100.0f;  // 22.00 - 36.00
}

// Helper: format sensor value or "null" when disconnected or invalid (NaN)
static void fmtOrNull(char *out, size_t outLen, const char *key, float val, bool useNull) {
  if (useNull || isnan(val) || isinf(val)) {
    snprintf(out, outLen, "\"%s\":null", key);
  } else {
    snprintf(out, outLen, "\"%s\":%.2f", key, val);
  }
}

// Build JSON payload.
// Fields:
//   node_id      - fixed node identifier
//   seq_id       - monotonically increasing sequence counter
//   t_node       - NTP epoch timestamp in ms at the moment the reading was generated (0 = unsynced)
//   location     - human-readable location label
//   sensor fields (temperature, turbidity, pH, dissolvedOxygen, flowRate)
//   diagResult   (optional, only when diagnostics were requested)
//   test_run_id  (optional, only when test evaluation mode is active)
//
// t_node is captured by the caller immediately before buildPayload() and must not be modified.
// Use static format buffers to avoid ~140 bytes stack allocation (prevents stack overflow on ESP32)
static char s_do[28], s_turb[28], s_ph[24], s_flow[28], s_temp[28];
static void buildPayload(char *buf, size_t bufLen,
                         uint32_t seq_id, uint64_t t_node,
                         float do_val, float turbidity, float ph,
                         float flow, float temp,
                         const char *diagResult,
                         const char *testRunId) {

  fmtOrNull(s_temp, sizeof(s_temp), "temperature",     temp,      !SENSOR_CONNECTED[0]);
  fmtOrNull(s_turb, sizeof(s_turb), "turbidity",       turbidity, !SENSOR_CONNECTED[1]);
  fmtOrNull(s_ph,   sizeof(s_ph),   "pH",              ph,        !SENSOR_CONNECTED[2]);
  fmtOrNull(s_do,   sizeof(s_do),   "dissolvedOxygen", do_val,    !SENSOR_CONNECTED[3]);
  fmtOrNull(s_flow, sizeof(s_flow), "flowRate",        flow,      !SENSOR_CONNECTED[4]);

  bool hasDiag = diagResult && diagResult[0];
  bool hasTest = testRunId  && testRunId[0];

  if (hasDiag && hasTest) {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,\"location\":\"%s\","
             "%s,%s,%s,%s,%s,\"diagResult\":\"%s\",\"test_run_id\":\"%s\"}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node, NODE_LOCATION,
             s_temp, s_turb, s_ph, s_do, s_flow, diagResult, testRunId);
  } else if (hasDiag) {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,\"location\":\"%s\","
             "%s,%s,%s,%s,%s,\"diagResult\":\"%s\"}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node, NODE_LOCATION,
             s_temp, s_turb, s_ph, s_do, s_flow, diagResult);
  } else if (hasTest) {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,\"location\":\"%s\","
             "%s,%s,%s,%s,%s,\"test_run_id\":\"%s\"}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node, NODE_LOCATION,
             s_temp, s_turb, s_ph, s_do, s_flow, testRunId);
  } else {
    snprintf(buf, bufLen,
             "{\"node_id\":\"%s\",\"seq_id\":%lu,\"t_node\":%llu,\"location\":\"%s\","
             "%s,%s,%s,%s,%s}",
             NODE_ID, (unsigned long)seq_id, (unsigned long long)t_node, NODE_LOCATION,
             s_temp, s_turb, s_ph, s_do, s_flow);
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

// Parse CMD:test:stop:<test_run_id> - returns true if it matches our active test_run_id
static bool parseTestStop(const char* cmd) {
  if (strncmp(cmd, "test:stop:", 10) != 0) return false;
  const char* id = cmd + 10;
  return (s_testModeActive && strcmp(id, s_testRunId) == 0);
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

// -------------------- Idle OLED refresh --------------------
#define OLED_HOLD_MS 1500  // How long TX/ACK screens persist before idle screen takes over
static uint32_t s_lastOledActivityMs = 0;

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
    // Monitoring idle screen — shows last TX result prominently
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
    snprintf(slotBuf, sizeof(slotBuf), "Slot:%d  Cyc:%lus",
             NODE_SLOT, (unsigned long)((TDMA_SLOT_MS * TDMA_NUM_SLOTS) / 1000));

    oledShowLines("MONITORING MODE", seqBuf, rssiBuf, slotBuf, ntpBuf);
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

    Radio.Send((uint8_t*)payload, (uint8_t)strlen(payload));

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
          oledShowLines(hdr, oledLineBuf, statusLine, oledLineBuf2, "");
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

// Simple self-check for diagnostics (simulated sensors - always OK for test)
static const char* runDiagnostics() {
  return "OK";  // In real sensors: validate readings, return "OK" or error string
}

// -------------------- TDMA state --------------------
// s_lastTxSlot: the ABSOLUTE slot counter of the last transmission.
// Using the absolute counter (not reduced by % NUM_SLOTS) means each slot
// occurrence is unique, so the node correctly re-transmits every cycle.
// Initialized to UINT64_MAX so the very first matching slot fires immediately.
static uint64_t s_lastTxSlot = UINT64_MAX;

// Returns the ABSOLUTE slot counter: total slots elapsed since epoch.
// This number increases monotonically and is unique per slot occurrence.
// Returns UINT64_MAX if NTP is not yet synced.
static uint64_t tdmaAbsoluteSlot() {
  if (!s_timeSynced) return UINT64_MAX;
  uint64_t now = epochMillis();
  if (now == 0) return UINT64_MAX;
  return now / TDMA_SLOT_MS;  // no modulo - unique per slot occurrence
}

// Returns the slot INDEX (0..NUM_SLOTS-1) for display and assignment checks.
static uint8_t tdmaSlotIndex() {
  uint64_t abs = tdmaAbsoluteSlot();
  if (abs == UINT64_MAX) return 0xFF;
  return (uint8_t)(abs % TDMA_NUM_SLOTS);
}

// Returns ms elapsed since the start of the current slot.
// Used to enforce TDMA_TX_WINDOW_MS (guard band).
static uint32_t tdmaSlotOffset() {
  if (!s_timeSynced) return 0;
  uint64_t now = epochMillis();
  if (now == 0) return 0;
  return (uint32_t)(now % TDMA_SLOT_MS);
}

// Returns true when it is this node's turn to transmit and it hasn't
// already transmitted in the current slot occurrence.
static bool tdmaShouldTx() {
  uint64_t absSlot = tdmaAbsoluteSlot();
  if (absSlot == UINT64_MAX) return false;                  // NTP not synced
  if ((absSlot % TDMA_NUM_SLOTS) != (uint64_t)NODE_SLOT) return false; // Not our slot
  if (absSlot == s_lastTxSlot) return false;                // Already sent this occurrence
  if (tdmaSlotOffset() >= TDMA_TX_WINDOW_MS) return false;  // Past TX window (guard band)
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

  oledShowLines("MONITORING MODE", "Sender " NODE_ID,
                s_timeSynced ? "NTP: synced" : "NTP: unsynced",
                "TDMA slot " STRINGIFY(NODE_SLOT), "");
  delay(600);
}

void loop() {
  Radio.IrqProcess();

  uint32_t now = millis();

  // Periodic NTP re-sync (WiFi brought up briefly, then disconnected)
  if (s_timeSynced && (now - s_lastNtpSyncMs >= NTP_RESYNC_MS)) {
    syncNTP();
  }

  // Determine if we should transmit this iteration.
  // Priority: triggerReadingNow (remote command) > test mode interval > TDMA slot.
  // In test mode the TDMA slot constraint is lifted so the dashboard gets rapid readings.
  bool inTest = testModeActive();
  bool shouldTx = false;

  if (triggerReadingNow) {
    shouldTx = true;
  } else if (inTest) {
    // Test mode: use its own interval, ignore TDMA
    shouldTx = (now - lastSendTime >= s_testIntervalMs);
  } else if (s_timeSynced) {
    // Normal TDMA operation
    shouldTx = tdmaShouldTx();
  } else {
    // NTP not yet synced: fall back to simple interval so node isn't silent forever
    shouldTx = (now - lastSendTime >= TDMA_FALLBACK_MS);
  }

  if (shouldTx) {
    lastSendTime      = now;
    triggerReadingNow = false;
    // Record the absolute slot counter so we don't re-transmit this slot occurrence
    if (!inTest && s_timeSynced) s_lastTxSlot = tdmaAbsoluteSlot();

    // Re-check after potential expiry inside testModeActive() above
    inTest = testModeActive();

    float do_val, turbidity, ph, flow, temp;
    readSensors(do_val, turbidity, ph, flow, temp);

    seq_id++;

    // Capture t_node immediately after reading - this is the ground-truth generation timestamp
    uint64_t t_node = epochMillis();

    const char* diagResult = nullptr;
    if (runDiagNext) {
      diagResult = runDiagnostics();
      runDiagNext = false;
    }

    const char* testRunId = (inTest && s_testRunId[0]) ? s_testRunId : nullptr;

    buildPayload(txBuf, TX_BUF_SIZE, seq_id, t_node,
                 do_val, turbidity, ph, flow, temp, diagResult, testRunId);

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
